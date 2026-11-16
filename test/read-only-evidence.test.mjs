import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createReadOnlyEvidenceVerifier } from '../lib/read-only-evidence.js';
import { signedEvidenceFixture } from '../scripts/fixtures/read-only-evidence.mjs';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { temporaryProfile } from '../scripts/fixtures/smart-mode-profile.mjs';

async function fixture(t) {
  const path = await temporaryProfile(t), data = sourceFixture(); let at = 100000;
  const signed = await signedEvidenceFixture(path, data.scope, [...data.index.values()], at);
  const open = async (io) => {
    const verifier = await createReadOnlyEvidenceVerifier({ profileDir: path, scope: data.scope, now: () => at, io });
    t.after(() => verifier.close()); return verifier;
  };
  const verifier = await open();
  return { ...data, ...signed, path, verifier, open, get at() { return at; }, set at(value) { at = value; } };
}

test('signed evidence is independently admitted, full-fingerprint bound and reproducible after recovery', async (t) => {
  const f = await fixture(t);
  assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_MISSING');
  await f.deliver();
  assert.deepEqual(f.verifier.reviews(), f.payload.reviews);
  assert.equal(f.verifier.status().revision, 1);
  const record = f.payload.reviews[0]; assert.equal(f.verifier.verifyReview(record), true);
  assert.equal(f.verifier.verifyReview({ ...record, definitionFingerprint: 'f'.repeat(64) }), false);
  assert.equal(f.verifier.verifyReview({ ...record, expiresAt: record.expiresAt + 1 }), false);
  assert.equal(f.verifier.verifyReview({ ...record, review: { ...record.review, evidenceHash: 'a'.repeat(64) } }), false);
  assert.deepEqual((await f.open()).reviews(), f.payload.reviews);
  const receipts = join(f.path, 'storages', 'mcp_connector_smart_v1', 'evidence_receipts');
  const files = fs.readdirSync(receipts, { recursive: true }).filter((file) => file.endsWith('.json'));
  const body = fs.readFileSync(join(receipts, files[0]), 'utf8');
  assert.doesNotMatch(body, /PRIVATE KEY|inputSchema|outputSchema|fixture_capability|sample|publicKey/);
});

for (const scenario of ['tampered', 'untrusted-key', 'disabled-key', 'expired-key', 'not-public-key', 'foreign-account', 'foreign-group', 'foreign-profile', 'expired', 'future', 'duplicate-review', 'wrong-review-scope', 'no-reviewer', 'unknown-fields']) {
  test(`evidence fails closed: ${scenario}`, async (t) => {
    const f = await fixture(t), value = structuredClone(f.payload), trust = structuredClone(f.trust);
    if (scenario === 'foreign-account') value.accountRef = 'other-account';
    if (scenario === 'foreign-group') value.groupId = 'legal';
    if (scenario === 'foreign-profile') value.profileBinding = 'e'.repeat(64);
    if (scenario === 'expired') value.expiresAt = f.at;
    if (scenario === 'future') value.notBefore = f.at + 1;
    if (scenario === 'duplicate-review') value.reviews.push(value.reviews[0]);
    if (scenario === 'wrong-review-scope') value.reviews[0].accountRef = 'other';
    if (scenario === 'no-reviewer') delete value.reviews[0].review.reviewerHash;
    if (scenario === 'unknown-fields') value.sourceRelations = [];
    if (scenario === 'disabled-key') trust.keys[0].enabled = false;
    if (scenario === 'expired-key') trust.keys[0].expiresAt = f.at;
    if (scenario === 'not-public-key') trust.keys[0].publicKey = 'not an SPKI public key';
    await f.write('trust.json', trust);
    const bundle = f.bundle(value, scenario === 'untrusted-key' ? 'model-claimed-key' : undefined);
    if (scenario === 'tampered') bundle.payload.reviews[0].definitionFingerprint = 'f'.repeat(64);
    await f.write('bundle.json', bundle);
    assert.deepEqual(f.verifier.reviews(), []); assert.equal(f.verifier.status().status, 'unavailable');
    assert.equal(f.verifier.verifyReview(f.payload.reviews[0]), false);
  });
}

