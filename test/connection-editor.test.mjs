import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEP_EXISTING_VALUE,
  connectionConfigurationEditable,
  editableConnectionConfiguration,
  normalizeConnectionReconfiguration,
} from '../lib/connection-editor.js';

const httpRecord = {
  key: 'json-demo',
  connectorId: '__json__',
  kind: 'json',
  name: 'Demo',
  transport: 'streamable-http',
  url: 'https://example.com/mcp?access_token=url-secret',
  serverName: 'demo',
  headers: { 'X-Tenant': 'tenant-secret' },
  auth: { mode: 'bearer', bearerToken: 'bearer-secret' },
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
};

test('安全编辑配置只返回保留标记，不泄露敏感值', () => {
  const editable = editableConnectionConfiguration(httpRecord);
  assert.equal(editable.key, 'json-demo');
  assert.equal(editable.serverName, 'demo');
  assert.match(editable.json, /<KEEP_EXISTING>/);
  assert.doesNotMatch(editable.json, /url-secret|tenant-secret|bearer-secret/);
  assert.deepEqual(editable.preservedFields.sort(), [
    'connections[0].bearerToken',
    'connections[0].headers.X-Tenant',
    'connections[0].url',
  ]);
});

test('保留标记在本机合并，同时允许修改非敏感配置和替换凭据', () => {
  const document = JSON.parse(editableConnectionConfiguration(httpRecord).json);
  document.connections[0].name = '生产数据';
  document.connections[0].url = 'https://new.example.com/mcp';
  document.connections[0].headers['X-Region'] = 'cn-east-1';
  document.connections[0].bearerToken = 'new-token';

  const next = normalizeConnectionReconfiguration(httpRecord, document);
  assert.equal(next.key, httpRecord.key);
  assert.equal(next.connectorId, httpRecord.connectorId);
  assert.equal(next.serverName, httpRecord.serverName);
  assert.equal(next.name, '生产数据');
  assert.equal(next.url, 'https://new.example.com/mcp');
  assert.deepEqual(next.headers, { 'X-Tenant': 'tenant-secret', 'X-Region': 'cn-east-1' });
  assert.deepEqual(next.auth, { mode: 'bearer', bearerToken: 'new-token' });
  assert.equal(next.enabled, true);
  assert.equal(next.createdAt, 1);
});

test('删除敏感字段可清除它，serverName 和市场连接身份不可编辑', () => {
  const document = JSON.parse(editableConnectionConfiguration(httpRecord).json);
  document.connections[0].url = 'https://example.com/mcp';
  document.connections[0].headers = {};
  document.connections[0].authMode = 'none';
  delete document.connections[0].bearerToken;
  const next = normalizeConnectionReconfiguration(httpRecord, document);
  assert.deepEqual(next.headers, {});
  assert.equal(next.auth, undefined);

  document.connections[0].serverName = 'other';
  assert.throws(() => normalizeConnectionReconfiguration(httpRecord, document), /serverName 是连接身份/);
  assert.equal(connectionConfigurationEditable({ ...httpRecord, connectorId: 'market-demo' }), false);
  assert.throws(
    () => editableConnectionConfiguration({ ...httpRecord, connectorId: 'market-demo' }),
    /市场连接器请使用配置或重新授权入口/,
  );
});

test('stdio 参数、环境变量与本地路径默认保留，也可以整体替换', () => {
  const current = {
    key: 'custom-local', connectorId: '__custom__', kind: 'manual', name: 'Local',
    transport: 'stdio', command: '/opt/local/bin/node', args: ['server.js', '--token', 'secret'],
    env: { API_TOKEN: 'env-secret', LOG_LEVEL: 'info' }, cwd: '/Users/example/private',
    serverName: 'local', headers: {}, enabled: false, createdAt: 10, updatedAt: 11,
  };
  const editable = editableConnectionConfiguration(current);
  assert.doesNotMatch(editable.json, /server\.js|secret|\/Users\/example|\/opt\/local/);
  const kept = normalizeConnectionReconfiguration(current, editable.json);
  assert.equal(kept.command, current.command);
  assert.deepEqual(kept.args, current.args);
  assert.deepEqual(kept.env, current.env);
  assert.equal(kept.cwd, current.cwd);
  assert.equal(kept.enabled, false);

  const document = JSON.parse(editable.json);
  document.connections[0].command = 'npx';
  document.connections[0].args = ['-y', 'new-server'];
  document.connections[0].env = { LOG_LEVEL: 'debug' };
  document.connections[0].cwd = '';
  const replaced = normalizeConnectionReconfiguration(current, document);
  assert.equal(replaced.command, 'npx');
  assert.deepEqual(replaced.args, ['-y', 'new-server']);
  assert.deepEqual(replaced.env, { LOG_LEVEL: 'debug' });
  assert.equal(replaced.cwd, '');
  assert.equal(replaced.url, undefined);
  assert.equal(replaced.auth, undefined);
});

test('无法对应原值的保留标记与多连接提交会被拒绝', () => {
  const invalid = { connections: [{ name: 'Demo', serverName: 'demo', transport: 'streamable-http', url: 'https://example.com/mcp', headers: { New: KEEP_EXISTING_VALUE } }] };
  assert.throws(() => normalizeConnectionReconfiguration(httpRecord, invalid), /没有可保留的原值/);
  assert.throws(
    () => normalizeConnectionReconfiguration(httpRecord, { connections: [invalid.connections[0], invalid.connections[0]] }),
    /只能提交当前这一条 connection/,
  );
});
