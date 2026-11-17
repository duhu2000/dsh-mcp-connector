import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SmartModeStore } from '../lib/smart-mode-store.js';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { readOnlyReviewFor } from '../scripts/fixtures/read-only-review.mjs';

async function fixture(t) {
  const data = sourceFixture(), profileDir = await fs.mkdtemp(join(tmpdir(), 'qmcp-ro-review-')), stores = [];
  const open = async (options = {}) => { const store = await SmartModeStore.open({ profileDir, ...options }); stores.push(store); return store; };
  t.after(async () => { for (const store of stores) await store.close(); await fs.rm(profileDir, { recursive: true, force: true }); });
  return { ...data, profileDir, open, review: readOnlyReviewFor(data.scope, [...data.index.values()][0]) };
}
const synthetic = (review) => review.accountRef === 'synthetic-grant-a';

test('read-only records require independent approval, bind full fingerprints and store no schema or samples', async (t) => {
  const f = await fixture(t), denied = await f.open();
  await assert.rejects(denied.setReadOnlyReview(f.review, { expectedRevision: 0 }), { code: 'READ_ONLY_APPROVAL_REQUIRED' });
  const store = await f.open({ approveReadOnlyReview: synthetic });
  const first = await store.setReadOnlyReview(f.review, { expectedRevision: 0 });
  assert.equal(first.revision, 1); await store.close();
  const recovered = await f.open();
  assert.deepEqual(await recovered.readReadOnlyReview(f.scope.accountRef, f.scope.groupId, f.review.sourceId, f.review.definitionFingerprint), first);
  assert.equal((await recovered.listReadOnlyReviews(f.scope.accountRef, f.scope.groupId)).length, 1);
  for (const key of ['rawDefinition', 'inputSchema', 'sample', 'accessToken']) {
    await assert.rejects(store.setReadOnlyReview({ ...f.review, [key]: 'reject' }, { expectedRevision: 1 }), { code: 'INVALID_READ_ONLY_REVIEW' });
  }
  const body = await fs.readFile(join(store.readOnlyReviewDir(f.scope.accountRef, f.scope.groupId, f.review.sourceId, f.review.definitionFingerprint), '0000000000000001.json'), 'utf8');
  assert.doesNotMatch(body, /inputSchema|outputSchema|Synthetic raw capability|canary|accessToken/);
  const different = { ...f.review, definitionFingerprint: 'f'.repeat(64) };
  assert.equal(await recovered.readReadOnlyReview(f.scope.accountRef, f.scope.groupId, different.sourceId, different.definitionFingerprint), undefined);
});

test('concurrent CAS has one winner; revocation persists and re-enable needs new approval', async (t) => {
  const f = await fixture(t), a = await f.open({ approveReadOnlyReview: synthetic }), b = await f.open({ approveReadOnlyReview: synthetic });
  const results = await Promise.allSettled([a.setReadOnlyReview(f.review, { expectedRevision: 0 }),
    b.setReadOnlyReview({ ...f.review, expiresAt: f.review.expiresAt + 1000 }, { expectedRevision: 0 })]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const plain = await f.open(), current = (await plain.listReadOnlyReviews(f.scope.accountRef, f.scope.groupId))[0];
  const revoked = await plain.setReadOnlyReview({ ...current.review, enabled: false }, { expectedRevision: 1 });
  assert.equal(revoked.revision, 2);
  await assert.rejects(plain.setReadOnlyReview(current.review, { expectedRevision: 2 }), { code: 'READ_ONLY_APPROVAL_REQUIRED' });
  assert.equal((await plain.listReadOnlyReviews(f.scope.accountRef, f.scope.groupId))[0].review.enabled, false);
});

test('write failure leaves the previous record intact and retry recovers without a revision gap', async (t) => {
  const f = await fixture(t), good = await f.open({ approveReadOnlyReview: synthetic });
  await good.setReadOnlyReview(f.review, { expectedRevision: 0 });
  const broken = await f.open({ io: { ...fs, async link(from, to) { if (String(to).includes('read_only_reviews')) throw Object.assign(new Error(), { code: 'EIO' }); return fs.link(from, to); } } });
  await assert.rejects(broken.setReadOnlyReview({ ...f.review, enabled: false }, { expectedRevision: 1 }), { code: 'EIO' });
  assert.equal((await good.listReadOnlyReviews(f.scope.accountRef, f.scope.groupId))[0].revision, 1);
  assert.equal((await good.setReadOnlyReview({ ...f.review, enabled: false }, { expectedRevision: 1 })).revision, 2);
});

test('corrupt review history fails closed and separate account/group ledgers cannot share review authority', async (t) => {
  const f = await fixture(t), store = await f.open({ approveReadOnlyReview: synthetic });
  await store.setReadOnlyReview(f.review, { expectedRevision: 0 });
  assert.deepEqual(await store.listReadOnlyReviews('other-account', f.scope.groupId), []);
  assert.deepEqual(await store.listReadOnlyReviews(f.scope.accountRef, 'other-group'), []);
  const file = join(store.readOnlyReviewDir(f.scope.accountRef, f.scope.groupId, f.review.sourceId, f.review.definitionFingerprint), '0000000000000001.json');
  await fs.writeFile(file, '{"version":999}');
  await assert.rejects(store.listReadOnlyReviews(f.scope.accountRef, f.scope.groupId), { code: 'UNSUPPORTED_STORE_VERSION' });
});
