import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionToolInjectionController,
  normalizeInjectionMode,
} from '../lib/session-injection.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sessionHost(initialNames) {
  let names = [...initialNames];
  let definitionsCalls = 0;
  const guards = new Set();
  const listeners = new Map();
  const agents = [];
  const emit = (event, payload = {}) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const ctx = { tools: {
    definitions() { definitionsCalls += 1; return names.map((name) => ({ name })); },
    guard(fn) { guards.add(fn); return () => guards.delete(fn); },
    restrict() {},
  } };
  const agentCtx = {
    agents: { list: () => [...agents] },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
  };
  function makeAgent(id, workspaceId = 'workspace-a') {
    const restrictions = new Set();
    const agent = { id, workspaceId, restrictions, ctx: { tools: {
      restrict({ deny }) {
        const layer = new Set(deny);
        restrictions.add(layer);
        return () => restrictions.delete(layer);
      },
    } } };
    agents.push(agent);
    return agent;
  }
  return {
    ctx, agentCtx, agents, guards, emit, makeAgent,
    denied(agent) { return new Set([...agent.restrictions].flatMap((layer) => [...layer])); },
    setNames(next) { names = [...next]; emit('tools/change'); },
    get definitionsCalls() { return definitionsCalls; },
    resetDefinitionsCalls() { definitionsCalls = 0; },
  };
}

test('injectionMode 旧连接默认 always，未知值拒绝', () => {
  assert.equal(normalizeInjectionMode(), 'always');
  assert.equal(normalizeInjectionMode('session'), 'session');
  assert.throws(() => normalizeInjectionMode('keyword'), /不支持/);
});

