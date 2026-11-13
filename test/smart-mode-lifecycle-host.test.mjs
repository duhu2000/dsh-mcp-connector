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
import { createSourceSelector } from '../lib/source-selection.js';
import { indexRawToolSources, RAW_TOOL_ORIGIN } from '../lib/source-relations.js';
import { rawDefinition, relationFor } from '../scripts/fixtures/source-selection.mjs';
import { createSmartModePrepareController } from '../lib/smart-mode-prepare.js';
import { readOnlyReviewFor } from '../scripts/fixtures/read-only-review.mjs';
import { SMART_RESOURCE_HOST_CONTRACT, estimateSmartToolTokens } from '../lib/smart-mode-resources.js';

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
  const { setup, reply, ...lifecycleOptions } = options;
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
      const blocks = reply?.(input) ?? [{ type: 'text', text: 'offline' }];
      for (const [index, block] of blocks.entries()) {
        yield { type: 'block-start', index, blockType: block.type };
        if (block.type === 'tool-call') yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
        else yield { type: 'text-delta', index, text: block.text };
        yield { type: 'block-end', index, block };
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: 'finish', reason: { kind: blocks.some((block) => block.type === 'tool-call') ? 'tool-calls' : 'stop' } };
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

async function restrictedHarness(t, { full = false, delivery = 'native', legacy = false, withResources = false,
  resourcePolicy = {}, businessBody, parallelBusiness = false, withPrepare = withResources, withSources = withPrepare } = {}) {
  const data = enterpriseFixture({ full });
  const prepared = new Map(), denied = new Set(), hidden = new Set(), bodies = new Map();
  let controller, sourceSelector, prepareController, brokenRead = false, at = 1000;
  const sourceRows = [], sourceRelations = [], sourceIntents = new Map(), readOnlyReviews = [];
  const scripts = [];
  const h = await harness(t, { reply: () => scripts.shift(), async setup(ctx) {
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
      ...(parallelBusiness ? { isConcurrencySafe: typeof parallelBusiness === 'function' ? parallelBusiness : () => true } : {}),
      async execute(args, exec) { bodies.set(name, (bodies.get(name) ?? 0) + 1); return businessBody ? businessBody(name, args, exec) : { ok: true }; },
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
      getPreparedNames: (agent) => withPrepare ? prepareController?.getPreparedNames(agent) ?? [] : prepared.get(agent) ?? [],
      isRecordUsable: () => true, isRecordVisible: (record) => !hidden.has(record.key),
      isToolAllowed: (name) => !denied.has(name),
      isManuallyActive: (name, record, agent) => manualController?.inspect(name, agent)?.active === true,
      sourceSearch: withSources ? (agent, args) => sourceSelector.search(agent, args) : undefined,
      prepareTools: withPrepare ? (agent, args, exec) => prepareController.prepare(agent, args, exec) : undefined,
      releaseTools: withResources ? (agent, args, exec) => prepareController.release(agent, args, exec) : undefined,
      assertPreparedReady: withResources ? (agent) => prepareController?.assertResourceReady(agent) : undefined,
      getResourceStatus: withResources ? (agent) => prepareController.resourceStatus(agent) : undefined,
    });
    controller.mount(events);
    if (withSources) {
      for (const [i, name] of [[0, 'fixture_read_0'], [1, 'read/long fixture name '.repeat(4)]]) {
        sourceRows.push({ origin: RAW_TOOL_ORIGIN, accountRef: data.scope.accountRef, groupId: data.scope.groupId,
          connectionKey: data.scope.connections[i].connectionKey, serverName: data.scope.connections[i].serverName, definition: rawDefinition(name) });
      }
      const sources = [...indexRawToolSources(data.scope, sourceRows).values()];
      sourceRelations.push(relationFor(data.scope, 'synthetic-native-equivalence', sources));
      if (withResources) sourceRows.push({ origin: RAW_TOOL_ORIGIN, accountRef: data.scope.accountRef, groupId: data.scope.groupId,
        connectionKey: data.scope.connections[2].connectionKey, serverName: data.scope.connections[2].serverName,
        definition: rawDefinition('read/long fixture name '.repeat(4)) });
      sourceSelector = createSourceSelector({ enabled: true, scope: data.scope,
        getSessionSnapshot: controller.sessionSnapshot, getRawSources: () => sourceRows,
        getRelations: () => sourceRelations, inspectSource: controller.inspectSource,
        getUserSourceIntent: (agent) => sourceIntents.get(agent), now: () => at,
      });
      sourceSelector.mount(events);
      if (withPrepare) {
        readOnlyReviews.push(...[...indexRawToolSources(data.scope, sourceRows).values()].map((source) => readOnlyReviewFor(data.scope, source)));
        const nativeExecutor = ctx.tools.selectExecutor();
        prepareController = createSmartModePrepareController({ enabled: true, scope: data.scope,
          restrictions: controller, selector: sourceSelector, getReadOnlyReviews: () => readOnlyReviews, now: () => at,
          resources: withResources ? { enabled: true, hostContract: SMART_RESOURCE_HOST_CONTRACT, ttlMs: 100, ...resourcePolicy } : undefined,
          isNativeExecutor: (agent) => ctx.tools.selectExecutor(agent) === nativeExecutor,
          getBudgetSchemas: (agent, names) => names.map((name) => JSON.parse(JSON.stringify(host.projectToolSchema(agent.ctx.tools.get(name, agent) ?? ctx.tools.get(name), true)))),
        });
        prepareController.mount(events);
      }
    }
    return {
      lifecycle: { ...controller.lifecycleBindings(), selectDefault: () => ({
        mode: 'smart', policyVersion: 'fixture-v1', accountRef: data.scope.accountRef, groupId: data.scope.groupId,
      }) },
      close() { prepareController?.dispose(); sourceSelector?.dispose(); controller.dispose(); manualController?.dispose(); stopManagement(); },
    };
  } });
  return { ...data, ...h, prepared, denied, hidden, bodies, controller, sourceSelector, sourceRows, sourceRelations, sourceIntents,
    prepareController, readOnlyReviews,
    get at() { return at; }, set at(value) { at = value; },
    queueCalls(calls) { scripts.push(calls.map((call, i) => ({ type: 'tool-call', id: call.id ?? `model-${Math.random()}-${i}`, name: call.name, arguments: JSON.stringify(call.args ?? {}) }))); },
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

contract('P1-04 native discovery returns canonical plus aliases without loading or executing a business tool', async (t) => {
  const h = await restrictedHarness(t, { withSources: true }); const { agent } = await h.create('source-discovery'); await h.drive(agent);
  const sources = [...indexRawToolSources(h.scope, h.sourceRows).values()];
  const result = await h.call(agent, 'mcp_connector_discover', { action: 'search', query: sources[1].publicName });
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result), new RegExp(sources[0].publicName));
  assert.match(JSON.stringify(result), new RegExp(sources[1].publicName));
  assert.equal(h.ctx.tools.get(sources[0].publicName, agent), undefined);
  assert.equal(h.bodies.size, 0); assert.equal(h.prepared.size, 0);
  assert.equal(h.controller.inspectSource(agent, sources[0]).available, true, 'own mask does not hide discovery eligibility');
});

