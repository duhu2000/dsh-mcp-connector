import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnectorDescriptor, normalizeConnectionRecord } from '../lib/schema.js';
import { auditDescriptor } from '../lib/catalog.js';
import { normalizeJsonImport } from '../lib/connectors/json-connector.js';
import { buildManualRecord } from '../lib/connectors/manual-connector.js';
import { resourceMetadataUrlFallback } from '../lib/oauth.js';
import { buildEntryConfig } from '../lib/mcp-provision.js';

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
    auth: {
      mode: 'bearer',
      credentialName: 'Vendor Access Token',
      credentialPlaceholder: '请输入 Token',
      credentialDescription: '仅保存在本机',
      credentialHelpLabel: '如何获取 Token？',
    },
    promptVariables: [{ name: 'company', label: '企业名称', required: true }],
    prompts: [{ title: '查询', text: '查询 {{company}}' }],
    probeStatus: 'pass',
    toolsSnapshot: [{ serverKey: 'main', tools: [{ name: 'search', description: '查询' }] }],
    servers: [{ serverKey: 'main', url: 'https://mcp.example.com/stream', serverName: 'templated' }],
  });
  assert.equal(d.promptVariables[0].name, 'company');
  assert.equal(d.auth.credentialName, 'Vendor Access Token');
  assert.equal(d.auth.credentialPlaceholder, '请输入 Token');
  assert.equal(d.auth.credentialDescription, '仅保存在本机');
  assert.equal(d.auth.credentialHelpLabel, '如何获取 Token？');
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

test('normalizeJsonImport: stdio 透传 + 缺 url 跳过', () => {
  const { records, skipped } = normalizeJsonImport({
    mcpServers: {
      local: { command: 'npx', args: ['-y', 'x'], env: { LOG_LEVEL: 'info' }, cwd: '/tmp' },
      broken: { type: 'streamable-http' },
      ok: { url: 'https://mcp.example.com/stream' },
    },
  });
  assert.equal(records.length, 2);
  assert.equal(skipped.length, 1);
  assert.equal(records[0].transport, 'stdio');
  assert.equal(records[0].command, 'npx');
  assert.deepEqual(records[0].args, ['-y', 'x']);
  assert.deepEqual(records[0].env, { LOG_LEVEL: 'info' });
  assert.equal(records[0].cwd, '/tmp');
  assert.ok(skipped.some((s) => s.includes('缺 url')));
});

test('normalizeJsonImport: 全部跳过时抛错', () => {
  assert.throws(
    () => normalizeJsonImport({ mcpServers: { local: { type: 'stdio' } } }),
    /没有可导入的连接/,
  );
});

test('stdio 描述校验、SSE 归一化与目录 env 密钥审计', () => {
  const descriptor = normalizeConnectorDescriptor({
    id: 'local-tools', name: 'Local Tools', auth: { mode: 'none' },
    servers: [{ serverKey: 'main', transport: 'stdio', command: 'npx', args: ['-y', 'server'], serverName: 'local-tools' }],
  });
  assert.equal(descriptor.servers[0].transport, 'stdio');
  assert.equal(descriptor.servers[0].url, undefined);
  assert.throws(() => normalizeConnectorDescriptor({
    id: 'bad', name: 'Bad', servers: [{ serverKey: 'main', transport: 'stdio', serverName: 'bad' }],
  }), /command 必填/);
  assert.equal(normalizeConnectorDescriptor({
    id: 'legacy', name: 'Legacy', servers: [{ serverKey: 'main', transport: 'sse', url: 'https://mcp.example.com/sse', serverName: 'legacy' }],
  }).servers[0].transport, 'streamable-http');
  assert.throws(() => auditDescriptor(normalizeConnectorDescriptor({
    id: 'secret-env', name: 'Secret env', auth: { mode: 'none' },
    servers: [{ serverKey: 'main', transport: 'stdio', command: 'npx', env: { GITHUB_TOKEN: 'x' }, serverName: 'secret-env' }],
  })), /env.*密钥类变量/);
});

test('旧 connection record 的 SSE 归一化，stdio 字段保留', () => {
  const base = { key: 'x', connectorId: 'x', kind: 'json', name: 'X', serverName: 'x', createdAt: 1, updatedAt: 1 };
  assert.equal(normalizeConnectionRecord({ ...base, transport: 'sse', url: 'https://mcp.example.com/sse' }).transport, 'streamable-http');
  const stdio = normalizeConnectionRecord({ ...base, transport: 'stdio', command: 'uvx', args: ['server'], env: { MODE: 'test' } });
  assert.equal(stdio.command, 'uvx');
  assert.deepEqual(stdio.env, { MODE: 'test' });
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

test('buildManualRecord: stdio 不要求 URL 并透传本机进程字段', () => {
  const record = buildManualRecord({
    name: 'Local MCP', transport: 'stdio', command: 'npx', args: ['-y', 'server'],
    envJson: { SERVICE_TOKEN: 'local-only' }, cwd: '/tmp',
  });
  assert.equal(record.transport, 'stdio');
  assert.equal(record.url, undefined);
  assert.equal(record.command, 'npx');
  assert.deepEqual(record.args, ['-y', 'server']);
  assert.deepEqual(record.env, { SERVICE_TOKEN: 'local-only' });
  assert.throws(() => buildManualRecord({ name: 'Bad', transport: 'stdio' }), /command 必填/);
});

test('buildEntryConfig: stdio 仅透传进程字段，不混入 HTTP headers', () => {
  const config = buildEntryConfig({
    transport: 'stdio', serverName: 'local', command: 'uvx', args: ['server'],
    env: { MODE: 'test' }, cwd: '/tmp', headers: { Authorization: 'should-not-pass' },
  }, new Map());
  assert.deepEqual(config, {
    transport: 'stdio', serverName: 'local', command: 'uvx', args: ['server'],
    env: { MODE: 'test' }, cwd: '/tmp', failOnStartupError: false,
  });
});

test('OAuth protected resource metadata fallback 保留 MCP 路径', () => {
  assert.equal(
    resourceMetadataUrlFallback('https://agent.example.com/mcp/company/stream'),
    'https://agent.example.com/mcp/.well-known/oauth-protected-resource/company/stream',
  );
});
