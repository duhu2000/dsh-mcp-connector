import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSmartModeLifecycleAdapter, SMART_MODE_HOST_CONTRACT } from '../lib/smart-mode-lifecycle.js';
import { SmartModeStore } from '../lib/smart-mode-store.js';
import { registerTools } from '../lib/tools.js';
import { createSmartModeRestrictionController, SMART_RESTRICTION_HOST_CONTRACT } from '../lib/smart-mode-restrictions.js';
import { createSessionToolInjectionController } from '../lib/session-injection.js';
import { enterpriseFixture } from '../scripts/fixtures/smart-mode-enterprise.mjs';

// Explicitly selected installed Host code; no profile loader or production data.
// A selected but incompatible runtime FAILS. No remote/model/MCP client is used.
const anchor = process.env.DSH_HOST_INTEGRATION_ANCHOR;
let host;
if (anchor) {
  // Resolve siblings from the actual runtime, including its native executor.
  // The profile's dependency links need not expose that executor directly.
  const require = createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh-agent-loop'));
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  host = Object.assign({}, ...await Promise.all([
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-system-prompt',
  ].map(load)));
  host.native = await load('@deepseek-ai/dsh-tool-executor-native');
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const bounded = (promise) => Promise.race([
  promise,
  new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('isolated Host timed out')), 5000); timer.unref(); }),
]);
const policy = { mode: 'smart', policyVersion: 'fixture-v1', accountRef: 'synthetic-account', groupId: 'enterprise-six' };
const snapshot = (id, mode = 'smart') => ({ ...policy, mode, version: 1, sessionId: id, selection: 'user-confirmed' });
const privateTool = 'mcp__lifecycle_fixture__private';
const publicTool = 'lifecycle_fixture_public';

