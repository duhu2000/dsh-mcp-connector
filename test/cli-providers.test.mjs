import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CLI_PROVIDERS,
  cliBridgeArgs,
  buildCliInvocation,
  buildCliPreflightInvocation,
  executeCliProviderTool,
  handleCliBridgeRequest,
  listCliProviderTools,
  redactCliError,
  runCliProcess,
  resolveCliExecutable,
} from '../lib/cli-providers.js';

test('仅升级精确匹配的旧市场桥接，不覆盖用户自定义命令', () => {
  const record = { connectorId: 'dingtalk', command: 'npx', args: [
    '--yes', '--legacy-peer-deps', '--package', 'dsh-mcp-connector@0.2.48',
    '--package', 'dingtalk-workspace-cli@1.0.61', 'dsh-mcp-cli-bridge', '--provider', 'dingtalk-dws',
  ] };
  assert.ok(cliBridgeArgs(record).includes('dsh-mcp-connector@0.2.55'));
  assert.ok(cliBridgeArgs({ ...record, args: record.args.map((arg) => arg.replace('@0.2.48', '@0.2.49')) }).includes('dsh-mcp-connector@0.2.55'));
  assert.ok(record.args.includes('dsh-mcp-connector@0.2.48'));
  for (const changed of [{ connectorId: 'custom' }, { command: '/custom/npx' }, { args: [...record.args, '--custom'] }]) {
    const custom = { ...record, ...changed };
    assert.deepEqual(cliBridgeArgs(custom), custom.args);
  }
});

test('Windows 解析全局及 npx 官方包，保留带空格绝对路径，不执行 cmd shim', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cli provider 中文 '));
  try {
    for (const layout of ['global', 'npx']) {
      const prefix = path.join(temp, layout);
      const root = path.join(prefix, 'node_modules', 'dingtalk-workspace-cli');
      const bin = layout === 'global' ? prefix : path.join(prefix, 'node_modules', '.bin');
      mkdirSync(path.join(root, 'vendor'), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(path.join(bin, 'dws.cmd'), '@echo SHOULD_NOT_EXECUTE');
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dingtalk-workspace-cli', bin: { dws: 'bin/dws.js' } }));
      const native = path.join(root, 'vendor', 'dws.exe');
      copyFileSync(process.execPath, native);
      // Preserve the Windows runtime environment; do not inherit Node test IPC mode.
      const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !['path', 'node_test_context', 'node_options'].includes(key.toLowerCase()))), Path: `;relative;"${bin}"` };
      assert.equal(resolveCliExecutable('dws', { platform: 'win32', env }), realpathSync(native));
      assert.equal(buildCliPreflightInvocation('dingtalk-dws', { executable: native }).command, native);
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'not-the-approved-provider', bin: { dws: 'bin/dws.js' } }));
      assert.throws(() => resolveCliExecutable('dws', { platform: 'win32', env }), /CLI_NATIVE_MISSING/);
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dingtalk-workspace-cli', bin: { dws: 'bin/dws.js' } }));
      if (process.platform === 'win32') {
        console.error(`CLI fixture ${layout}: starting native argv check`);
        const marker = '中文 space & | %PATH% ^ " quote';
        const result = await runCliProcess('dws', ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', marker], { env });
        assert.deepEqual(JSON.parse(result), [marker]);
        console.error(`CLI fixture ${layout}: starting timeout check`);
        await assert.rejects(runCliProcess('dws', ['-e', 'setInterval(()=>{},100)'], { env, timeoutMs: 1000 }), /timed out/);
        console.error(`CLI fixture ${layout}: process checks complete`);
      }
      rmSync(native, { recursive: true, maxRetries: 10, retryDelay: 100 });
      assert.throws(() => resolveCliExecutable('dws', { platform: 'win32', env }), /CLI_NATIVE_MISSING/);
    }
    assert.throws(() => resolveCliExecutable('dws', { platform: 'win32', env: { PATH: '' } }), /CLI_NOT_FOUND/);
    assert.throws(() => resolveCliExecutable('dws.cmd', { platform: 'win32' }), /CLI_SHIM_UNSUPPORTED/);
    assert.equal(resolveCliExecutable('dws', { platform: 'darwin' }), 'dws');
    assert.equal(resolveCliExecutable('dws', { platform: 'linux' }), 'dws');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('钉钉 CLI Provider 只暴露只读命令', () => {
  const forbidden = new Set(['create', 'update', 'delete', 'send', 'approve', 'reject', 'revoke', 'upload']);
  assert.ok(CLI_PROVIDERS['dingtalk-dws'].tools.length >= 10);
  for (const tool of CLI_PROVIDERS['dingtalk-dws'].tools) {
    assert.equal(tool.readOnly, true);
    assert.equal(tool.command.some((part) => forbidden.has(part)), false, tool.name);
  }
  assert.ok(listCliProviderTools('dingtalk-dws').every((tool) => tool.annotations.readOnlyHint));
});

