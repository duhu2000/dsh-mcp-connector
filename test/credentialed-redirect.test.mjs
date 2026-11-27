/**
 * 携凭据重定向的行为回归。
 *
 * 覆盖评审提出的三类问题：
 *   1. 301/302/303 必须按 Fetch 规范改用 GET 并丢弃请求体（不能把 POST 重发过去）；
 *   2. 会话关闭（DELETE）在同源跳转后必须真正到达端点；
 *   3. 超出跳数上限时，每一个被放弃的 3xx 响应体都要被取消（连接不泄漏）。
 * 另外断言跨源仍然一律拒绝，且拒绝会被归类成 redirect 而不是 network。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { listMcpTools } from '../lib/mcp-http.js';
import { validateConnectionRecord } from '../lib/mcp-validation.js';

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1,
  result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'srv', version: '1' } },
});

/** 启动一个记录请求的 HTTP server，返回 { base, requests, close }。 */
async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const entry = {
        method: req.method,
        url: req.url,
        body,
        sessionId: req.headers['mcp-session-id'] ?? null,
        apiKey: req.headers['x-api-key'] ?? null,
      };
      requests.push(entry);
      handler(entry, req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body ?? '');
}

/** 标准 streamable-http 会话端点。 */
function mcpSession(res, body, sessionId = 'sess-1') {
  let message = {};
  try { message = JSON.parse(body); } catch {}
  if (message.method === 'initialize') return reply(res, 200, initBody, { 'mcp-session-id': sessionId });
  if (message.method === 'notifications/initialized') return reply(res, 202, '');
  return reply(res, 200, JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo' }] } }));
}

test('同源 303 之后连接校验按 Fetch 规范改用 GET', async () => {
  const server = await startServer(({ url, method }, req, res) => {
    if (url === '/mcp') return reply(res, 303, '', { location: '/mcp2' });
    if (url === '/mcp2') {
      // 303 语义要求 GET；若仍发 POST 则按规范返回 405。
      if (method !== 'GET') return reply(res, 405, JSON.stringify({ error: 'method not allowed' }));
      return reply(res, 200, initBody);
    }
    return reply(res, 404, '{}');
  });
  try {
    const record = { transport: 'streamable-http', url: `${server.base}/mcp`, auth: { mode: 'none' } };
    const result = await validateConnectionRecord(record, { timeoutMs: 4000 });
    assert.equal(result.ok, true, `303 后校验应通过，实际：${result.kind} ${result.message}`);
    assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), ['POST /mcp', 'GET /mcp2']);
  } finally { await server.close(); }
});

test('301/302/303 改用 GET 并丢弃请求体，307/308 保留 POST 与请求体', async () => {
  for (const [status, expectedMethod] of [[301, 'GET'], [302, 'GET'], [303, 'GET'], [307, 'POST'], [308, 'POST']]) {
    const server = await startServer(({ url, body }, req, res) => {
      if (url === '/mcp') return reply(res, status, '', { location: '/mcp2' });
      return mcpSession(res, body);
    });
    try {
      const record = { transport: 'streamable-http', url: `${server.base}/mcp`, auth: { mode: 'none' } };
      await listMcpTools(record, { timeoutMs: 4000, retryCount: 0 }).catch(() => {});
      const hop = server.requests.find((r) => r.url === '/mcp2');
      assert.ok(hop, `${status} 应跟随同源跳转`);
      assert.equal(hop.method, expectedMethod, `${status} 后方法应为 ${expectedMethod}`);
      if (expectedMethod === 'GET') assert.equal(hop.body, '', `${status} 后不应携带请求体`);
      else assert.notEqual(hop.body, '', `${status} 后应保留请求体`);
    } finally { await server.close(); }
  }
});

test('同源跳转后会话关闭 DELETE 真正到达端点', async () => {
  const server = await startServer(({ method, url, body }, req, res) => {
    if (url === '/mcp') return reply(res, 308, '', { location: '/mcp2' });
    if (url === '/mcp2') {
      if (method === 'DELETE') return reply(res, 204);
      return mcpSession(res, body, 'sess-XYZ');
    }
    return reply(res, 404, '{}');
  });
  try {
    const record = { transport: 'streamable-http', url: `${server.base}/mcp`, auth: { mode: 'none' } };
    const listed = await listMcpTools(record, { timeoutMs: 4000, retryCount: 0 });
    assert.equal(listed.tools.length, 1);
    const deletes = server.requests.filter((r) => r.method === 'DELETE');
    assert.equal(deletes.length, 2, '应发出两次 DELETE（原地址 + 跳转地址）');
    assert.equal(deletes[0].url, '/mcp');
    assert.equal(deletes[1].url, '/mcp2', 'DELETE 必须跟到真实端点');
    assert.equal(deletes[1].sessionId, 'sess-XYZ', 'DELETE 必须带会话 ID');
  } finally { await server.close(); }
});

test('超出跳数上限时所有被放弃的响应体都被取消', async () => {
  const server = await startServer(({ url }, req, res) => {
    const next = `/hop${server.requests.length + 1}`;
    reply(res, 302, 'X'.repeat(256), { location: next });
  });
  const cancelled = [];
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    if (response.body) {
      const original = response.body.cancel.bind(response.body);
      response.body.cancel = (reason) => {
        cancelled.push(new URL(url).pathname);
        return original(reason);
      };
    }
    return response;
  };
  try {
    const record = { transport: 'streamable-http', url: `${server.base}/mcp`, auth: { mode: 'none' } };
    const result = await validateConnectionRecord(record, { timeoutMs: 4000, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'redirect', `应归类为重定向问题，实际 ${result.kind}`);
    assert.equal(server.requests.length, 2, '同源最多只允许跟随 1 跳');
    assert.deepEqual(cancelled, ['/mcp', '/hop2'], '首个与第二个 3xx 响应体都必须取消');
  } finally { await server.close(); }
});

test('跨源重定向仍然拒绝，且不向第三方送出任何凭据', async () => {
  const evil = await startServer((ctx, req, res) => reply(res, 200, 'stolen'));
  const server = await startServer((ctx, req, res) => reply(res, 307, '', { location: `${evil.base}/collect` }));
  try {
    const record = {
      transport: 'streamable-http',
      url: `${server.base}/mcp`,
      auth: { mode: 'api-key', apiKeyHeader: 'x-api-key', apiKeyValue: 'SECRET-KEY' },
      headers: { 'x-org-key': 'ORG-SECRET' },
    };
    const result = await validateConnectionRecord(record, { timeoutMs: 4000 });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'redirect', `跨源拒绝应归类为 redirect，实际 ${result.kind}`);
    assert.equal(evil.requests.length, 0, '跨源目标不得收到任何请求');
    assert.equal(evil.requests.filter((r) => r.apiKey).length, 0, '不得泄露 x-api-key');
  } finally {
    await server.close();
    await evil.close();
  }
});

test('同源跳转仍受 assertConnectionUrl 约束（不允许跳到非白名单协议）', async () => {
  const server = await startServer((ctx, req, res) => {
    reply(res, 302, '', { location: 'ftp://127.0.0.1/data' });
  });
  try {
    const record = { transport: 'streamable-http', url: `${server.base}/mcp`, auth: { mode: 'none' } };
    const result = await validateConnectionRecord(record, { timeoutMs: 4000 });
    assert.equal(result.ok, false, 'ftp 目标必须被拒绝');
    assert.equal(server.requests.length, 1, '不得向非法协议目标发出请求');
  } finally { await server.close(); }
});
