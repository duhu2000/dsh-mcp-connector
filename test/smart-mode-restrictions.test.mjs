import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerTools, MCP_CONNECTOR_MANAGEMENT_NAMES } from '../lib/tools.js';
import { readHostRestrictionNames } from '../lib/host-tool-names.js';
import { createSmartModeRestrictionController, SMART_RESTRICTION_HOST_CONTRACT } from '../lib/smart-mode-restrictions.js';
import { enterpriseFixture } from '../scripts/fixtures/smart-mode-enterprise.mjs';
import { createTranslator } from '../lib/i18n/index.js';
import { EN_DICTIONARY } from '../lib/i18n/locales/en.js';

function fixture(options = {}) {
  const data = enterpriseFixture(options);
  const globals = new Map(), guards = new Set(), listeners = new Map(), agents = [], prepared = new Map();
  const calls = [], denied = new Set(), hidden = new Set(), manual = new Set();
  let brokenRead = false, brokenRestrict = false, brokenRegistration = false, restrictions = 0;
  const emit = (type, ...args) => { for (const fn of listeners.get(type) ?? []) fn(...args); };
  const view = (agent) => {
    if (brokenRead) throw new Error('synthetic view failure');
    const visible = new Map([...globals].filter(([name]) => !agent || [...agent.masks].every((mask) => !mask.has(name))));
    if (agent) for (const [name, def] of agent.locals) visible.set(name, def);
    return { visible, knownNames: new Set([...globals.keys(), ...agent?.locals.keys() ?? []]), restrictableNames: new Set(globals.keys()) };
  };
  const ctx = { tools: {
    view, get: (name, agent) => view(agent).visible.get(name),
    guard(fn) { guards.add(fn); return () => guards.delete(fn); },
    register(def) { globals.set(def.name, def); emit('tools/change'); return () => { globals.delete(def.name); emit('tools/change'); }; },
    schemas() { assert.fail('controllers must not materialize schemas'); },
  },
  on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
  agents: { list: () => agents },
  };
  registerTools(ctx, { sessionTools: async (args, exec) => {
    calls.push({ args, exec });
    return { ok: args.action !== 'activate' || args.confirmed === true, message: 'legacy', detail: {} };
  } }, { compact: options.compact, t: options.controller?.t });
  for (const name of [...data.businessNames, ...data.outsideNames, 'mcp_connector_third_party']) ctx.tools.register({ name });
  const controller = createSmartModeRestrictionController(ctx, {
    enabled: true, hostContract: SMART_RESTRICTION_HOST_CONTRACT, scope: data.scope,
    getRecords: () => data.records, getCatalogEntries: () => data.catalog,
    getPreparedNames: (agent) => prepared.get(agent) ?? [],
    isRecordUsable: () => true, isRecordVisible: (record) => !hidden.has(record.key),
    isToolAllowed: (name) => !denied.has(name), isManuallyActive: (name) => manual.has(name),
    ...options.controller,
  });
  controller.mount(ctx);
  const make = (id, mode = 'smart') => {
    const agent = { id, status: 'idle', locals: new Map(), masks: new Set() };
    agent.ctx = { tools: {
      get: ctx.tools.get,
      register(def) {
        if (brokenRegistration && def.name === 'mcp_connector_session_tools') throw new Error('synthetic register failure');
        if (agent.locals.has(def.name)) throw new Error('duplicate local');
        agent.locals.set(def.name, def); emit('tools/change');
        return () => { agent.locals.delete(def.name); emit('tools/change'); };
      },
      restrict({ deny }) {
        if (brokenRestrict) throw new Error('synthetic restriction failure');
        assert.ok(deny.every((name) => globals.has(name)), 'only restrictable names accepted');
        restrictions++; const mask = new Set(deny); agent.masks.add(mask); emit('tools/change');
        return () => { agent.masks.delete(mask); emit('tools/change'); };
      },
    } };
    agents.push(agent);
    const stop = controller.installMode(agent, data.snapshot(id, mode));
    return { agent, stop };
  };
  return { ...data, ctx, controller, make, prepared, calls, denied, hidden, manual, globals, guards, emit,
    names: (agent) => [...view(agent).visible.keys()].sort(),
    guard: (name, agent) => [...guards].map((fn) => fn({ name, agent })).find((value) => value !== undefined),
    breakRead: (value) => { brokenRead = value; }, breakRestrict: (value) => { brokenRestrict = value; },
    breakRegistration: () => { brokenRegistration = true; }, restrictions: () => restrictions,
  };
}

test('disabled controller is inert and does not inspect Host or scope', () => {
  const ctx = new Proxy({}, { get() { assert.fail('disabled Host access'); } });
  const c = createSmartModeRestrictionController(ctx);
  c.mount(ctx)(); c.installMode({}, {})(); c.dispose();
});

