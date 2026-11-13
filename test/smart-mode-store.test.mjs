import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { SmartModeStore } from '../lib/smart-mode-store.js';

const group = { accountRef: 'synthetic-grant-a', groupId: 'enterprise-six' };
const policy = (mode = 'smart') => ({ ...group, mode, policyVersion: 'fixture-v1' });
const snapshot = (sessionId = 'synthetic-session', extra = {}) => ({
  version: 1, sessionId, mode: 'smart', policyVersion: 'fixture-v1',
  selection: 'user-confirmed', ...group, ...extra,
});
const fault = (code) => Object.assign(new Error(`synthetic ${code}`), { code });

async function fixture(t, options = {}) {
  const profileDir = await fs.mkdtemp(join(tmpdir(), 'mcp-smart-store-'));
  const stores = [];
  const open = async (more = {}) => {
    const store = await SmartModeStore.open({ profileDir, ...options, ...more });
    stores.push(store); return store;
  };
  t.after(async () => {
    for (const store of stores) await store.close();
    // Only this test's mkdtemp return value is recursively removed.
    await fs.rm(profileDir, { recursive: true, force: true });
  });
  return { profileDir, open, store: await open() };
}

async function worker(t) {
  const child = fork(new URL('../scripts/fixtures/smart-mode-store-worker.mjs', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const messages = [], waiters = [];
  const take = (type) => {
    const index = messages.findIndex((m) => m.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => waiters.push({ type, resolve, reject }));
  };
  child.on('message', (message) => {
    const index = waiters.findIndex((w) => w.type === message.type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  });
  child.on('exit', () => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`fixture child exited: ${stderr}`));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  await take('ready');
  return { child, take,
    run: (value) => { child.send({ type: 'run', ...value }); return take('result'); },
    async kill() { const exited = once(child, 'exit'); child.kill(); await exited; },
  };
}

test('storage requires an explicit profile and never falls back to DSH_HOME', async () => {
  for (const profileDir of [undefined, '', 'relative-profile']) {
    await assert.rejects(SmartModeStore.open({ profileDir }), { code: 'EXPLICIT_PROFILE_REQUIRED' });
  }
});

test('real disk close/reopen restores snapshots and default revisions, without prepared data', async (t) => {
  const { store, open } = await fixture(t);
  await store.setDefaultPolicy(policy(), { expectedRevision: 0 });
  const choice = store.selectDefault(group.accountRef, group.groupId);
  const value = snapshot('restored', { ...choice, selection: 'smart-auto' });
  await store.writeSnapshot(value); await store.close();
  await assert.rejects(store.readSnapshot('restored'), { code: 'STORE_CLOSED' });
  const fresh = await open();
  assert.deepEqual(await fresh.readSnapshot('restored'), value);
  await fresh.refreshDefaultPolicy(group.accountRef, group.groupId);
  assert.deepEqual(fresh.selectDefault(group.accountRef, group.groupId), choice);
  assert.equal('loadedTools' in await fresh.readSnapshot('restored'), false);
});

test('transactions capture caller values before asynchronous I/O begins', async (t) => {
  const { store } = await fixture(t);
  const value = snapshot('captured'); const pending = store.writeSnapshot(value);
  value.mode = 'compat';
  assert.equal((await pending).mode, 'smart');
  const nextPolicy = policy(); const policyWrite = store.setDefaultPolicy(nextPolicy, { expectedRevision: 0 });
  nextPolicy.mode = 'compat';
  assert.equal((await policyWrite).mode, 'smart');
});

test('close drains already accepted disk writes and rejects new transactions', async (t) => {
  const { open } = await fixture(t);
  let release, entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { entered = resolve; });
  const store = await open({ io: { ...fs, async link(from, to) {
    if (String(to).includes('sessions')) { entered(); await gate; }
    await fs.link(from, to);
  } } });
  const write = store.writeSnapshot(snapshot('drained')); await ready;
  let closed = false; const closing = store.close().then(() => { closed = true; });
  await assert.rejects(store.writeSnapshot(snapshot('new-after-close')), { code: 'STORE_CLOSED' });
  assert.equal(closed, false);
  release(); await write; await closing;
  assert.deepEqual(await (await open()).readSnapshot('drained'), snapshot('drained'));
});

test('profile, grant and group bindings remain separate; same SessionId cannot merge accounts', async (t) => {
  const a = await fixture(t), b = await fixture(t);
  await a.store.writeSnapshot(snapshot('same-id'));
  await b.store.writeSnapshot(snapshot('same-id', { accountRef: 'synthetic-grant-b' }));
  assert.equal((await a.store.readSnapshot('same-id')).accountRef, group.accountRef);
  assert.equal((await b.store.readSnapshot('same-id')).accountRef, 'synthetic-grant-b');
  await a.store.setDefaultPolicy(policy(), { expectedRevision: 0 });
  await a.store.setDefaultPolicy({ ...policy('compat'), accountRef: 'synthetic-grant-b' }, { expectedRevision: 0 });
  await a.store.setDefaultPolicy({ ...policy('compat'), groupId: 'another-group' }, { expectedRevision: 0 });
  await assert.rejects(a.store.writeSnapshot(snapshot('same-id', { accountRef: 'synthetic-grant-b' })), { code: 'SNAPSHOT_CONFLICT' });
});

test('concurrent snapshot writes are idempotent; conflicting mode cannot overwrite a locked session', async (t) => {
  const { store, open } = await fixture(t); const peer = await open();
  const copies = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? store : peer).writeSnapshot(snapshot())));
  for (const copy of copies) assert.deepEqual(copy, snapshot());
  const before = await fs.readFile(store.snapshotPath('synthetic-session'), 'utf8');
  await assert.rejects(peer.writeSnapshot(snapshot('synthetic-session', { mode: 'compat' })), { code: 'SNAPSHOT_CONFLICT' });
  assert.equal(await fs.readFile(store.snapshotPath('synthetic-session'), 'utf8'), before);
});