test('signed revocation/omission, expiry and key removal take effect on the next use without restart', async (t) => {
  const f = await fixture(t); await f.deliver(); assert.ok(f.verifier.reviews().length);
  await f.deliver({ ...f.payload, revision: 2, reviews: [] }); assert.deepEqual(f.verifier.effectiveReviews(f.payload.reviews), []);
  await f.deliver(); assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_ROLLBACK');
  const recovered = await f.open(); assert.deepEqual(recovered.reviews(), []);
  await f.deliver({ ...f.payload, revision: 3 }); assert.ok(recovered.reviews().length);
  f.at = f.payload.expiresAt; assert.deepEqual(recovered.reviews(), []);
  f.at = f.payload.issuedAt; await f.write('trust.json', { ...f.trust, keys: [] });
  assert.equal(recovered.status().code, 'READ_ONLY_EVIDENCE_KEY_UNTRUSTED');
});

test('same revision cannot change content; local withdrawal overrides a signed approval', async (t) => {
  const f = await fixture(t); await f.deliver(); assert.ok(f.verifier.reviews().length);
  const withdrawn = { ...f.payload.reviews[0], enabled: false };
  assert.equal(f.verifier.effectiveReviews([withdrawn])[0].enabled, false);
  await f.deliver({ ...f.payload, reviews: [] }); assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_REVISION_CONFLICT');
  await f.deliver({ ...f.payload, revision: 2, reviews: [] }); assert.deepEqual(f.verifier.reviews(), []);
});

test('real disk receipt failure denies acceptance and a later receiver recovers without memory-only approval', async (t) => {
  const f = await fixture(t); await f.deliver();
  const broken = await f.open({ ...fs, linkSync() { throw Object.assign(new Error('synthetic disk failure'), { code: 'EIO' }); } });
  assert.deepEqual(broken.reviews(), []); assert.equal(broken.status().code, 'READ_ONLY_EVIDENCE_IO_FAILED');
  assert.ok(f.verifier.reviews().length);
  const other = await f.open(); assert.deepEqual(other.reviews(), f.payload.reviews);
});

test('uncertain receipt publication requires a successful durability retry, including a fresh receiver', async (t) => {
  const f = await fixture(t); await f.deliver();
  const receiptFds = new Set(); let barrierFails = true, acknowledgements = 0;
  const io = { ...fs,
    openSync(path, ...args) { const fd = fs.openSync(path, ...args);
      if (String(path).includes('evidence_receipts') && !String(path).includes('.pending-')) receiptFds.add(fd); return fd; },
    closeSync(fd) { receiptFds.delete(fd); return fs.closeSync(fd); },
    fsyncSync(fd) {
      if (receiptFds.has(fd)) { acknowledgements++; if (barrierFails) throw Object.assign(new Error('synthetic durability failure'), { code: 'EIO' }); }
      return fs.fsyncSync(fd);
    },
    linkSync(from, to) { fs.linkSync(from, to); throw Object.assign(new Error('uncertain publication'), { code: 'EIO' }); },
  };
  const broken = await f.open(io);
  assert.deepEqual(broken.reviews(), []);
  assert.deepEqual(broken.reviews(), [], 'visible receipt alone cannot complete a failed receive');
  assert.equal(broken.status().code, 'READ_ONLY_EVIDENCE_IO_FAILED');
  const cold = await f.open(io);
  assert.deepEqual(cold.reviews(), [], 'new receiver must also confirm the existing receipt');
  barrierFails = false;
  assert.deepEqual(cold.reviews(), f.payload.reviews);
  const confirmed = acknowledgements;
  assert.ok(confirmed > 0);
  assert.deepEqual(cold.reviews(), f.payload.reviews);
  assert.equal(acknowledgements, confirmed, 'confirmed unchanged receipt needs no repeated fsync on the hot path');
  assert.deepEqual(broken.reviews(), f.payload.reviews);
});

