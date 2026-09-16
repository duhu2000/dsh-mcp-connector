import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverServerMetadata } from '../lib/oauth.js';

const origin = 'https://auth.example.com';
const metadata = (issuer) => ({
  issuer, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token',
  registration_endpoint: origin + '/register', revocation_endpoint: origin + '/revoke',
});

async function withFetch(routes, run) {
  const previous = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const item = routes[String(url)] ?? { status: 404 };
    if (item.error) throw item.error;
    return new Response(JSON.stringify(item.body ?? {}), { status: item.status ?? 200 });
  };
  try { await run(requested); } finally { globalThis.fetch = previous; }
}

for (const path of ['', '/', '/docs', '/docs/', '/tenant/docs', '/tenant%20one/docs']) {
  test('RFC 8414 insertion and exact issuer identity: ' + (path || '(root)'), async () => {
    const issuer = origin + path;
    const url = origin + '/.well-known/oauth-authorization-server' + path.replace(/\/+$/, '');
    await withFetch({ [url]: { body: metadata(issuer) } }, async (requested) => {
      assert.equal((await discoverServerMetadata(issuer, 100)).issuer, issuer);
      assert.deepEqual(requested, [url]);
    });
  });
}

for (const status of [404, 405]) {
  test('legacy OAuth suffix fallback only when unavailable: ' + status, async () => {
    const issuer = origin + '/docs';
    const first = origin + '/.well-known/oauth-authorization-server/docs';
    const legacy = issuer + '/.well-known/oauth-authorization-server';
    await withFetch({ [first]: { status }, [legacy]: { body: metadata(issuer) } }, async (requested) => {
      assert.equal((await discoverServerMetadata(issuer, 100)).issuer, issuer);
      assert.deepEqual(requested, [first, legacy]);
    });
  });
}

test('403, 429, 500 and network errors do not trigger alternate discovery', async () => {
  const issuer = origin + '/docs';
  const url = origin + '/.well-known/oauth-authorization-server/docs';
  for (const item of [{ status: 403 }, { status: 429 }, { status: 500 }, { error: new Error('offline') }]) {
    await withFetch({ [url]: item }, async (requested) => {
      await assert.rejects(discoverServerMetadata(issuer, 100));
      assert.deepEqual(requested, [url]);
    });
  }
});

test('invalid or mismatched issuer fails closed without suffix fallback', async () => {
  const issuer = origin + '/docs/';
  const url = origin + '/.well-known/oauth-authorization-server/docs';
  for (const body of [null, [], {}, { ...metadata(issuer), issuer: origin + '/docs' }, metadata('https://other.example.com')]) {
    await withFetch({ [url]: { body } }, async (requested) => {
      await assert.rejects(discoverServerMetadata(issuer, 100), { code: 'invalid_metadata' });
      assert.deepEqual(requested, [url]);
    });
  }
});

test('issuer query and fragment rejected before network access', async () => {
  await withFetch({}, async (requested) => {
    for (const issuer of [origin + '/docs?q=x', origin + '/docs#x']) {
      await assert.rejects(discoverServerMetadata(issuer, 100), { code: 'invalid_metadata' });
    }
    assert.deepEqual(requested, []);
  });
});

test('OIDC insertion then legacy suffix supplements only the same issuer', async () => {
  const issuer = origin + '/docs';
  const oauth = origin + '/.well-known/oauth-authorization-server/docs';
  const oidc = origin + '/.well-known/openid-configuration/docs';
  const legacy = issuer + '/.well-known/openid-configuration';
  const base = metadata(issuer);
  delete base.registration_endpoint;
  delete base.revocation_endpoint;
  for (const standard of [true, false]) {
    const source = standard ? oidc : legacy;
    await withFetch({ [oauth]: { body: base }, [source]: { body: { ...metadata(issuer), token_endpoint: origin + '/oidc-token' } } }, async (requested) => {
      const result = await discoverServerMetadata(issuer, 100);
      assert.equal(result.registrationEndpoint, origin + '/register');
      assert.equal(result.tokenEndpoint, origin + '/token');
      assert.deepEqual(requested, standard ? [oauth, oidc] : [oauth, oidc, legacy]);
    });
  }
});

test('OIDC mismatch is never merged; optional failure does not break complete OAuth metadata', async () => {
  const issuer = origin + '/docs';
  const oauth = origin + '/.well-known/oauth-authorization-server/docs';
  const oidc = origin + '/.well-known/openid-configuration/docs';
  const base = metadata(issuer);
  delete base.revocation_endpoint;
  await withFetch({ [oauth]: { body: base }, [oidc]: { body: metadata('https://other.example.com') } }, async (requested) => {
    const result = await discoverServerMetadata(issuer, 100);
    assert.equal(result.revocationEndpoint, undefined);
    assert.deepEqual(requested, [oauth, oidc]);
  });
  delete base.registration_endpoint;
  await withFetch({ [oauth]: { body: base }, [oidc]: { body: metadata('https://other.example.com') } }, async () => {
    await assert.rejects(discoverServerMetadata(issuer, 100), { code: 'invalid_metadata' });
  });
});

test('all missing metadata preserves HTTP failure and unsafe endpoints remain rejected', async () => {
  await withFetch({}, async () => {
    await assert.rejects(discoverServerMetadata(origin + '/docs', 100), { httpStatus: 404 });
  });
  await withFetch({ [origin + '/.well-known/oauth-authorization-server']: {
    body: { ...metadata(origin), token_endpoint: 'file:///tmp/token' },
  } }, async () => {
    await assert.rejects(discoverServerMetadata(origin, 100));
  });
});