contract('P1-04 current Host permissions filter sources and explicit denial never changes to a peer', async (t) => {
  const h = await restrictedHarness(t, { withSources: true }); const { agent } = await h.create('source-permissions'); await h.drive(agent);
  const sources = [...indexRawToolSources(h.scope, h.sourceRows).values()];
  const capabilityId = `relation:${h.sourceRelations[0].id}`;
  h.denied.add(sources[0].publicName);
  assert.equal((await h.sourceSelector.select(agent, { capabilityId })).selected[0].sourceId, sources[1].sourceId);
  h.sourceIntents.set(agent, { sessionId: agent.id, accountRef: h.scope.accountRef, groupId: h.scope.groupId,
    capabilityId, kind: 'source', sources: [sources[0]], evidenceHash: 'a'.repeat(64), expiresAt: 9000 });
  // Receipt contains only the exact fingerprint binding, never model claims.
  h.sourceIntents.get(agent).sources = [{ sourceId: sources[0].sourceId, definitionFingerprint: sources[0].definitionFingerprint }];
  const blocked = await h.sourceSelector.select(agent, { capabilityId });
  assert.equal(blocked.reason, 'EXPLICIT_SOURCE_DENIED'); assert.deepEqual(blocked.selected, []);
  h.denied.clear(); const intent = h.sourceIntents.get(agent); intent.kind = 'compare';
  intent.sources = sources.map(({ sourceId, definitionFingerprint }) => ({ sourceId, definitionFingerprint }));
  assert.equal((await h.sourceSelector.select(agent, { capabilityId })).budgetException, true);
  assert.equal(h.bodies.size, 0);
});