async function harness(t, options = {}) {
  const { setup, ...lifecycleOptions } = options;
  const tables = new Map(), snapshots = new Map(), requests = [], events = [], errors = [], handles = [];
  const trustedInputIds = new Set();
  let bodyCalls = 0;
  const persistence = {
    identity: Symbol('isolated-lifecycle-memory'),
    async create(header, opts = {}) {
      assert.equal(tables.has(header.id), false);
      tables.set(header.id, { header: structuredClone(header), rows: [], cut: opts.inheritedEventCount ?? 0, owned: false });
      return this.open(header.id, 'write');
    },
    async open(id, access) {
      const table = tables.get(id); assert.ok(table, 'synthetic session exists');
      if (access === 'write') { assert.equal(table.owned, false); table.owned = true; }
      let closed = false;
      return {
        id, header: structuredClone(table.header), inheritedEventCount: table.cut, access,
        async read(offset = 0, length) {
          assert.equal(closed, false);
          return { eventState: 'detached', events: structuredClone(table.rows.slice(offset, length === undefined ? undefined : offset + length)) };
        },
        async append(rows) {
          for (const row of rows) { assert.equal(row.seq, table.rows.length); table.rows.push(structuredClone(row)); }
        },
        async flush() {},
        async close() { if (!closed && access === 'write') table.owned = false; closed = true; },
        async [Symbol.asyncDispose]() { await this.close(); },
      };
    },
    async flush() {},
    async stat(id) {
      const table = tables.get(id);
      return table ? { header: structuredClone(table.header), eventCount: table.rows.length, revision: String(table.rows.length) } : undefined;
    },
    async list() { return Promise.all([...tables.keys()].map((id) => this.stat(id))); },
  };
  class OfflineAdapter extends host.LlmAdapter {
    providerInfo(id) { return { id, name: 'Offline lifecycle fixture' }; }
    async resolveModel(provider, id) { return { provider, id, name: id, contextWindow: 65536, inputModalities: ['text'] }; }
    async *stream(input) {
      requests.push({ tools: input.tools.map((tool) => tool.name), input });
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'offline' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'offline' } };
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const root = new host.Context();
  root.provide('sessionPersistence', persistence);
  root.on('session/event', (session, event) => {
    events.push({ id: session.id, event });
    const table = tables.get(session.id);
    if (table?.owned) { assert.equal(event.seq, table.rows.length); table.rows.push(structuredClone(event)); }
  });
  root.on('agent/error', ({ error }) => errors.push(error));
  for (const service of [host.SessionStore, host.SessionProjectionRegistry, host.AgentRegistry, host.LlmRuntime]) root.plugin(service);
  root.plugin(host.SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
  root.plugin(host.ToolRuntime);
  root.plugin(host.native);
  root.plugin(host.AgentLoop, { agents: [], maxParallelToolCalls: 2 });
  const ctx = await bounded(new Promise((resolve) => root.plugin({
    inject: ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections', 'agentLoop'],
    apply: resolve,
  })));
  ctx.llm.registerAdapter(['lifecycle-offline'], new OfflineAdapter());
  for (const name of [privateTool, publicTool]) ctx.tools.register({
    name, description: 'Synthetic lifecycle fixture; never executes a business tool',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => { bodyCalls++; throw new Error('No tool call is allowed in this fixture'); },
  });
  const configured = await setup?.(ctx);
  const installCalls = [];
  const integration = {
    enabled: true, hostContract: SMART_MODE_HOST_CONTRACT,
    readSnapshot: async (id) => snapshots.get(id),
    writeSnapshot: async (value) => { snapshots.set(value.sessionId, structuredClone(value)); },
    installMode(agent, value) {
      installCalls.push({ agent, value });
      return value.mode === 'smart' ? agent.ctx.tools.restrict({ deny: [privateTool] }) : () => {};
    },
    // Test-only provenance allowlist, not a claim that source.kind=user is proof.
    classifyInput: (message) => trustedInputIds.has(message.id) ? 'interactive' : 'background',
    selectDefault: () => policy,
    ...configured?.lifecycle,
    ...lifecycleOptions,
  };
  let adapter = createSmartModeLifecycleAdapter(integration);
  await adapter.mount(ctx);
  const agentOptions = { provider: 'lifecycle-offline', model: 'fixture', maxTokens: 30 };
  const create = async (id, extra = {}) => {
    const handle = await ctx.agents.create({ sessionId: id, agentOptions, ...extra });
    handles.push(handle); return handle;
  };
  const resume = async (id) => {
    const handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions });
    handles.push(handle); return handle;
  };
  const input = (trusted = true) => {
    const message = host.createUserMessage({ content: [{ type: 'text', text: 'Synthetic isolated lifecycle input' }], source: { kind: 'user' } });
    if (trusted) trustedInputIds.add(message.id);
    return message;
  };
  const drive = async (agent, message = input()) => { agent.followup(message); await bounded(agent.whenIdle()); };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const handle of handles.splice(0).reverse()) await handle.dispose();
    adapter.dispose();
    await configured?.close?.();
    await root.fiber.dispose();
    assert.equal(bodyCalls, 0, 'no business or synthetic tool body was invoked');
  };
  t.after(close);
  return {
    ctx, create, resume, input, drive, close, requests, events, snapshots, errors, tables, installCalls,
    get adapter() { return adapter; },
    async remount() { adapter.dispose(); adapter = createSmartModeLifecycleAdapter(integration); await adapter.mount(ctx); },
  };
}

const contract = (name, fn) => test(`installed Host smart lifecycle: ${name}`, { skip: !host, timeout: 15000 }, fn);

contract('first schema is restricted synchronously, commit is awaited, and queued turns lock once', async (t) => {
  const gate = deferred(), entered = deferred(); let writes = 0, selections = 0;
  const h = await harness(t, {
    async writeSnapshot() { writes++; entered.resolve(); await gate.promise; },
    selectDefault() { selections++; return policy; },
  });
  const { agent } = await h.create('first');
  agent.followup(h.input()); agent.followup(h.input());
  await bounded(entered.promise); await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(agent.ctx.tools.get(privateTool, agent), undefined);
  assert.equal(h.adapter.status(agent).committed, false);
  gate.resolve(); await bounded(agent.whenIdle());
  assert.equal(h.requests.length, 2);
  assert.equal(writes, 1); assert.equal(selections, 1);
  for (const request of h.requests) {
    assert.equal(request.tools.includes(privateTool), false);
    assert.equal(request.tools.includes(publicTool), true);
  }
  assert.equal(h.adapter.status(agent).committed, true);
  assert.deepEqual(h.errors, []);
});

