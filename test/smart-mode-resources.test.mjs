import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../scripts/fixtures/smart-mode-prepare.mjs';
import { createSmartModePrepareController } from '../lib/smart-mode-prepare.js';
import { SMART_RESOURCE_HOST_CONTRACT, estimateSmartToolTokens } from '../lib/smart-mode-resources.js';
import { createTranslator } from '../lib/i18n/index.js';
import { EN_DICTIONARY } from '../lib/i18n/locales/en.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(options = {}) {
  const callbacks = new Map(); let id = 0, timerFailures = options.timerFailures ?? 0;
  const timers = { setTimeout(fn, delay) {
    if (timerFailures) { timerFailures--; throw new Error('synthetic timer failure'); }
    const key = ++id; callbacks.set(key, { fn, due: f.at + delay }); return key; },
    clearTimeout(key) { callbacks.delete(key); } };
  const f = fixture({ ...options, timers, resources: { enabled: true, hostContract: SMART_RESOURCE_HOST_CONTRACT,
    ttlMs: 100, ...options.resources } });
  let seq = 0;
  return { ...f, get at() { return f.at; }, set at(value) { f.at = value; },
    event(agent, type, data, extra = {}) { const event = { seq: ++seq, type, data, ...extra }; f.emit('session/event', { id: agent.id }, event); return event; },
    async fireTimers() {
      for (const [key, timer] of [...callbacks]) if (timer.due <= f.at) { callbacks.delete(key); timer.fn(); }
      await tick(); await tick();
    }, timers: callbacks,
  };
}
const cap = (f, n = 0) => n === 0 ? f.capabilityId : `source:${f.sources[n + 1].sourceId}`;
const load = (f, agent, ids = [cap(f)]) => f.prepare.prepare(agent, { capabilityIds: ids });
const status = (f, agent) => f.prepare.resourceStatus(agent);
const loaded = (f, agent) => f.prepare.getPreparedNames(agent);
const entry = (f, agent, name = f.sources[0].publicName) => status(f, agent).entries.find((item) => item.publicName === name);

test('resource feature stays inert without explicit opt-in and rejects unverified contracts or a raised hard budget', async () => {
  const f = fixture(); const { agent } = f.make('legacy-p105');
  assert.equal((await load(f, agent)).ok, true); assert.deepEqual(status(f, agent), { enabled: false });
  assert.equal((await f.prepare.release(agent, { publicNames: [f.sources[0].publicName] })).message, 'SMART_RESOURCES_DISABLED');
  for (const resources of [{ hostContract: 'unknown' }, { maxTokens: 5001 }, { ttlMs: 0 }]) {
    assert.throws(() => setup({ resources }), { code: 'INVALID_RESOURCE_POLICY' });
  }
  assert.throws(() => createSmartModePrepareController({ enabled: true, scope: f.scope, restrictions: f.controller,
    selector: f.selector, getReadOnlyReviews: () => [], resources: { enabled: true, hostContract: SMART_RESOURCE_HOST_CONTRACT } }), { code: 'MISSING_RESOURCE_CALLBACK' });
});

test('budget matches DSH UTF-16 JSON length, one array framing overhead and zero for no tools', () => {
  const tools = [{ name: '汉字🙂', description: '中'.repeat(17), parameters: { type: 'object', properties: {} } }];
  assert.equal(estimateSmartToolTokens(tools), Math.ceil(JSON.stringify(tools).length / 4) + 4);
  assert.notEqual(estimateSmartToolTokens(tools), Math.ceil(Buffer.byteLength(JSON.stringify(tools)) / 4) + 4);
  assert.equal(estimateSmartToolTokens([]), 0);
  assert.throws(() => estimateSmartToolTokens([{ name: 'bad', parameters: undefined }]), /NON_JSON/);
});

test('budget counts both actual local management entries plus scoped tools, never outside or global 25 entries', async () => {
  const requests = [];
  const f = setup({ getBudgetSchemas(agent, names) {
    requests.push(names);
    return names.map((name) => ({ name, parameters: {}, description: name.startsWith('mcp_connector_') ? '中'.repeat(100) : 'x'.repeat(100) }));
  } }); const { agent } = f.make('budget');
  assert.equal((await load(f, agent)).ok, true);
  const names = ['mcp_connector_discover', 'mcp_connector_session_tools', f.sources[0].publicName];
  assert.deepEqual(new Set(requests.at(-1)), new Set(names));
  assert.equal(status(f, agent).estimatedTokens, estimateSmartToolTokens(names.map((name) => ({ name, parameters: {},
    description: name.startsWith('mcp_connector_') ? '中'.repeat(100) : 'x'.repeat(100) }))));
  assert.ok(requests.every((list) => !list.includes('outside_fixture')));
});

