import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConnectionError, validateConnectionRecord } from '../lib/mcp-validation.js';

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

function bearerRecord(url, token) {
  return {
    key: 'wind-stock',
    connectorId: 'wind-demo',
    kind: 'manual',
    name: 'Wind Demo',
    transport: 'streamable-http',
    url,
    serverName: 'wind-demo',
    headers: {},
    auth: { mode: 'bearer', bearerToken: token },
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

test('MCP 连接校验通过 initialize 鉴权后才返回成功', async () => {
  let seenAuthorization;
  const { server, url } = await listen(async (req, res) => {
    seenAuthorization = req.headers.authorization;
    for await (const _chunk of req) {}
    if (seenAuthorization !== 'Bearer valid-key') {
      res.writeHead(401); res.end(); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '1' } },
    }));
  });
  try {
    const result = await validateConnectionRecord(bearerRecord(url, 'valid-key'), { timeoutMs: 2000 });
    assert.equal(result.ok, true, result.message);
    assert.equal(seenAuthorization, 'Bearer valid-key');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('MCP 连接校验将 401 分类为凭据错误', async () => {
  const { server, url } = await listen(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(401); res.end();
  });
  try {
    const result = await validateConnectionRecord(bearerRecord(url, 'wrong-key'), { timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'auth');
    assert.match(result.message, /无效|权限/);
    assert.doesNotMatch(result.message, /wrong-key/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('MCP 健康检查可使用 OAuth grant 组装鉴权头', async () => {
  let seenAuthorization;
  const { server, url } = await listen(async (req, res) => {
    seenAuthorization = req.headers.authorization;
    for await (const _chunk of req) {}
    res.writeHead(seenAuthorization === 'Bearer oauth-token' ? 200 : 401, { 'content-type': 'application/json' });
    res.end(seenAuthorization === 'Bearer oauth-token' ? JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'oauth', version: '1' } },
    }) : '');
  });
  try {
    const record = { ...bearerRecord(url, ''), auth: { mode: 'oauth', grantKey: 'grant-1' } };
    const result = await validateConnectionRecord(record, {
      timeoutMs: 2000,
      grants: new Map([['grant-1', { accessToken: 'oauth-token' }]]),
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(seenAuthorization, 'Bearer oauth-token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('连接错误将 TLS reset 转为可操作的用户提示', () => {
  const cause = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' });
  const error = new TypeError('fetch failed', { cause });
  const result = classifyConnectionError(error);
  assert.equal(result.kind, 'tls');
  assert.match(result.message, /专线|VPN|IP 白名单/);
});

test('连接错误将 DNS 解析失败转为可操作提示', () => {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND nonexistent.invalid'), { code: 'ENOTFOUND' });
  const result = classifyConnectionError(new TypeError('fetch failed', { cause }));
  assert.equal(result.kind, 'dns');
  assert.match(result.message, /域名解析失败/);
});

test('stdio 启动错误区分命令缺失、退出码与启动超时', () => {
  const missing = classifyConnectionError(Object.assign(new Error('spawn uvx ENOENT'), { code: 'ENOENT' }), { transport: 'stdio' });
  assert.equal(missing.kind, 'process-not-found');
  assert.match(missing.message, /启动命令不存在/);

  const exited = classifyConnectionError(new Error('child process exited with code 7'), { transport: 'stdio' });
  assert.equal(exited.kind, 'process-exit');
  assert.equal(exited.exitCode, 7);
  assert.match(exited.message, /退出码 7/);

  const timeout = classifyConnectionError(Object.assign(new Error('startup timed out'), { code: 'ETIMEDOUT' }), { transport: 'stdio' });
  assert.equal(timeout.kind, 'timeout');
  assert.match(timeout.message, /启动或工具同步超时/);
});

test('stdio 健康检查交给 dsh-mcp-client 管理且不发 HTTP 请求', async () => {
  let fetched = false;
  const result = await validateConnectionRecord({
    ...bearerRecord(undefined, ''), transport: 'stdio', command: 'npx', args: ['server'], auth: undefined,
  }, { fetchImpl: async () => { fetched = true; throw new Error('不应调用'); } });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'managed');
  assert.equal(fetched, false);
});