test('explicit Host contract and exactly one bound six-server account group are required', () => {
  assert.throws(() => fixture({ controller: { hostContract: 'unknown' } }), { code: 'UNVERIFIED_RESTRICTION_HOST' });
  const data = enterpriseFixture();
  assert.throws(() => fixture({ controller: { scope: { ...data.scope, connections: data.scope.connections.slice(0, 5) } } }), { code: 'INVALID_ENTERPRISE_SCOPE' });
  const wrong = enterpriseFixture(); wrong.records[0].auth.grantKey = 'other';
  assert.throws(() => fixture({ controller: { getRecords: () => wrong.records } }), { code: 'GROUP_BINDING_CHANGED' });
});

test('25 legacy management names match the actual definitions; no broad prefix ownership', () => {
  const f = fixture();
  assert.equal(MCP_CONNECTOR_MANAGEMENT_NAMES.length, 25);
  assert.ok(MCP_CONNECTOR_MANAGEMENT_NAMES.every((name) => f.globals.has(name)));
});

test('smart sees two local entries and zero enterprise tools; compat and all 57 outside definitions remain intact', () => {
  const f = fixture({ full: true });
  const globals = [...f.globals];
  const { agent: compat } = f.make('compat', 'compat');
  const before = f.names(compat);
  const { agent } = f.make('smart');
  assert.equal(f.businessNames.length, 356); assert.equal(f.outsideNames.length, 57);
  assert.deepEqual(f.names(compat), before);
  assert.deepEqual([...f.globals], globals, 'global definitions are not rewritten');
  assert.deepEqual(f.names(agent).filter((name) => name.startsWith('mcp_connector_') && name !== 'mcp_connector_third_party'), ['mcp_connector_discover', 'mcp_connector_session_tools']);
  assert.ok(f.businessNames.every((name) => !f.names(agent).includes(name) && f.guard(name, agent)));
  assert.ok(f.outsideNames.every((name) => f.names(agent).includes(name) && f.guard(name, agent) === undefined));
  assert.ok(f.names(agent).includes('mcp_connector_third_party'));
  assert.equal(compat.locals.size, 0);
});

test('only trusted prepared membership can narrow the deny set; no cross-Agent or same-ID state sharing', () => {
  const f = fixture(); const a = f.make('a'), b = f.make('b'); const name = f.businessNames[0];
  f.prepared.set(a.agent, [name]); f.controller.refresh();
  assert.ok(f.names(a.agent).includes(name)); assert.equal(f.guard(name, a.agent), undefined);
  assert.ok(!f.names(b.agent).includes(name)); assert.ok(f.guard(name, b.agent));
  a.stop(); const fresh = f.make('a');
  assert.ok(!f.names(fresh.agent).includes(name));
  assert.equal(f.guard(name, undefined), undefined, 'non-Agent automation remains legacy');
});

test('cache discovery still finds hidden tools, filters permissions and never loads a tool or returns its schema', async () => {
  const f = fixture(); const { agent } = f.make('a');
  f.catalog[0].inputSchema = { secretFixture: 'must-not-return' };
  const tool = agent.locals.get('mcp_connector_discover');
  const result = await tool.execute({ action: 'search', query: 'fixture' }, { agent });
  assert.ok(result.detail.items.some((entry) => entry.publicName === f.businessNames[0]));
  assert.ok(result.detail.items.every((entry) => entry.prepared === false));
  assert.doesNotMatch(JSON.stringify(result), /inputSchema|must-not-return/);
  assert.match(tool.output.render({}, result)[0].text, new RegExp(f.businessNames[0]));
  assert.ok(!f.names(agent).includes(f.businessNames[0]));
  f.denied.add(f.businessNames[0]);
  const next = await tool.execute({ action: 'search', query: 'fixture' }, { agent });
  assert.ok(!next.detail.items.some((entry) => entry.publicName === f.businessNames[0]));
});

test('management rejects forged Agent arguments, other-Agent context, prepare and arbitrary dispatch', async () => {
  const f = fixture(); const { agent } = f.make('a'), b = f.make('b');
  const discover = agent.locals.get('mcp_connector_discover');
  await assert.rejects(discover.execute({ action: 'status' }, { agent: b.agent }), /AGENT_MISMATCH/);
  for (const args of [{ action: 'status', agentId: 'b' }, { action: 'prepare' }, { action: 'call', name: f.businessNames[0] }, { action: 'search', query: 'x', limit: 100 }]) {
    assert.equal((await discover.execute(args, { agent })).ok, false);
  }
  assert.equal((await agent.locals.get('mcp_connector_session_tools').execute({ action: 'prepare' }, { agent })).ok, false);
  assert.equal(f.calls.length, 0);
});