test('default policy uses compare-and-set revisions and failed updates do not change cached defaults', async (t) => {
  const { store, open } = await fixture(t); const peer = await open();
  await store.setDefaultPolicy(policy(), { expectedRevision: 0 });
  await peer.refreshDefaultPolicy(group.accountRef, group.groupId);
  await store.setDefaultPolicy(policy('compat'), { expectedRevision: 1 });
  await assert.rejects(peer.setDefaultPolicy({ ...policy(), policyVersion: 'stale' }, { expectedRevision: 1 }), { code: 'POLICY_REVISION_CONFLICT' });
  assert.equal(peer.selectDefault(group.accountRef, group.groupId).mode, 'smart');
  assert.equal((await peer.refreshDefaultPolicy(group.accountRef, group.groupId)).mode, 'compat');
  assert.equal(peer.selectDefault(group.accountRef, group.groupId).policyRevision, 2);
  await assert.rejects(peer.setDefaultPolicy(policy()), { code: 'INVALID_EXPECTED_REVISION' });
  await assert.rejects(peer.setDefaultPolicy({ ...policy(), version: 900 }, { expectedRevision: 2 }), { code: 'INVALID_DEFAULT_POLICY' });
});

test('new defaults do not rewrite committed sessions; stale automatic choices are refused', async (t) => {
  const { store, open } = await fixture(t); const stale = await open();
  await store.setDefaultPolicy(policy(), { expectedRevision: 0 });
  await stale.refreshDefaultPolicy(group.accountRef, group.groupId);
  const selected = snapshot('existing', { ...stale.selectDefault(group.accountRef, group.groupId), selection: 'smart-auto' });
  await store.writeSnapshot(selected);
  await store.setDefaultPolicy(policy('compat'), { expectedRevision: 1 });
  assert.deepEqual(await store.readSnapshot('existing'), selected);
  assert.deepEqual(await stale.writeSnapshot(selected), selected, 'identical committed choice remains retryable');
  await assert.rejects(stale.writeSnapshot({ ...selected, sessionId: 'unlocked' }), { code: 'DEFAULT_POLICY_CHANGED' });
  assert.equal(await store.readSnapshot('unlocked'), undefined);
  await stale.refreshDefaultPolicy(group.accountRef, group.groupId);
  const oldCompat = snapshot('stale-compat', { ...stale.selectDefault(group.accountRef, group.groupId), selection: 'legacy' });
  await store.setDefaultPolicy(policy(), { expectedRevision: 2 });
  await assert.rejects(stale.writeSnapshot(oldCompat), { code: 'DEFAULT_POLICY_CHANGED' });
});