test('a newer concurrent revocation wins while an existing receipt is being acknowledged', async (t) => {
  const f = await fixture(t); await f.deliver(); assert.ok(f.verifier.reviews().length);
  const receiptFds = new Set(); let advanced = false;
  const cold = await f.open({ ...fs,
    openSync(path, ...args) { const fd = fs.openSync(path, ...args);
      if (String(path).includes('evidence_receipts') && !String(path).includes('.pending-')) receiptFds.add(fd); return fd; },
    closeSync(fd) { receiptFds.delete(fd); return fs.closeSync(fd); },
    fsyncSync(fd) {
      fs.fsyncSync(fd);
      if (!advanced && receiptFds.has(fd)) {
        advanced = true;
        fs.writeFileSync(join(f.directory, 'bundle.json'), JSON.stringify(f.bundle({ ...f.payload, revision: 2, reviews: [] })));
        assert.deepEqual(f.verifier.reviews(), []);
      }
    },
  });
  assert.deepEqual(cold.reviews(), []);
  assert.equal(advanced, true);
  assert.equal(cold.status().revision, 2);
  await f.deliver(); assert.equal(cold.status().code, 'READ_ONLY_EVIDENCE_ROLLBACK');
});

test('corrupt receipt, malformed/oversize delivery and missing trust never widen approval', async (t) => {
  const f = await fixture(t); await f.deliver(); assert.ok(f.verifier.reviews().length);
  const receiptBase = join(f.path, 'storages', 'mcp_connector_smart_v1', 'evidence_receipts');
  const receipt = fs.readdirSync(receiptBase, { recursive: true }).find((file) => file.endsWith('.json'));
  fs.writeFileSync(join(receiptBase, receipt), '{}');
  assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_RECEIPT_INVALID');
  fs.writeFileSync(join(f.directory, 'bundle.json'), '{'); assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_MALFORMED');
  fs.writeFileSync(join(f.directory, 'bundle.json'), 'x'.repeat(1024 * 1024 + 1)); assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_TOO_LARGE');
  fs.unlinkSync(join(f.directory, 'trust.json')); assert.deepEqual(f.verifier.reviews(), []);
});

test('independent receivers concurrently publish exactly one durable receipt for the same signed revision', async (t) => {
  const f = await fixture(t); await f.deliver();
  // Use a live clock in workers; their signed validity does not depend on
  // test-process closures or shared in-memory admission state.
  const at = Date.now(), signed = await signedEvidenceFixture(f.path, f.scope, [...f.index.values()], at);
  await signed.deliver();
  const outputs = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../scripts/fixtures/read-only-evidence-worker.mjs', import.meta.url),
      { workerData: { profileDir: f.path, scope: f.scope } });
    worker.on('error', reject); worker.on('message', resolve);
    worker.on('exit', (code) => { if (code) reject(new Error(`evidence worker exited ${code}`)); });
  })));
  assert.ok(outputs.every((output) => output.status === 'verified'), JSON.stringify(outputs));
  const base = join(f.path, 'storages', 'mcp_connector_smart_v1', 'evidence_receipts');
  assert.equal(fs.readdirSync(base, { recursive: true }).filter((file) => file.endsWith('.json')).length, 1);
});

test('a real non-directory receipt target denies acceptance until the disk layout is repaired', async (t) => {
  const f = await fixture(t); await f.deliver();
  const blocked = join(f.path, 'storages', 'mcp_connector_smart_v1', 'evidence_receipts');
  fs.writeFileSync(blocked, 'synthetic write failure', { flag: 'wx' });
  assert.deepEqual(f.verifier.reviews(), []);
  fs.unlinkSync(blocked); assert.equal(f.verifier.status().status, 'verified');
});

test('public-key rotation retains the revision floor and requires a new independently signed bundle', async (t) => {
  const f = await fixture(t); await f.deliver(); assert.equal(f.verifier.status().status, 'verified');
  const next = await signedEvidenceFixture(f.path, f.scope, [...f.index.values()], f.at);
  assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_SIGNATURE_INVALID');
  await next.deliver({ ...next.payload, revision: 2 }); assert.equal(f.verifier.status().revision, 2);
  await f.write('trust.json', f.trust); await f.deliver();
  assert.equal(f.verifier.status().code, 'READ_ONLY_EVIDENCE_ROLLBACK');
});
