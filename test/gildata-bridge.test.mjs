import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createQueryAuthBridge } from '../lib/query-auth-bridge.js';

const KEY = 'local-test-key +/?&=中文';
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } };
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const call = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'FinQuery', arguments: { query: "恒生电子（600570）2025年年度营业收入和归母净利润" } } };

function fixture({ profile = 'gildata-finquery', answer, failure, sse = false } = {}) {
  const calls = [];
  const bridge = createQueryAuthBridge({ profile, apiKey: KEY, fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    assert.equal(new URL(url).searchParams.get('token'), KEY);
    assert.equal(new URL(url).origin, 'https://api.gildata.com');
    assert.equal(opts.redirect, 'error');
    if (opts.method === 'DELETE') return new Response(null, { status: 204 });
    const payload = JSON.parse(opts.body);
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (payload.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: KEY } };
    else {
      assert.equal(opts.headers['Mcp-Session-Id'], 'fake-session');
      if (failure) return failure(url, opts);
      result = answer ?? { tools: [{ name: 'FinQuery', description: KEY }], nextCursor: 'next-page' };
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result });
    return new Response(sse ? `data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: ${body}\n\n` : body,
      { headers: { 'content-type': sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'fake-session' } });
  } });
  return { bridge, calls };
}

test('GilData official endpoint preserve session, encode key and expose only tools', async () => {
  for (const profile of ['gildata-finquery']) {
    const { bridge, calls } = fixture({ profile });
    const initial = await bridge.handle(init);
    assert.deepEqual(initial.result.capabilities, { tools: {} });
    assert.equal(JSON.stringify(initial).includes(KEY), false);
    await bridge.handle(initialized);
    const listed = await bridge.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { cursor: 'page-two' } });
    assert.equal(listed.result.nextCursor, 'next-page');
    assert.equal(listed.result.tools[0].description, '[REDACTED]');
    assert.equal(JSON.parse(calls.at(-1).opts.body).params.cursor, 'page-two');
    assert.equal(new URL(calls[0].url).pathname, '/mcp-servers/aidata-assistant-srv-tool');
    await bridge.close();
    assert.equal(calls.at(-1).opts.method, 'DELETE');
  }
});

test('one caller request produces one tools/call; returned key is scrubbed', async () => {
  const { bridge, calls } = fixture({ answer: { content: [{ type: 'text', text: `secret=${encodeURIComponent(KEY)}` }] } });
  await bridge.handle(init); await bridge.handle(initialized);
  const response = await bridge.handle(call);
  assert.equal(response.id, 3);
  assert.deepEqual(JSON.parse(calls.at(-1).opts.body).params.arguments, call.params.arguments);
  assert.equal(response.result.content[0].text, 'secret=[REDACTED]');
  assert.equal(calls.filter(c => JSON.parse(c.opts.body).method === 'tools/call').length, 1);
});

test('HTTP, redirect, protocol and timeout failures never retry or echo credentials', async () => {
  const failures = [
    () => new Response(KEY, { status: 401 }),
    () => new Response(KEY, { status: 302, headers: { location: `https://other.invalid/?api_key=${encodeURIComponent(KEY)}` } }),
    () => { throw new Error(`timeout at ${KEY}`); },
    () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, error: { message: KEY } })),
  ];
  for (const failure of failures) {
    const { bridge, calls } = fixture({ failure });
    await bridge.handle(init); await bridge.handle(initialized);
    const response = await bridge.handle(call);
    assert.equal(response.error.code, -32000);
    assert.equal(JSON.stringify(response).includes(KEY), false);
    assert.equal(calls.filter(c => JSON.parse(c.opts.body).method === 'tools/call').length, 1);
  }
});

test('SSE matched response is supported', async () => {
  const { bridge } = fixture({ sse: true });
  assert.ok((await bridge.handle(init)).result);
  await bridge.handle(initialized);
  assert.ok((await bridge.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).result.tools);
});

test('response object keys are redacted as well as values', async () => {
  const { bridge } = fixture({ answer: { structuredContent: { [KEY]: KEY } } });
  await bridge.handle(init); await bridge.handle(initialized);
  const response = await bridge.handle(call);
  assert.deepEqual(response.result.structuredContent, { '[REDACTED]': '[REDACTED]' });
});

test('missing credentials, unknown endpoint and uninitialized calls fail closed', async () => {
  assert.throws(() => createQueryAuthBridge({ profile: 'gildata-finquery', apiKey: '' }));
  assert.throws(() => createQueryAuthBridge({ profile: 'https://other.invalid', apiKey: KEY }));
  const { bridge, calls } = fixture();
  assert.equal((await bridge.handle(call)).error.code, -32000);
  assert.equal((await bridge.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).error.code, -32601);
  assert.equal(calls.length, 0);
});

test('CLI refuses credential arguments without echoing them', () => {
  const result = spawnSync(process.execPath, ['scripts/gildata-bridge.mjs', '--api-key', KEY], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(KEY), false);
});

test('GilData default timeout is 180 seconds and caller arguments cannot change endpoint', async () => {
  const timeout = AbortSignal.timeout;
  const durations = [];
  try {
    AbortSignal.timeout = ms => { durations.push(ms); return timeout(ms); };
    const { bridge, calls } = fixture({ answer: { content: [] } });
    await bridge.handle(init); await bridge.handle(initialized);
    await bridge.handle({ ...call, params: { ...call.params, arguments: { query: 'x', url: 'https://other.invalid' } } });
    assert.ok(durations.every(ms => ms === 180_000));
    assert.ok(calls.every(c => new URL(c.url).hostname === 'api.gildata.com'));
  } finally { AbortSignal.timeout = timeout; }
});

test('missing local token exits before reading or calling any tools', () => {
  const env = { ...process.env }; delete env.GILDATA_API_KEY;
  const result = spawnSync(process.execPath, ['scripts/gildata-bridge.mjs'], { encoding: 'utf8', env });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Missing local credential/);
});