contract('P1-04 raw definition changes invalidate old selections without altering native registrations', async (t) => {
  const h = await restrictedHarness(t, { withSources: true }); const { agent } = await h.create('source-change'); await h.drive(agent);
  const capabilityId = `relation:${h.sourceRelations[0].id}`;
  const plan = await h.sourceSelector.select(agent, { capabilityId });
  const before = h.ctx.tools.schemas(agent);
  h.sourceRows[0].definition.outputSchema = { type: 'array', items: { type: 'string' } };
  assert.equal((await h.sourceSelector.select(agent, { capabilityId })).reason, 'SOURCE_DEFINITION_CHANGED');
  assert.equal(await h.sourceSelector.validateSelection(agent, plan), false);
  assert.deepEqual(h.ctx.tools.schemas(agent), before);
  assert.equal(h.bodies.size, 0);
});

contract('P1-05 native prepare exposes only the next resolve, preserves compat and performs no business call', async (t) => {
  const h = await restrictedHarness(t, { withPrepare: true });
  h.snapshots.set('p105-compat', h.snapshot('p105-compat', 'compat'));
  const compat = await h.create('p105-compat'), smart = await h.create('p105-smart');
  await h.drive(smart.agent);
  const sources = [...indexRawToolSources(h.scope, h.sourceRows).values()], name = sources[0].publicName;
  const baseline = h.ctx.tools.schemas(compat.agent);
  const resolve = () => smart.agent.ctx.tools.resolve({ agent: smart.agent,
    modelSelection: { provider: 'lifecycle-offline', model: 'fixture' }, signal: new AbortController().signal });
  const old = await resolve();
  try {
    assert.equal(h.ctx.tools.get(name, smart.agent, old), undefined);
    const result = await h.call(smart.agent, 'mcp_connector_discover', {
      action: 'prepare', capabilityIds: [`relation:${h.sourceRelations[0].id}`],
    });
    assert.equal(result.isError, false); assert.match(JSON.stringify(result), new RegExp(name));
    assert.ok(h.ctx.tools.get(name, smart.agent));
    assert.equal(h.ctx.tools.get(name, smart.agent, old), undefined, 'already admitted tool set is never widened');
    const next = await resolve();
    try { assert.ok(h.ctx.tools.executable(name, smart.agent, next)); } finally { next.dispose(); }
    await h.drive(smart.agent);
    assert.ok(h.requests.at(-1).tools.includes(name));
    assert.ok(!h.requests.at(-1).tools.includes(sources[1].publicName));
    assert.deepEqual(h.ctx.tools.schemas(compat.agent), baseline);
    assert.equal(h.bodies.size, 0);
  } finally { old.dispose(); }
});

