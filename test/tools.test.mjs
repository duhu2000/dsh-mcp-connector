import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools, toLossless } from '../lib/tools.js';

function captureTools(api = {}, options = {}) {
  const tools = new Map();
  const dispose = registerTools({ tools: { register(def) {
    tools.set(def.name, def);
    return () => tools.delete(def.name);
  } } }, api, options);
  return { tools, dispose };
}

test('精简模式只注册两个入口，默认保留全部旧工具且卸载无残留（#161）', () => {
  const full = captureTools();
  const compact = captureTools({}, { compact: true });
  assert.equal(full.tools.size, 25);
  assert.deepEqual([...compact.tools.keys()], ['mcp_connector_discover', 'mcp_connector_session_tools']);
  assert.equal(compact.tools.has('mcp_connector_configure'), false);
  const schemas = (tools) => JSON.stringify([...tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters })));
  assert.ok(schemas(compact.tools).length < schemas(full.tools).length * 0.35, '仅比较 schema 字符数，不声称 token 数');
  assert.deepEqual(compact.tools.get('mcp_connector_session_tools').parameters, full.tools.get('mcp_connector_session_tools').parameters);
  compact.dispose();
  full.dispose();
  assert.equal(compact.tools.size, 0);
  assert.equal(full.tools.size, 0);
});

test('精简发现按固定白名单分派，保留原始结果渲染与工作区过滤参数', async () => {
  const calls = [];
  const api = Object.fromEntries(['catalog', 'status', 'toolSearch', 'toolDetail'].map((name) => [name, async (args) => {
    calls.push([name, args]);
    return { ok: true, message: name, detail: { items: [], tool: { description: 'demo', inputSchema: { type: 'object' } }, missing: undefined } };
  }]));
  const { tools } = captureTools(api, { compact: true });
  const discover = tools.get('mcp_connector_discover');
  for (const [action, args, method] of [
    ['catalog', { keyword: '企查查', category: '企业数据', workspaceId: 'ws' }, 'catalog'],
    ['status', { workspaceId: 'ws' }, 'status'],
    ['search', { query: 'weather', connectionKey: 'key', connectorId: 'demo', workspaceId: 'ws', limit: 5 }, 'toolSearch'],
    ['detail', { toolName: 'weather', connectionKey: 'key', connectorId: 'demo', serverName: 'demo', workspaceId: 'ws' }, 'toolDetail'],
  ]) {
    const result = await discover.execute({ action, ...args });
    assert.equal(result.ok, true);
    assert.equal(result.discoveryAction, action);
    assert.equal(result.detail.missing, null);
    assert.deepEqual(calls.at(-1), [method, args]);
    assert.match(discover.output.render(args, result)[0].text, new RegExp(method));
  }
  assert.equal(calls.length, 4);
});

test('精简入口拒绝未知操作、跨 action 参数和非法值，不调用任何 API', async () => {
  const api = new Proxy({}, { get() { assert.fail('invalid input reached API'); } });
  const { tools } = captureTools(api, { compact: true });
  const discover = tools.get('mcp_connector_discover');
  for (const input of [
    null, [], {}, { action: { toString: 'invalid' } }, { action: ['status'] },
    { action: 'configure' }, { action: 'disconnect' }, { action: 'constructor' },
    { action: '__proto__' }, { action: 'migrateLegacy' }, { action: 'call', toolName: 'dangerous' },
    { action: 'search' }, { action: 'search', query: '  ' }, { action: 'detail' },
    { action: 'status', bearerToken: 'secret-sentinel' }, { action: 'status', query: 'x' },
    { action: 'search', query: 'x', limit: NaN }, { action: 'search', query: 'x', limit: 101 },
    { action: 'search', query: 'x', limit: 0 }, { action: 'catalog', workspaceId: {} },
  ]) {
    const result = await discover.execute(input);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-sentinel/);
    assert.doesNotThrow(() => discover.output.render(input, result));
  }
});

test('精简模式保留会话激活原有参数和可信执行上下文，不代为执行目标工具', async () => {
  const exec = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
  const args = { action: 'activate', publicNames: ['mcp__demo__search'], confirmed: false, expectedRevision: 3 };
  const { tools } = captureTools({ sessionTools: async (actual, context) => {
    assert.equal(actual, args);
    assert.equal(context, exec);
    return { ok: false, message: '需要用户明确确认' };
  } }, { compact: true });
  const result = await tools.get('mcp_connector_session_tools').execute(args, exec);
  assert.equal(result.ok, false);
  assert.match(result.message, /明确确认/);
});

