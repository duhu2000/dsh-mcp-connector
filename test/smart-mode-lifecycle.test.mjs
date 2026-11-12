import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSmartModeLifecycleAdapter, SMART_MODE_HOST_CONTRACT, isUnstartedRootSession,
} from '../lib/smart-mode-lifecycle.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const policy = { mode: 'smart', policyVersion: 'fixture-v1', accountRef: 'synthetic-account', groupId: 'enterprise-six' };
const smart = (id) => ({ ...policy, version: 1, sessionId: id, selection: 'smart-auto' });
const human = (id) => ({ id, role: 'user', content: [], source: { kind: 'fixture-interactive' } });

function fixture(options = {}) {
  const listeners = new Map(), agents = [], snapshots = new Map(), masks = new Map(), writes = [];
  const ctx = {
    agents: { list: () => agents },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
  };
  const emit = (type, ...args) => { for (const fn of listeners.get(type) ?? []) fn(...args); };
  const serial = async (type, payload) => { for (const fn of listeners.get(type) ?? []) await fn(payload); };
  const adapter = createSmartModeLifecycleAdapter({
    enabled: true, hostContract: SMART_MODE_HOST_CONTRACT,
    readSnapshot: async (id) => snapshots.get(id),
    writeSnapshot: async (snapshot) => { writes.push(snapshot); snapshots.set(snapshot.sessionId, snapshot); },
    installMode(agent, snapshot) {
      const mask = { mode: snapshot.mode };
      masks.set(agent, mask);
      return () => { if (masks.get(agent) === mask) masks.delete(agent); };
    },
    classifyInput: (message) => message.source.kind === 'fixture-interactive' ? 'interactive' : message.source.kind,
    selectDefault: () => policy,
    ...options,
  });
  const make = (id, { events = [], header = {} } = {}) => {
    const agent = {
      id, status: 'idle',
      session: { id, header: { id, createdAt: 1, isSeeded: false, ...header }, snapshotEvents: () => events },
      inbox: {
        nextStep: [], nextTurn: [],
        prepend(target, message) {
          this[target === 'next-step' ? 'nextStep' : 'nextTurn'].unshift(message);
          emit('agent/inbox/inserted', { agent, message });
        },
      },
    };
    agents.push(agent);
    return agent;
  };
  const queue = (agent, message, target = 'next-turn') => {
    agent.inbox[target === 'next-turn' ? 'nextTurn' : 'nextStep'].push(message);
    emit('agent/inbox/inserted', { agent, message });
  };
  const claim = (agent) => {
    const messages = [...agent.inbox.nextStep.splice(0), ...agent.inbox.nextTurn.splice(0, 1)];
    for (const message of messages) emit('agent/inbox/claimed', { agent, message, turn: 1 });
    return messages;
  };
  const step = async (agent, next = async () => ({ kind: 'enter', messages: [] })) => {
    const handler = [...listeners.get('agent/pre-step')][0];
    return handler({ agent, signal: new AbortController().signal }, next);
  };
  return { adapter, ctx, emit, serial, make, queue, claim, step, masks, snapshots, writes, listeners };
}

test('disabled adapter does not read Host, storage, policy or register hooks', async () => {
  const adapter = createSmartModeLifecycleAdapter();
  const dispose = await adapter.mount(new Proxy({}, { get() { throw new Error('must remain inert'); } }));
  assert.equal(adapter.status({}).phase, 'disabled');
  dispose();
});

test('unverified Host is refused before registering any hooks', async () => {
  const f = fixture({ hostContract: 'unknown' });
  await assert.rejects(f.adapter.mount(f.ctx), { code: 'UNVERIFIED_HOST_CONTRACT' });
  assert.equal(f.listeners.size, 0);
});

test('old blank root waits for first trusted input; timestamp and source startup alone do not choose mode', async () => {
  const f = fixture();
  await f.adapter.mount(f.ctx);
  const agent = f.make('old-blank');
  await f.serial('agent/created', { agent, source: 'resume' });
  assert.equal(f.adapter.status(agent).phase, 'awaiting-input');
  assert.equal(f.writes.length, 0);
  f.queue(agent, human('first'));
  f.claim(agent);
  assert.equal(f.masks.get(agent).mode, 'smart', 'installed synchronously before Host resolve');
  assert.equal(f.adapter.status(agent).committed, false);
  await f.step(agent);
  assert.equal(f.adapter.status(agent).committed, true);
  assert.deepEqual(f.snapshots.get(agent.id), smart(agent.id));
});

