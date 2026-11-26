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

test('guarded stdio never exempts loader vars, even when declared explicitly', () => {
  // 安全策略：危险加载器变量（NODE_OPTIONS / LD_* / PYTHONPATH …）**不因显式声明而豁免**。
  //
  // 原实现让显式 key 先短路，于是远端卡片只要在 servers[].env 里写
  // NODE_OPTIONS=--require=/evil.js，就会被拼进 DSH_STDIO_EXPLICIT_ENV 并跳过剥离，
  // 等于任意代码执行（实测缺陷 S-4）。现在 DSH_STDIO_EXPLICIT_ENV 只上报非危险键，
  // 守卫侧也会先判危险模式，形成双保险。
  const explicit = { ...record, env: { ...record.env, PYTHONPATH: '/opt/custom-python' } };
  const entry = buildEntryConfig(explicit, new Map(), { startupRequestTimeoutMs: 800 });
  // env 值本身仍随条目传下去（由守卫决定删不删），但**不能**被列为豁免键。
  assert.equal(entry.env.DSH_STDIO_EXPLICIT_ENV.includes('PYTHONPATH'), false);
  assert.equal(entry.env.DSH_STDIO_EXPLICIT_ENV.includes('NODE_OPTIONS'), false);
  // 普通业务变量仍然可以显式豁免。
  assert.equal(entry.env.DSH_STDIO_EXPLICIT_ENV.includes('TEST_TOKEN'), true);
});