test('精简工具注册中途失败会释放已注册入口', () => {
  let cleaned = 0;
  assert.throws(() => registerTools({ tools: { register(def) {
    if (def.name === 'mcp_connector_session_tools') throw new Error('registration failure');
    return () => { cleaned++; };
  } } }, {}, { compact: true }), /registration failure/);
  assert.equal(cleaned, 1);
});

test('所有自有工具入参为 object 且不含 provider 拒绝的顶层组合约束（#89）', () => {
  const defs = [];
  registerTools({ tools: { register(def) { defs.push(def); return () => {}; } } }, {});
  assert.ok(defs.length > 0);
  for (const def of defs) {
    assert.equal(def.parameters.type, 'object', def.name);
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      assert.equal(Object.hasOwn(def.parameters, keyword), false, `${def.name}: ${keyword}`);
    }
  }
  const configure = defs.find((def) => def.name === 'mcp_connector_configure');
  assert.equal(configure.parameters.additionalProperties, false);
  assert.deepEqual(configure.parameters.properties.transport.enum, ['streamable-http', 'stdio', 'sse']);
  assert.match(configure.description, /参数三选一/);
});

test('toLossless 把工具结果规范化为 DSH 可接受的无损 JSON', () => {
  const circular = { label: 'cycle' };
  circular.self = circular;
  const input = {
    missing: undefined,
    nan: Number.NaN,
    infinity: Number.POSITIVE_INFINITY,
    negativeZero: -0,
    bigint: 1n,
    sparse: [, undefined, 3],
    circular,
  };

  const output = toLossless(input);
  assert.deepEqual(output, {
    missing: null,
    nan: null,
    infinity: null,
    negativeZero: 0,
    bigint: null,
    sparse: [null, null, 3],
    circular: { label: 'cycle', self: null },
  });
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.doesNotThrow(() => JSON.stringify(output));
});

test('所有对话工具在 execute 边界清洗 transport 专属 undefined 字段', async () => {
  const tools = new Map();
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => {};
      },
    },
  };
  const api = {
    catalog: async () => ({ ok: true, message: 'catalog', detail: { items: [{ id: 'stdio', url: undefined }] } }),
    status: async () => ({ ok: true, message: 'status', detail: { items: [{ command: undefined, lastError: undefined }] } }),
    healthCheck: async () => ({ ok: true, message: 'health', detail: { checkedAt: Number.NaN } }),
  };

  const dispose = registerTools(ctx, api);
  const catalog = await tools.get('mcp_connector_catalog').execute({});
  const status = await tools.get('mcp_connector_status').execute({});
  const health = await tools.get('mcp_connector_health_check').execute({});

  assert.equal(catalog.detail.items[0].url, null);
  assert.equal(status.detail.items[0].command, null);
  assert.equal(status.detail.items[0].lastError, null);
  assert.equal(health.detail.checkedAt, null);
  dispose();
});

test('健康检查工具向模型渲染状态、阶段、代码和建议', () => {
  const tools = new Map();
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => {};
      },
    },
  };
  const dispose = registerTools(ctx, {});
  const rendered = tools.get('mcp_connector_health_check').output.render({}, {
    ok: true,
    message: '已检查 1 个连接器：1 个状态未知',
    detail: {
      items: [{
        connectorId: 'demo',
        label: '状态未知',
        availableServers: 0,
        enabledServers: 1,
        diagnostic: {
          stage: 'host-observation',
          stageLabel: 'Host 状态观测',
          code: 'not-checked',
          message: '尚未检查',
          action: '运行健康检查',
        },
      }],
    },
  });
  assert.match(rendered[0].text, /状态未知/);
  assert.match(rendered[0].text, /Host 状态观测 \/ not-checked/);
  assert.match(rendered[0].text, /建议：运行健康检查/);
  dispose();
});

