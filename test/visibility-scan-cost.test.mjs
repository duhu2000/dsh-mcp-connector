import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostGovernanceController } from '../lib/governance.js';
import { createHostScopeController } from '../lib/connection-scopes.js';
import { createSessionToolInjectionController } from '../lib/session-injection.js';

// Restrictions notify asynchronously, as opposed to the synchronous-only
// fixtures that previously covered reentrancy. Never start a real DSH profile.
function fixture(count = 1) {
  let names = ['mcp__acme__read'];
  let reads = 0;
  let pending = 0;
  const listeners = new Map();
  const guards = new Set();
  const emit = (event) => {
    for (const listener of listeners.get(event) ?? []) listener({});
  };
  const changed = () => {
    pending += 1;
    queueMicrotask(() => { pending -= 1; emit('tools/change'); });
  };
  const agents = Array.from({ length: count }, (_, id) => {
    const masks = new Set();
    return { id, workspaceId: 'outside', masks, ctx: { tools: {
      restrict({ deny }) {
        const mask = new Set(deny);
        masks.add(mask);
        changed();
        return () => { masks.delete(mask); changed(); };
      },
    } } };
  });
  const ctx = { tools: {
    definitions() { reads += 1; return names.map((name) => ({ name })); },
    schemas() { throw new Error('visibility must never read schemas'); },
    restrict() {},
    guard(fn) { guards.add(fn); return () => guards.delete(fn); },
  } };
  const agentCtx = {
    agents: { list: () => agents },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
  };
  return {
    ctx, agentCtx, agents, guards, emit,
    reads: () => reads,
    setNames(next) { names = next; emit('tools/change'); },
    async settle() {
      for (let i = 0; i < 30 && pending; i += 1) await Promise.resolve();
      assert.equal(pending, 0, 'restriction notifications must converge');
    },
  };
}

function controllers(host, state) {
  const common = {
    getRecords: () => state.records,
    workspaceIdForAgent: (agent) => agent.workspaceId,
  };
  return [
    createHostGovernanceController(host.ctx, { ...common, getRules: () => state.rules }),
    createHostScopeController(host.ctx, { ...common, getBindings: () => state.bindings }),
    createSessionToolInjectionController(host.ctx, common),
  ];
}

test('default visibility scans zero schemas across many agents and repeated change events', async () => {
  const host = fixture(40);
  const state = {
    records: [{ key: 'a', connectorId: 'acme', serverName: 'acme' }],
    rules: [], bindings: [],
  };
  const all = controllers(host, state);
  try {
    all.forEach((controller) => controller.mountAgents(host.agentCtx));
    for (let i = 0; i < 100; i += 1) host.emit('tools/change');
    await host.settle();
    assert.equal(host.reads(), 0);
    assert.equal(host.guards.size, 3, 'execution guards must not be removed');
  } finally { all.forEach((controller) => controller.dispose()); }
});

test('project visibility enumerates once per refresh, not once per agent', async () => {
  const host = fixture(40);
  const controller = createHostScopeController(host.ctx, {
    getRecords: () => [{ key: 'a', serverName: 'acme' }],
    getBindings: () => [{ connectionKey: 'a', global: false, projects: ['inside'] }],
    workspaceIdForAgent: (agent) => agent.workspaceId,
  });
  try {
    controller.mountAgents(host.agentCtx);
    assert.equal(host.reads(), 1);
    await host.settle();
    const before = host.reads();
    host.emit('tools/change');
    assert.equal(host.reads() - before, 1);
    for (const agent of host.agents) {
      assert.equal(agent.masks.size, 1);
      assert.ok([...agent.masks][0].has('mcp__acme__read'));
    }
  } finally { controller.dispose(); }
});