test('snapshot commit gates inference and concurrent / duplicate claims lock policy once', async () => {
  const gate = deferred(); let selections = 0, writes = 0;
  const f = fixture({ selectDefault() { selections++; return policy; }, async writeSnapshot() { writes++; await gate.promise; } });
  await f.adapter.mount(f.ctx);
  const agent = f.make('parallel');
  await f.serial('agent/created', { agent, source: 'startup' });
  const first = human('a'), second = human('b');
  f.queue(agent, first); f.queue(agent, second);
  f.claim(agent);
  f.emit('agent/inbox/claimed', { agent, message: first });
  await f.serial('agent/created', { agent, source: 'startup' });
  let inferred = false;
  const pending = f.step(agent, async () => { inferred = true; return { kind: 'enter', messages: [first] }; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(inferred, false);
  assert.equal(f.masks.get(agent).mode, 'smart');
  gate.resolve(); await pending;
  assert.equal(inferred, true);
  assert.equal(selections, 1); assert.equal(writes, 1);
  assert.deepEqual(agent.inbox.nextTurn, [second]);
});

test('write failure retains mask and restores every claimed input to its queue, once and in order', async () => {
  let failing = true;
  const f = fixture({ async writeSnapshot() { if (failing) throw new Error('synthetic disk failure'); } });
  await f.adapter.mount(f.ctx);
  const agent = f.make('write-failure');
  await f.serial('agent/created', { agent, source: 'startup' });
  const steering = human('steering'), first = human('first'), second = human('second');
  f.queue(agent, steering, 'next-step'); f.queue(agent, first); f.queue(agent, second);
  f.claim(agent);
  assert.deepEqual(await f.step(agent, () => assert.fail('must not infer')), { kind: 'reject' });
  assert.equal(f.adapter.status(agent).committed, false);
  assert.equal(f.adapter.status(agent).errorCode, 'SNAPSHOT_WRITE_FAILED');
  assert.equal(f.masks.get(agent).mode, 'smart');
  f.emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind: 'blocked' } } });
  assert.deepEqual(agent.inbox.nextStep, [steering]);
  assert.deepEqual(agent.inbox.nextTurn, [first, second]);
  failing = false;
  assert.equal((await f.adapter.retry(agent)).committed, true);
  assert.deepEqual(agent.inbox.nextTurn, [first, second], 'retry does not wake or duplicate messages');
  f.claim(agent); await f.step(agent);
});

for (const source of ['startup', 'resume', 'clear', 'compact']) {
  test(`valid snapshot wins on ${source}; new Agent gets its own mask`, async () => {
    const f = fixture(); f.snapshots.set('restored', smart('restored'));
    await f.adapter.mount(f.ctx);
    const agent = f.make('restored');
    await f.serial('agent/created', { agent, source });
    assert.equal(f.masks.get(agent).mode, 'smart');
    assert.equal(f.adapter.status(agent).committed, true);
    assert.equal(f.writes.length, 0);
  });
}

for (const source of ['clear', 'compact', 'unknown']) {
  test(`no snapshot on ${source} preserves compatibility`, async () => {
    const f = fixture(); await f.adapter.mount(f.ctx);
    const agent = f.make(source);
    await f.serial('agent/created', { agent, source });
    assert.equal(f.masks.get(agent).mode, 'compat');
  });
}

test('historical user, assistant or business activity cannot become a blank interactive session', () => {
  const f = fixture();
  for (const type of ['user/message', 'assistant/message', 'assistant/stream', 'tool/call', 'tool/result']) {
    const agent = f.make(type, { events: [{ type, data: { source: { kind: 'user' } } }] });
    assert.equal(isUnstartedRootSession(agent, 'resume'), false);
  }
  const agent = f.make('contexts', { events: [{ type: 'user/message', data: { message: { source: { kind: 'runtime-context' } } } }] });
  assert.equal(isUnstartedRootSession(agent, 'resume'), true);
});

test('historical sessions and background or unproved input retain compat despite smart default', async () => {
  const f = fixture(); await f.adapter.mount(f.ctx);
  const historical = f.make('history', { events: [{ type: 'user/message', data: human('prior') }] });
  await f.serial('agent/created', { agent: historical, source: 'resume' });
  assert.equal(f.masks.get(historical).mode, 'compat');
  for (const kind of ['background', 'unknown', 'user']) {
    const agent = f.make(kind);
    await f.serial('agent/created', { agent, source: 'startup' });
    f.queue(agent, { ...human(kind), source: { kind } }); f.claim(agent); await f.step(agent);
    assert.equal(f.masks.get(agent).mode, 'compat');
  }
});