test('disk boundary rejects credentials, message bodies, loaded tools and unknown fields', async (t) => {
  const { store } = await fixture(t);
  for (const field of ['accessToken', 'headers', 'messages', 'loadedTools', 'toolArguments']) {
    await assert.rejects(store.writeSnapshot({ ...snapshot(), [field]: 'must-not-persist' }), { code: 'INVALID_SNAPSHOT' });
    await assert.rejects(store.setDefaultPolicy({ ...policy(), [field]: 'must-not-persist' }, { expectedRevision: 0 }), { code: 'INVALID_DEFAULT_POLICY' });
  }
  await assert.rejects(store.writeSnapshot(snapshot('bad-version', { version: 999 })), { code: 'INVALID_SNAPSHOT' });
  assert.equal(await store.readSnapshot('synthetic-session'), undefined);
});

for (const point of ['open', 'writeFile', 'sync', 'link']) {
  test(`failed disk ${point} preserves the committed policy and can recover after reopen`, async (t) => {
    const { store, open } = await fixture(t);
    await store.setDefaultPolicy(policy(), { expectedRevision: 0 });
    const io = { ...fs,
      async open(path, flags, mode) {
        if (!String(path).includes('.pending-')) return fs.open(path, flags, mode);
        if (point === 'open') throw fault('EACCES');
        const handle = await fs.open(path, flags, mode);
        return { close: () => handle.close(),
          async writeFile(text, encoding) {
            if (point === 'writeFile') { await handle.writeFile('{partial'); throw fault('ENOSPC'); }
            await handle.writeFile(text, encoding);
          },
          async sync() { if (point === 'sync') throw fault('EIO'); await handle.sync(); },
        };
      },
      async link(from, to) { if (point === 'link') throw fault('EPERM'); await fs.link(from, to); },
    };
    const broken = await open({ io });
    await broken.refreshDefaultPolicy(group.accountRef, group.groupId);
    await assert.rejects(broken.setDefaultPolicy(policy('compat'), { expectedRevision: 1 }));
    assert.equal(broken.selectDefault(group.accountRef, group.groupId).mode, 'smart');
    const fresh = await open();
    assert.equal((await fresh.refreshDefaultPolicy(group.accountRef, group.groupId)).revision, 1);
    await fresh.setDefaultPolicy(policy('compat'), { expectedRevision: 1 });
    assert.equal(fresh.selectDefault(group.accountRef, group.groupId).mode, 'compat');
  });
}

test('uncertain error after atomic publication is safely recovered by an identical retry', async (t) => {
  const { open, store } = await fixture(t);
  const broken = await open({ io: { ...fs, async link(from, to) { await fs.link(from, to); throw fault('EIO'); } } });
  await assert.rejects(broken.writeSnapshot(snapshot()), { code: 'EIO' });
  const fresh = await open();
  assert.deepEqual(await fresh.writeSnapshot(snapshot()), snapshot());
  assert.deepEqual(await store.readSnapshot('synthetic-session'), snapshot());
});

test('identical retry still requires a successful durability acknowledgement', async (t) => {
  const { store, open } = await fixture(t);
  await store.writeSnapshot(snapshot());
  const broken = await open({ io: { ...fs, async open(path, flags, mode) {
    const handle = await fs.open(path, flags, mode);
    if (flags !== 'r+') return handle;
    return { async sync() { throw fault('EIO'); }, close: () => handle.close() };
  } } });
  await assert.rejects(broken.writeSnapshot(snapshot()), { code: 'EIO' });
  assert.deepEqual(await (await open()).writeSnapshot(snapshot()), snapshot());
});

test('corrupt / unknown domain and record versions block recovery rather than returning empty data', async (t) => {
  const { store, open } = await fixture(t);
  await store.writeSnapshot(snapshot());
  const path = store.snapshotPath('synthetic-session'); const original = await fs.readFile(path, 'utf8');
  for (const text of ['{partial', JSON.stringify({ version: 900 }), original.replace('synthetic-grant-a', 'tampered-account')]) {
    await fs.writeFile(path, text);
    await assert.rejects(store.readSnapshot('synthetic-session'));
  }
  await fs.writeFile(path, original);
  const marker = join(store.rootDir, 'domain.json'); const metadata = await fs.readFile(marker, 'utf8');
  await fs.writeFile(marker, JSON.stringify({ version: 900 }));
  await assert.rejects(open(), { code: 'UNSUPPORTED_STORE_VERSION' });
  await fs.unlink(marker);
  await assert.rejects(open(), { code: 'MISSING_DOMAIN_METADATA' });
  await fs.writeFile(marker, metadata);
  assert.deepEqual(await (await open()).readSnapshot('synthetic-session'), snapshot());
});