test('oversized constant management budget and missing, extra or async schema projections fail closed', async () => {
  for (const getBudgetSchemas of [
    (agent, names) => names.map((name) => ({ name, parameters: {}, description: 'x'.repeat(12000) })),
    () => [], (agent, names) => [...names.map((name) => ({ name, parameters: {} })), { name: 'outside', parameters: {} }],
    async () => [],
  ]) {
    const f = setup({ getBudgetSchemas }); const { agent } = f.make('bad-budget');
    assert.equal((await load(f, agent)).ok, false); assert.deepEqual(loaded(f, agent), []);
  }
});

test('reject strategy rolls back the whole batch when its exact serialized schemas exceed budget', async () => {
  const f = setup({ resources: { maxTokens: 500, eviction: 'reject' },
    getBudgetSchemas: (agent, names) => names.map((name) => ({ name, parameters: {},
      description: name.startsWith('mcp_connector_') ? '' : 'x'.repeat(1500) })) });
  const { agent } = f.make('hard-limit');
  assert.equal((await load(f, agent)).ok, true); const before = f.names(agent);
  assert.equal((await load(f, agent, [cap(f, 1)])).message, 'SMART_RESOURCE_CAPACITY');
  assert.deepEqual(f.names(agent), before); assert.equal(loaded(f, agent).length, 1);
});

test('schema growth after prepare blocks admission and dispatch; release can still repair an over-budget state', async () => {
  let padding = '';
  const f = setup({ getBudgetSchemas: (agent, names) => names.map((name) => ({ name, parameters: {},
    description: name.startsWith('mcp_connector_') ? '' : padding })) });
  const { agent } = f.make('schema-growth'); assert.equal((await load(f, agent)).ok, true);
  padding = 'x'.repeat(21000);
  assert.throws(() => f.controller.assertReady(agent), { code: 'SMART_RESOURCE_BUDGET_EXCEEDED' });
  assert.equal((await f.run({ agent, name: f.sources[0].publicName })).isError, true);
  const def = agent.locals.get('mcp_connector_discover');
  const result = await def.execute({ action: 'release', publicNames: [f.sources[0].publicName] }, { agent });
  assert.equal(result.ok, true); f.controller.assertReady(agent); assert.deepEqual(loaded(f, agent), []);
});

test('trusted comparison never bypasses the token budget or evicts a requested member of its own batch', async () => {
  const f = setup({ resources: { maxTokens: 500 },
    getBudgetSchemas: (agent, names) => names.map((name) => ({ name, parameters: {},
      description: name.startsWith('mcp_connector_') ? '' : 'x'.repeat(1500) })) });
  const { agent } = f.make('compare-budget'); f.intent(agent, f.sources.slice(0, 2), 'compare');
  assert.equal((await load(f, agent)).message, 'SMART_RESOURCE_CAPACITY'); assert.deepEqual(loaded(f, agent), []);
});

for (const mode of ['fixed', 'sliding']) test(`${mode} TTL expires at the boundary, releases the record and never resurrects on clock rollback`, async () => {
  const f = setup({ resources: { ttlMode: mode } }); const { agent } = f.make(mode);
  assert.equal((await load(f, agent)).ok, true); assert.equal(entry(f, agent).expiresAt, 1100);
  f.at = 1099; assert.equal(loaded(f, agent).length, 1);
  f.at = 1100; await f.fireTimers();
  assert.deepEqual(loaded(f, agent), []); assert.equal(status(f, agent).retainedCount, 0);
  f.at = 1000; assert.deepEqual(loaded(f, agent), []);
  assert.equal((await load(f, agent)).ok, true); assert.equal(entry(f, agent).expiresAt, 1200, 'monotonic logical clock');
});

