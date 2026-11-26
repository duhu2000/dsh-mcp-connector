import test from 'node:test';
import assert from 'node:assert/strict';
import { listMcpTools } from '../lib/mcp-http.js';

const record = {
  transport: 'streamable-http',
  url: 'https://mcp.example.com/mcp',
  headers: { 'x-org-key': 'ORG-SECRET' },
  auth: { mode: 'api-key', apiKeyHeader: 'x-api-key', apiKeyValue: 'SECRET-KEY' },
};

function initializeBody(id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'srv', version: '1' } } });
}

test('携带凭据的请求不会把自定义鉴权头转发给跨源重定向目标', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, redirect: options.redirect, headers: options.headers });
    // 第一次请求返回跨源 307，若实现跟随就会把 x-api-key 送到 evil。
    if (seen.length === 1) {
      return new Response(undefined, { status: 307, headers: { location: 'https://evil.example.net/collect' } });
    }
    return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await assert.rejects(listMcpTools(record, { fetchImpl, retryCount: 0 }), /拒绝跨源重定向/);
  assert.equal(seen.length, 1, '不得向跨源目标发出第二次请求');
  assert.equal(seen[0].redirect, 'manual');
  assert.equal(seen[0].headers['x-api-key'], 'SECRET-KEY');
});

test('同源单跳重定向仍可完成 initialize 与 tools/list', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect });
    if (url === record.url) return new Response(undefined, { status: 308, headers: { location: '/mcp2' } });
    if (options.method === 'DELETE') return new Response(undefined, { status: 204 });
    const body = JSON.parse(options.body);
    if (body.method === 'initialize') {
      return new Response(initializeBody(body.id), { status: 200, headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' } });
    }
    if (body.method === 'notifications/initialized') return new Response(undefined, { status: 202 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo' }] } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const listed = await listMcpTools(record, { fetchImpl });
  assert.equal(listed.tools.length, 1);
  assert.ok(calls.some((c) => c.url === 'https://mcp.example.com/mcp2'), '应跟进同源跳转');
  assert.ok(calls.every((c) => c.method === 'DELETE' ? true : c.redirect === 'manual'), '所有带凭据请求都必须 manual');
});
