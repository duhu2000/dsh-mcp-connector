import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildEntryConfig, provision } from '../lib/mcp-provision.js';

const guard = fileURLToPath(new URL('../lib/stdio-startup-guard.js', import.meta.url));
const record = { key: 'json-fixture', serverName: 'fixture', transport: 'stdio', command: 'fixture-node', args: ['server.js', '--flag'], cwd: '/fixture-workspace', env: { TEST_TOKEN: 'synthetic-token' }, enabled: true };

test('restored stdio entries bound startup work without changing the saved connection', () => {
  const original = structuredClone(record);
  const entry = buildEntryConfig(record, new Map(), { startupRequestTimeoutMs: 800 });
  assert.equal(entry.command, process.execPath);
  assert.deepEqual(entry.args, [guard, '--timeout-ms', '800', '--', record.command, ...record.args]);
  assert.equal(entry.cwd, record.cwd);
  assert.deepEqual(entry.env, record.env);
  assert.equal(entry.failOnStartupError, false);
  assert.deepEqual(record, original);
});

test('normal and strict provisioning preserve their existing transport contract', () => {
  for (const failOnStartupError of [false, true]) {
    const entry = buildEntryConfig(record, new Map(), { failOnStartupError });
    assert.equal(entry.command, record.command);
    assert.deepEqual(entry.args, record.args);
    assert.equal(entry.failOnStartupError, failOnStartupError);
  }
});

test('HTTP records do not acquire a stdio wrapper', () => {
  const entry = buildEntryConfig({ transport: 'streamable-http', serverName: 'remote', url: 'https://mcp.example.invalid', headers: { Authorization: 'synthetic' } }, new Map(), { startupRequestTimeoutMs: 800 });
  assert.equal(entry.command, undefined);
  assert.equal(entry.args, undefined);
  assert.equal(entry.url, 'https://mcp.example.invalid');
});

test('provision forwards the startup guard to the actual loader entry and keeps enabled state', async () => {
  let created;
  const ctx = { loader: { resolve() { throw new Error('missing'); }, async create(entry) { created = entry; } } };
  await provision(ctx, { entryPrefix: 'mcp' }, record, new Map(), { startupRequestTimeoutMs: 800 });
  assert.equal(created.id, 'mcp-json-fixture');
  assert.equal(created.disabled, false);
  assert.equal(created.config.args[0], guard);
});

test('guarded OAuth stdio tokens remain runtime-only and request budgets fail closed', () => {
  const oauth = { ...record, auth: { mode: 'oauth', grantKey: 'synthetic-grant' }, oauthTokenEnv: 'MCP_TOKEN' };
  const entry = buildEntryConfig(oauth, new Map([['synthetic-grant', { accessToken: 'synthetic-access' }]]), { startupRequestTimeoutMs: 800 });
  assert.equal(entry.env.MCP_TOKEN, 'Bearer synthetic-access');
  assert.equal(oauth.env.MCP_TOKEN, undefined);
  for (const timeout of [0, 99, Infinity, 2_147_483_648]) assert.throws(() => buildEntryConfig(record, new Map(), { startupRequestTimeoutMs: timeout }), RangeError);
});