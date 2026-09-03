import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools, toLossless } from '../lib/tools.js';

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