contract('write failure sends no request, preserves durable input order, retry uses identical mode', async (t) => {
  let failing = true;
  const h = await harness(t, { async writeSnapshot() { if (failing) throw new Error('synthetic snapshot failure'); } });
  const { agent } = await h.create('failure');
  const first = h.input(), second = h.input();
  agent.followup(first); agent.followup(second); await bounded(agent.whenIdle());
  assert.equal(h.requests.length, 0);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [first.id, second.id]);
  assert.equal(agent.ctx.tools.get(privateTool, agent), undefined);
  assert.equal(h.adapter.status(agent).committed, false);
  assert.ok(h.events.some(({ event }) => event.type === 'turn/end' && event.data.reason.kind === 'blocked'));
  failing = false;
  await h.adapter.retry(agent);
  const wake = h.input(); await h.drive(agent, wake);
  assert.equal(h.requests.length, 3);
  const admitted = agent.session.snapshotEvents().filter((e) => e.type === 'user/message' && e.data.source.kind === 'user');
  assert.deepEqual(admitted.map((e) => e.data.id), [first.id, second.id, wake.id]);
  assert.ok(h.requests.every((r) => !r.tools.includes(privateTool)));
  assert.deepEqual(h.errors, []);
});

contract('empty old session reuse, resume, and idle plugin remount reinstall policy', async (t) => {
  const h = await harness(t);
  const blank = await h.create('old-blank'); await blank.dispose();
  assert.equal(h.snapshots.has('old-blank'), false);
  h.tables.get('old-blank').header.createdAt = 1;
  const live = await h.resume('old-blank');
  assert.equal(h.adapter.status(live.agent).phase, 'awaiting-input');
  await h.drive(live.agent);
  const first = live.agent;
  await live.dispose();
  const restored = await h.resume('old-blank');
  assert.notEqual(restored.agent, first);
  assert.equal(restored.agent.ctx.tools.get(privateTool, restored.agent), undefined);
  await h.remount();
  assert.equal(restored.agent.ctx.tools.get(privateTool, restored.agent), undefined);
  await h.drive(restored.agent);
  assert.ok(h.requests.every((r) => !r.tools.includes(privateTool)));
  assert.deepEqual(h.errors, []);
});

contract('historical and background sessions stay compatible alongside a smart peer', async (t) => {
  const h = await harness(t);
  const old = await h.create('historical');
  await h.drive(old.agent, h.input(false)); await old.dispose();
  h.snapshots.delete('historical'); // Synthetic pre-feature history without snapshot.
  const resumed = await h.resume('historical');
  assert.equal(h.adapter.status(resumed.agent).mode, 'compat');
  const smartPeer = await h.create('peer'); await h.drive(smartPeer.agent);
  assert.equal(smartPeer.agent.ctx.tools.get(privateTool, smartPeer.agent), undefined);
  assert.ok(resumed.agent.ctx.tools.get(privateTool, resumed.agent));
  await h.drive(resumed.agent);
  assert.equal(h.requests.at(-1).tools.includes(privateTool), true);
});

contract('fork and subagent install their own parent policy before first prompt', async (t) => {
  const h = await harness(t);
  const parent = await h.create('parent'); await h.drive(parent.agent);
  const inherited = parent.agent.session.snapshotEvents();
  const fork = await h.create('fork', {
    seed: host.buildForkSeed(inherited, inherited.length - 1), inheritedEventCount: inherited.length,
    meta: { parentSession: parent.agent.id, isSeeded: true },
  });
  const child = await h.create('child', {
    parentAgent: parent.agent, meta: { parentSession: parent.agent.id, origin: 'subagent', delegationDepth: 1 },
  });
  for (const handle of [fork, child]) {
    assert.equal(h.adapter.status(handle.agent).mode, 'smart');
    assert.equal(handle.agent.ctx.tools.get(privateTool, handle.agent), undefined);
    assert.ok(h.installCalls.some((call) => call.agent === handle.agent));
    assert.equal(h.snapshots.get(handle.agent.id).selection, 'parent');
    await h.drive(handle.agent);
  }
  assert.ok(h.requests.every((r) => !r.tools.includes(privateTool)));
});

