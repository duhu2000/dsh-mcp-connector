import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_CACHE_MAX_TOOLS,
  connectionToolCacheSignature,
  createToolCatalogRecord,
  findToolDetails,
  normalizeToolSearchText,
  sanitizeToolMetadata,
  searchToolCatalog,
  toolCatalogCacheView,
} from '../lib/tool-catalog-cache.js';
import { toolCatalogRecordSchema } from '../lib/schema.js';

function connection(overrides = {}) {
  return {
    key: 'demo-search',
    connectorId: 'demo',
    serverKey: 'search',
    serverName: 'demo-search',
    transport: 'streamable-http',
    url: 'https://example.com/mcp?tenant=one',
    ...overrides,
  };
}

test('Schema 属性名与 Schema 关键字分层处理，保留合法同名参数但删除敏感默认值', () => {
  const tool = sanitizeToolMetadata({ name: 'lookup', inputSchema: {
    type: 'object', required: ['default', 'const', 'examples'],
    properties: {
      default: { type: 'string', default: 'secret' },
      const: { type: 'object', properties: { examples: { type: 'string', examples: ['secret'] } } },
      examples: { type: 'number' },
    },
    $defs: { default: { type: 'string', const: 'secret' } },
  } });
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['default', 'const', 'examples']);
  assert.deepEqual(tool.inputSchema.properties.default, { type: 'string' });
  assert.equal(tool.inputSchema.properties.const.properties.examples.type, 'string');
  assert.equal(tool.inputSchema.$defs.default.type, 'string');
  assert.doesNotMatch(JSON.stringify(tool), /secret/);
  assert.equal(tool.schemaTruncated, true);
});

test('最后成功工具缓存只保留裁剪后的能力元数据', () => {
  const tool = sanitizeToolMetadata({
    name: 'search',
    title: '搜索',
    description: '检索公开数据',
    inputSchema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', default: 'real-secret', examples: ['real-secret-2'], const: 'real-secret-3' },
        query: { type: 'string' },
      },
    },
  });
  const text = JSON.stringify(tool);
  assert.match(text, /apiKey/);
  assert.doesNotMatch(text, /real-secret|default|examples|const/);
  assert.equal(tool.schemaTruncated, true);
});

test('缓存有工具数和总大小上限，并用连接签名隔离旧端点', () => {
  const tools = Array.from({ length: TOOL_CACHE_MAX_TOOLS + 20 }, (_, index) => ({ name: `tool-${index}` }));
  const record = createToolCatalogRecord(connection(), tools, 1_000);
  assert.equal(record.tools.length, TOOL_CACHE_MAX_TOOLS);
  assert.equal(record.truncated, true);
  assert.equal(toolCatalogRecordSchema.safeParse(record).success, true);
  assert.equal(record.observedAt, 1_000);
  assert.notEqual(
    connectionToolCacheSignature(connection()),
    connectionToolCacheSignature(connection({ url: 'https://example.com/another' })),
  );
  assert.doesNotMatch(JSON.stringify(record), /tenant=one/);
});

test('工具搜索支持中英紧邻归一化、稳定排序且不跨字段拼接命中', () => {
  const entries = [createToolCatalogRecord(connection(), [
    { name: 'mcp_connector_search', title: 'MCP连接器搜索', description: '搜索连接能力' },
    { name: 'weather_lookup', title: 'Weather', description: 'weather city forecast' },
    { name: 'split_fields', title: 'weather', description: 'city' },
  ], 1_000)];
  assert.equal(normalizeToolSearchText('MCP连接器'), 'mcp 连接器');
  const compact = searchToolCatalog(entries, { query: 'mcp连接器' }, 2_000);
  assert.equal(compact[0].name, 'mcp_connector_search');
  const sameField = searchToolCatalog(entries, { query: 'weather city' }, 2_000);
  assert.deepEqual(sameField.map((item) => item.name), ['weather_lookup']);
});

test('工具详情精确匹配、保留 schema 并报告缓存陈旧性和同名歧义', () => {
  const first = createToolCatalogRecord(connection(), [{
    name: 'lookup', description: '查询', inputSchema: { type: 'object', required: ['query'] },
  }], 1_000);
  const second = createToolCatalogRecord(connection({ key: 'demo-two', serverName: 'demo-two' }), [{ name: 'lookup' }], 1_000);
  const matches = findToolDetails([first, second], { toolName: 'lookup' }, 90_000_000);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].stale, true);
  assert.deepEqual(matches[0].inputSchema, { type: 'object', required: ['query'] });
  assert.equal(toolCatalogCacheView(first, 2_000).cacheAgeMs, 1_000);
});