contract('P1-05 read-only revocation denies stale admitted dispatch and requires new prepare after restoration', async (t) => {
  const h = await restrictedHarness(t, { withPrepare: true }); const { agent } = await h.create('p105-revoked'); await h.drive(agent);
  const capabilityIds = [`relation:${h.sourceRelations[0].id}`], name = h.sourceRows[0].definition.name;
  assert.equal((await h.prepareController.prepare(agent, { capabilityIds })).ok, true);
  const exact = [...indexRawToolSources(h.scope, h.sourceRows).values()][0].publicName;
  assert.ok(exact.includes(name));
  const admitted = await agent.ctx.tools.resolve({ agent,
    modelSelection: { provider: 'lifecycle-offline', model: 'fixture' }, signal: new AbortController().signal });
  try {
    h.readOnlyReviews[0].enabled = false;
    assert.equal((await h.call(agent, exact)).isError, true);
    h.controller.refresh(); assert.equal(h.ctx.tools.executable(exact, agent, admitted), undefined);
    h.readOnlyReviews[0].enabled = true; h.controller.refresh();
    assert.equal(h.ctx.tools.get(exact, agent), undefined);
    assert.equal((await h.prepareController.prepare(agent, { capabilityIds })).ok, true);
    assert.ok(h.ctx.tools.get(exact, agent)); assert.equal(h.bodies.size, 0);
  } finally { admitted.dispose(); }
});