contract('corrupt snapshot rolls back Agent publication without inference or compat fallback', async (t) => {
  const h = await harness(t);
  h.snapshots.set('bad', { ...snapshot('bad'), version: 900 });
  await assert.rejects(h.create('bad'), { code: 'INVALID_SNAPSHOT' });
  assert.equal(h.ctx.agents.get('bad'), undefined);
  assert.equal(h.ctx.sessions.get('bad'), undefined);
  assert.equal(h.requests.length, 0);
});

contract('assembly failure after claim also restores input without a request', async (t) => {
  const h = await harness(t);
  const { agent } = await h.create('assembly-failure');
  const stop = agent.ctx.systemPrompt.tools(() => { throw new Error('synthetic assembly failure'); });
  const message = h.input(); await h.drive(agent, message);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [message.id]);
  assert.ok(h.errors.length > 0);
  stop();
});

contract('cancel while snapshot write is pending drains the loop without resurrecting canceled input', async (t) => {
  const gate = deferred(), entered = deferred();
  const h = await harness(t, { async writeSnapshot() { entered.resolve(); await gate.promise; } });
  const { agent } = await h.create('cancel');
  agent.followup(h.input()); await bounded(entered.promise);
  // Let prompt assembly reach the async barrier before canceling.
  await tick(); agent.cancel({ kind: 'user' });
  await bounded(agent.whenIdle());
  assert.equal(h.requests.length, 0);
  assert.deepEqual(agent.inbox.nextTurn, []);
  assert.deepEqual(agent.inbox.nextStep, []);
  gate.resolve(); await tick();
  assert.equal(h.adapter.status(agent).committed, true);
  assert.equal(h.requests.length, 0, 'late commit cannot wake canceled inference');
});

contract('same-SessionId replacement waits for a canceled predecessor storage write', async (t) => {
  const gate = deferred(), entered = deferred(); let store;
  const h = await harness(t, { async writeSnapshot(value) {
    entered.resolve(); await gate.promise; store.set(value.sessionId, value);
  } });
  store = h.snapshots;
  const old = await h.create('replacement');
  old.agent.followup(h.input()); await bounded(entered.promise); await tick();
  old.agent.cancel({ kind: 'user' }); await bounded(old.agent.whenIdle()); await old.dispose();
  let resumed = false;
  const pending = h.resume('replacement').then((handle) => { resumed = true; return handle; });
  await tick();
  assert.equal(resumed, false);
  assert.equal(h.requests.length, 0);
  gate.resolve(); const fresh = await bounded(pending);
  assert.equal(h.adapter.status(old.agent).phase, 'unattached');
  assert.equal(h.adapter.status(fresh.agent).mode, 'smart');
  assert.equal(h.adapter.status(fresh.agent).committed, true);
  await h.drive(fresh.agent);
  assert.equal(h.requests.at(-1).tools.includes(privateTool), false);
});

contract('disabled adapter leaves the real Host tool set and inference behavior unchanged', async (t) => {
  const h = await harness(t, { enabled: false,
    readSnapshot() { assert.fail('disabled adapter must not touch storage'); },
    installMode() { assert.fail('disabled adapter must not install a mask'); },
  });
  const { agent } = await h.create('disabled'); await h.drive(agent);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].tools.includes(privateTool), true);
  assert.equal(h.requests[0].tools.includes(publicTool), true);
  assert.equal(h.adapter.status(agent).phase, 'disabled');
  assert.equal(h.snapshots.size, 0);
});

async function diskStoreFixture(t, options = {}) {
  const profileDir = await fs.mkdtemp(join(tmpdir(), 'mcp-smart-host-disk-'));
  const stores = [];
  const open = async (more = {}) => {
    const store = await SmartModeStore.open({ profileDir, ...options, ...more });
    stores.push(store); return store;
  };
  // Register cleanup before the harness so Host teardown happens first.
  t.after(async () => {
    for (const store of stores) await store.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  });
  return { open, store: await open(), profileDir };
}

