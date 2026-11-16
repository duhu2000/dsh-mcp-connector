import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { z } from 'zod';
import { SmartModeStore } from './smart-mode-store.js';
import { readOnlyReviewSchema } from './smart-mode-prepare.js';
import { normalizeSmartEnterpriseScope } from './smart-mode-bindings.js';
import { canonicalSourceJson, sourceError } from './source-relations.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/), ref = z.string().min(1).max(512);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const purpose = 'dsh-read-only-evidence-v1';
const trustSchema = z.strictObject({ version: z.literal(1), accountRef: ref, groupId: ref, profileBinding: hash,
  keys: z.array(z.strictObject({ id: ref, publicKey: z.string().max(256)
    .regex(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/),
  enabled: z.boolean(), notBefore: time, expiresAt: time })).max(16) });
const payloadSchema = z.strictObject({ version: z.literal(1), purpose: z.literal(purpose), accountRef: ref, groupId: ref,
  profileBinding: hash, revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), issuedAt: time,
  notBefore: time, expiresAt: time, reviews: z.array(readOnlyReviewSchema).max(1024) });
const bundleSchema = z.strictObject({ keyId: ref, payload: payloadSchema, signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) });
const receiptSchema = z.strictObject({ version: z.literal(1), accountRef: ref, groupId: ref, profileBinding: hash,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), digest: hash });
const digest = (value) => createHash('sha256').update(canonicalSourceJson(value)).digest('hex');
export const readOnlyEvidenceSigningBytes = (payload) => Buffer.from(`${purpose}\n${canonicalSourceJson(payload)}`, 'utf8');
export const readOnlyEvidenceDirectory = (profileDir) => join(resolve(profileDir), 'smart-mode-evidence');
const parse = (schema, value, code) => { const result = schema.safeParse(value); if (!result.success) throw sourceError(code); return result.data; };

/** Fixed local files, no URLs, credentials, signing or trust-management API.
 * Public trust anchors are provisioned out of band by the profile administrator.
 * Every use revalidates the signed full snapshot and the durable revision floor.
 */