test('构建 dws 参数时不经 shell 且仅接受声明字段', () => {
  const invocation = buildCliInvocation('dingtalk-dws', 'dingtalk_search_users', {
    profile: 'corp:user',
    query: '研发部; rm -rf /',
  });
  assert.equal(invocation.command, 'dws');
  assert.deepEqual(invocation.args, [
    '--profile', 'corp:user', 'contact', 'user', 'search', '--query', '研发部; rm -rf /', '--format', 'json',
  ]);
  assert.throws(
    () => buildCliInvocation('dingtalk-dws', 'dingtalk_search_users', { query: '研发部', shell: true }),
    /unknown tool arguments/,
  );
  assert.throws(
    () => buildCliInvocation('dingtalk-dws', 'dingtalk_search_users', { query: '研发部\nwhoami' }),
    /control characters/,
  );
});

test('列表参数、分页和布尔过滤生成稳定 dws argv', () => {
  assert.deepEqual(
    buildCliInvocation('dingtalk-dws', 'dingtalk_get_users', { ids: ['u1', 'u2'] }).args,
    ['contact', 'user', 'get', '--ids', 'u1,u2', '--format', 'json'],
  );
  assert.deepEqual(
    buildCliInvocation('dingtalk-dws', 'dingtalk_list_todos', { page: 2, size: 10, completed: false }).args,
    ['todo', 'task', 'list', '--page', '2', '--size', '10', '--status', 'false', '--format', 'json'],
  );
  assert.throws(
    () => buildCliInvocation('dingtalk-dws', 'dingtalk_list_todos', { size: 101 }),
    /must be <= 100/,
  );
  assert.deepEqual(
    buildCliInvocation('dingtalk-dws', 'dingtalk_search_documents', { query: '项目计划' }).args,
    ['drive', 'search', '--query', '项目计划', '--format', 'json'],
  );
  assert.deepEqual(
    buildCliInvocation('dingtalk-dws', 'dingtalk_list_reports', {
      start: '2026-09-01T00:00:00+08:00',
      end: '2026-09-15T23:59:59+08:00',
      size: 20,
    }).args,
    [
      'report', 'inbox', 'list',
      '--start', '2026-09-01T00:00:00+08:00',
      '--end', '2026-09-15T23:59:59+08:00',
      '--size', '20', '--format', 'json',
    ],
  );
  assert.throws(
    () => buildCliInvocation('dingtalk-dws', 'dingtalk_list_pending_approvals', {
      start: '2026-09-01T00:00:00+08:00',
    }),
    /missing required argument: end/,
  );
  assert.throws(
    () => buildCliInvocation('dingtalk-dws', 'dingtalk_list_reports', {
      start: '2026-09-01T00:00:00+08:00',
      end: '2026-09-15T23:59:59+08:00',
      size: 21,
    }),
    /must be <= 20/,
  );
});