const diskGroup = { accountRef: policy.accountRef, groupId: policy.groupId };
const defaultPolicy = { ...diskGroup, mode: 'smart', policyVersion: 'disk-fixture-v1' };

contract('real disk + new Context restores locked policy and starts without the old prepared set', async (t) => {
  const { store, open } = await diskStoreFixture(t);
  await store.setDefaultPolicy(defaultPolicy, { expectedRevision: 0 });
  const first = await harness(t, await store.lifecycleBindings(diskGroup));
  const old = await first.create('disk-restored');
  await first.drive(old.agent);
  const saved = await store.readSnapshot(old.agent.id);
  assert.equal(saved.policyRevision, 1);
  old.agent.ctx.tools.register({
    name: 'fixture_prepared_only', description: 'Ephemeral prepared-set sentinel',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => assert.fail('must never execute'),
  });
  assert.ok(old.agent.ctx.tools.get('fixture_prepared_only', old.agent));
  await first.close(); await store.close();
  const freshStore = await open();
  await freshStore.setDefaultPolicy({ ...defaultPolicy, mode: 'compat' }, { expectedRevision: 1 });
  const second = await harness(t, await freshStore.lifecycleBindings(diskGroup));
  const restored = await second.create('disk-restored');
  assert.equal(second.adapter.status(restored.agent).mode, 'smart');
  assert.equal(restored.agent.ctx.tools.get('fixture_prepared_only', restored.agent), undefined);
  await second.drive(restored.agent);
  assert.equal(second.requests.at(-1).tools.includes(privateTool), false);
  const unlocked = await second.create('disk-new'); await second.drive(unlocked.agent);
  assert.equal(second.adapter.status(unlocked.agent).mode, 'compat');
  assert.equal(second.requests.at(-1).tools.includes(privateTool), true);
  assert.deepEqual(await freshStore.readSnapshot('disk-restored'), saved);
});

contract('disk write failure blocks inference, restores input and recovers through the same transaction', async (t) => {
  let failWrite = false;
  const { store, open } = await diskStoreFixture(t, { io: { ...fs, async link(from, to) {
    if (failWrite && String(to).includes('sessions')) throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' });
    await fs.link(from, to);
  } } });
  await store.setDefaultPolicy(defaultPolicy, { expectedRevision: 0 });
  const h = await harness(t, await store.lifecycleBindings(diskGroup));
  const { agent } = await h.create('disk-failure'); const input = h.input();
  failWrite = true; await h.drive(agent, input);
  assert.equal(h.requests.length, 0);
  assert.equal(h.adapter.status(agent).committed, false);
  assert.equal(agent.ctx.tools.get(privateTool, agent), undefined);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [input.id]);
  assert.equal(await (await open()).readSnapshot(agent.id), undefined);
  failWrite = false; assert.equal((await h.adapter.retry(agent)).committed, true);
  await h.drive(agent);
  const userInputs = agent.session.snapshotEvents().filter((e) => e.type === 'user/message' && e.data.source.kind === 'user');
  assert.equal(userInputs.filter((e) => e.data.id === input.id).length, 1);
  assert.ok(h.requests.every((r) => !r.tools.includes(privateTool)));
  assert.equal((await store.readSnapshot(agent.id)).mode, 'smart');
});

contract('another process policy change cannot silently change an already assembled schema', async (t) => {
  const { store, open } = await diskStoreFixture(t);
  await store.setDefaultPolicy(defaultPolicy, { expectedRevision: 0 });
  const bindings = await store.lifecycleBindings(diskGroup);
  const peer = await open();
  await peer.setDefaultPolicy({ ...defaultPolicy, mode: 'compat' }, { expectedRevision: 1 });
  const h = await harness(t, bindings); const { agent } = await h.create('stale-default');
  const input = h.input(); await h.drive(agent, input);
  assert.equal(h.requests.length, 0);
  assert.equal(h.adapter.status(agent).committed, false);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [input.id]);
  assert.equal(await store.readSnapshot(agent.id), undefined);
  assert.equal(agent.ctx.tools.get(privateTool, agent), undefined);
});

