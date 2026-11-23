import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { oauthAuthorize } from '../lib/connectors/oauth-connector.js';

const issuer = 'https://auth.example.com';
const resource = 'https://data.example.com/mcp';

async function run(t, registrationErrors = [], { wrongState = false } = {}) {
  const registrations = [], authorizations = [], tokens = [];
  const nativeFetch = globalThis.fetch;
  let callbackResponse;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === resource) return new Response(null, { status: 401, headers: {
      'www-authenticate': 'Bearer resource_metadata="https://data.example.com/metadata", scope="read"',
    } });
    if (url === 'https://data.example.com/metadata') return Response.json({
      resource, authorization_servers: [issuer], scopes_supported: ['read'],
    });
    if (url === issuer + '/.well-known/oauth-authorization-server') return Response.json({
      issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
      registration_endpoint: issuer + '/register', revocation_endpoint: issuer + '/revoke',
      token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
    });
    if (url === issuer + '/register') {
      registrations.push(JSON.parse(options.body));
      const failure = registrationErrors[registrations.length - 1];
      if (failure instanceof Error) throw failure;
      if (failure) return Response.json(failure.body, { status: failure.status });
      return Response.json({ client_id: 'synthetic-client', token_endpoint_auth_method: 'none' });
    }
    if (url === issuer + '/token') {
      tokens.push(Object.fromEntries(new URLSearchParams(options.body)));
      return Response.json({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 60 });
    }
    throw new Error('Unexpected request: ' + url);
  });
  const logger = { warn() {}, info(message) {
    if (!message.startsWith('opening authorization page: ')) return;
    const authorization = new URL(message.slice('opening authorization page: '.length));
    authorizations.push(authorization);
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', 'synthetic-code');
    callback.searchParams.set('state', wrongState ? 'wrong-state' : authorization.searchParams.get('state'));
    callbackResponse = nativeFetch(callback).then(async response => { await response.text(); return response.status; });
  } };
  let result, error;
  try {
    result = await oauthAuthorize({ connector: {
      id: 'synthetic', auth: { clientName: 'Test', scope: 'read' },
      servers: [{ serverKey: 'synthetic', url: resource }],
    }, config: { requestTimeoutMs: 1000, callbackTimeoutMs: 2000, openBrowser: false }, logger });
  } catch (caught) { error = caught; }
  if (callbackResponse) assert.equal(await callbackResponse, 200);
  // Success and all error paths must release every listener.
  for (const request of registrations) {
    await assert.rejects(nativeFetch(request.redirect_uris[0]));
  }
  return { registrations, authorizations, tokens, result, error };
}
const redirectRejected = { status: 400, body: {
  error: 'invalid_client_metadata', error_description: 'redirect_uris are not allowed',
} };

test('existing /callback providers register once and finish authorization', async t => {
  const r = await run(t);
  assert.equal(r.error, undefined);
  assert.equal(r.registrations.length, 1);
  assert.equal(new URL(r.registrations[0].redirect_uris[0]).pathname, '/callback');
  assert.equal(r.tokens[0].redirect_uri, r.registrations[0].redirect_uris[0]);
});

test('explicit redirect rejection switches only the path and keeps PKCE/token redirect consistent', async t => {
  const r = await run(t, [redirectRejected]);
  assert.equal(r.error, undefined);
  assert.equal(r.registrations.length, 2);
  const [first, second] = r.registrations.map(body => new URL(body.redirect_uris[0]));
  assert.equal(first.origin, second.origin);
  assert.equal(second.hostname, '127.0.0.1');
  assert.equal(second.pathname, '/oauth/callback');
  assert.deepEqual({ ...r.registrations[0], redirect_uris: [] }, { ...r.registrations[1], redirect_uris: [] });
  assert.equal(r.authorizations.length, 1);
  assert.equal(r.authorizations[0].searchParams.get('redirect_uri'), second.href);
  assert.equal(r.tokens[0].redirect_uri, second.href);
  assert.equal(r.tokens[0].resource, resource);
  assert.equal(createHash('sha256').update(r.tokens[0].code_verifier).digest('base64url'),
    r.authorizations[0].searchParams.get('code_challenge'));
});

for (const [name, failure] of [
  ['generic metadata error', { status: 400, body: { error: 'invalid_client_metadata' } }],
  ['invalid scope', { status: 400, body: { error: 'invalid_scope' } }],
  ['forbidden', { status: 403, body: redirectRejected.body }],
  ['rate limited', { status: 429, body: redirectRejected.body }],
  ['outage', { status: 500, body: redirectRejected.body }],
  ['network failure', new Error('network failed')],
]) {
  test(name + ' never retries registration', async t => {
    const r = await run(t, [failure]);
    assert.ok(r.error);
    assert.equal(r.registrations.length, 1);
    assert.equal(r.authorizations.length, 0);
    assert.equal(r.tokens.length, 0);
  });
}

test('second rejection stops after two attempts with no browser or token request', async t => {
  const r = await run(t, [redirectRejected, redirectRejected]);
  assert.equal(r.error.code, 'invalid_client_metadata');
  assert.equal(r.registrations.length, 2);
  assert.equal(r.authorizations.length, 0);
  assert.equal(r.tokens.length, 0);
});

test('fallback retains state validation and never exchanges a mismatched callback', async t => {
  const r = await run(t, [redirectRejected], { wrongState: true });
  assert.match(r.error.message, /state mismatch/);
  assert.equal(r.tokens.length, 0);
});