export async function createReadOnlyEvidenceVerifier({ profileDir, scope: inputScope, now = () => Date.now(), io = fs } = {}) {
  const scope = normalizeSmartEnterpriseScope(inputScope);
  const store = await SmartModeStore.open({ profileDir });
  const root = store.rootDir; await store.close();
  const directory = readOnlyEvidenceDirectory(profileDir);
  const receipts = join(root, 'evidence_receipts', digest([scope.accountRef, scope.groupId]));
  let closed = false, nextBoundary = Infinity, last = { status: 'unavailable', code: 'READ_ONLY_EVIDENCE_MISSING', revision: null, reviewCount: 0 };
  const monitors = new Set();

  function directorySafe(path) {
    const stat = io.lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw sourceError('READ_ONLY_EVIDENCE_PATH_REJECTED');
  }
  function read(path, limit = 1024 * 1024) {
    if (io.lstatSync(path).isSymbolicLink()) throw sourceError('READ_ONLY_EVIDENCE_PATH_REJECTED');
    const fd = io.openSync(path, 'r');
    try {
      const stat = io.fstatSync(fd);
      if (!stat.isFile() || stat.size > limit) throw sourceError('READ_ONLY_EVIDENCE_TOO_LARGE');
      const bytes = Buffer.alloc(limit + 1); let length = 0;
      for (;;) {
        const count = io.readSync(fd, bytes, length, bytes.length - length, null);
        length += count;
        if (length > limit) throw sourceError('READ_ONLY_EVIDENCE_TOO_LARGE');
        if (!count) break;
      }
      try { return JSON.parse(bytes.subarray(0, length).toString('utf8')); }
      catch { throw sourceError('READ_ONLY_EVIDENCE_MALFORMED'); }
    } finally { io.closeSync(fd); }
  }
  function head() {
    let files;
    try { directorySafe(receipts); files = io.readdirSync(receipts); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    if (files.length > 4096 || files.some((file) => !/^\d{16}\.json$/.test(file) && !file.startsWith('.pending-'))) throw sourceError('READ_ONLY_EVIDENCE_RECEIPT_INVALID');
    const latest = files.filter((file) => /^\d{16}\.json$/.test(file)).sort().at(-1);
    if (!latest) return undefined;
    const record = read(join(receipts, latest), 4096);
    const parsed = parse(z.strictObject({ receipt: receiptSchema, checksum: hash }), record, 'READ_ONLY_EVIDENCE_RECEIPT_INVALID');
    if (digest(parsed.receipt) !== parsed.checksum || parsed.receipt.accountRef !== scope.accountRef
        || parsed.receipt.groupId !== scope.groupId || String(parsed.receipt.revision).padStart(16, '0') !== latest.slice(0, -5)) throw sourceError('READ_ONLY_EVIDENCE_RECEIPT_INVALID');
    return parsed.receipt;
  }
  function accept(receipt) {
    const before = head();
    if (before && (receipt.profileBinding !== before.profileBinding || receipt.revision < before.revision)) throw sourceError('READ_ONLY_EVIDENCE_ROLLBACK');
    if (before?.revision === receipt.revision) {
      if (before.digest !== receipt.digest) throw sourceError('READ_ONLY_EVIDENCE_REVISION_CONFLICT');
      return;
    }
    io.mkdirSync(receipts, { recursive: true, mode: 0o700 }); directorySafe(receipts);
    const file = join(receipts, `${String(receipt.revision).padStart(16, '0')}.json`), temp = join(receipts, `.pending-${randomUUID()}`);
    try {
      const fd = io.openSync(temp, 'wx', 0o600);
      try { io.writeFileSync(fd, JSON.stringify({ receipt, checksum: digest(receipt) })); io.fsyncSync(fd); }
      finally { io.closeSync(fd); }
      try { io.linkSync(temp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (process.platform !== 'win32') {
        const dir = io.openSync(receipts, 'r'); try { io.fsyncSync(dir); } finally { io.closeSync(dir); }
      }
    } finally { try { io.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    // A concurrent receiver may already have accepted a newer snapshot.
    const after = head();
    if (after?.profileBinding !== receipt.profileBinding || after?.revision !== receipt.revision) throw sourceError('READ_ONLY_EVIDENCE_ROLLBACK');
    if (after.digest !== receipt.digest) throw sourceError('READ_ONLY_EVIDENCE_REVISION_CONFLICT');
  }
  function snapshot() {
    if (closed) throw sourceError('READ_ONLY_EVIDENCE_CLOSED');
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw sourceError('READ_ONLY_EVIDENCE_CLOCK_INVALID');
    directorySafe(directory);
    const trust = parse(trustSchema, read(join(directory, 'trust.json'), 32768), 'READ_ONLY_EVIDENCE_TRUST_INVALID');
    if (trust.accountRef !== scope.accountRef || trust.groupId !== scope.groupId || new Set(trust.keys.map((key) => key.id)).size !== trust.keys.length) throw sourceError('READ_ONLY_EVIDENCE_TRUST_INVALID');
    const bundle = parse(bundleSchema, read(join(directory, 'bundle.json')), 'READ_ONLY_EVIDENCE_INVALID');
    const payload = bundle.payload, key = trust.keys.find((key) => key.id === bundle.keyId);
    if (!key?.enabled || at < key.notBefore || at >= key.expiresAt) throw sourceError('READ_ONLY_EVIDENCE_KEY_UNTRUSTED');
    let publicKey;
    try { publicKey = createPublicKey(key.publicKey); } catch { throw sourceError('READ_ONLY_EVIDENCE_KEY_UNTRUSTED'); }
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, readOnlyEvidenceSigningBytes(payload), publicKey, Buffer.from(bundle.signature, 'base64'))) throw sourceError('READ_ONLY_EVIDENCE_SIGNATURE_INVALID');
    if (payload.accountRef !== scope.accountRef || payload.groupId !== scope.groupId || payload.profileBinding !== trust.profileBinding) throw sourceError('READ_ONLY_EVIDENCE_SCOPE_MISMATCH');
    // Even an expired/future signed revocation raises the durable floor. It can
    // never be used to replay an older still-valid approval after restart.
    accept({ version: 1, accountRef: scope.accountRef, groupId: scope.groupId, profileBinding: payload.profileBinding,
      revision: payload.revision, digest: digest(payload) });
    if (payload.issuedAt > at || payload.notBefore > at || payload.expiresAt <= at || payload.expiresAt <= payload.notBefore) throw sourceError('READ_ONLY_EVIDENCE_EXPIRED');
    const seen = new Set();
    for (const review of payload.reviews) {
      const id = `${review.sourceId}:${review.definitionFingerprint}`;
      if (review.accountRef !== scope.accountRef || review.groupId !== scope.groupId || !review.review.reviewerHash
          || review.validFrom < payload.notBefore || review.expiresAt > payload.expiresAt
          || review.review.reviewedAt > payload.issuedAt || seen.has(id)) throw sourceError('READ_ONLY_EVIDENCE_REVIEW_INVALID');
      seen.add(id);
    }
    last = { status: 'verified', code: null, revision: payload.revision, reviewCount: payload.reviews.length };
    nextBoundary = Math.min(key.expiresAt, payload.expiresAt,
      ...payload.reviews.filter((review) => review.enabled && review.expiresAt > at).map((review) => review.expiresAt));
    return payload.reviews;
  }
  function readReviews() {
    try { return snapshot(); }
    catch (error) {
      nextBoundary = Infinity;
      last = { status: 'unavailable', code: error.code?.startsWith('READ_ONLY_EVIDENCE_') ? error.code
        : error.code === 'ENOENT' ? 'READ_ONLY_EVIDENCE_MISSING' : 'READ_ONLY_EVIDENCE_IO_FAILED', revision: null, reviewCount: 0 };
      return [];
    }
  }
  function permits(review, records) {
    const at = now();
    return records.some((approved) => approved.enabled && approved.sourceId === review.sourceId
      && approved.definitionFingerprint === review.definitionFingerprint && approved.accountRef === review.accountRef && approved.groupId === review.groupId
      && approved.review.evidenceHash === review.review.evidenceHash && at >= approved.validFrom && at < approved.expiresAt
      && review.validFrom >= approved.validFrom && review.expiresAt <= approved.expiresAt);
  }
  return {
    reviews: readReviews,
    verifyReview: (review) => permits(review, readReviews()),
    // Persisted local revocations override signed approvals; legacy self-claims
    // are never enough to regain approval if evidence is absent or withdrawn.
    effectiveReviews(local) {
      const approved = readReviews(), combined = new Map(approved.map((review) => [`${review.sourceId}:${review.definitionFingerprint}`, review]));
      for (const review of local) if (!review.enabled || permits(review, approved)) combined.set(`${review.sourceId}:${review.definitionFingerprint}`, review);
      return [...combined.values()];
    },
    status() { readReviews(); return { ...last }; },
    watch(listener) {
      if (closed) throw sourceError('READ_ONLY_EVIDENCE_CLOSED');
      let watcher, stamp;
      const fingerprint = () => [directory, join(directory, 'trust.json'), join(directory, 'bundle.json'), receipts].map((path) => {
        try { const stat = io.lstatSync(path); return [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode]; }
        catch (error) { return error.code; }
      });
      const notify = () => { if (!closed) { stamp = JSON.stringify(fingerprint()); try { listener(); } catch { /* Admission gates independently fail closed. */ } } };
      const attach = () => {
        if (watcher) return;
        try {
          directorySafe(directory); watcher = io.watch(directory, notify);
          watcher.on('error', () => { watcher?.close(); watcher = undefined; notify(); });
        } catch { /* Directory may not be provisioned yet; poll until it is. */ }
      };
      attach(); stamp = JSON.stringify(fingerprint());
      // Watch delivery plus a bounded fallback: lost OS events cannot leave an
      // idle lookup mask stale indefinitely. Inference/dispatch admission also rechecks.
      const timer = setInterval(() => {
        attach(); if (stamp !== JSON.stringify(fingerprint()) || now() >= nextBoundary) notify();
      }, 1000); timer.unref();
      const stop = () => { clearInterval(timer); watcher?.close(); monitors.delete(stop); };
      monitors.add(stop); return stop;
    },
    close() { closed = true; for (const stop of [...monitors]) stop(); },
  };
}