test('local session entry preserves original args, context, confirmation, revision and TTL contract', async () => {
  const f = fixture(); f.globals.get('mcp_connector_session_tools').timeoutMs = 1234;
  const { agent } = f.make('a'); const exec = { agent };
  assert.equal(agent.locals.get('mcp_connector_session_tools').timeoutMs, 1234, 'Host execution metadata preserved');
  const args = { action: 'activate', confirmed: false, expectedRevision: 3, ttlMinutes: 4, publicNames: [f.businessNames[0]] };
  const result = await agent.locals.get('mcp_connector_session_tools').execute(args, exec);
  assert.equal(result.ok, false); assert.equal(f.calls[0].args, args); assert.equal(f.calls[0].exec, exec);
  assert.equal(args.confirmed, false); assert.ok(!f.names(agent).includes(f.businessNames[0]));
});

test('workspace, governance, lifecycle and manual gates can only tighten trusted prepared membership', () => {
  const f = fixture(); const { agent } = f.make('a'); const name = f.businessNames[0];
  f.prepared.set(agent, [name]); f.controller.refresh(); assert.ok(f.names(agent).includes(name));
  f.denied.add(name); assert.ok(f.guard(name, agent)); f.controller.refresh(); assert.ok(!f.names(agent).includes(name));
  f.denied.clear(); f.hidden.add(f.records[0].key); f.controller.refresh(); assert.ok(!f.names(agent).includes(name));
  f.hidden.clear(); f.records[0].enabled = false; f.controller.refresh(); assert.ok(!f.names(agent).includes(name));
  f.records[0].enabled = true; f.records[0].injectionMode = 'session'; f.controller.refresh(); assert.ok(!f.names(agent).includes(name));
  f.manual.add(name); f.controller.refresh(); assert.ok(f.names(agent).includes(name));
  f.manual.delete(name); assert.ok(f.guard(name, agent));
});

test('new owned tools are denied, repeated events settle, and removed names are never passed to restrict', () => {
  const f = fixture(); const { agent } = f.make('a'); const before = f.restrictions();
  const name = 'mcp__qcc-company__new'; const stop = f.ctx.tools.register({ name });
  assert.ok(!f.names(agent).includes(name)); stop();
  const settled = f.restrictions();
  for (let i = 0; i < 10; i++) f.emit('tools/change');
  assert.equal(f.restrictions(), settled); assert.ok(settled > before);
});

test('restriction refresh failures retain the previous mask and block admission plus dispatch', () => {
  const f = fixture(); const { agent } = f.make('a'); const name = f.businessNames[0];
  const previous = [...agent.masks][0];
  f.breakRestrict(true); f.ctx.tools.register({ name: 'mcp__qcc-company__new' });
  assert.ok(agent.masks.has(previous)); assert.ok(f.guard(name, agent));
  assert.equal(f.guard(f.outsideNames[0], agent), undefined);
  assert.throws(() => f.controller.assertReady(agent), /REFRESH_FAILED/);
  f.breakRestrict(false); assert.throws(() => f.controller.assertReady(agent), { code: 'SMART_VISIBILITY_CHANGED' });
  f.controller.assertReady(agent);
  f.breakRead(true); f.controller.refresh();
  assert.equal(f.controller.status(agent).blocked, true);
  f.breakRead(false); f.controller.assertReady(agent);
});

test('local business shadow is never authorized, even when its name is prepared', () => {
  const f = fixture(); const { agent } = f.make('a'); const name = f.businessNames[0];
  f.prepared.set(agent, [name]); f.controller.refresh();
  const stop = agent.ctx.tools.register({ name });
  assert.throws(() => f.controller.assertReady(agent), { code: 'BUSINESS_TOOL_SHADOW' });
  assert.ok(f.guard(name, agent)); stop(); f.controller.assertReady(agent);
});

test('local registration failure is atomic; failed install leaves no local entries or mask', () => {
  const f = fixture(); f.breakRegistration();
  assert.throws(() => f.make('a'), /register failure/);
  const names = f.ctx.agents.list()[0];
  assert.equal(names.locals.size, 0); assert.equal(names.masks.size, 0);
});

test('missing records, grant changes and asynchronous permission callbacks never widen access', () => {
  const f = fixture(); const { agent } = f.make('a'); const name = f.businessNames[0];
  f.prepared.set(agent, [name]); f.controller.refresh();
  f.records[0].auth.grantKey = 'another-account';
  assert.throws(() => f.controller.assertReady(agent), { code: 'GROUP_BINDING_CHANGED' });
  assert.ok(f.guard(name, agent));
  f.records[0].auth.grantKey = f.scope.accountRef; f.records.splice(0, 1); f.controller.refresh();
  assert.ok(!f.names(agent).includes(name));
  const asyncPolicy = fixture({ controller: { isToolAllowed: async () => true } });
  const peer = asyncPolicy.make('async'); asyncPolicy.prepared.set(peer.agent, [asyncPolicy.businessNames[0]]);
  asyncPolicy.controller.refresh();
  assert.ok(!asyncPolicy.names(peer.agent).includes(asyncPolicy.businessNames[0]));
});

