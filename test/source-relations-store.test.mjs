import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { SmartModeStore } from '../lib/smart-mode-store.js';
import { sourceFixture, relationInput } from '../scripts/fixtures/source-selection.mjs';

async function fixture(t) {
  const data = sourceFixture(), profileDir = await fs.mkdtemp(join(tmpdir(), 'mcp-source-relations-'));
  const stores = [];
  const open = async (options = {}) => {
    const store = await SmartModeStore.open({ profileDir, ...options }); stores.push(store); return store;
  };
  t.after(async () => { for (const store of stores) await store.close(); await fs.rm(profileDir, { recursive: true, force: true }); });
  return { ...data, profileDir, open, store: await open(), input: relationInput(data.relations[0]) };
}

const syntheticApproval = (relation) => relation.accountRef === 'synthetic-grant-a';

test('candidate and approved relationships remain separate; the default store cannot authorize an active approval', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.store.setSourceRelation(f.input, { expectedRevision: 0 }), { code: 'RELATION_APPROVAL_REQUIRED' });
  assert.deepEqual(await f.store.listSourceRelations(f.scope.accountRef, f.scope.groupId), []);
  const candidate = { ...f.input, status: 'candidate' };
  await f.store.setSourceRelation(candidate, { expectedRevision: 0 });
  assert.equal((await f.store.readSourceRelation(f.scope.accountRef, f.scope.groupId, f.input.id)).status, 'candidate');
  await assert.rejects(f.store.setSourceRelation(f.input, { expectedRevision: 1 }), { code: 'RELATION_APPROVAL_REQUIRED' });
});

test('synthetic review persists only identities, hashes and conclusions, survives close/reopen and rejects raw samples', async (t) => {
  const f = await fixture(t); const reviewed = await f.open({ approveSourceRelation: syntheticApproval });
  const saved = await reviewed.setSourceRelation(f.input, { expectedRevision: 0 });
  await reviewed.close(); const fresh = await f.open();
  assert.deepEqual(await fresh.readSourceRelation(f.scope.accountRef, f.scope.groupId, f.input.id), saved);
  const path = join(fresh.relationDir(f.scope.accountRef, f.scope.groupId, f.input.id), '0000000000000001.json');
  const text = await fs.readFile(path, 'utf8');
  assert.doesNotMatch(text, /inputSchema|outputSchema|annotations|execution|canary|Synthetic raw capability/);
  for (const field of ['rawDefinition', 'canaryResponses', 'headers', 'accessToken']) {
    await assert.rejects(reviewed.setSourceRelation({ ...f.input, [field]: 'must-not-store' }, { expectedRevision: 1 }), { code: 'INVALID_SOURCE_RELATION' });
  }
});

test('relation revision CAS is idempotent and each kill switch works independently without granting re-enable permission', async (t) => {
  const f = await fixture(t); const approved = await f.open({ approveSourceRelation: syntheticApproval });
  const first = await approved.setSourceRelation(f.input, { expectedRevision: 0 });
  assert.deepEqual(await approved.setSourceRelation(f.input, { expectedRevision: 0 }), first);
  const other = { ...f.input, id: 'unrelated-relationship' };
  await approved.setSourceRelation(other, { expectedRevision: 0 });
  await f.store.setSourceRelation({ ...f.input, enabled: false }, { expectedRevision: 1 });
  const relations = await f.store.listSourceRelations(f.scope.accountRef, f.scope.groupId);
  assert.equal(relations.find((r) => r.id === f.input.id).enabled, false);
  assert.equal(relations.find((r) => r.id === other.id).enabled, true);
  await assert.rejects(f.store.setSourceRelation(f.input, { expectedRevision: 2 }), { code: 'RELATION_APPROVAL_REQUIRED' });
  await assert.rejects(approved.setSourceRelation({ ...f.input, validFrom: 20 }, { expectedRevision: 0 }), { code: 'RELATION_REVISION_CONFLICT' });
});

test('same relation ID across accounts or groups uses independent disk records', async (t) => {
  const f = await fixture(t);
  const candidate = { ...f.input, status: 'candidate' };
  await f.store.setSourceRelation(candidate, { expectedRevision: 0 });
  await f.store.setSourceRelation({ ...candidate, accountRef: 'synthetic-grant-b' }, { expectedRevision: 0 });
  await f.store.setSourceRelation({ ...candidate, groupId: 'other-group' }, { expectedRevision: 0 });
  assert.equal((await f.store.listSourceRelations(f.scope.accountRef, f.scope.groupId)).length, 1);
  assert.equal((await f.store.listSourceRelations('synthetic-grant-b', f.scope.groupId))[0].accountRef, 'synthetic-grant-b');
});

test('write failure does not replace an existing relationship and recovery can retry the same revision', async (t) => {
  const f = await fixture(t); const original = { ...f.input, status: 'candidate' };
  await f.store.setSourceRelation(original, { expectedRevision: 0 });
  const broken = await f.open({ io: { ...fs, async link(from, to) {
    if (String(to).includes('source_relations')) throw Object.assign(new Error('synthetic write error'), { code: 'EIO' });
    await fs.link(from, to);
  } } });
  await assert.rejects(broken.setSourceRelation({ ...original, enabled: false }, { expectedRevision: 1 }), { code: 'EIO' });
  assert.equal((await f.store.readSourceRelation(f.scope.accountRef, f.scope.groupId, f.input.id)).revision, 1);
  const fresh = await f.open();
  assert.equal((await fresh.setSourceRelation({ ...original, enabled: false }, { expectedRevision: 1 })).revision, 2);
});

test('malformed versions or corrupt relation history block reads instead of turning approvals into empty defaults', async (t) => {
  const f = await fixture(t); await f.store.setSourceRelation({ ...f.input, status: 'candidate' }, { expectedRevision: 0 });
  const path = join(f.store.relationDir(f.scope.accountRef, f.scope.groupId, f.input.id), '0000000000000001.json');
  for (const text of ['{partial', JSON.stringify({ version: 900 })]) {
    await fs.writeFile(path, text);
    await assert.rejects(f.store.listSourceRelations(f.scope.accountRef, f.scope.groupId));
  }
});

test('two real processes racing the same candidate revision cannot overwrite the winner', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const start = async (input) => {
    const child = fork(new URL('../scripts/fixtures/smart-mode-store-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill(); await done; } });
    await once(child, 'message');
    const result = once(child, 'message');
    child.send({ type: 'run', profileDir: f.profileDir, operation: 'relation', value: input, expectedRevision: 0 });
    return (await result)[0];
  };
  const results = await Promise.all([start({ ...f.input, status: 'candidate' }), start({ ...f.input, status: 'candidate', enabled: false })]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).code, 'RELATION_REVISION_CONFLICT');
});