test('fork and subagent explicitly copy parent policy, without copying prepared tools', async () => {
  const f = fixture(); await f.adapter.mount(f.ctx);
  f.snapshots.set('parent', { ...smart('parent'), loadedTools: ['must-not-copy'] });
  for (const header of [{ parentSession: 'parent', isSeeded: true }, { parentSession: 'parent', origin: 'subagent' }]) {
    const agent = f.make(header.origin ?? 'fork', { header });
    await f.serial('agent/created', { agent, source: 'startup' });
    assert.equal(f.masks.get(agent).mode, 'smart');
    assert.deepEqual(f.snapshots.get(agent.id), { ...smart(agent.id), selection: 'parent' });
    assert.equal('loadedTools' in f.snapshots.get(agent.id), false);
  }
  const unknown = f.make('unknown-parent', { header: { parentSession: 'missing', isSeeded: true } });
  await assert.rejects(f.serial('agent/created', { agent: unknown, source: 'startup' }), { code: 'PARENT_MODE_UNRESOLVED' });
});

test('corrupt or unknown snapshots and read errors block instead of silently selecting compat', async () => {
  for (const saved of [null, { ...smart('bad'), version: 999 }, { ...smart('other') }]) {
    const f = fixture(); f.snapshots.set('bad', saved); await f.adapter.mount(f.ctx);
    const agent = f.make('bad');
    await assert.rejects(f.serial('agent/created', { agent, source: 'resume' }), { code: 'INVALID_SNAPSHOT' });
    assert.equal(f.masks.has(agent), false);
    assert.equal(f.adapter.status(agent).committed, false);
  }
  const f = fixture({ async readSnapshot() { throw new Error('synthetic read error'); } });
  await f.adapter.mount(f.ctx); const agent = f.make('unreadable');
  await assert.rejects(f.serial('agent/created', { agent, source: 'resume' }), { code: 'INITIALIZATION_FAILED' });
});

test('install failure rejects current step and preserves input; callback must be synchronous', async () => {
  const f = fixture({ installMode() { throw new Error('synthetic restrict error'); } });
  await f.adapter.mount(f.ctx); const agent = f.make('install-error');
  await f.serial('agent/created', { agent, source: 'startup' });
  const message = human('input'); f.queue(agent, message); f.claim(agent);
  assert.equal((await f.step(agent)).kind, 'reject');
  assert.deepEqual(agent.inbox.nextTurn, [message]);
  assert.equal(f.writes.length, 0);
});

test('disposed Agent completion cannot commit state for a replacement with the same SessionId', async () => {
  const gate = deferred();
  const f = fixture({ async writeSnapshot() { await gate.promise; } });
  await f.adapter.mount(f.ctx); const old = f.make('same-id');
  await f.serial('agent/created', { agent: old, source: 'startup' });
  f.queue(old, human('old-input')); f.claim(old);
  f.emit('agent/disposed', { agent: old });
  const fresh = f.make('same-id');
  const pending = f.serial('agent/created', { agent: fresh, source: 'resume' });
  await Promise.resolve();
  assert.equal(f.adapter.status(fresh).phase, 'initializing');
  assert.throws(() => f.adapter.dispose(), { code: 'DISPOSE_REQUIRES_SETTLED_WRITES' });
  gate.resolve(); await pending;
  assert.equal(f.adapter.status(old).phase, 'unattached');
  assert.equal(f.adapter.status(fresh).phase, 'awaiting-input');
  assert.equal(f.masks.has(old), false);
});

test('idle plugin remount restores snapshot without rewriting it; archive does not delete it', async () => {
  const f = fixture(); const agent = f.make('remount'); f.snapshots.set(agent.id, smart(agent.id));
  await f.adapter.mount(f.ctx);
  assert.equal(f.masks.get(agent).mode, 'smart');
  f.emit('session/archived', { session: agent.session });
  f.adapter.dispose();
  assert.equal(f.snapshots.has(agent.id), true);
  assert.equal(f.masks.has(agent), false);
  assert.equal(f.writes.length, 0);
});

test('running remount or teardown is rejected without releasing active restrictions', async () => {
  const f = fixture(); const agent = f.make('busy'); agent.status = 'running';
  await assert.rejects(f.adapter.mount(f.ctx), { code: 'REMOUNT_REQUIRES_IDLE_AGENTS' });
  assert.equal(f.listeners.size, 0);
  agent.status = 'idle'; await f.adapter.mount(f.ctx);
  agent.status = 'running'; assert.throws(() => f.adapter.dispose(), { code: 'DISPOSE_REQUIRES_IDLE_AGENTS' });
  agent.status = 'idle'; f.adapter.dispose();
});

test('another Host middleware rejection keeps its original semantics', async () => {
  const f = fixture(); await f.adapter.mount(f.ctx); const agent = f.make('other-rejection');
  await f.serial('agent/created', { agent, source: 'startup' });
  f.queue(agent, human('input')); f.claim(agent);
  assert.equal((await f.step(agent, async () => ({ kind: 'reject' }))).kind, 'reject');
  f.emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind: 'blocked' } } });
  await Promise.resolve();
  assert.deepEqual(agent.inbox.nextTurn, []);
});
