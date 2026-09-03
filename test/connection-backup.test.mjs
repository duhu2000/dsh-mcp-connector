import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACTED_LOCAL_VALUE,
  REDACTED_VALUE,
  exportRedactedConnections,
  snapshotPublicSummary,
  unresolvedRedactions,
} from '../lib/connection-backup.js';
import { normalizeJsonImport } from '../lib/connectors/json-connector.js';
import { SnapshotStore, defineConnectorDomain } from '../lib/stores.js';

function record(overrides = {}) {
  return {
    key: 'custom-demo',
    connectorId: '__custom__',
    kind: 'manual',
    name: 'Demo',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    serverName: 'demo',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test('脱敏导出不包含凭据、OAuth Grant、stdio 参数或本地路径', () => {
  const records = [
    record({
      key: 'http',
      name: '/Users/qcc/private/demo',
      url: 'https://user:password@example.com/mcp?token=url-secret#fragment',
      headers: { 'X-Static-Secret': 'header-secret' },
      auth: { mode: 'bearer', bearerToken: 'bearer-secret' },
    }),
    record({
      key: 'stdio',
      transport: 'stdio',
      url: undefined,
      command: '/Users/qcc/bin/private-mcp',
      args: ['--token', 'argument-secret'],
      env: { VENDOR_TOKEN: 'env-secret' },
      cwd: '/Users/qcc/private/worktree',
      serverName: 'stdio-demo',
      headers: {},
    }),
    record({
      key: 'oauth',
      connectorId: 'oauth-demo',
      auth: { mode: 'oauth', grantKey: 'grant:secret-account:secret-key' },
      serverKey: 'company',
      serverName: 'oauth-company',
    }),
  ];

  const exported = exportRedactedConnections(records, { exportedAt: 0 });
  const text = JSON.stringify(exported);
  for (const secret of [
    'password', 'url-secret', 'header-secret', 'bearer-secret', 'argument-secret',
    'env-secret', '/Users/qcc', 'grant:secret-account:secret-key',
  ]) assert.doesNotMatch(text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(exported.connections.length, 2);
  assert.equal(exported.oauthConnections.length, 1);
  assert.equal(exported.connections[0].url, REDACTED_VALUE);
  assert.equal(exported.connections[1].command, REDACTED_LOCAL_VALUE);
});

test('脱敏导出可回填凭据后再次导入，未回填时整体拒绝', () => {
  const exported = exportRedactedConnections([
    record({ auth: { mode: 'api-key', apiKeyHeader: 'X-Api-Key', apiKeyValue: 'original-secret' } }),
  ]);
  assert.throws(() => normalizeJsonImport(exported), /脱敏导出仍有 1 个待补值/);

  exported.connections[0].apiKeyValue = 'replacement-secret';
  const { records } = normalizeJsonImport(exported);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].auth, {
    mode: 'api-key',
    apiKeyHeader: 'X-Api-Key',
    apiKeyValue: 'replacement-secret',
  });
});

test('快照公开摘要只暴露恢复范围与 OAuth 可恢复性', () => {
  const snapshot = {
    key: 'snapshot-1',
    createdAt: 1,
    reason: 'disconnect',
    targetKeys: ['oauth'],
    absentKeys: [],
    records: [record({ key: 'oauth', auth: { mode: 'oauth', grantKey: 'grant-secret' } })],
  };
  const unavailable = snapshotPublicSummary(snapshot, new Map());
  assert.equal(unavailable.restorable, false);
  assert.equal(unavailable.requiresReauthorization, true);
  assert.doesNotMatch(JSON.stringify(unavailable), /grant-secret/);

  const available = snapshotPublicSummary(snapshot, new Map([['grant-secret', { needsReauth: false }]]));
  assert.equal(available.restorable, true);
  assert.deepEqual(unresolvedRedactions({ a: REDACTED_VALUE, b: [REDACTED_LOCAL_VALUE] }), ['$.a', '$.b[0]']);
});

test('快照表保持 storage domain v1 兼容并只保留最新 20 个', async () => {
  const spec = defineConnectorDomain();
  assert.equal(spec.version, 1);
  assert.ok(spec.tables.snapshots);
  assert.ok(spec.tables.governance, '治理表与现有 storage domain 保持 v1 兼容');
  assert.ok(spec.tables.connection_scopes, '连接作用域表与现有 storage domain 保持 v1 兼容');

  const records = new Map();
  const table = {
    async get(key) { return records.get(key); },
    async put(key, value) { records.set(key, value); },
    async delete(key) { return records.delete(key); },
    entries() { return records.entries(); },
  };
  const store = new SnapshotStore({ tables: new Map([['snapshots', table]]) });
  for (let index = 0; index < 21; index += 1) {
    await store.put({ key: `snapshot-${index}`, createdAt: index, updatedAt: index, reason: 'test', targetKeys: [], records: [], absentKeys: [] });
  }
  await store.trim(20);
  assert.equal(records.size, 20);
  assert.equal(records.has('snapshot-0'), false);
  assert.equal(records.has('snapshot-20'), true);
});
