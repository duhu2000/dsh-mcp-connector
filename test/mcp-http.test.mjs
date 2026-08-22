import test from 'node:test';
import assert from 'node:assert/strict';
import { listMcpTools } from '../lib/mcp-http.js';

const record = {
  transport: 'streamable-http',
  url: 'https://mcp.example.com/mcp',
  auth: { mode: 'none' },
};

function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(value === undefined ? undefined : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('tools/list 拒绝服务端重复返回同一分页游标', async () => {
  let listRequests = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method === 'DELETE') return new Response(undefined, { status: 204 });
    const body = JSON.parse(options.body);
    if (body.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'loop', version: '1' } },
      }, { headers: { 'Mcp-Session-Id': 'loop-session' } });
    }
    if (body.method === 'notifications/initialized') return new Response(undefined, { status: 202 });
    listRequests += 1;
    return jsonResponse({
      jsonrpc: '2.0',
      id: body.id,
      result: { tools: [{ name: `tool-${listRequests}` }], nextCursor: 'same-cursor' },
    });
  };

  await assert.rejects(
    listMcpTools(record, { fetchImpl }),
    /重复分页游标/,
  );
  assert.equal(listRequests, 2);
});

test('initialized 通知被服务端拒绝时停止 tools/list', async () => {
  const methods = [];
  const fetchImpl = async (_url, options) => {
    if (options.method === 'DELETE') return new Response(undefined, { status: 204 });
    const body = JSON.parse(options.body);
    methods.push(body.method);
    if (body.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'reject', version: '1' } },
      }, { headers: { 'Mcp-Session-Id': 'reject-session' } });
    }
    return jsonResponse({ error: { code: -32000, message: 'session not ready' } }, { status: 400 });
  };

  await assert.rejects(
    listMcpTools(record, { fetchImpl }),
    /HTTP 400/,
  );
  assert.deepEqual(methods, ['initialize', 'notifications/initialized']);
});