test('missing / corrupt policy history invalidates the cache and does not select a full compatibility fallback', async (t) => {
  const { store } = await fixture(t);
  await store.setDefaultPolicy(policy(), { expectedRevision: 0 });
  await store.setDefaultPolicy(policy('compat'), { expectedRevision: 1 });
  const dir = store.policyDir(group.accountRef, group.groupId);
  await fs.unlink(join(dir, '0000000000000001.json'));
  await assert.rejects(store.refreshDefaultPolicy(group.accountRef, group.groupId), { code: 'INVALID_POLICY_HISTORY' });
  assert.throws(() => store.selectDefault(group.accountRef, group.groupId), { code: 'DEFAULT_POLICY_NOT_LOADED' });
});

test('archive / close retain snapshots; only trusted permanent deletion removes data and prevents resurrection', async (t) => {
  let confirmed = false;
  const { store, open } = await fixture(t, { confirmPermanentDeletion: async () => confirmed });
  await store.writeSnapshot(snapshot());
  await assert.rejects(store.permanentlyDeleteSession('synthetic-session'), { code: 'PERMANENT_DELETION_NOT_CONFIRMED' });
  await store.close(); const fresh = await open();
  assert.deepEqual(await fresh.readSnapshot('synthetic-session'), snapshot());
  confirmed = true; await fresh.permanentlyDeleteSession('synthetic-session');
  await assert.rejects(fs.stat(fresh.snapshotPath('synthetic-session')), { code: 'ENOENT' });
  const marker = await fs.readFile(fresh.deletionPath('synthetic-session'), 'utf8');
  assert.equal(marker.includes('synthetic-session'), false);
  assert.equal(marker.includes(group.accountRef), false);
  await assert.rejects(fresh.readSnapshot('synthetic-session'), { code: 'SESSION_PERMANENTLY_DELETED' });
  await assert.rejects(fresh.writeSnapshot(snapshot()), { code: 'SESSION_PERMANENTLY_DELETED' });
  assert.equal(await fresh.permanentlyDeleteSession('synthetic-session'), true);
});

test('permanent deletion dominates an already prepared first write', async (t) => {
  const { store, open } = await fixture(t, { confirmPermanentDeletion: async () => true });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let entered; const ready = new Promise((resolve) => { entered = resolve; });
  const writer = await open({ io: { ...fs, async link(from, to) {
    if (String(to).includes(`${join('sessions', '')}`)) { entered(); await gate; }
    await fs.link(from, to);
  } } });
  const pending = writer.writeSnapshot(snapshot());
  await ready; await store.permanentlyDeleteSession('synthetic-session'); release();
  await assert.rejects(pending, { code: 'SESSION_PERMANENTLY_DELETED' });
  await assert.rejects(fs.stat(store.snapshotPath('synthetic-session')), { code: 'ENOENT' });
});

test('permanent cleanup removes only the deleted Session crash remnants', async (t) => {
  const { store } = await fixture(t, { confirmPermanentDeletion: async () => true });
  await store.writeSnapshot(snapshot('delete-me')); await store.writeSnapshot(snapshot('keep-me'));
  const dir = join(store.rootDir, 'sessions');
  const deletedName = store.snapshotPath('delete-me').split(/[\\/]/).at(-1);
  const keptName = store.snapshotPath('keep-me').split(/[\\/]/).at(-1);
  const orphan = join(dir, `.pending-${deletedName}-synthetic-orphan`);
  const kept = join(dir, `.pending-${keptName}-synthetic-orphan`);
  await fs.writeFile(orphan, 'synthetic deleted metadata'); await fs.writeFile(kept, 'synthetic retained metadata');
  await store.permanentlyDeleteSession('delete-me');
  await assert.rejects(fs.stat(orphan), { code: 'ENOENT' });
  assert.equal(await fs.readFile(kept, 'utf8'), 'synthetic retained metadata');
  assert.deepEqual(await store.readSnapshot('keep-me'), snapshot('keep-me'));
});

