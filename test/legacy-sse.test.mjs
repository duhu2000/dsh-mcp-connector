import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { LegacySseSession } from '../lib/legacy-sse.js';
import { normalizeJsonImport } from '../lib/connectors/json-connector.js';
import { buildManualRecord } from '../lib/connectors/manual-connector.js';
import { auditDescriptor } from '../lib/catalog.js';
import { normalizeConnectionRecord, normalizeConnectorDescriptor } from '../lib/schema.js';
import { editableConnectionConfiguration } from '../lib/connection-editor.js';
import { exportRedactedConnections } from '../lib/connection-backup.js';
import { buildEntryConfig } from '../lib/mcp-provision.js';
import { validateConnectionRecord } from '../lib/mcp-validation.js';
import { listMcpTools } from '../lib/mcp-http.js';

const fakeKey = 'synthetic-test-only-key';
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

async function fixture(t, { endpoint, status, disconnect = false } = {}) {
  const calls = [], streams = new Map();
  let sequence = 0;
  const server = createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url, key: req.headers.apikey });
    if (status) { res.writeHead(status).end(); return; }
    if (req.headers.apikey !== fakeKey) { res.writeHead(401).end(); return; }
    if (req.method === 'GET' && req.url === '/sse') {
      const id = String(++sequence);
      streams.set(id, res);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // Fragment CRLF and endpoint across writes; leave the stream open after replies.
      res.write(': heartbeat\r');
      res.write('\nevent: endpoint\r\ndata: ');
      res.write(`${endpoint ?? '/messages?session=' + id}\r\n\r\n`);
      req.on('close', () => streams.delete(id));
      return;
    }
    if (req.method !== 'POST' || !req.url.startsWith('/messages?session=')) { res.writeHead(405).end(); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    calls.at(-1).rpc = message;
    const stream = streams.get(new URL(req.url, 'http://local').searchParams.get('session'));
    res.writeHead(202).end();
    if (disconnect) { stream.end(); return; }
    if (message.id === undefined) return;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } };
    else if (message.method === 'tools/list') result = message.params?.cursor
      ? { tools: [{ name: 'second', inputSchema: { type: 'object' } }] }
      : { tools: [{ name: 'first', inputSchema: { type: 'object' } }], nextCursor: 'page-2' };
    else result = { content: [{ type: 'text', text: 'mock-only' }] };
    stream.write('event: message\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} }) + '\r\n\r\n');
    stream.write('event: message\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\r\n\r\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const stream of streams.values()) stream.destroy(); server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/sse`;
  return { url, calls, streams };
}

test('vendor SSE import stays remote across normalize/edit/export and provisions a bundled credential-safe adapter', () => {
  const { records: [imported] } = normalizeJsonImport({ mcpServers: { bcpmdata: { type: 'sse', url: 'https://mcp.example.com/sse', headers: { apiKey: fakeKey } } } });
  const record = normalizeConnectionRecord(imported);
  assert.equal(record.transport, 'sse');
  assert.equal(record.headers.apiKey, fakeKey);
  assert.equal(buildManualRecord({ name: 'manual', transport: 'sse', url: record.url }).transport, 'sse');
  const exported = exportRedactedConnections([record]);
  assert.equal(exported.connections[0].transport, 'sse');
  assert.ok(!JSON.stringify(exported).includes(fakeKey));
  const edited = editableConnectionConfiguration(record);
  assert.ok(JSON.stringify(edited).includes('sse'));
  assert.ok(!JSON.stringify(edited).includes(fakeKey));
  const config = buildEntryConfig(record, new Map());
  assert.equal(config.transport, 'stdio');
  assert.equal(config.command, process.execPath);
  assert.match(config.args[0], /legacy-sse-bridge.js$/);
  assert.ok(!JSON.stringify(config.args).includes(fakeKey));
  assert.equal(JSON.parse(config.env.DSH_LEGACY_SSE_CONFIG).headers.apiKey, fakeKey);
  assert.equal(record.transport, 'sse');
});

test('legacy initialize and paginated discovery use GET endpoint + POST messages with the same API key', async t => {
  const f = await fixture(t);
  const record = { transport: 'sse', url: f.url, headers: { apiKey: fakeKey } };
  const validation = await validateConnectionRecord(record);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  assert.equal(validation.protocolVersion, '2024-11-05');
  const listed = await listMcpTools(record);
  assert.deepEqual(listed.tools.map(tool => tool.name), ['first', 'second']);
  assert.equal(listed.pages, 2);
  assert.equal(f.calls.filter(call => call.method === 'GET').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/sse').length, 0);
  assert.ok(f.calls.every(call => call.key === fakeKey));
});

test('SSE 401/403 remain credential errors; no protocol fallback or retry', async t => {
  for (const status of [401, 403]) {
    const f = await fixture(t, { status });
    const result = await validateConnectionRecord({ transport: 'sse', url: f.url });
    assert.equal(result.kind, 'auth');
    assert.equal(result.httpStatus, status);
    assert.equal(f.calls.length, 1);
  }
});

test('provider endpoint cannot send credentials to another origin', async t => {
  const f = await fixture(t, { endpoint: 'https://other.example.invalid/messages?secret=never-log' });
  const session = new LegacySseSession(f.url, { headers: { apiKey: fakeKey } });
  await assert.rejects(session.request(initialize), /origin mismatch/);
  assert.equal(f.calls.length, 1);
  assert.equal(session.pending.size, 0);
});

test('SSE stream loss rejects the pending request without replay', async t => {
  const f = await fixture(t, { disconnect: true });
  const session = new LegacySseSession(f.url, { headers: { apiKey: fakeKey } });
  await assert.rejects(session.request(initialize), /stream closed/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(session.pending.size, 0);
});

test('invalid streams, redirects, absent endpoints and oversized events fail closed', async () => {
  for (const response of [
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response(null, { status: 302, headers: { location: 'https://other.example.invalid/' } }),
    new Response('event: message\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    new Response('data:' + 'x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/event-stream' } }),
  ]) {
    const session = new LegacySseSession('https://mcp.example.com/sse', { fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error'); return response;
    } });
    await assert.rejects(session.start());
    assert.ok(session.closed);
  }
  const session = new LegacySseSession('https://mcp.example.com/sse', { timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } }) });
  await assert.rejects(session.start(), /timeout/);
});