contract('a conflicting disk snapshot blocks the losing inference and preserves its input', async (t) => {
  const { store, open } = await diskStoreFixture(t);
  await store.setDefaultPolicy(defaultPolicy, { expectedRevision: 0 });
  const h = await harness(t, await store.lifecycleBindings(diskGroup));
  const { agent } = await h.create('snapshot-conflict');
  const peer = await open();
  const winner = { version: 1, sessionId: agent.id, mode: 'compat', policyVersion: 'explicit-fixture', selection: 'user-confirmed' };
  await peer.writeSnapshot(winner);
  const input = h.input(); await h.drive(agent, input);
  assert.equal(h.requests.length, 0);
  assert.equal(h.adapter.status(agent).committed, false);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [input.id]);
  assert.deepEqual(await store.readSnapshot(agent.id), winner);
});

async function restrictedHarness(t, { full = false, delivery = 'native', legacy = false } = {}) {
  const data = enterpriseFixture({ full });
  const prepared = new Map(), denied = new Set(), hidden = new Set(), bodies = new Map();
  let controller, brokenRead = false;
  const h = await harness(t, { async setup(ctx) {
    let manualController;
    if (legacy) {
      manualController = createSessionToolInjectionController(ctx, {
        getRecords: () => data.records, isRecordVisible: () => true, isToolAllowed: () => true,
      });
      manualController.mountAgents(ctx);
    }
    const stopManagement = registerTools(ctx, { async sessionTools(args, exec) {
      if (!manualController) return { ok: true, message: 'synthetic legacy status', detail: {} };
      try {
        const detail = args.action === 'status' ? manualController.status(exec.agent)
          : args.action === 'preview-activate' ? manualController.previewActivation(exec.agent, args)
            : args.action === 'activate' ? manualController.activate(exec.agent, args)
              : manualController.deactivate(exec.agent, args);
        return { ok: true, message: 'synthetic legacy operation', detail };
      } catch (e) { return { ok: false, message: e.message }; }
    } });
    for (const name of [...data.businessNames, ...data.outsideNames]) ctx.tools.register({
      name, description: 'Synthetic offline tool, no MCP client or external provider',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      async execute() { bodies.set(name, (bodies.get(name) ?? 0) + 1); return { ok: true }; },
    });
    const facade = { tools: {
      get: (...args) => ctx.tools.get(...args),
      guard: (...args) => ctx.tools.guard(...args),
      view: (...args) => { if (brokenRead) throw new Error('synthetic view failure'); return ctx.tools.view(...args); },
      schemas() { assert.fail('new controller must not deep materialize schemas'); },
    } };
    const events = { on(type, listener) {
      let active = true;
      const stop = ctx.on(type, (...args) => {
        if (type !== 'tools/change' || delivery === 'native') return listener(...args);
        const schedule = delivery === 'microtask' ? queueMicrotask : setImmediate;
        schedule(() => { if (active) listener(...args); });
      });
      return () => { active = false; stop(); };
    } };
    controller = createSmartModeRestrictionController(facade, {
      enabled: true, hostContract: SMART_RESTRICTION_HOST_CONTRACT, scope: data.scope,
      getRecords: () => data.records, getCatalogEntries: () => data.catalog,
      getPreparedNames: (agent) => prepared.get(agent) ?? [],
      isRecordUsable: () => true, isRecordVisible: (record) => !hidden.has(record.key),
      isToolAllowed: (name) => !denied.has(name),
      isManuallyActive: (name, record, agent) => manualController?.inspect(name, agent)?.active === true,
    });
    controller.mount(events);
    return {
      lifecycle: { ...controller.lifecycleBindings(), selectDefault: () => ({
        mode: 'smart', policyVersion: 'fixture-v1', accountRef: data.scope.accountRef, groupId: data.scope.groupId,
      }) },
      close() { controller.dispose(); manualController?.dispose(); stopManagement(); },
    };
  } });
  return { ...data, ...h, prepared, denied, hidden, bodies, controller,
    breakRead(value) { brokenRead = value; },
    async call(agent, name, args = {}) {
      const result = await h.ctx.tools.execute({ agent, signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: `synthetic-${Math.random()}`, name, arguments: JSON.stringify(args) }] });
      return result.results[0].result;
    },
  };
}