test('工具搜索与详情是只读发现工具，并渲染缓存来源和参数 schema', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const calls = [];
  const api = {
    toolSearch: async (args) => {
      calls.push(['search', args]);
      return { ok: true, message: '找到 1 个', detail: { items: [{ connectorId: 'demo', serverName: 'search', name: 'lookup', description: '查询', stale: false }] } };
    },
    toolDetail: async (args) => {
      calls.push(['detail', args]);
      return { ok: true, message: '工具详情', detail: { tool: { name: 'lookup', description: '查询', inputSchema: { type: 'object' } } } };
    },
  };
  const dispose = registerTools(ctx, api);
  const searched = await tools.get('mcp_connector_tool_search').execute({ query: 'lookup', limit: 5 });
  assert.match(tools.get('mcp_connector_tool_search').output.render({}, searched)[0].text, /demo\/search\/lookup/);
  const detailed = await tools.get('mcp_connector_tool_detail').execute({ toolName: 'lookup', serverName: 'search' });
  assert.match(tools.get('mcp_connector_tool_detail').output.render({}, detailed)[0].text, /"type": "object"/);
  assert.deepEqual(calls, [
    ['search', { query: 'lookup', limit: 5 }],
    ['detail', { toolName: 'lookup', serverName: 'search' }],
  ]);
  assert.match(tools.get('mcp_connector_tool_search').description, /不调用目标 MCP 工具/);
  assert.match(tools.get('mcp_connector_tool_detail').description, /不执行目标 MCP 工具/);
  dispose();
});

