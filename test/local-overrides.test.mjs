import test from 'node:test';
import assert from 'node:assert/strict';
import { editableLocalOverrides, normalizeLocalOverrides, effectiveLocalRecord, supportsLocalOverrides } from '../lib/local-overrides.js';
import { normalizeConnectionRecord, connectionSnapshotSchema } from '../lib/schema.js';
import { buildEntryConfig } from '../lib/mcp-provision.js';
import { exportRedactedConnections } from '../lib/connection-backup.js';
import { connectionToolCacheSignature } from '../lib/tool-catalog-cache.js';

const base = { key: 'local-main', connectorId: 'local', serverKey: 'main', kind: 'manual', name: 'Local', serverName: 'local', transport: 'stdio', command: 'node', args: ['server.js'], env: { LOG_LEVEL: 'info' }, cwd: '/base', createdAt: 1, updatedAt: 1 };

test('local overlay composes without mutating registry defaults and survives storage', () => {
  const record = normalizeConnectionRecord({ ...base, localOverrides: { argsAppend: ['/private/path'], env: { LOG_LEVEL: 'debug', TOKEN: 'synthetic-secret' }, cwd: '/private/cwd' } });
  const original = structuredClone(record);
  const config = buildEntryConfig(record, new Map());
  assert.deepEqual(config.args, ['server.js', '/private/path']);
  assert.deepEqual(config.env, { LOG_LEVEL: 'debug', TOKEN: 'synthetic-secret' });
  assert.equal(config.cwd, '/private/cwd');
  assert.deepEqual(record, original);
  assert.deepEqual(record.args, base.args);
  assert.deepEqual(record.localOverrides, original.localOverrides);
  const snapshot = connectionSnapshotSchema.parse({ key: 's', createdAt: 1, updatedAt: 1, reason: 'test', targetKeys: [base.key], absentKeys: [], records: [record] });
  assert.deepEqual(snapshot.records[0].localOverrides, record.localOverrides);
});

test('editable and portable views never expose existing local values', () => {
  const record = { ...base, localOverrides: { argsAppend: ['synthetic-secret'], env: { TOKEN: 'synthetic-secret' }, cwd: '/private/path' } };
  const view = editableLocalOverrides(record);
  assert.doesNotMatch(view, /synthetic-secret|private\/path/);
  assert.deepEqual(normalizeLocalOverrides(record, view), record.localOverrides);
  const exported = JSON.stringify(exportRedactedConnections([record]));
  assert.doesNotMatch(exported, /synthetic-secret|private\/path|\/base/);
  assert.match(exported, /TOKEN/);
  assert.deepEqual(normalizeLocalOverrides(record, '{}'), {});
  assert.deepEqual(effectiveLocalRecord({ ...record, localOverrides: undefined }), { ...record, localOverrides: undefined });
});

test('invalid overlays fail closed without reflecting submitted values', () => {
  for (const input of ['{secret', { command: 'synthetic-secret' }, { argsAppend: [12] }, { env: { TOKEN: 1 } }, { env: { ELECTRON_RUN_AS_NODE: '1' } }, JSON.parse('{"env":{"__proto__":"x"}}'), { argsAppend: ['x\0'] }, { env: { TOKEN: '\0' } }, { cwd: '\0' }, { argsAppend: ['x', '<KEEP_EXISTING>'] }, { env: { TOKEN: '<KEEP_EXISTING>' } }]) {
    assert.throws(() => normalizeLocalOverrides(base, input), (error) => !error.message.includes('synthetic-secret'));
  }
});

test('HTTP, custom, JSON, OAuth and CLI entries cannot acquire local overlays', () => {
  for (const patch of [{ transport: 'streamable-http', url: 'https://example.com/mcp' }, { connectorId: '__custom__' }, { connectorId: '__json__' }, { connectorId: 'dingtalk' }, { auth: { mode: 'oauth', grantKey: 'g' } }, { oauthTokenEnv: 'TOKEN' }]) {
    const record = { ...base, ...patch, localOverrides: { argsAppend: ['x'] } };
    assert.equal(supportsLocalOverrides(record), false);
    assert.throws(() => normalizeConnectionRecord(record));
    assert.throws(() => buildEntryConfig(record, new Map()));
  }
});

test('any effective overlay change invalidates the cached tool identity', () => {
  const signature = connectionToolCacheSignature(base);
  for (const localOverrides of [{ argsAppend: ['x'] }, { env: { TOKEN: 'a' } }, { cwd: '/other' }]) {
    assert.notEqual(connectionToolCacheSignature({ ...base, localOverrides }), signature);
  }
  assert.notEqual(connectionToolCacheSignature({ ...base, localOverrides: { env: { TOKEN: 'a' } } }), connectionToolCacheSignature({ ...base, localOverrides: { env: { TOKEN: 'b' } } }));
});