contract('P1-03 first real request has two entries, no 356 enterprise schemas, and unchanged outside definitions', async (t) => {
  const h = await restrictedHarness(t, { full: true });
  h.snapshots.set('compat', h.snapshot('compat', 'compat'));
  const compat = await h.create('compat');
  const before = h.ctx.tools.schemas(compat.agent);
  const smart = await h.create('smart'); await h.drive(smart.agent);
  const names = h.requests.at(-1).tools;
  assert.ok(h.businessNames.every((name) => !names.includes(name)));
  assert.deepEqual(names.filter((name) => name.startsWith('mcp_connector_')).sort(), ['mcp_connector_discover', 'mcp_connector_session_tools']);
  assert.deepEqual(h.ctx.tools.schemas(compat.agent), before);
  const outside = (schemas) => schemas.filter((def) => h.outsideNames.includes(def.name));
  assert.equal(outside(before).length, 57);
  assert.deepEqual(outside(h.ctx.tools.schemas(smart.agent)), outside(before));
  assert.ok(h.businessNames.every((name) => h.ctx.tools.get(name, smart.agent) === undefined));
  assert.equal(h.ctx.tools.get('mcp_connector_discover', compat.agent), undefined);
  await h.drive(compat.agent);
  assert.equal(h.requests.at(-1).tools.filter((name) => name.startsWith('mcp_connector_')).length, 25);
});

contract('P1-03 native dispatch and lookup enforce prepared membership per Agent and after current-policy denial', async (t) => {
  const h = await restrictedHarness(t);
  const a = await h.create('a'), b = await h.create('b'); await h.drive(a.agent); await h.drive(b.agent);
  const name = h.businessNames[0];
  assert.equal((await h.call(a.agent, name)).isError, true);
  assert.equal(h.bodies.get(name), undefined);
  h.prepared.set(a.agent, [name]); h.controller.refresh();
  assert.equal((await h.call(a.agent, name)).isError, false);
  assert.equal(h.bodies.get(name), 1);
  assert.equal((await h.call(b.agent, name)).isError, true);
  const admitted = await a.agent.ctx.tools.resolve({ agent: a.agent, modelSelection: { provider: 'lifecycle-offline', model: 'fixture' }, signal: new AbortController().signal });
  h.denied.add(name); // Guard sees permission changes even before visibility refresh.
  assert.equal((await h.call(a.agent, name)).isError, true);
  h.controller.refresh();
  assert.equal(a.agent.ctx.tools.executable(name, a.agent, admitted), undefined);
  admitted.dispose(); assert.equal(h.bodies.get(name), 1);
  assert.equal((await h.call(a.agent, h.outsideNames[0])).isError, false);
});

contract('P1-03 local business shadow blocks inference and native body even if marked prepared', async (t) => {
  const h = await restrictedHarness(t); const { agent } = await h.create('shadow'); await h.drive(agent);
  const name = h.businessNames[0]; h.prepared.set(agent, [name]); h.controller.refresh();
  let shadowCalls = 0;
  const stop = agent.ctx.tools.register({ name, description: 'Synthetic forbidden shadow', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] }, execute: async () => { shadowCalls++; return {}; } });
  const before = h.requests.length; const input = h.input(); await h.drive(agent, input);
  assert.equal(h.requests.length, before);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [input.id]);
  assert.equal((await h.call(agent, name)).isError, true); assert.equal(shadowCalls, 0);
  stop(); h.controller.assertReady(agent);
});