for (const callback of ['isRecordUsable', 'isRecordVisible', 'isToolAllowed', 'isManuallyActive']) {
  test(`a rejecting async ${callback} fails closed without an unhandled rejection`, async () => {
    const f = fixture({ controller: { [callback]: async () => { throw new Error('synthetic permission unavailable'); } } });
    for (const record of f.records) record.injectionMode = 'session';
    const { agent } = f.make(`async-failure-${callback}`);
    f.prepared.set(agent, [f.businessNames[0]]); f.controller.refresh();
    assert.ok(!f.names(agent).includes(f.businessNames[0]));
    assert.ok(f.guard(f.businessNames[0], agent));
    await new Promise((resolve) => setImmediate(resolve));
    f.controller.dispose();
  });
}

test('a foreign snapshot or replaced legacy entry cannot redirect management to another account or implementation', () => {
  const f = fixture(); const compat = f.make('foreign', 'compat'); compat.stop();
  assert.throws(() => f.controller.installMode(compat.agent, { ...f.snapshot(compat.agent.id), accountRef: 'another-grant' }), { code: 'SNAPSHOT_SCOPE_MISMATCH' });
  const { agent } = f.make('replacement');
  const original = f.globals.get('mcp_connector_session_tools');
  f.globals.set(original.name, { ...original, execute: async () => assert.fail('must not delegate after replacement') });
  assert.throws(() => f.controller.assertReady(agent), { code: 'LEGACY_SESSION_ENTRY_CHANGED' });
  f.globals.set(original.name, original); f.controller.assertReady(agent);
});

test('rollback removes only this layer and restores legacy definitions without touching stored mode or other deny layers', () => {
  const f = fixture(); const { agent, stop } = f.make('a'); const name = f.outsideNames[0];
  const external = agent.ctx.tools.restrict({ deny: [name] });
  const recordModes = f.records.map((record) => record.injectionMode);
  agent.status = 'running'; assert.throws(stop, { code: 'ROLLBACK_REQUIRES_IDLE_AGENT' });
  agent.status = 'idle'; stop();
  assert.equal(agent.locals.size, 0);
  assert.ok(f.businessNames.every((n) => f.names(agent).includes(n)));
  assert.ok(!f.names(agent).includes(name)); assert.deepEqual(f.records.map((record) => record.injectionMode), recordModes);
  external(); f.controller.dispose(); assert.equal(f.guards.size, 0);
});

test('existing compact global registration stays unchanged for a compat Agent', () => {
  const f = fixture({ compact: true }); const { agent } = f.make('compact', 'compat');
  assert.deepEqual(f.names(agent).filter((name) => name.startsWith('mcp_connector_') && name !== 'mcp_connector_third_party'), ['mcp_connector_discover', 'mcp_connector_session_tools']);
});

test('restriction reader rejects incompatible shape with no schema fallback', () => {
  assert.throws(() => readHostRestrictionNames({ view: () => ({}) }, {}), /incompatible/);
  assert.throws(() => readHostRestrictionNames({ definitions: () => [] }, {}), /unavailable/);
});

test('smart local descriptions and rendered cache results follow the injected Host language', async () => {
  const f = fixture({ controller: { t: createTranslator('en', { en: EN_DICTIONARY }) } });
  const { agent } = f.make('english');
  const discover = agent.locals.get('mcp_connector_discover');
  const result = await discover.execute({ action: 'search', query: 'fixture' }, { agent });
  assert.match(discover.output.render({}, result)[0].text, /Not prepared/);
  for (const def of agent.locals.values()) assert.doesNotMatch(JSON.stringify({ description: def.description, parameters: def.parameters }), /\p{Script=Han}/u);
  assert.doesNotMatch(JSON.stringify(discover.output.render({}, result)), /\p{Script=Han}/u);
});

test('canonical source search preserves the restriction layer preparation state', async () => {
  const data = enterpriseFixture(); const name = data.businessNames[0];
  const f = fixture({ controller: { sourceSearch: async () => ({ items: [{ publicName: name, serverName: data.records[0].serverName, prepared: false }] }) } });
  const { agent } = f.make('source-prepared'); f.prepared.set(agent, [name]); f.controller.refresh();
  const result = await agent.locals.get('mcp_connector_discover').execute({ action: 'search', query: 'fixture' }, { agent });
  assert.equal(result.detail.items[0].prepared, true);
});
