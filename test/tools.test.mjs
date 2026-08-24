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