test('delayed restrictions converge; new tools stay denied and removing policies releases masks', async () => {
  const host = fixture(2);
  const state = {
    records: [{ key: 'a', connectorId: 'acme', serverName: 'acme', injectionMode: 'session' }],
    rules: [{ scope: 'connection', connectorId: 'acme', effect: 'deny' }],
    bindings: [{ connectionKey: 'a', global: false, projects: ['inside'] }],
  };
  const all = controllers(host, state);
  try {
    all.forEach((controller) => controller.mountAgents(host.agentCtx));
    await host.settle();
    host.setNames(['mcp__acme__read', 'mcp__acme__write']);
    await host.settle();
    for (const agent of host.agents) {
      assert.equal(agent.masks.size, 3);
      for (const mask of agent.masks) assert.ok(mask.has('mcp__acme__write'));
      for (const guard of host.guards) {
        assert.equal(typeof guard({ name: 'mcp__acme__write', agent }), 'string');
      }
    }
    state.rules = [];
    state.bindings = [];
    state.records[0].injectionMode = 'always';
    const before = host.reads();
    all.forEach((controller) => controller.refresh());
    await host.settle();
    assert.equal(host.reads(), before, 'lifting restrictions needs no schema enumeration');
    for (const agent of host.agents) assert.equal(agent.masks.size, 0);
  } finally { all.forEach((controller) => controller.dispose()); }
});

test('disabled lifecycle still denies without explicit governance rules', async () => {
  const host = fixture();
  const controller = createHostGovernanceController(host.ctx, {
    getRecords: () => [{ key: 'a', connectorId: 'acme', serverName: 'acme', enabled: false }],
    getRules: () => [],
  });
  try {
    controller.mountAgents(host.agentCtx);
    await host.settle();
    assert.ok(host.reads() > 0);
    assert.ok([...host.agents[0].masks][0].has('mcp__acme__read'));
  } finally { controller.dispose(); }
});

for (const api of ['definitions', 'legacy-view']) {
  test(`schema-read microtask feedback is severed via ${api}; real changes are still enforced`, async () => {
    const host = fixture(3);
    let schemaCalls = 0;
    host.ctx.tools.schemas = () => {
      schemaCalls++;
      assert.ok(schemaCalls < 25, 'residual feedback loop must not reach the sentinel');
      queueMicrotask(() => host.emit('tools/change'));
      return [];
    };
    if (api === 'legacy-view') {
      const definitions = host.ctx.tools.definitions;
      host.ctx.tools.view = () => {
        const names = definitions().map((definition) => definition.name);
        return { visible: new Map(names.map((name) => [name, null])),
          knownNames: new Set(names), restrictableNames: new Set(names) };
      };
      delete host.ctx.tools.definitions;
    }
    const state = {
      records: [{ key: 'a', connectorId: 'acme', serverName: 'acme', injectionMode: 'session' }],
      rules: [{ scope: 'connection', connectorId: 'acme', effect: 'deny' }],
      bindings: [{ connectionKey: 'a', global: false, projects: ['inside'] }],
    };
    const all = controllers(host, state);
    try {
      all.forEach((controller) => controller.mountAgents(host.agentCtx));
      // One external caller reads a schema and thereby creates a notification.
      // The visibility listeners must not feed it back into another schema read.
      host.ctx.tools.schemas();
      await Promise.resolve();
      await host.settle();
      assert.equal(schemaCalls, 1);
      host.setNames(['mcp__acme__read', 'mcp__acme__new']);
      await host.settle();
      for (const agent of host.agents) {
        assert.equal(agent.masks.size, 3);
        for (const mask of agent.masks) assert.ok(mask.has('mcp__acme__new'));
      }
      // An incompatible Host must preserve the last restrictions, not clear
      // them as if the tool registry had become empty.
      host.ctx.tools.definitions = () => { throw new Error('incompatible Host'); };
      host.emit('tools/change');
      for (const agent of host.agents) {
        assert.equal(agent.masks.size, 3);
        for (const mask of agent.masks) assert.ok(mask.has('mcp__acme__new'));
      }
      assert.equal(schemaCalls, 1);
    } finally { all.forEach((controller) => controller.dispose()); }
  });
}