contract('P1-03 cache discovery and legacy manual entry retain trusted Agent and confirmation rules', async (t) => {
  const h = await restrictedHarness(t, { legacy: true }); const name = h.businessNames[0];
  h.records[0].injectionMode = 'session';
  const { agent } = await h.create('manual'); await h.drive(agent);
  const discovery = h.ctx.tools.get('mcp_connector_discover', agent);
  const result = await discovery.execute({ action: 'search', query: 'fixture' }, { agent });
  assert.ok(result.detail.items.some((row) => row.publicName === name && row.manual));
  const nativeSearch = await h.call(agent, 'mcp_connector_discover', { action: 'search', query: 'fixture' });
  assert.equal(nativeSearch.isError, false);
  assert.match(JSON.stringify(nativeSearch), new RegExp(name));
  const session = h.ctx.tools.get('mcp_connector_session_tools', agent);
  const preview = await session.execute({ action: 'preview-activate', connectionKey: h.records[0].key, publicNames: [name] }, { agent });
  const args = { action: 'activate', connectionKey: h.records[0].key, publicNames: [name], expectedRevision: preview.detail.baseRevision };
  assert.equal((await session.execute({ ...args, confirmed: false }, { agent })).ok, false);
  assert.equal((await session.execute({ ...args, confirmed: true }, { agent })).ok, true);
  assert.equal(h.ctx.tools.get(name, agent), undefined, 'legacy activation does not open the separate prepared layer');
  h.prepared.set(agent, [name]); h.controller.refresh();
  assert.equal((await h.call(agent, name)).isError, false);
});

for (const delivery of ['native', 'microtask', 'immediate']) {
  contract(`P1-03 ${delivery} tools/change converges and rolls back only owned resources`, async (t) => {
    const h = await restrictedHarness(t, { delivery }); const handle = await h.create('events'); await h.drive(handle.agent);
    const name = 'mcp__qcc-company__new_fixture';
    const stop = h.ctx.tools.register({ name, description: 'Synthetic new registration', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] }, execute: async () => assert.fail('unprepared call') });
    await tick(); await tick();
    assert.equal(h.ctx.tools.get(name, handle.agent), undefined);
    const otherDeny = handle.agent.ctx.tools.restrict({ deny: [h.outsideNames[0]] });
    h.controller.dispose();
    assert.ok(h.ctx.tools.get(name, handle.agent));
    assert.equal(h.ctx.tools.get(h.outsideNames[0], handle.agent), undefined);
    assert.equal(h.ctx.tools.get('mcp_connector_discover', handle.agent), undefined);
    assert.equal(h.ctx.tools.schemas(handle.agent).filter((def) => def.name.startsWith('mcp_connector_')).length, 25);
    await h.drive(handle.agent);
    assert.ok(h.businessNames.every((entry) => h.requests.at(-1).tools.includes(entry)), 'rollback admits legacy inference again');
    otherDeny(); stop();
  });
}

contract('P1-03 failed name view blocks requests with recoverable input and keeps the old mask', async (t) => {
  const h = await restrictedHarness(t); const { agent } = await h.create('failed-view'); await h.drive(agent);
  const before = h.requests.length; h.breakRead(true);
  const input = h.input(); await h.drive(agent, input);
  assert.equal(h.requests.length, before);
  assert.equal(h.ctx.tools.get(h.businessNames[0], agent), undefined);
  assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), [input.id]);
  h.breakRead(false); h.controller.assertReady(agent);
});

contract('P1-03 subagent and same-SessionId resume explicitly reinstall masks without parent preparation', async (t) => {
  const h = await restrictedHarness(t); const parent = await h.create('restricted-parent'); await h.drive(parent.agent);
  const name = h.businessNames[0]; h.prepared.set(parent.agent, [name]); h.controller.refresh();
  const child = await h.create('restricted-child', { parentAgent: parent.agent,
    meta: { origin: 'subagent', parentSession: parent.agent.id, delegationDepth: 1 } });
  await h.drive(child.agent);
  assert.equal(h.requests.at(-1).tools.includes(name), false);
  assert.deepEqual(h.requests.at(-1).tools.filter((n) => n.startsWith('mcp_connector_')).sort(), ['mcp_connector_discover', 'mcp_connector_session_tools']);
  await child.dispose(); await parent.dispose();
  assert.equal(h.controller.status(parent.agent).mode, 'unattached');
  const resumed = await h.resume('restricted-parent');
  assert.notEqual(resumed.agent, parent.agent);
  assert.equal(h.ctx.tools.get(name, resumed.agent), undefined);
  await h.drive(resumed.agent);
  assert.equal(h.requests.at(-1).tools.includes(name), false);
});