test('执行器使用注入 runner 并把 JSON 结果返回 MCP 内容', async () => {
  const calls = [];
  const result = await executeCliProviderTool('dingtalk-dws', 'dingtalk_get_current_user', {}, {
    runner: async (command, args) => {
      calls.push({ command, args });
      return '{"name":"测试用户"}';
    },
  });
  assert.deepEqual(calls, [{ command: 'dws', args: ['contact', 'user', 'get-self', '--format', 'json'] }]);
  assert.match(result.content[0].text, /测试用户/);
});

test('钉钉 Provider 在枚举工具前检查官方 OAuth 状态', async () => {
  assert.deepEqual(buildCliPreflightInvocation('dingtalk-dws'), {
    command: 'dws',
    args: ['auth', 'status', '--format', 'json'],
  });
  const unavailable = await handleCliBridgeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
    preflight: async () => { throw new Error('access_token=must-not-leak 请先登录'); },
  });
  assert.equal(unavailable.error.code, -32001);
  assert.match(unavailable.error.message, /请先登录/);
  assert.doesNotMatch(unavailable.error.message, /must-not-leak/);
});

test('MCP JSON-RPC 支持 initialize、tools/list 和 tools/call', async () => {
  const initialized = await handleCliBridgeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(initialized.result.serverInfo.name, 'dsh-mcp-cli-bridge/dingtalk-dws');
  const listed = await handleCliBridgeRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, {
    preflight: async () => {},
  });
  assert.ok(listed.result.tools.some((tool) => tool.name === 'dingtalk_search_documents'));
  const called = await handleCliBridgeRequest({
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dingtalk_list_todos', arguments: {} },
  }, {
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
  });
  assert.equal(called.result.content[0].text, 'ok');
});

test('OAuth 状态查询成功不等于已授权：未明确授权时不暴露工具', async () => {
  const cases = [
    { success: true, authenticated: false },
    { success: true },
    { success: true, authenticated: 'true' },
    { success: false, authenticated: true },
    { authenticated: true },
    null, [], 'invalid-json',
  ];
  for (const status of cases) {
    const result = await handleCliBridgeRequest({ id: 1, method: 'tools/list' }, {
      runner: async () => typeof status === 'string' ? status : JSON.stringify(status),
    });
    assert.equal(result.error.code, -32001, JSON.stringify(status));
    assert.equal(result.result, undefined);
  }
});

test('明确授权才列出工具，退出登录后重新枚举立即失败且不泄露状态', async () => {
  let authenticated = true;
  const options = { runner: async () => JSON.stringify({
    success: true, authenticated, message: 'private-identity', access_token: 'private-token',
  }) };
  const ready = await handleCliBridgeRequest({ id: 1, method: 'tools/list' }, options);
  assert.equal(ready.result.tools.length, 11);
  authenticated = false;
  const unavailable = await handleCliBridgeRequest({ id: 2, method: 'tools/list' }, options);
  assert.equal(unavailable.error.code, -32001);
  assert.match(unavailable.error.message, /auth login/);
  assert.doesNotMatch(JSON.stringify([ready, unavailable]), /private-identity|private-token/);
});

test('CLI 错误输出脱敏', () => {
  const redacted = redactCliError('client_secret=abc access_token:xyz "refreshToken": "json-secret" Authorization: Bearer token-value');
  assert.doesNotMatch(redacted, /abc|xyz|json-secret|token-value/);
  assert.match(redacted, /REDACTED/);
});

test('CLI 成功输出如意外含 Token 也不返回 Host', async () => {
  const result = await executeCliProviderTool('dingtalk-dws', 'dingtalk_get_current_user', {}, {
    runner: async () => '{"name":"测试用户","access_token":"must-not-leak"}',
  });
  assert.match(result.content[0].text, /测试用户/);
  assert.doesNotMatch(result.content[0].text, /must-not-leak/);
  assert.match(result.content[0].text, /REDACTED/);
});

test('缺失 CLI 命令返回可操作诊断', async () => {
  await assert.rejects(
    runCliProcess('definitely-missing-dws-command-for-test', [], { timeoutMs: 1000 }),
    /请先完成安装和 OAuth 登录/,
  );
});
