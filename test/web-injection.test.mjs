import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectWebRoutes } from '../lib/web.js';
import { Context } from '@deepseek-ai/cordis';

for (const name of ['webStartup', 'webRuntime']) {
  test('real Cordis service lifecycle: ' + name, async () => {
    const ctx = new Context();
    const routes = new Map();
    try {
      ctx.provide('webServer', { register(route) {
        assert.ok(!routes.has(route.path));
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      } });
      injectWebRoutes(ctx, { versionStatus: async () => ({ detail: { installedVersion: 'test' } }) });
      const stop = ctx.provide(name, { trustedHosts: ['trusted.example'] });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(routes.size, 3);
      assert.equal((await request(routes, 'trusted.example')).status, 503);
      const stopConnection = ctx.provide('connection', name === 'webRuntime' ? {} : {
        admit: () => ({ peer: {} }),
      });
      assert.equal((await request(routes, 'trusted.example')).status, 200);
      if (name === 'webStartup') {
        const stopAuthentication = ctx.provide('connection.authentication', {});
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(routes.size, 3);
        assert.equal((await request(routes, 'trusted.example')).status, 403);
        await stopAuthentication();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await request(routes, 'trusted.example')).status, 200);
      }
      await stopConnection();
      assert.equal((await request(routes, 'trusted.example')).status, 503);
      stop();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(routes.size, 0);
    } finally {
      await ctx.fiber.dispose();
    }
  });
}

function harness(connection = {}, authentication) {
  const callbacks = new Map();
  const routes = new Map();
  const ctx = { inject(deps, callback) {
    assert.equal(deps[0], 'webServer');
    assert.equal(deps.length, 2);
    callbacks.set(deps[1], callback);
  } };
  injectWebRoutes(ctx, { versionStatus: async () => ({ detail: { installedVersion: 'test' } }) });
  return { routes, activate(name, trustedHosts = []) {
    const effects = [];
    callbacks.get(name)({
      [name]: { trustedHosts },
      get(key) { assert.equal(key, 'connection'); return connection; },
      inject(deps, callback) {
        assert.deepEqual(deps, ['connection.authentication']);
        if (authentication) callback({
          get(key) { assert.equal(key, 'connection'); return connection; },
          effect(fn) { effects.push(fn()); },
        });
      },
      webServer: { register(route) {
        assert.ok(!routes.has(route.path), 'no duplicate routes');
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      } },
      effect(fn) { effects.push(fn()); },
    });
    return () => effects.reverse().forEach(fn => fn());
  } };
}

async function request(routes, host, origin = 'http://' + host, headers = {}) {
  const req = {
    method: 'POST', headers: { host, origin, ...headers },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"method":"versionStatus"}');
    },
  };
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await routes.get('/mcp-connector/api').handler(req, res);
  return res;
}

test('legacy Connection preserves trusted hosts and disposes and remounts routes', async () => {
  const h = harness();
  assert.equal(h.routes.size, 0);
  const stop = h.activate('webRuntime', ['trusted.example:3080']);
  assert.equal(h.routes.size, 3);
  assert.ok(h.routes.has('/mcp-connector/ui'));
  assert.ok(h.routes.has('/mcp-connector/events'));
  assert.equal((await request(h.routes, '127.0.0.1:3080')).status, 200);
  assert.equal((await request(h.routes, 'trusted.example:3080')).status, 200);
  assert.equal((await request(h.routes, 'trusted.example:3081')).status, 403);
  assert.equal((await request(h.routes, 'trusted.example:3080', 'http://other.example')).status, 403);
  stop();
  assert.equal(h.routes.size, 0);
  h.activate('webRuntime')();
  assert.equal(h.routes.size, 0);
});

test('legacy Connection prefers webStartup trust and falls back when webStartup unloads', async () => {
  const h = harness();
  const oldStop = h.activate('webRuntime', ['old.example']);
  const newStop = h.activate('webStartup', ['new.example']);
  assert.equal((await request(h.routes, 'new.example')).status, 200);
  assert.equal((await request(h.routes, 'old.example')).status, 403);
  newStop();
  assert.equal((await request(h.routes, 'old.example')).status, 200);
  oldStop();
  assert.equal(h.routes.size, 0);
});

test('legacy service arriving after new service does not override new trust', async () => {
  const h = harness();
  const newStop = h.activate('webStartup', ['new.example']);
  const oldStop = h.activate('webRuntime', ['old.example']);
  assert.equal((await request(h.routes, 'old.example')).status, 403);
  oldStop();
  assert.equal(h.routes.size, 3);
  newStop();
  assert.equal(h.routes.size, 0);
});

