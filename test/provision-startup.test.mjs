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
  // 显式声明的 env 原样保留；另加内部标记让守卫区分「继承值 vs 连接级显式值」。
  assert.equal(entry.env.TEST_TOKEN, record.env.TEST_TOKEN);
  assert.equal(entry.env.DSH_STDIO_EXPLICIT_ENV, 'TEST_TOKEN');
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

test('desktop hosts start the guard as Node without leaking the switch to the server', () => {
  const original = structuredClone(record);
  process.versions.electron = '44.0.0';
  try {
    const guarded = buildEntryConfig(record, new Map(), { startupRequestTimeoutMs: 800 });
    assert.equal(guarded.command, process.execPath);
    assert.equal(guarded.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(guarded.env.TEST_TOKEN, 'synthetic-token');
    assert.notEqual(guarded.env, record.env);
    // 未加 guard 的路径不需要该变量，避免把它交给用户配置的 server
    assert.equal(buildEntryConfig(record, new Map(), {}).env.ELECTRON_RUN_AS_NODE, undefined);
    assert.deepEqual(record, original);
  } finally {
    delete process.versions.electron;
  }
  // CLI 宿主（node 进程）行为不变
  const cli = buildEntryConfig(record, new Map(), { startupRequestTimeoutMs: 800 });
  assert.equal(cli.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(cli.env.TEST_TOKEN, record.env.TEST_TOKEN);
  assert.equal(cli.env.DSH_STDIO_EXPLICIT_ENV, 'TEST_TOKEN');
});

test('guarded stdio keeps explicitly declared loader vars and drops inherited ones', () => {
  // 显式声明 PYTHONPATH：用户确实需要自定义解释器路径，守卫应保留。
  const explicit = { ...record, env: { ...record.env, PYTHONPATH: '/opt/custom-python' } };
  const entry = buildEntryConfig(explicit, new Map(), { startupRequestTimeoutMs: 800 });
  assert.equal(entry.env.PYTHONPATH, '/opt/custom-python');
  assert.equal(entry.env.DSH_STDIO_EXPLICIT_ENV.includes('PYTHONPATH'), true);
  // 未显式声明时，不额外注入该 key。
  assert.equal(entry.env.DSH_STDIO_EXPLICIT_ENV.includes('NODE_OPTIONS'), false);
});