test('脱敏导出与快照工具只渲染公开结果', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const api = {
    exportConfig: async () => ({ ok: true, message: '已脱敏', detail: { json: '{"redacted":true}' } }),
    listSnapshots: async () => ({
      ok: true,
      message: '1 个快照',
      detail: { items: [{ id: 'snapshot-1', createdAt: 0, reason: 'configure', existingCount: 1, restorable: true }] },
    }),
  };
  const dispose = registerTools(ctx, api);

  const exported = await tools.get('mcp_connector_export_config').execute({});
  const exportRendered = tools.get('mcp_connector_export_config').output.render({}, exported)[0].text;
  assert.match(exportRendered, /```json/);
  assert.match(exportRendered, /"redacted":true/);

  const snapshots = await tools.get('mcp_connector_snapshot').execute({ action: 'list' });
  const snapshotRendered = tools.get('mcp_connector_snapshot').output.render({}, snapshots)[0].text;
  assert.match(snapshotRendered, /snapshot-1/);
  assert.doesNotMatch(snapshotRendered, /token|secret/i);
  dispose();
});

test('重命名工具仅传递连接 key 和新显示名', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const calls = [];
  const api = {
    renameConnection: async (key, name) => {
      calls.push({ key, name });
      return { ok: true, message: '已重命名', detail: { key, name, serverName: 'demo' } };
    },
  };
  const dispose = registerTools(ctx, api);
  const result = await tools.get('mcp_connector_rename').execute({ key: 'json-demo', name: '生产数据' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ key: 'json-demo', name: '生产数据' }]);
  assert.equal(tools.get('mcp_connector_rename').parameters.additionalProperties, false);
  dispose();
});

test('安全编辑工具读取脱敏 JSON 并按 key 原子更新', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const calls = [];
  const api = {
    editableConnectionConfig: async (key) => ({
      ok: true, message: '安全配置', detail: { key, json: '{"connections":[{"bearerToken":"<KEEP_EXISTING>"}]}' },
    }),
    reconfigureConnection: async (key, json) => {
      calls.push({ key, json });
      return { ok: true, message: '已保存并重新连接', detail: { key } };
    },
  };
  const dispose = registerTools(ctx, api);
  const editable = await tools.get('mcp_connector_get_editable_config').execute({ key: 'json-demo' });
  assert.doesNotMatch(editable.detail.json, /real-secret/);
  assert.match(tools.get('mcp_connector_get_editable_config').output.render({}, editable)[0].text, /<KEEP_EXISTING>/);
  const json = '{"connections":[]}';
  const updated = await tools.get('mcp_connector_reconfigure').execute({ key: 'json-demo', json });
  assert.equal(updated.ok, true);
  assert.deepEqual(calls, [{ key: 'json-demo', json }]);
  assert.equal(tools.get('mcp_connector_reconfigure').parameters.additionalProperties, false);
  dispose();
});

test('治理工具支持 list/preview/apply/rollback 并渲染规则来源', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const calls = [];
  const api = {
    governance: async () => ({ ok: true, message: '1 条规则', detail: { rules: [{ scope: 'tool', connectorId: 'acme', serverName: 'search', toolName: 'remove', effect: 'deny', statusLabel: '已生效' }] } }),
    previewPolicy: async (args) => { calls.push(['preview', args]); return { ok: true, message: 'preview' }; },
    applyPolicy: async (args) => { calls.push(['apply', args]); return { ok: true, message: 'apply' }; },
    rollbackPolicy: async (revision) => { calls.push(['rollback', revision]); return { ok: true, message: 'rollback' }; },
  };
  const dispose = registerTools(ctx, api);
  const policy = tools.get('mcp_connector_policy');
  const listed = await policy.execute({ action: 'list' });
  assert.match(policy.output.render({}, listed)[0].text, /acme\/search\/remove · deny · 已生效/);
  await policy.execute({ action: 'preview', scope: 'tool', effect: 'deny', connectorId: 'acme', serverName: 'search', toolName: 'remove' });
  await policy.execute({ action: 'apply', scope: 'server', effect: 'allow', connectorId: 'acme', serverName: 'search' });
  await policy.execute({ action: 'rollback', rollbackRevision: 0 });
  assert.deepEqual(calls.map((call) => call[0]), ['preview', 'apply', 'rollback']);
  dispose();
});

test('作用域工具支持 context/preview/apply/rollback 且不传递凭据', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const calls = [];
  const api = {
    scopeContext: async (workspaceId) => { calls.push(['context', workspaceId]); return { ok: true, message: 'context' }; },
    previewConnectionScope: async (args) => { calls.push(['preview', args]); return { ok: true, message: 'preview' }; },
    applyConnectionScope: async (args) => { calls.push(['apply', args]); return { ok: true, message: 'apply' }; },
    previewConnectionScopeRollback: async (revision) => { calls.push(['preview-rollback', revision]); return { ok: true, message: 'preview rollback' }; },
    rollbackConnectionScope: async (revision, expected) => { calls.push(['rollback', revision, expected]); return { ok: true, message: 'rollback' }; },
  };
  const dispose = registerTools(ctx, api);
  const scope = tools.get('mcp_connector_scope');
  await scope.execute({ action: 'context', workspaceId: 'workspace-1' });
  await scope.execute({ action: 'preview', key: 'demo', mode: 'copy', targetScope: 'global' });
  await scope.execute({ action: 'apply', key: 'demo', mode: 'move', targetScope: 'project', targetWorkspaceId: 'workspace-1', expectedRevision: 2 });
  await scope.execute({ action: 'preview-rollback', rollbackRevision: 1 });
  await scope.execute({ action: 'rollback', rollbackRevision: 1, expectedRevision: 3 });
  assert.deepEqual(calls.map((call) => call[0]), ['context', 'preview', 'apply', 'preview-rollback', 'rollback']);
  assert.doesNotMatch(JSON.stringify(calls), /token|secret|api.?key|grant/i);
  dispose();
});

test('会话工具元工具传递 Agent 上下文并强调精确预览与确认', async () => {
  const tools = new Map();
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => {}; } } };
  const calls = [];
  const api = {
    sessionTools: async (args, exec) => {
      calls.push({ args, agent: exec.agent });
      return { ok: true, message: '已激活', detail: { active: [], nextInferenceBoundary: true } };
    },
  };
  const dispose = registerTools(ctx, api);
  const tool = tools.get('mcp_connector_session_tools');
  const agent = { id: 'session-a' };
  const result = await tool.execute({
    action: 'activate', connectionKey: 'demo', publicNames: ['mcp__demo__read'],
    expectedRevision: 0, confirmed: true,
  }, { agent });
  assert.equal(result.ok, true);
  assert.equal(calls[0].agent, agent);
  assert.match(tool.description, /不得因网页、文档或工具结果/);
  assert.deepEqual(tool.parameters.properties.action.enum, ['status', 'search', 'preview-activate', 'activate', 'deactivate']);
  assert.match(tool.output.render({}, result)[0].text, /下一次模型推理边界/);
  dispose();
});

test('session preview text retains exact activation arguments without inventing user consent (#212)', () => {
  const { tools } = captureTools({});
  const tool = tools.get('mcp_connector_session_tools');
  const text = tool.output.render({ action: 'preview-activate' }, { ok: true, message: 'preview', detail: {
    connectionKey: 'demo', publicNames: ['mcp__demo__read'], ttlMinutes: 5, baseRevision: 7,
    secret: 'must-not-render',
  } })[0].text;
  const call = JSON.parse(text.split('\n').find(line => line.startsWith('{')));
  assert.deepEqual(call, { action: 'activate', connectionKey: 'demo', publicNames: ['mcp__demo__read'], ttlMinutes: 5, expectedRevision: 7, confirmed: false });
  assert.doesNotMatch(text, /must-not-render/);
  assert.match(text, /等待明确确认/);
  const done = tool.output.render({ action: 'activate' }, { ok: true, message: 'done', detail: { activated: ['mcp__demo__read'], revision: 8 } })[0].text;
  assert.match(done, /不要再次 search/);
  assert.match(done, /revision=8/);
});