test('requestRejection authenticates webStartup requests on hosts that predate admit', async () => {
  const connection = { requestRejection() { return this.rejection; } };
  const h = harness(connection);
  const stop = h.activate('webStartup', ['configured.example:6731']);
  try {
    for (const [rejection, status] of [[403, 403], [401, 401], [undefined, 200]]) {
      connection.rejection = rejection;
      assert.equal((await request(h.routes, 'configured.example:6731')).status, status);
    }
  } finally {
    stop();
  }
});

test('the current Connection controls access without falling back to trustedHosts', async () => {
  const browserPeer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  let admission;
  const h = harness({ browserPeer, admit() { return admission; }, requestRejection() { return undefined; } });
  const stop = h.activate('webStartup', ['configured.example:6731']);
  const host = 'configured.example:6731';
  try {
    for (const [result, status] of [
      [{ rejection: 403 }, 403],
      [{ rejection: 401 }, 401],
      [{ peer: { ...browserPeer } }, 403],
      [{ peer: browserPeer }, 200],
      [undefined, 403],
    ]) {
      admission = result;
      assert.equal((await request(h.routes, host)).status, status);
    }
  } finally {
    stop();
  }
});

test('provider-owned sessions admit only the browser credential selected by DSH', async () => {
  const host = 'configured.example:6731';
  const origin = 'http://' + host;
  const cookieName = 'dsh-auth-' + 'a'.repeat(43);
  const web = cookieName + '=v1.browser.signature';
  const desktop = 'dsh-desktop-session=desktop-fixture';
  const api = cookieName + '=v2.api.signature';
  const fakeBrowser = cookieName + '=v1.forged.signature';
  const browserPeer = { id: 'in-process', principal: { kind: 'owner' } };
  const calls = [];
  const h = harness({
    browserPeer,
    admit(req) {
      calls.push(req.headers);
      if (req.headers.host !== host || req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return { rejection: 403 };
      const selected = req.headers.cookie?.split(';').map(pair => pair.trim())
        .find(pair => pair.startsWith(cookieName + '=') || pair.startsWith('dsh-desktop-session='));
      const id = selected === web ? 'web' : selected === desktop ? 'desktop' :
        selected === api || req.headers.authorization === 'synthetic-api' ? 'api' : undefined;
      if (!id) return { rejection: 401 };
      // A second service call can wrap the same Peer in a different object.
      return { peer: { id, principal: { kind: 'owner' } } };
    },
  }, {});
  const stop = h.activate('webStartup');
  try {
    const allowed = await request(h.routes, host, origin, {
      cookie: 'irrelevant=value; ' + web, authorization: 'synthetic-api', 'sec-fetch-site': 'same-origin',
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(calls, [
      { host, origin, cookie: 'irrelevant=value; ' + web, authorization: 'synthetic-api', 'sec-fetch-site': 'same-origin' },
      { host, origin, cookie: web, 'sec-fetch-site': 'same-origin' },
    ]);
    assert.equal((await request(h.routes, host, origin, { cookie: desktop })).status, 200);
    assert.equal((await request(h.routes, host, origin, { cookie: web + '; ' + api })).status, 200);

    for (const cookie of [api, api + '; ' + fakeBrowser, api + '; ' + web]) {
      assert.equal((await request(h.routes, host, origin, { cookie })).status, 403);
    }
    assert.equal((await request(h.routes, host, origin, {
      cookie: fakeBrowser, authorization: 'synthetic-api',
    })).status, 403);
    assert.equal((await request(h.routes, host, origin, { cookie: fakeBrowser })).status, 401);
    assert.equal((await request(h.routes, host, origin)).status, 401);
    assert.equal((await request(h.routes, 'untrusted.example', undefined, { cookie: web })).status, 403);
    assert.equal((await request(h.routes, host, 'http://other.example', { cookie: web })).status, 403);
    assert.equal((await request(h.routes, host, origin, { cookie: web, 'sec-fetch-site': 'cross-site' })).status, 403);
  } finally {
    stop();
  }
});

test('provider unavailability preserves 503 during either browser admission', async () => {
  const host = 'configured.example:6731';
  const origin = 'http://' + host;
  const cookie = 'dsh-auth-' + 'a'.repeat(43) + '=v1.browser.signature';
  const peer = { id: 'web', principal: { kind: 'owner' } };

  for (const admissions of [[{ rejection: 503 }], [{ peer }, { rejection: 503 }]]) {
    const h = harness({ admit() { return admissions.shift(); } }, {});
    const stop = h.activate('webStartup');
    try {
      const res = await request(h.routes, host, origin, { cookie });
      assert.equal(res.status, 503);
      assert.equal(JSON.parse(res.body).message, 'DSH session authentication unavailable');
      assert.equal(admissions.length, 0);
    } finally {
      stop();
    }
  }
});
