import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionScopeService,
  bindingForConnection,
  connectionVisibleInWorkspace,
  createHostScopeController,
  mutateScopeBinding,
  normalizeScopeDocument,
  normalizeScopeTarget,
} from '../lib/connection-scopes.js';

test('多选范围严格校验，去重且替换 global，不影响旧单目标接口', () => {
  const target = normalizeScopeTarget({ scope: 'project', workspaceIds: ['b', ' a ', 'a'] });
  assert.deepEqual(target.workspaceIds, ['a', 'b']);
  for (const workspaceIds of [[], 'a', [null], [''], Array(101).fill('a')]) {
    assert.throws(() => normalizeScopeTarget({ scope: 'project', workspaceIds }), /workspaceIds/);
  }
  assert.throws(() => normalizeScopeTarget({ scope: 'project', workspaceId: 'a', workspaceIds: ['b'] }), /同时/);
  const binding = mutateScopeBinding({ connectionKey: 'x', global: true, projects: [] }, { mode: 'move', target });
  assert.equal(binding.global, false);
  for (const id of ['a', 'b']) assert.equal(connectionVisibleInWorkspace(binding, id), true);
  for (const id of ['c', undefined, '']) assert.equal(connectionVisibleInWorkspace(binding, id), false);
  const reduced = mutateScopeBinding(binding, { mode: 'move', target: { scope: 'project', workspaceIds: ['a'] } });
  assert.equal(connectionVisibleInWorkspace(reduced, 'b'), false);
});

test('多选保存互斥、失败不改内存，持久恢复和回滚保持完整列表', async () => {
  let persisted;
  let release;
  const store = { get: async () => persisted, put: async (value) => {
    await new Promise((resolve) => { release = resolve; });
    persisted = structuredClone(value);
  } };
  const service = new ConnectionScopeService(store);
  await service.load();
  const input = { connectionKey: 'x', mode: 'move', target: { scope: 'project', workspaceIds: ['a', 'b'] } };
  const first = service.apply(input, { expectedRevision: 0 });
  await assert.rejects(service.apply({ ...input, target: { scope: 'project', workspaceIds: ['c'] } }, { expectedRevision: 0 }), /正在保存/);
  release();
  await first;
  const restored = new ConnectionScopeService(store);
  await restored.load();
  assert.deepEqual(restored.binding('x').projects, ['a', 'b']);
  await assert.rejects(restored.apply(input, { expectedRevision: 0 }), /重新预览/);
  store.put = async () => { throw new Error('disk failure'); };
  await assert.rejects(restored.apply({ ...input, target: { scope: 'global' } }, { expectedRevision: 1 }), /disk failure/);
  assert.deepEqual(restored.binding('x').projects, ['a', 'b']);
  store.put = async (value) => { persisted = structuredClone(value); };
  await restored.rollback(0, { expectedRevision: 1 });
  assert.equal(restored.binding('x').global, true);
});

test('旧连接缺少显式绑定时保持 profile/global 兼容', () => {
  const document = normalizeScopeDocument(null);
  assert.deepEqual(bindingForConnection(document.bindings, 'legacy'), {
    connectionKey: 'legacy', global: true, projects: [],
  });
  assert.equal(connectionVisibleInWorkspace(bindingForConnection([], 'legacy'), 'workspace-a'), true);
});

test('已存在的作用域数据损坏或读取失败时 fail closed，不降级为 global', async () => {
  assert.throws(() => normalizeScopeDocument({
    revision: 1,
    bindings: [{ connectionKey: 'project-only', global: false, projects: [] }],
  }), /至少需要一个作用域/);
  const service = new ConnectionScopeService({
    async get() { throw new Error('scope storage unreadable'); },
  });
  await assert.rejects(service.load(), /scope storage unreadable/);
});

test('project 目标强制稳定 workspaceId，global 不携带项目标识', () => {
  assert.deepEqual(normalizeScopeTarget({ scope: 'global', workspaceId: 'ignored' }), { scope: 'global' });
  assert.deepEqual(normalizeScopeTarget({ scope: 'project', workspaceId: ' workspace-a ' }), {
    scope: 'project', workspaceId: 'workspace-a',
  });
  assert.throws(() => normalizeScopeTarget({ scope: 'project' }), /workspaceId/);
});

test('copy 只增加作用域绑定，move 替换绑定且不接触连接配置', () => {
  const project = mutateScopeBinding(
    { connectionKey: 'acme', global: false, projects: ['workspace-a'] },
    { mode: 'copy', target: { scope: 'project', workspaceId: 'workspace-b' } },
  );
  assert.deepEqual(project, { connectionKey: 'acme', global: false, projects: ['workspace-a', 'workspace-b'] });
  const promoted = mutateScopeBinding(project, { mode: 'move', target: { scope: 'global' } });
  assert.deepEqual(promoted, { connectionKey: 'acme', global: true, projects: [] });
});

