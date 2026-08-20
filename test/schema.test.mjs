import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnectorDescriptor } from '../lib/schema.js';
import { auditDescriptor } from '../lib/catalog.js';
import { normalizeJsonImport } from '../lib/connectors/json-connector.js';
import { buildManualRecord } from '../lib/connectors/manual-connector.js';
import { resourceMetadataUrlFallback } from '../lib/oauth.js';

test('normalizeConnectorDescriptor 补齐默认值', () => {
  const d = normalizeConnectorDescriptor({
    id: 'acme',
    name: 'ACME',
    auth: { mode: 'oauth2-pkce', issuer: 'https://auth.example.com' },
    servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'acme-a' }],
  });
  assert.equal(d.id, 'acme');
  assert.equal(d.category, '其他');
  assert.equal(d.published, true);
  assert.equal(d.featured, false);
  assert.equal(d.auth.mode, 'oauth2-pkce');
  assert.equal(d.auth.scope, 'mcp:tools');
  assert.equal(d.auth.clientName, 'DeepSeek Harness - MCP 连接器');
  assert.equal(d.servers[0].transport, 'streamable-http');
  assert.equal(d.probeStatus, 'unverified');
  assert.deepEqual(d.promptVariables, []);
  assert.deepEqual(d.toolsSnapshot, []);
});

test('normalizeConnectorDescriptor 接受参数化 Prompt 与工具快照', () => {
  const d = normalizeConnectorDescriptor({
    id: 'templated', name: 'Templated',
    promptVariables: [{ name: 'company', label: '企业名称', required: true }],
    prompts: [{ title: '查询', text: '查询 {{company}}' }],
    probeStatus: 'pass',
    toolsSnapshot: [{ serverKey: 'main', tools: [{ name: 'search', description: '查询' }] }],
    servers: [{ serverKey: 'main', url: 'https://mcp.example.com/stream', serverName: 'templated' }],
  });
  assert.equal(d.promptVariables[0].name, 'company');
  assert.equal(d.probeStatus, 'pass');
  assert.equal(d.toolsSnapshot[0].tools[0].name, 'search');
});

test('normalizeConnectorDescriptor 拒绝缺 servers 的描述', () => {
  assert.throws(() => normalizeConnectorDescriptor({ id: 'x', name: 'X' }), /servers/);
});

test('auditDescriptor 拒绝目录携带密钥类头', () => {
  assert.throws(
    () =>
      auditDescriptor(
        normalizeConnectorDescriptor({
          id: 'x',
          name: 'X',
          servers: [
            { serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'x-a', headers: { Authorization: 'Bearer secret' } },
          ],
        }),
      ),
    /密钥类头/,
  );
});

test('normalizeJsonImport: mcpServers 格式 + Bearer 提升', () => {
  const { records, skipped } = normalizeJsonImport({
    mcpServers: {
      'my-vendor': {
        type: 'streamable-http',
        url: 'https://vendor.example.com/mcp/stream',
        headers: { Authorization: 'Bearer tok123', 'X-Extra': '1' },
      },
    },
  });
  assert.equal(records.length, 1);
  assert.equal(skipped.length, 0);
  const r = records[0];
  assert.equal(r.kind, 'json');
  assert.equal(r.serverName, 'my-vendor');
  assert.equal(r.auth.mode, 'bearer');
  assert.equal(r.auth.bearerToken, 'tok123');
  assert.equal(r.headers['X-Extra'], '1');
  assert.equal('Authorization' in r.headers, false);
});

test('normalizeJsonImport: connections 格式 api-key', () => {
  const { records } = normalizeJsonImport({
    connections: [
      { name: '地图', url: 'https://mcp.example.com/stream', serverName: 'geo', authMode: 'api-key', apiKeyHeader: 'X-Key', apiKeyValue: 'v1' },
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].auth.mode, 'api-key');
  assert.equal(records[0].auth.apiKeyValue, 'v1');
});

test('normalizeJsonImport: stdio 跳过 + 缺 url 跳过', () => {
  const { records, skipped } = normalizeJsonImport({
    mcpServers: {
      local: { command: 'npx', args: ['x'] },
      broken: { type: 'streamable-http' },
      ok: { url: 'https://mcp.example.com/stream' },
    },
  });
  assert.equal(records.length, 1);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((s) => s.includes('stdio')));
  assert.ok(skipped.some((s) => s.includes('缺 url')));
});

test('normalizeJsonImport: 全部跳过时抛错', () => {
  assert.throws(
    () => normalizeJsonImport({ mcpServers: { local: { command: 'npx' } } }),
    /没有可导入的连接/,
  );
});

test('buildManualRecord: bearer / api-key / none', () => {
  const bearer = buildManualRecord({ name: 'A', url: 'https://mcp.example.com/stream', authMode: 'bearer', bearerToken: 't' });
  assert.equal(bearer.auth.mode, 'bearer');
  const apikey = buildManualRecord({ name: 'B', url: 'https://mcp.example.com/stream', authMode: 'api-key', apiKeyValue: 'v' });
  assert.equal(apikey.auth.mode, 'api-key');
  assert.equal(apikey.auth.apiKeyHeader, 'X-Api-Key');
  const none = buildManualRecord({ name: 'C', url: 'https://mcp.example.com/stream' });
  assert.equal(none.auth, undefined);
});

test('buildManualRecord: 拒绝非 https 且非回环 http', () => {
  assert.throws(() => buildManualRecord({ name: 'A', url: 'http://evil.example.com/stream' }), /protocol/);
  assert.throws(() => buildManualRecord({ name: 'A', url: 'ftp://x/stream' }), /protocol|invalid url/);
});

test('buildManualRecord: serverName 归一化', () => {
  const r = buildManualRecord({ name: 'My DB', url: 'https://mcp.example.com/stream', serverName: 'My-DB 2' });
  assert.equal(r.serverName, 'my-db-2');
});

test('OAuth protected resource metadata fallback 保留 MCP 路径', () => {
  assert.equal(
    resourceMetadataUrlFallback('https://agent.example.com/mcp/company/stream'),
    'https://agent.example.com/mcp/.well-known/oauth-protected-resource/company/stream',
  );
});