contract('P1-05 failed comparison audit retains only the original canonical source', async (t) => {
  const h = await restrictedHarness(t, { withPrepare: true }); const { agent } = await h.create('p105-batch-rollback'); await h.drive(agent);
  const capabilityId = `relation:${h.sourceRelations[0].id}`, sources = [...indexRawToolSources(h.scope, h.sourceRows).values()];
  assert.equal((await h.prepareController.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
  h.sourceIntents.set(agent, { sessionId: agent.id, accountRef: h.scope.accountRef, groupId: h.scope.groupId,
    capabilityId, kind: 'compare', sources: sources.map(({ sourceId, definitionFingerprint }) => ({ sourceId, definitionFingerprint })),
    evidenceHash: 'd'.repeat(64), expiresAt: 9000 });
  h.readOnlyReviews[1].enabled = false;
  assert.equal((await h.prepareController.prepare(agent, { capabilityIds: [capabilityId] })).ok, false);
  assert.ok(h.ctx.tools.get(sources[0].publicName, agent)); assert.equal(h.ctx.tools.get(sources[1].publicName, agent), undefined);
  assert.equal(h.bodies.size, 0);
});

contract('P1-05 pending preparation rejects relationship changes before a native loading commit', async (t) => {
  const h = await restrictedHarness(t, { withPrepare: true }); const { agent } = await h.create('p105-stale'); await h.drive(agent);
  const select = h.sourceSelector.select;
  h.sourceSelector.select = async (...input) => { const plan = await select(...input);
    h.sourceRelations[0] = { ...h.sourceRelations[0], revision: 2 }; return plan; };
  const result = await h.prepareController.prepare(agent, { capabilityIds: [`relation:${h.sourceRelations[0].id}`] });
  assert.equal(result.message, 'PREPARE_SELECTION_CHANGED');
  assert.deepEqual(h.prepareController.getPreparedNames(agent), []); assert.equal(h.bodies.size, 0);
});

contract('P1-05 resume and subagent start with no inherited preparation', async (t) => {
  const h = await restrictedHarness(t, { withPrepare: true }); const parent = await h.create('p105-parent'); await h.drive(parent.agent);
  const capabilityIds = [`relation:${h.sourceRelations[0].id}`], name = [...indexRawToolSources(h.scope, h.sourceRows).values()][0].publicName;
  assert.equal((await h.prepareController.prepare(parent.agent, { capabilityIds })).ok, true);
  const child = await h.create('p105-child', { parentAgent: parent.agent,
    meta: { origin: 'subagent', parentSession: parent.agent.id, delegationDepth: 1 } });
  await h.drive(child.agent); assert.ok(!h.requests.at(-1).tools.includes(name));
  await child.dispose(); await parent.dispose();
  const restored = await h.resume('p105-parent'); await h.drive(restored.agent);
  assert.ok(!h.requests.at(-1).tools.includes(name)); assert.deepEqual(h.prepareController.getPreparedNames(restored.agent), []);
  assert.equal(h.bodies.size, 0);
});

contract('P1-06 model-driven first prepare bootstraps mid-step and canonical request budget includes exactly two management entries', async (t) => {
  const h = await restrictedHarness(t, { withResources: true });
  h.snapshots.set('p106-compat', h.snapshot('p106-compat', 'compat'));
  const compat = await h.create('p106-compat'), { agent } = await h.create('p106-first');
  const before = h.ctx.tools.schemas(compat.agent);
  h.queueCalls([{ name: 'mcp_connector_discover', args: { action: 'prepare', capabilityIds: [`relation:${h.sourceRelations[0].id}`] } }]);
  await h.drive(agent); await tick();
  const names = new Set([...h.businessNames, 'mcp_connector_discover', 'mcp_connector_session_tools']);
  const projected = h.requests.at(-1).input.tools.filter((tool) => names.has(tool.name));
  const resources = h.prepareController.resourceStatus(agent);
  assert.equal(projected.length, 3); assert.equal(resources.errorCode, null);
  assert.equal(resources.estimatedTokens, estimateSmartToolTokens(projected));
  assert.ok(resources.estimatedTokens <= 5000); assert.deepEqual(h.ctx.tools.schemas(compat.agent), before);
  assert.equal(h.bodies.size, 0); assert.deepEqual(h.errors, []);
});

contract('P1-06 real parallel bodies, ordered results and a queued exclusive sibling stay pinned until the Host step drains', async (t) => {
  const slow = deferred(), entered = deferred(), fast = deferred(); let first = true;
  const h = await restrictedHarness(t, { withResources: true, resourcePolicy: { ttlMode: 'fixed' },
    parallelBusiness: (args) => args.serial !== true,
    async businessBody(name, args) {
      if (args.slow && first) { first = false; entered.resolve(); await slow.promise; }
      if (args.fast) fast.resolve();
      return { ok: true };
    },
  }); const { agent } = await h.create('p106-parallel'); await h.drive(agent);
  const sources = [...indexRawToolSources(h.scope, h.sourceRows).values()];
  const capabilityIds = [`relation:${h.sourceRelations[0].id}`, `source:${sources[2].sourceId}`];
  assert.equal((await h.prepareController.prepare(agent, { capabilityIds })).ok, true);
  h.queueCalls([{ id: 'slow', name: sources[0].publicName, args: { slow: true } },
    { id: 'fast', name: sources[2].publicName, args: { fast: true } },
    { id: 'queued', name: sources[0].publicName, args: { serial: true } }]);
  const driving = h.drive(agent); await bounded(entered.promise); await bounded(fast.promise); await tick();
  assert.equal(h.prepareController.resourceStatus(agent).inFlight, 2, 'fast body result still awaits model-order commit');
  h.at = 1200;
  const release = await h.prepareController.release(agent, { publicNames: [sources[0].publicName, sources[2].publicName] });
  assert.equal(release.detail.pending.length, 2);
  assert.equal((await h.prepareController.collect(agent)).ok, true);
  assert.equal(h.prepareController.getPreparedNames(agent).length, 2);
  slow.resolve(); await bounded(driving); await h.prepareController.collect(agent);
  assert.equal(h.bodies.get(sources[0].publicName), 2, JSON.stringify({ status: h.prepareController.resourceStatus(agent),
    events: h.events.filter((item) => item.id === agent.id).map((item) => ({ type: item.event.type, data: item.event.type === 'tool/result' ? item.event.data : undefined })) }));
  assert.equal(h.bodies.get(sources[2].publicName), 1);
  assert.deepEqual(h.prepareController.getPreparedNames(agent), []);
  assert.equal(h.prepareController.resourceStatus(agent).activeSteps, 0);
  const events = h.events.filter((item) => item.id === agent.id).map((item) => item.event);
  const results = events.filter((event) => event.type === 'tool/result').map((event) => event.data.message.toolCallId);
  assert.deepEqual(results, ['slow', 'fast', 'queued']);
  const stepEnd = events.findLastIndex((event) => event.type === 'step/end');
  assert.ok(events.findIndex((event) => event.type === 'tool/result' && event.data.message.toolCallId === 'queued') < stepEnd);
  assert.deepEqual(h.errors, []);
});

contract('P1-06 cancellation drains a started body, emits recovery results for queued calls and does not renew TTL', async (t) => {
  const gate = deferred(), entered = deferred();
  const h = await restrictedHarness(t, { withResources: true,
    async businessBody() { entered.resolve(); await gate.promise; return { ok: true }; },
  }); const { agent } = await h.create('p106-cancel'); await h.drive(agent);
  const source = [...indexRawToolSources(h.scope, h.sourceRows).values()][0];
  await h.prepareController.prepare(agent, { capabilityIds: [`relation:${h.sourceRelations[0].id}`] });
  h.queueCalls([{ id: 'started', name: source.publicName }, { id: 'skipped', name: source.publicName }]);
  const driving = h.drive(agent); await bounded(entered.promise);
  const releasing = await h.prepareController.release(agent, { publicNames: [source.publicName] });
  assert.deepEqual(releasing.detail.pending, [source.publicName]);
  h.at = 1200; agent.cancel({ kind: 'user' }); await tick();
  assert.equal(h.prepareController.resourceStatus(agent).inFlight, 1);
  gate.resolve(); await bounded(driving); await h.prepareController.collect(agent);
  assert.equal(h.bodies.get(source.publicName), 1);
  assert.deepEqual(h.prepareController.getPreparedNames(agent), [], JSON.stringify(h.prepareController.resourceStatus(agent)));
  const events = h.events.filter((item) => item.id === agent.id).map((item) => item.event);
  assert.deepEqual(events.filter((event) => event.type === 'tool/result').map((event) => event.data.message.toolCallId), ['started', 'skipped']);
  assert.equal(h.prepareController.resourceStatus(agent).errorCode, null); assert.deepEqual(h.errors, []);
});

contract('P1-06 final Host success renews sliding TTL; failures leave its last successful expiry unchanged', async (t) => {
  const h = await restrictedHarness(t, { withResources: true, businessBody(name, args) {
    if (args.fail) throw new Error('Synthetic business failure, no MCP'); return { ok: true };
  } }); const { agent } = await h.create('p106-sliding'); await h.drive(agent);
  const source = [...indexRawToolSources(h.scope, h.sourceRows).values()][0];
  await h.prepareController.prepare(agent, { capabilityIds: [`relation:${h.sourceRelations[0].id}`] });
  h.at = 1050; assert.equal((await h.call(agent, source.publicName)).isError, false);
  assert.equal(h.prepareController.resourceStatus(agent).entries[0].expiresAt, 1150);
  h.at = 1060; assert.equal((await h.call(agent, source.publicName, { fail: true })).isError, true);
  assert.equal(h.prepareController.resourceStatus(agent).entries[0].expiresAt, 1150);
  h.at = 1150; await h.prepareController.collect(agent);
  assert.equal(h.ctx.tools.get(source.publicName, agent), undefined);
});

contract('P1-06 LRU pressure cannot evict a live direct Host invocation and later reclaim succeeds', async (t) => {
  const gate = deferred(), entered = deferred();
  const h = await restrictedHarness(t, { withResources: true, resourcePolicy: { maxPrepared: 1 },
    async businessBody() { entered.resolve(); await gate.promise; return { ok: true }; },
  }); const { agent } = await h.create('p106-lru'); await h.drive(agent);
  const sources = [...indexRawToolSources(h.scope, h.sourceRows).values()];
  await h.prepareController.prepare(agent, { capabilityIds: [`relation:${h.sourceRelations[0].id}`] });
  const calling = h.call(agent, sources[0].publicName); await bounded(entered.promise);
  assert.equal((await h.prepareController.prepare(agent, { capabilityIds: [`source:${sources[2].sourceId}`] })).message, 'SMART_RESOURCE_CAPACITY');
  assert.ok(h.ctx.tools.get(sources[0].publicName, agent));
  gate.resolve(); await bounded(calling); await tick();
  const result = await h.prepareController.prepare(agent, { capabilityIds: [`source:${sources[2].sourceId}`] });
  assert.equal(result.ok, true); assert.deepEqual(result.detail.evicted, [sources[0].publicName]);
  assert.equal(h.ctx.tools.get(sources[0].publicName, agent), undefined); assert.ok(h.ctx.tools.get(sources[2].publicName, agent));
});

contract('P1-06 model prepare can evict an unreferenced LRU definition within the active step', async (t) => {
  const h = await restrictedHarness(t, { withResources: true, resourcePolicy: { maxPrepared: 1, ttlMs: 1000 } });
  const { agent } = await h.create('p106-model-lru'); await h.drive(agent);
  const sources = [...indexRawToolSources(h.scope, h.sourceRows).values()];
  await h.prepareController.prepare(agent, { capabilityIds: [`relation:${h.sourceRelations[0].id}`] });
  h.queueCalls([{ id: 'model-prepare', name: 'mcp_connector_discover', args: { action: 'prepare', capabilityIds: [`source:${sources[2].sourceId}`] } }]);
  await h.drive(agent); await tick();
  assert.deepEqual(h.prepareController.getPreparedNames(agent), [sources[2].publicName]);
  assert.ok(h.requests.at(-1).tools.includes(sources[2].publicName));
  assert.ok(!h.requests.at(-1).tools.includes(sources[0].publicName));
  assert.equal(h.prepareController.resourceStatus(agent).errorCode, null); assert.deepEqual(h.errors, []);
});

contract('P1-06 revoked read-only evidence still blocks subsequent dispatch while an earlier body is pinned', async (t) => {
  const gate = deferred(), entered = deferred();
  const h = await restrictedHarness(t, { withResources: true,
    async businessBody() { entered.resolve(); await gate.promise; return { ok: true }; },
  }); const { agent } = await h.create('p106-revoke'); await h.drive(agent);
  const source = [...indexRawToolSources(h.scope, h.sourceRows).values()][0];
  await h.prepareController.prepare(agent, { capabilityIds: [`relation:${h.sourceRelations[0].id}`] });
  const calling = h.call(agent, source.publicName); await bounded(entered.promise);
  h.readOnlyReviews[0].enabled = false;
  assert.equal((await h.call(agent, source.publicName)).isError, true); assert.equal(h.bodies.get(source.publicName), 1);
  h.controller.refresh(); assert.equal(h.ctx.tools.get(source.publicName, agent), undefined);
  gate.resolve(); await bounded(calling); await h.prepareController.collect(agent);
  assert.deepEqual(h.prepareController.getPreparedNames(agent), []); assert.equal(h.prepareController.resourceStatus(agent).retainedCount, 0);
});

contract('P1-06 release remains Agent-local and recovery or subagent never inherits tokens, timers or loaded definitions', async (t) => {
  const h = await restrictedHarness(t, { withResources: true }); const a = await h.create('p106-a'), b = await h.create('p106-b');
  await h.drive(a.agent); await h.drive(b.agent);
  const capabilityIds = [`relation:${h.sourceRelations[0].id}`], source = [...indexRawToolSources(h.scope, h.sourceRows).values()][0];
  await h.prepareController.prepare(a.agent, { capabilityIds }); await h.prepareController.prepare(b.agent, { capabilityIds });
  const release = await h.call(a.agent, 'mcp_connector_discover', { action: 'release', publicNames: [source.publicName] });
  assert.equal(release.isError, false); assert.ok(h.ctx.tools.get(source.publicName, b.agent));
  const child = await h.create('p106-child', { parentAgent: b.agent,
    meta: { origin: 'subagent', parentSession: b.agent.id, delegationDepth: 1 } });
  await h.drive(child.agent); assert.deepEqual(h.prepareController.getPreparedNames(child.agent), []);
  await child.dispose(); await b.dispose(); const resumed = await h.resume('p106-b'); await h.drive(resumed.agent);
  const current = h.prepareController.resourceStatus(resumed.agent);
  assert.equal(current.retainedCount, 0); assert.equal(current.inFlight, 0); assert.equal(current.activeSteps, 0);
  assert.ok(!h.requests.at(-1).tools.includes(source.publicName));
});