test('repeating prepare, search or status does not refresh sliding TTL', async () => {
  const f = setup(); const { agent } = f.make('no-renew'); await load(f, agent);
  f.at = 1050; await load(f, agent);
  await f.selector.search(agent, { query: 'fixture' }); status(f, agent);
  assert.equal(entry(f, agent).expiresAt, 1100);
});

test('only final successful, uncanceled execution renews sliding TTL and changes recency', async () => {
  const f = setup(); const { agent } = f.make('success'); await load(f, agent);
  const name = f.sources[0].publicName;
  f.at = 1040; assert.equal((await f.run({ agent, name })).isError, false);
  assert.equal(entry(f, agent).expiresAt, 1140);
  f.at = 1050; await f.run({ agent, name }, async () => ({ isError: true, content: [] }));
  assert.equal(entry(f, agent).expiresAt, 1140);
  const canceled = new AbortController(); canceled.abort(); f.at = 1060;
  await f.run({ agent, name, signal: canceled.signal });
  assert.equal(entry(f, agent).expiresAt, 1140);
});

test('fixed TTL still expires after a successful call; active body stays pinned until the final result', async () => {
  const f = setup({ resources: { ttlMode: 'fixed' } }); const { agent } = f.make('fixed-body'); await load(f, agent);
  const gate = deferred(), entered = deferred(), name = f.sources[0].publicName;
  const running = f.run({ agent, name }, async () => { entered.resolve(); await gate.promise; return { isError: false, content: [] }; });
  await entered.promise; f.at = 1150; await f.fireTimers();
  assert.equal(status(f, agent).inFlight, 1); assert.deepEqual(loaded(f, agent), [name]);
  gate.resolve(); await running; await f.prepare.collect(agent);
  assert.deepEqual(loaded(f, agent), []); assert.equal(status(f, agent).retainedCount, 0);
});

test('sliding success after nominal expiry can renew its pinned original entry; failed calls cannot', async () => {
  for (const isError of [false, true]) {
    const f = setup(); const { agent } = f.make(`late-${isError}`); await load(f, agent);
    const gate = deferred(), entered = deferred(), name = f.sources[0].publicName;
    const running = f.run({ agent, name }, async () => { entered.resolve(); await gate.promise; return { isError, content: [] }; });
    await entered.promise; f.at = 1120; await f.fireTimers(); gate.resolve(); await running; await f.prepare.collect(agent);
    assert.equal(loaded(f, agent).length, isError ? 0 : 1);
    if (!isError) assert.equal(entry(f, agent).expiresAt, 1220);
  }
});

test('explicit release defers an active body, rejects a new unlogged call and does not renew after success', async () => {
  const f = setup(); const { agent } = f.make('release-body'); await load(f, agent);
  const name = f.sources[0].publicName, gate = deferred(), entered = deferred();
  const running = f.run({ agent, name }, async () => { entered.resolve(); await gate.promise; return { isError: false, content: [] }; });
  await entered.promise;
  const release = await f.prepare.release(agent, { publicNames: [name] });
  assert.deepEqual(release.detail.pending, [name]); assert.equal(status(f, agent).inFlight, 1);
  assert.equal((await f.run({ agent, name })).isError, true);
  assert.equal((await load(f, agent)).message, 'RESOURCE_RELEASE_PENDING');
  gate.resolve(); await running; await f.prepare.collect(agent);
  assert.deepEqual(loaded(f, agent), []); assert.equal(status(f, agent).retainedCount, 0);
});

test('step pins all prepared siblings until step/end even before a queued call is logged', async () => {
  const f = setup({ resources: { ttlMode: 'fixed' } }); const { agent } = f.make('step');
  await load(f, agent, [cap(f), cap(f, 1)]);
  const names = loaded(f, agent); f.event(agent, 'step/start', { turn: 1, step: 1 });
  f.at = 1200; await f.fireTimers(); assert.deepEqual(new Set(loaded(f, agent)), new Set(names));
  const release = await f.prepare.release(agent, { publicNames: names }); assert.equal(release.detail.pending.length, 2);
  for (const [i, name] of names.entries()) {
    const callId = `queued-${i}`; f.event(agent, 'tool/call', { turn: 1, step: 1, callId, name });
    assert.equal((await f.run({ agent, name, callId })).isError, false);
    f.event(agent, 'tool/result', { turn: 1, step: 1, message: { toolCallId: callId } });
    assert.equal(loaded(f, agent).length, 2, 'ordered result is not a batch-end signal');
  }
  f.event(agent, 'step/end', { turn: 1, step: 1 });
  f.event(agent, 'turn/end', { turn: 1 }); await f.prepare.collect(agent);
  assert.deepEqual(loaded(f, agent), []);
});