test('host subprocess forwards initialize, discovery, tool calls and notifications without replay or credential logs', async t => {
  const f = await fixture(t);
  const config = buildEntryConfig({ transport: 'sse', url: f.url, headers: { apiKey: fakeKey }, serverName: 'fixture' }, new Map());
  const child = spawn(config.command, config.args, { env: { ...process.env, ...config.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const request = async message => {
    child.stdin.write(JSON.stringify(message) + '\n');
    const deadline = Date.now() + 5000;
    for (;;) {
      const response = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.id === message.id);
      if (response) return response;
      if (Date.now() > deadline) throw new Error('mock bridge timeout: ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  assert.ok((await request(initialize)).result.serverInfo);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.ok((await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).result.tools);
  assert.equal((await request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'first', arguments: {} } })).result.content[0].text, 'mock-only');
  assert.equal(f.calls.filter(call => call.rpc?.method === 'tools/call').length, 1);
  assert.ok(stdout.includes('notifications/message'));
  assert.ok(!stdout.includes(fakeKey) && !stderr.includes(fakeKey));
  const exit = once(child, 'exit');
  child.stdin.end();
  const [code] = await exit;
  assert.equal(code, 0);
});


test('SSE catalog cards retain API-key and OAuth credentials through auditing and provisioning', () => {
  for (const mode of ['api-key', 'oauth2-pkce']) {
    const descriptor = auditDescriptor(normalizeConnectorDescriptor({ id: 'legacy', name: 'Legacy', auth: { mode, apiKeyHeader: 'apiKey' },
      servers: [{ serverKey: 'main', serverName: 'legacy', transport: 'sse', url: 'https://mcp.example.com/sse' }] }));
    assert.equal(descriptor.servers[0].transport, 'sse');
  }
  const entry = buildEntryConfig({ transport: 'sse', url: 'https://mcp.example.com/sse', auth: { mode: 'oauth', grantKey: 'fake' } }, new Map([['fake', { accessToken: fakeKey }]]));
  assert.equal(JSON.parse(entry.env.DSH_LEGACY_SSE_CONFIG).headers.Authorization, `Bearer ${fakeKey}`);
  assert.ok(!JSON.stringify(entry.args).includes(fakeKey));
});


test('validation timeout cancels an SSE stream before sending any RPC', async () => {
  let cancelled = false, calls = 0;
  const result = await validateConnectionRecord({ transport: 'sse', url: 'https://mcp.example.com/sse' }, {
    timeoutMs: 20,
    fetchImpl: async () => {
      calls += 1;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  assert.equal(result.kind, 'timeout');
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});
