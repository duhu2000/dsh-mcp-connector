import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMcpResource } from '../lib/mcp-http.js';
import { registerTools } from '../lib/tools.js';

const uri = 'resource://params/enums.json';
const record = { key: 'trade', transport: 'streamable-http', url: 'https://mcp.example/mcp', auth: { mode: 'oauth', grantKey: 'grant' } };
const grants = new Map([['grant', { accessToken: 'test-secret' }]]);
const json = (id, result, headers = {}) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json', ...headers } });
function remote({ read, capabilities = { resources: {} } } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    assert.equal(url, record.url, 'resource URI must never be fetched directly');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    if (options.method === 'DELETE') { calls.push('DELETE'); return new Response(null, { status: 204 }); }
    const body = JSON.parse(options.body); calls.push(body.method);
    if (body.method === 'initialize') return json(body.id, { protocolVersion: '2025-03-26', capabilities }, { 'mcp-session-id': 'test-session' });
    assert.equal(options.headers['Mcp-Session-Id'], 'test-session');
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(body.method, 'resources/read');
    assert.deepEqual(body.params, { uri });
    return read ? read(body) : json(body.id, { contents: [{ uri, mimeType: 'application/json', text: '{"country_code":["US"]}' }] });
  } };
}

test('one authenticated resource read with protocol session; no business initialization or tool calls', async () => {
  const mock = remote();
  const result = await readMcpResource(record, uri, { ...mock, grants });
  assert.deepEqual(JSON.parse(result.contents[0].text), { country_code: ['US'] });
  assert.deepEqual(mock.calls, ['initialize', 'notifications/initialized', 'resources/read', 'DELETE']);
  assert.doesNotMatch(JSON.stringify(result), /test-secret|test-session/);
});

test('missing resources capability stops before read', async () => {
  const mock = remote({ capabilities: {} });
  await assert.rejects(readMcpResource(record, uri, { ...mock, grants }), /does not advertise/);
  assert.deepEqual(mock.calls, ['initialize', 'DELETE']);
});

test('failure, malformed result and oversized response never retry or expose server errors', async () => {
  for (const read of [
    () => new Response('test-secret test-session', { status: 503 }),
    () => new Response(JSON.stringify({ error: { message: 'test-secret test-session' } })),
    body => json(body.id + 1, { contents: [] }),
    body => json(body.id, { contents: [{ uri: 'resource://other', text: 'wrong' }] }),
    body => json(body.id, { contents: [{ uri, blob: 'abc' }] }),
    body => json(body.id, { contents: [{ uri, text: 'x'.repeat(2 * 1024 * 1024) }] }),
  ]) {
    const mock = remote({ read });
    await assert.rejects(readMcpResource(record, uri, { ...mock, grants }), error => !/test-secret|test-session/.test(error.message));
    assert.equal(mock.calls.filter(x => x === 'resources/read').length, 1);
    assert.equal(mock.calls.at(-1), 'DELETE');
  }
});

test('invalid URI, stdio and cancellation do not dispatch requests', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('unexpected'); };
  for (const bad of ['https://evil.example', 'file:///etc/passwd', '', undefined, 'resource://has space']) {
    await assert.rejects(readMcpResource(record, bad, { fetchImpl }));
  }
  await assert.rejects(readMcpResource({ ...record, transport: 'stdio' }, uri, { fetchImpl }));
  await assert.rejects(readMcpResource(record, uri, { fetchImpl, signal: AbortSignal.abort() }));
  assert.equal(calls, 0);
});

test('revoked access during protocol initialization stops before resources/read', async () => {
  const mock = remote(); let checks = 0;
  await assert.rejects(readMcpResource(record, uri, { ...mock, grants, beforeRequest() {
    if (++checks === 3) throw new Error('revoked');
  } }), /revoked/);
  assert.deepEqual(mock.calls, ['initialize', 'notifications/initialized', 'DELETE']);
});

test('resource API requires trusted workspace, enabled visible connection, policy and valid grant', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('    async resourceRead(');
  const end = source.indexOf('    async toolsList(', start);
  let allowed = true, effect = 'allow', badGrant = false, calls = 0;
  const state = { connections: new Map([['trade', record]]) };
  const api = new Function('state', 'workspaceIdForAgent', 'connectionVisibleInWorkspace', 'connectionScopes', 'serverPolicy', 'grantFailure', 'readMcpResource', 'grantMap', 'config', 't', `return {${source.slice(start, end)}}`)(
    state, agent => agent.id === 'known' ? 'workspace' : undefined,
    () => allowed, { binding: () => ({}) }, () => ({ desiredEffect: effect }), () => badGrant,
    async () => { calls++; return { contents: [] }; }, () => grants, { requestTimeoutMs: 1000 }, text => text,
  );
  const args = { connectionKey: 'trade', uri, workspaceId: 'spoofed' };
  const exec = { agent: { id: 'known' } };
  assert.equal((await api.resourceRead(args)).ok, false);
  assert.equal((await api.resourceRead(args, { agent: { id: 'unknown' } })).ok, false);
  allowed = false; assert.equal((await api.resourceRead(args, exec)).ok, false); allowed = true;
  effect = 'deny'; assert.equal((await api.resourceRead(args, exec)).ok, false); effect = 'allow';
  badGrant = true; assert.equal((await api.resourceRead(args, exec)).ok, false); badGrant = false;
  record.enabled = false; assert.equal((await api.resourceRead(args, exec)).ok, false); delete record.enabled;
  assert.equal((await api.resourceRead({ ...args, connectionKey: 'missing' }, exec)).ok, false);
  assert.equal(calls, 0);
  assert.equal((await api.resourceRead(args, exec)).ok, true);
  assert.equal(calls, 1);
});

test('full and compact resource tools forward trusted execution context and render content', async () => {
  for (const compact of [false, true]) {
    const definitions = new Map(); const exec = { agent: { id: 'known' } };
    const args = { connectionKey: 'trade', uri };
    registerTools({ tools: { register: def => { definitions.set(def.name, def); return () => {}; } } }, {
      async resourceRead(received, context) {
        assert.deepEqual(received, args); assert.equal(context, exec);
        return { ok: true, message: 'External data', detail: { contents: [{ uri, text: '{"ok":true}' }] } };
      },
    }, { compact });
    const tool = definitions.get(compact ? 'mcp_connector_discover' : 'mcp_connector_resource_read');
    const input = compact ? { action: 'read_resource', ...args } : args;
    const result = await tool.execute(input, exec);
    assert.equal(result.ok, true);
    assert.match(tool.output.render(input, result)[0].text, /\{"ok":true\}/);
  }
});