test('作用域变更按 revision 预览、提交、持久恢复和回滚', async () => {
  let persisted;
  const store = {
    async get() { return persisted; },
    async put(value) { persisted = structuredClone(value); },
  };
  let now = 100;
  const service = new ConnectionScopeService(store, { now: () => ++now });
  await service.load();
  const input = {
    connectionKey: 'acme', mode: 'move', target: { scope: 'project', workspaceId: 'workspace-a' },
  };
  const preview = service.preview(input);
  assert.equal(preview.baseRevision, 0);
  assert.deepEqual(preview.current, { connectionKey: 'acme', global: true, projects: [] });
  assert.deepEqual(preview.next, { connectionKey: 'acme', global: false, projects: ['workspace-a'] });
  assert.equal(service.snapshot().bindings.length, 0, 'preview 不写 storage');

  const applied = await service.apply(input, { expectedRevision: 0 });
  assert.equal(applied.document.revision, 1);
  assert.equal(connectionVisibleInWorkspace(service.binding('acme'), 'workspace-a'), true);
  assert.equal(connectionVisibleInWorkspace(service.binding('acme'), 'workspace-b'), false);
  await assert.rejects(service.apply({ ...input, target: { scope: 'global' } }, { expectedRevision: 0 }), /重新预览/);

  const restarted = new ConnectionScopeService(store);
  await restarted.load();
  assert.deepEqual(restarted.binding('acme').projects, ['workspace-a']);
  const rolledBack = await restarted.rollback(0, { expectedRevision: 1 });
  assert.equal(rolledBack.document.revision, 2);
  assert.deepEqual(restarted.binding('acme'), { connectionKey: 'acme', global: true, projects: [] });
});

test('作用域持久化失败不会改变内存或产生凭据副本', async () => {
  const service = new ConnectionScopeService({
    async get() { return null; },
    async put() { throw new Error('disk full'); },
  });
  await service.load();
  await assert.rejects(service.assign('secret-connection', { scope: 'project', workspaceId: 'workspace-a' }), /disk full/);
  assert.equal(service.snapshot().revision, 0);
  assert.deepEqual(service.snapshot().bindings, []);
});

function scopeHost(names, { emitFromSchemas = false } = {}) {
  const guards = new Set();
  const listeners = new Map();
  const agents = [];
  let schemaReads = 0;
  const emit = (event, payload = {}) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const ctx = {
    tools: {
      definitions: () => {
        schemaReads += 1;
        if (emitFromSchemas) emit('tools/change');
        return names.map((name) => ({ name }));
      },
      guard(fn) { guards.add(fn); return () => guards.delete(fn); },
      restrict() {},
    },
  };
  const agentCtx = {
    agents: { list: () => agents },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
  };
  function agent(id, workspaceId) {
    const restrictions = new Set();
    const value = {
      id,
      workspaceId,
      restrictions,
      ctx: { tools: { restrict({ deny }) {
        const entry = new Set(deny);
        restrictions.add(entry);
        return () => restrictions.delete(entry);
      } } },
    };
    agents.push(value);
    return value;
  }
  return {
    ctx, agentCtx, agents, guards, agent,
    denied(value) { return new Set([...value.restrictions].flatMap((entry) => [...entry])); },
    emit,
    schemaReads: () => schemaReads,
  };
}

test('Host 对 project-only 工具同时收窄可见性并在执行层 fail closed', () => {
  const globalTool = 'mcp__global-server__read';
  const projectTool = 'mcp__project-server__read';
  const host = scopeHost([globalTool, projectTool, 'unrelated']);
  const inProject = host.agent('a', 'workspace-a');
  const outside = host.agent('b', 'workspace-b');
  const records = [
    { key: 'global', serverName: 'global-server' },
    { key: 'project', serverName: 'project-server' },
  ];
  const bindings = [{ connectionKey: 'project', global: false, projects: ['workspace-a'] }];
  const controller = createHostScopeController(host.ctx, {
    getRecords: () => records,
    getBindings: () => bindings,
    workspaceIdForAgent: (agent) => agent.workspaceId,
  });
  controller.mountAgents(host.agentCtx);

  assert.deepEqual([...host.denied(inProject)], []);
  assert.deepEqual([...host.denied(outside)], [projectTool]);
  const guard = [...host.guards][0];
  assert.equal(guard({ name: projectTool, agent: inProject }), undefined);
  assert.match(guard({ name: projectTool, agent: outside }), /不属于当前工作区/);
  assert.match(guard({ name: projectTool }), /不属于当前工作区/, '无 Agent 的 project 调用必须 fail closed');
  assert.equal(guard({ name: globalTool }), undefined);
  assert.equal(guard({ name: 'unrelated' }), undefined);

  bindings[0].projects.push('workspace-b');
  controller.refresh();
  assert.deepEqual([...host.denied(outside)], []);
  assert.equal(guard({ name: projectTool, agent: outside }), undefined);
  bindings[0].projects = ['workspace-a'];
  controller.refresh();
  assert.deepEqual([...host.denied(outside)], [projectTool]);
  assert.match(guard({ name: projectTool, agent: outside }), /不属于当前工作区/);

  controller.dispose();
  assert.equal(host.guards.size, 0);
  assert.equal(outside.restrictions.size, 0);
});

test('作用域同步忽略名称读取同步触发的嵌套 tools/change，后续独立变更仍生效', () => {
  const projectTool = 'mcp__project-server__read';
  const host = scopeHost([projectTool], { emitFromSchemas: true });
  const outside = host.agent('outside', 'workspace-b');
  const controller = createHostScopeController(host.ctx, {
    getRecords: () => [{ key: 'project', serverName: 'project-server' }],
    getBindings: () => [{ connectionKey: 'project', global: false, projects: ['workspace-a'] }],
    workspaceIdForAgent: (agent) => agent.workspaceId,
  });

  controller.mountAgents(host.agentCtx);
  assert.equal(host.schemaReads(), 1);
  assert.deepEqual([...host.denied(outside)], [projectTool]);

  host.emit('tools/change');
  assert.equal(host.schemaReads(), 2);
  controller.dispose();
});
