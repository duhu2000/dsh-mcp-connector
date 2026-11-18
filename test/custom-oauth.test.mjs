import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCustomConnections } from '../lib/custom-oauth.js';
import { buildManualRecord } from '../lib/connectors/manual-connector.js';
import { normalizeJsonImport } from '../lib/connectors/json-connector.js';

for (const name of ['qcc-company', 'tradesparq-trade-data']) {
  test(`${name}: standard URL-only import detects authorization without provider metadata`, async (t) => {
    const url = `https://mcp.example.com/${name}`;
    let registrations = 0;
    t.mock.method(globalThis, 'fetch', async (target, options) => {
      if (target === url) return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/metadata", scope="read"' } });
      if (target.endsWith('/metadata')) return Response.json({ resource: url, authorization_servers: ['https://auth.example.com'], scopes_supported: ['read', 'write'] });
      if (target.includes('well-known')) return Response.json({ issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token', registration_endpoint: 'https://auth.example.com/register', revocation_endpoint: 'https://auth.example.com/revoke' });
      registrations++;
      throw new Error('unexpected request');
    });
    const { records } = normalizeJsonImport({ mcpServers: { [name]: { type: 'streamable-http', url } } });
    const result = await prepareCustomConnections(records);
    assert.equal(result.ok, true);
    assert.equal(result.records[0].oauthDiscovery.scope, 'read');
    assert.equal(result.records[0].enabled, false);
    assert.equal(result.records[0].pendingAuthorization, true);
    assert.equal(registrations, 0);
  });
}

test('API keys, explicit none and arbitrary headers do not initiate OAuth discovery', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(null, {status: 401}); });
  for (const options of [{authMode:'none'}, {authMode:'bearer', bearerToken:'synthetic'}, {headersJson:{'X-Tenant':'test'}}]) {
    const record = buildManualRecord({name:'test',url:'https://mcp.example.com/mcp',...options});
    const before = requests;
    assert.equal((await prepareCustomConnections([record])).ok, false);
    assert.equal(requests - before, 1);
  }
});


test('403 is not an OAuth challenge; stdio remains supported with default auto', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return new Response(null, { status: 403 }); });
  const result = await prepareCustomConnections([buildManualRecord({name:'denied',url:'https://mcp.example.com/mcp'})]);
  assert.equal(result.ok, false);
  assert.equal(count, 1);
  assert.equal(result.records[0].pendingAuthorization, false);
  assert.equal(buildManualRecord({name:'local',transport:'stdio',command:'node',authMode:'auto'}).transport, 'stdio');
});

test('discovered cross-origin resource cannot create an OAuth draft', async (t) => {
  t.mock.method(globalThis, 'fetch', async (target) => target.endsWith('/metadata')
    ? Response.json({resource:'https://other.example.com/mcp',authorization_servers:['https://auth.example.com']})
    : new Response(null,{status:401,headers:{'www-authenticate':'Bearer resource_metadata="https://mcp.example.com/metadata"'}}));
  const result = await prepareCustomConnections([buildManualRecord({name:'mismatch',url:'https://mcp.example.com/mcp'})]);
  assert.equal(result.ok, false);
  assert.equal(result.records[0].pendingAuthorization, false);
});