test('security revocation overrides in-flight resource pins and cannot authorize a queued sibling', async () => {
  const f = setup(); const { agent } = f.make('revoke'); await load(f, agent);
  const name = f.sources[0].publicName;
  f.event(agent, 'step/start', { turn: 1, step: 1 });
  f.reviews[0].enabled = false; assert.ok(f.guard(agent, name)); f.controller.refresh();
  assert.deepEqual(loaded(f, agent), []);
  f.event(agent, 'tool/call', { turn: 1, step: 1, callId: 'denied', name });
  assert.equal((await f.run({ agent, name, callId: 'denied' })).isError, true);
  f.event(agent, 'tool/result', { turn: 1, step: 1, message: { toolCallId: 'denied' } });
  f.event(agent, 'step/end', { turn: 1, step: 1 }); await f.prepare.collect(agent);
  f.reviews[0].enabled = true; assert.deepEqual(loaded(f, agent), []);
});

test('LRU evicts only unpinned least recently successful entries and preserves a busy step under pressure', async () => {
  const f = setup({ resources: { ttlMs: 1000, maxPrepared: 2 } }); const { agent } = f.make('lru');
  await load(f, agent, [cap(f), cap(f, 1)]);
  f.at = 1010; await f.run({ agent, name: f.sources[0].publicName });
  const result = await load(f, agent, [cap(f, 2)]); assert.equal(result.ok, true);
  assert.ok(loaded(f, agent).includes(f.sources[0].publicName)); assert.ok(!loaded(f, agent).includes(f.sources[2].publicName));
  assert.ok(result.detail.evicted.includes(f.sources[2].publicName));
  f.event(agent, 'step/start', { turn: 1, step: 1 });
  const before = f.names(agent);
  assert.equal((await load(f, agent, [cap(f, 1)])).message, 'SMART_RESOURCE_CAPACITY'); assert.deepEqual(f.names(agent), before);
  f.event(agent, 'step/end', { turn: 1, step: 1 }); await f.prepare.collect(agent);
});

test('complete assistant batch pins every referenced sibling but frees unrelated entries for model-driven LRU', async () => {
  const f = setup({ resources: { maxPrepared: 2, ttlMs: 1000 } }); const { agent } = f.make('inventory');
  await load(f, agent, [cap(f), cap(f, 1)]);
  f.event(agent, 'step/start', { turn: 1, step: 1 });
  f.event(agent, 'assistant/message', { turn: 1, step: 1, message: { id: 'model-inventory', role: 'assistant', content: [
    { type: 'tool-call', id: 'preparing', name: 'mcp_connector_discover' },
    { type: 'tool-call', id: 'sibling', name: f.sources[0].publicName },
  ] } });
  const result = await load(f, agent, [cap(f, 2)]);
  assert.equal(result.ok, true); assert.deepEqual(result.detail.evicted, [f.sources[2].publicName]);
  assert.ok(loaded(f, agent).includes(f.sources[0].publicName));
  f.event(agent, 'tool/call', { turn: 1, step: 1, callId: 'forged', name: f.sources[0].publicName });
  assert.equal(status(f, agent).errorCode, 'RESOURCE_UNPLANNED_CALL');
});

test('a trusted source switch is atomic when idle and blocked while the original capability is pinned', async () => {
  const f = setup(); const { agent } = f.make('switch'); await load(f, agent);
  f.event(agent, 'step/start', { turn: 1, step: 1 }); f.intent(agent, [f.sources[1]]);
  assert.equal((await load(f, agent)).message, 'RESOURCE_ENTRY_IN_FLIGHT');
  f.event(agent, 'step/end', { turn: 1, step: 1 }); await f.prepare.collect(agent);
  assert.equal((await load(f, agent)).ok, true); assert.deepEqual(loaded(f, agent), [f.sources[1].publicName]);
});