test('按会话连接默认隐藏，精确激活仅影响当前 Agent', () => {
  const read = 'mcp__acme__read';
  const write = 'mcp__acme__write';
  const always = 'mcp__global__search';
  const host = sessionHost([read, write, always]);
  const first = host.makeAgent('first');
  const second = host.makeAgent('second');
  const records = [
    { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' },
    { key: 'global', name: 'Global', serverName: 'global', enabled: true, injectionMode: 'always' },
  ];
  let clock = 1_000;
  const controller = createSessionToolInjectionController(host.ctx, {
    getRecords: () => records,
    workspaceIdForAgent: (agent) => agent.workspaceId,
    now: () => clock,
  });
  controller.mountAgents(host.agentCtx);

  assert.deepEqual([...host.denied(first)].sort(), [read, write]);
  assert.deepEqual([...host.denied(second)].sort(), [read, write]);
  const preview = controller.previewActivation(first, {
    connectionKey: 'acme', publicNames: [read], ttlMinutes: 5,
  });
  assert.equal(preview.baseRevision, 0);
  assert.equal(preview.nextInferenceBoundary, true);
  assert.equal(controller.status(first).activeCount, 0, 'preview 不修改状态');

  const activated = controller.activate(first, {
    connectionKey: 'acme', publicNames: [read], ttlMinutes: 5,
    expectedRevision: preview.baseRevision, confirmed: true,
  });
  assert.equal(activated.revision, 1);
  assert.deepEqual([...host.denied(first)], [write]);
  assert.deepEqual([...host.denied(second)].sort(), [read, write]);

  const guard = [...host.guards][0];
  assert.equal(guard({ name: read, agent: first }), undefined);
  assert.match(guard({ name: write, agent: first }), /未在当前会话激活/);
  assert.match(guard({ name: read, agent: second }), /未在当前会话激活/);
  assert.match(guard({ name: read }), /需要当前会话/);
  assert.equal(guard({ name: always }), undefined);

  clock += 5 * 60_000 + 1;
  controller.refresh();
  assert.deepEqual([...host.denied(first)].sort(), [read, write]);
  assert.equal(controller.status(first).activeCount, 0);
  assert.equal(controller.status(first).revision, 2, '过期是一次显式状态变更');
  controller.dispose();
});

test('激活需要确认和最新 revision，且不能越过作用域或治理拒绝', () => {
  const allowed = 'mcp__acme__read';
  const governed = 'mcp__acme__delete';
  const host = sessionHost([allowed, governed]);
  const agent = host.makeAgent('agent', 'workspace-b');
  const record = { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' };
  let visible = false;
  const controller = createSessionToolInjectionController(host.ctx, {
    getRecords: () => [record],
    isRecordVisible: () => visible,
    isToolAllowed: (name) => name !== governed,
  });
  controller.mountAgents(host.agentCtx);

  assert.throws(() => controller.previewActivation(agent, {
    connectionKey: 'acme', publicNames: [allowed],
  }), /不属于当前工作区/);
  visible = true;
  assert.throws(() => controller.previewActivation(agent, {
    connectionKey: 'acme', publicNames: [governed],
  }), /治理策略拒绝/);
  assert.throws(() => controller.previewActivation(agent, {
    connectionKey: 'acme', publicNames: ['mcp__acme__unknown'],
  }), /尚未观察/);
  const preview = controller.previewActivation(agent, {
    connectionKey: 'acme', publicNames: [allowed],
  });
  assert.throws(() => controller.activate(agent, {
    connectionKey: 'acme', publicNames: [allowed], expectedRevision: 0,
  }), /明确确认/);
  assert.throws(() => controller.activate(agent, {
    connectionKey: 'acme', publicNames: [allowed], expectedRevision: 9, confirmed: true,
  }), /revision=0/);
  controller.activate(agent, {
    connectionKey: 'acme', publicNames: [allowed], expectedRevision: preview.baseRevision, confirmed: true,
  });
  assert.throws(() => controller.deactivate(agent, { expectedRevision: 0 }), /revision=1/);
  const cleared = controller.deactivate(agent, { expectedRevision: 1 });
  assert.equal(cleared.activeCount, 0);
  controller.dispose();
});

test('tools/change 新工具保持隐藏、消失工具清理激活，不同 restriction 始终取交集', async () => {
  const read = 'mcp__acme__read';
  const write = 'mcp__acme__write';
  const host = sessionHost([read]);
  const agent = host.makeAgent('agent');
  const upstreamDeny = agent.ctx.tools.restrict({ deny: [read] });
  const record = { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' };
  const controller = createSessionToolInjectionController(host.ctx, { getRecords: () => [record] });
  controller.mountAgents(host.agentCtx);
  controller.activate(agent, {
    connectionKey: 'acme', publicNames: [read], expectedRevision: 0, confirmed: true,
  });
  assert.deepEqual([...host.denied(agent)], [read], '释放会话层不能释放上游拒绝');

  host.setNames([read, write]);
  // tools/change 走 50ms 固定窗口合并：窗口到期前可见性保持旧状态。
  assert.deepEqual([...host.denied(agent)], [read], '合并窗口内不做同步刷新');
  await sleep(120);
  assert.deepEqual([...host.denied(agent)].sort(), [read, write], '新工具不继承旧激活');
  upstreamDeny();
  assert.deepEqual([...host.denied(agent)], [write]);

  host.setNames([write]);
  await sleep(120);
  const status = controller.status(agent);
  assert.equal(status.activeCount, 0);
  assert.equal(status.revision, 2, '已消失的精确工具激活被清理');
  controller.dispose();
});

test('Agent disposed 立即清理 restriction 与内存激活', () => {
  const read = 'mcp__acme__read';
  const host = sessionHost([read]);
  const agent = host.makeAgent('agent');
  const controller = createSessionToolInjectionController(host.ctx, {
    getRecords: () => [{ key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' }],
  });
  controller.mountAgents(host.agentCtx);
  controller.activate(agent, {
    connectionKey: 'acme', publicNames: [read], expectedRevision: 0, confirmed: true,
  });
  host.agents.splice(host.agents.indexOf(agent), 1);
  host.emit('agent/disposed', { agent });
  assert.equal(agent.restrictions.size, 0);
  assert.throws(() => controller.activate(agent, {
    connectionKey: 'acme', publicNames: [read], expectedRevision: 1, confirmed: true,
  }), /revision=0/, '销毁后不继承原会话 revision');
  controller.dispose();
});

test('tools/change 突发在 50ms 固定窗口内只刷新一次，窗口后重新武装', async () => {
  const read = 'mcp__acme__read';
  const host = sessionHost([read]);
  const agent = host.makeAgent('agent');
  const record = { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' };
  const controller = createSessionToolInjectionController(host.ctx, { getRecords: () => [record] });
  controller.mountAgents(host.agentCtx);
  host.resetDefinitionsCalls();

  // 模拟冷启动 syncTools() 逐个注册：20 个事件同步到达。
  for (let i = 0; i < 20; i += 1) host.setNames([read, `mcp__acme__tool${i}`]);
  assert.equal(host.definitionsCalls, 0, '突发期间不做同步刷新');
  assert.deepEqual([...host.denied(agent)], [read], '窗口到期前可见性保持旧状态');
  // Fail-closed 不变量：合并窗口内 guard 仍在工具执行前同步拦截未激活工具。
  const guard = [...host.guards][0];
  assert.match(guard({ name: 'mcp__acme__tool0', agent }), /未在当前会话激活/);

  const deadline = Date.now() + 1000;
  while (host.definitionsCalls === 0 && Date.now() < deadline) await sleep(10);
  assert.equal(host.definitionsCalls, 1, '一次突发只触发一次合并刷新');
  assert.deepEqual([...host.denied(agent)].sort(), [read, 'mcp__acme__tool19'].sort());
  await sleep(120);
  assert.equal(host.definitionsCalls, 1, '窗口外无重复刷新');

  // 第二次突发在窗口结束后重新武装。
  host.resetDefinitionsCalls();
  host.setNames([read, 'mcp__acme__tool19', 'mcp__acme__tool20']);
  assert.equal(host.definitionsCalls, 0, '新窗口内不做同步刷新');
  const secondDeadline = Date.now() + 1000;
  while (host.definitionsCalls === 0 && Date.now() < secondDeadline) await sleep(10);
  assert.equal(host.definitionsCalls, 1, '第二次突发触发一次合并刷新');
  assert.deepEqual(
    [...host.denied(agent)].sort(),
    [read, 'mcp__acme__tool19', 'mcp__acme__tool20'].sort(),
  );
  controller.dispose();
});

test('窗口内持续到来的 tools/change 不会饿死刷新', async () => {
  const read = 'mcp__acme__read';
  const host = sessionHost([read]);
  const agent = host.makeAgent('agent');
  const record = { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' };
  const controller = createSessionToolInjectionController(host.ctx, { getRecords: () => [record] });
  controller.mountAgents(host.agentCtx);
  host.resetDefinitionsCalls();

  // 每 30ms 到达一个事件，持续 300ms：固定窗口仍按窗口到期刷新，
  // trailing debounce 会在持续突发期间一次也不刷新。
  for (let i = 0; i < 10; i += 1) {
    host.setNames([read, `mcp__acme__tool${i}`]);
    await sleep(30);
  }
  assert.ok(host.definitionsCalls >= 2, `持续突发期间仍刷新，实际 ${host.definitionsCalls} 次`);
  controller.dispose();
});

test('显式 refresh 会消费待触发的合并窗口，不产生重复刷新', async () => {
  const read = 'mcp__acme__read';
  const write = 'mcp__acme__write';
  const host = sessionHost([read]);
  const agent = host.makeAgent('agent');
  const record = { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' };
  const controller = createSessionToolInjectionController(host.ctx, { getRecords: () => [record] });
  controller.mountAgents(host.agentCtx);
  host.resetDefinitionsCalls();

  host.setNames([read, write]);
  assert.equal(host.definitionsCalls, 0, 'tools/change 只排队不刷新');
  controller.refresh();
  assert.equal(host.definitionsCalls, 1, '显式变更同步刷新');
  assert.deepEqual([...host.denied(agent)].sort(), [read, write]);
  await sleep(120);
  assert.equal(host.definitionsCalls, 1, '显式刷新后窗口不再触发第二次刷新');
  controller.dispose();
});

test('dispose 清理待触发的 tools/change 合并窗口', async () => {
  const read = 'mcp__acme__read';
  const write = 'mcp__acme__write';
  const host = sessionHost([read]);
  const agent = host.makeAgent('agent');
  const record = { key: 'acme', name: 'Acme', serverName: 'acme', enabled: true, injectionMode: 'session' };
  const controller = createSessionToolInjectionController(host.ctx, { getRecords: () => [record] });
  controller.mountAgents(host.agentCtx);
  host.resetDefinitionsCalls();

  host.setNames([read, write]);
  controller.dispose();
  await sleep(120);
  assert.equal(host.definitionsCalls, 0, 'dispose 后窗口不再刷新');
  assert.deepEqual([...host.denied(agent)], [], 'dispose 释放 restriction');
});