test('failed deletion cleanup remains blocked and a later retry removes the payload', async (t) => {
  const { store, open } = await fixture(t, { confirmPermanentDeletion: async () => true });
  await store.writeSnapshot(snapshot('cleanup-failure'));
  const path = store.snapshotPath('cleanup-failure');
  const broken = await open({ io: { ...fs, async unlink(file) {
    if (file === path) throw fault('EACCES');
    await fs.unlink(file);
  } } });
  await assert.rejects(broken.permanentlyDeleteSession('cleanup-failure'), { code: 'EACCES' });
  await assert.rejects(store.readSnapshot('cleanup-failure'), { code: 'SESSION_PERMANENTLY_DELETED' });
  assert.equal(await store.permanentlyDeleteSession('cleanup-failure'), true);
  await assert.rejects(fs.stat(path), { code: 'ENOENT' });
});

test('two real processes cannot overwrite each other snapshot or default policy', { timeout: 15000 }, async (t) => {
  const { store, profileDir } = await fixture(t);
  const a = await worker(t), b = await worker(t);
  const writes = await Promise.all([
    a.run({ profileDir, operation: 'snapshot', value: snapshot('race') }),
    b.run({ profileDir, operation: 'snapshot', value: snapshot('race', { accountRef: 'synthetic-grant-b' }) }),
  ]);
  assert.equal(writes.filter((r) => r.ok).length, 1);
  assert.equal(writes.find((r) => !r.ok).code, 'SNAPSHOT_CONFLICT');
  const defaults = await Promise.all([
    a.run({ profileDir, operation: 'default', value: policy(), expectedRevision: 0 }),
    b.run({ profileDir, operation: 'default', value: policy('compat'), expectedRevision: 0 }),
  ]);
  assert.equal(defaults.filter((r) => r.ok).length, 1);
  assert.equal(defaults.find((r) => !r.ok).code, 'POLICY_REVISION_CONFLICT');
  assert.equal((await store.readSnapshot('race')).accountRef, writes.find((r) => r.ok).result.accountRef);
});

test('real processes preserve disjoint records and accept identical concurrent transactions', { timeout: 15000 }, async (t) => {
  const { profileDir, store } = await fixture(t); const a = await worker(t), b = await worker(t);
  const disjoint = await Promise.all([
    a.run({ profileDir, operation: 'snapshot', value: snapshot('left') }),
    b.run({ profileDir, operation: 'snapshot', value: snapshot('right') }),
  ]);
  assert.ok(disjoint.every((r) => r.ok));
  assert.deepEqual(await store.readSnapshot('left'), snapshot('left'));
  assert.deepEqual(await store.readSnapshot('right'), snapshot('right'));
  const identical = await Promise.all([a, b].map((w) => w.run({ profileDir, operation: 'default', value: policy(), expectedRevision: 0 })));
  assert.ok(identical.every((r) => r.ok && r.result.revision === 1));
});

for (const crashPoint of ['before-publish', 'after-publish']) {
  test(`real process crash ${crashPoint} leaves an unambiguous recoverable disk state`, { timeout: 15000 }, async (t) => {
    const { profileDir, open } = await fixture(t); const child = await worker(t);
    const pending = child.run({ profileDir, operation: 'snapshot', value: snapshot('crash'), crashPoint });
    pending.catch(() => {});
    await child.take('checkpoint'); await child.kill();
    const fresh = await open();
    assert.deepEqual(await fresh.readSnapshot('crash'), crashPoint === 'before-publish' ? undefined : snapshot('crash'));
    assert.deepEqual(await fresh.writeSnapshot(snapshot('crash')), snapshot('crash'));
  });
}

test('old connection / credential / governance files remain byte-for-byte unchanged', async (t) => {
  const { store, profileDir } = await fixture(t);
  const oldDir = join(profileDir, 'storages', 'mcp_connector'); await fs.mkdir(oldDir);
  const files = ['connections', 'grants', 'governance', 'connection_scopes'];
  for (const name of files) await fs.writeFile(join(oldDir, `${name}.json`), `synthetic legacy ${name}`);
  await store.setDefaultPolicy(policy(), { expectedRevision: 0 }); await store.writeSnapshot(snapshot());
  for (const name of files) assert.equal(await fs.readFile(join(oldDir, `${name}.json`), 'utf8'), `synthetic legacy ${name}`);
});