test('release, eviction and collection mask failures roll back entries and TTL metadata together', async () => {
  const f = setup({ resources: { maxPrepared: 1, ttlMode: 'fixed' } }); const { agent } = f.make('rollback'); await load(f, agent);
  const name = f.sources[0].publicName, before = entry(f, agent);
  f.failRestrict(); assert.equal((await f.prepare.release(agent, { publicNames: [name] })).ok, false);
  assert.deepEqual(entry(f, agent), before); assert.ok(f.names(agent).includes(name));
  f.failRestrict(); assert.equal((await load(f, agent, [cap(f, 1)])).ok, false);
  assert.deepEqual(entry(f, agent), before); assert.deepEqual(loaded(f, agent), [name]);
  f.at = 1100; f.failRestrict(5); assert.equal((await f.prepare.collect(agent)).ok, false);
  assert.ok(f.guard(agent, name)); f.failRestrict(0); assert.equal((await f.prepare.collect(agent)).ok, true);
  assert.deepEqual(loaded(f, agent), []);
});

test('timer installation failure rolls back preparation and does not leave a silently loaded source', async () => {
  const f = setup({ timerFailures: 1 }); const { agent } = f.make('timer-failure');
  assert.equal((await load(f, agent)).message, 'RESOURCE_TIMER_FAILED');
  assert.deepEqual(loaded(f, agent), []); assert.equal(status(f, agent).retainedCount, 0);
  assert.equal(f.names(agent).includes(f.sources[0].publicName), false);
  assert.equal((await load(f, agent)).ok, true); assert.equal(f.timers.size, 1);
});

test('partial Host event mounting releases every acquired listener and never permits unmounted resource use', async () => {
  const base = fixture(); const { agent } = base.make('mount-failure');
  const p = createSmartModePrepareController({ enabled: true, scope: base.scope, restrictions: base.controller,
    selector: base.selector, getReadOnlyReviews: () => base.reviews,
    resources: { enabled: true, hostContract: SMART_RESOURCE_HOST_CONTRACT },
    getBudgetSchemas: (agent, names) => names.map((name) => ({ name, parameters: {} })), isNativeExecutor: () => true,
  });
  const acquired = [], released = [];
  assert.throws(() => p.mount({ on(type) {
    if (type === 'agent/disposed') throw new Error('synthetic registration failure');
    acquired.push(type); return () => released.push(type);
  } }), /registration failure/);
  assert.deepEqual(released, [...acquired].reverse());
  assert.equal((await p.prepare(agent, { capabilityIds: [cap(base)] })).message, 'RESOURCE_NOT_MOUNTED');
});

test('concurrent prepare, release and timer collection serialize without losing a successful update', async () => {
  const f = setup({ resources: { ttlMode: 'fixed' } }); const { agent } = f.make('queue'); await load(f, agent);
  const original = f.selector.select, gate = deferred(), entered = deferred(); let first = true;
  f.selector.select = async (...args) => { const plan = await original(...args);
    if (first) { first = false; entered.resolve(); await gate.promise; } return plan; };
  const preparing = load(f, agent, [cap(f, 1)]); await entered.promise;
  f.at = 1100;
  const releasing = f.prepare.release(agent, { publicNames: [f.sources[0].publicName] });
  const collecting = f.prepare.collect(agent); gate.resolve();
  const results = await Promise.all([preparing, releasing, collecting]); assert.ok(results.every((item) => item.ok), JSON.stringify(results));
  assert.deepEqual(loaded(f, agent), [f.sources[2].publicName]); assert.equal(entry(f, agent, f.sources[2].publicName).expiresAt, 1200);
});

test('resource state, timers and tokens are isolated across Agents, identical IDs and compatibility mode', async () => {
  const f = setup(); const a = f.make('a'), b = f.make('b'), compat = f.make('compat', 'compat');
  await load(f, a.agent); await load(f, b.agent);
  const before = f.names(compat.agent), name = f.sources[0].publicName;
  await f.prepare.release(a.agent, { publicNames: [name] });
  assert.deepEqual(loaded(f, a.agent), []); assert.deepEqual(loaded(f, b.agent), [name]);
  assert.equal((await f.prepare.release(compat.agent, { publicNames: [name] })).ok, false); assert.deepEqual(f.names(compat.agent), before);
  const replacement = f.make('b'); assert.deepEqual(loaded(f, replacement.agent), []);
  f.emit('agent/disposed', { agent: b.agent }); assert.deepEqual(loaded(f, replacement.agent), []);
  f.at = 1100; await f.fireTimers(); assert.deepEqual(loaded(f, replacement.agent), []);
});

