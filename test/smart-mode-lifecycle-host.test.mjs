import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createSmartModeLifecycleAdapter, SMART_MODE_HOST_CONTRACT } from '../lib/smart-mode-lifecycle.js';

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
    ...options,
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
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.dispose();
    adapter.dispose();
    await root.fiber.dispose();
    assert.equal(bodyCalls, 0, 'no business or synthetic tool body was invoked');
  });
  return {
    ctx, create, resume, input, drive, requests, events, snapshots, errors, tables, installCalls,
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