test('unknown or reordered step boundaries fail closed and never pretend an unfinished batch was drained', async () => {
  const f = setup(); const { agent } = f.make('bad-order'); await load(f, agent);
  f.event(agent, 'step/start', { turn: 1, step: 1 });
  f.event(agent, 'tool/call', { turn: 1, step: 1, callId: 'pending', name: f.sources[0].publicName });
  f.event(agent, 'step/end', { turn: 1, step: 1 });
  assert.equal(status(f, agent).errorCode, 'RESOURCE_STEP_NOT_DRAINED');
  assert.throws(() => f.prepare.assertResourceReady(agent), { code: 'RESOURCE_STEP_NOT_DRAINED' });
  assert.equal((await f.prepare.release(agent, { publicNames: [f.sources[0].publicName] })).ok, false);
});

test('a replayed latest event is idempotent but an older reordered event is rejected', async () => {
  const f = setup(); const { agent } = f.make('duplicate'); await load(f, agent);
  const event = f.event(agent, 'step/start', { turn: 1, step: 1 });
  f.emit('session/event', { id: agent.id }, event); assert.equal(status(f, agent).activeSteps, 1);
  f.emit('session/event', { id: agent.id }, { ...event, seq: 0 });
  assert.equal(status(f, agent).errorCode, 'RESOURCE_EVENT_ORDER');
});

test('unsupported executor changes block prepare, inference and nested dispatch without changing compat behavior', async () => {
  let native = true;
  const f = setup({ isNativeExecutor: () => native }); const { agent } = f.make('executor'); await load(f, agent);
  assert.equal((await f.run({ agent, name: f.sources[0].publicName, parent: {} })).isError, true);
  native = false;
  assert.equal((await load(f, agent)).message, 'UNVERIFIED_RESOURCE_EXECUTOR');
  assert.throws(() => f.prepare.assertResourceReady(agent), { code: 'UNVERIFIED_RESOURCE_EXECUTOR' });
});

test('management release rejects foreign names, forged Agent context and unsupported payloads; status stays schema-free', async () => {
  const f = setup({ t: createTranslator('en', { en: EN_DICTIONARY }) }); const { agent } = f.make('manage'), b = f.make('peer'); await load(f, agent);
  const def = agent.locals.get('mcp_connector_discover');
  await assert.rejects(def.execute({ action: 'release', publicNames: [f.sources[0].publicName] }, { agent: b.agent }), /AGENT_MISMATCH/);
  for (const args of [{ publicNames: ['outside_fixture'] }, { publicNames: ['mcp__qcc-company-other__read'] },
    { publicNames: [f.sources[0].publicName], agentId: 'peer' }, { publicNames: [] }]) {
    assert.equal((await f.prepare.release(agent, args)).ok, false);
  }
  const read = await def.execute({ action: 'status' }, { agent });
  assert.equal(read.detail.resources.enabled, true); assert.doesNotMatch(JSON.stringify(read), /inputSchema|parameters/);
  const released = await def.execute({ action: 'release', publicNames: [f.sources[0].publicName] }, { agent });
  assert.equal(released.ok, true); assert.doesNotMatch(JSON.stringify(def.output.render({}, released)), /\p{Script=Han}/u);
  assert.deepEqual(loaded(f, agent), []);
});

test('dispose requires settled resource calls and clears only owned timers and prepared visibility', async () => {
  const f = setup(); const { agent } = f.make('dispose'); await load(f, agent);
  const gate = deferred(), entered = deferred();
  const running = f.run({ agent, name: f.sources[0].publicName }, async () => { entered.resolve(); await gate.promise; return { isError: false, content: [] }; });
  await entered.promise;
  assert.throws(() => f.prepare.dispose(), { code: 'RESOURCE_DISPOSE_REQUIRES_DRAIN' });
  gate.resolve(); await running; await f.prepare.collect(agent);
  f.prepare.dispose(); assert.equal(f.timers.size, 0); assert.deepEqual(loaded(f, agent), []);
  assert.ok(f.names(agent).includes('outside_fixture'));
});
