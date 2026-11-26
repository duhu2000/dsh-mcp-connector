import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { injectWebRoutes } from '../lib/web.js';

// Resolve an isolated DSH install's program files only. Credentials stay in memory.
const anchor = process.env.DSH_WEB_TEST_ANCHOR;

function response() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

test('DSH Connection admits signed browser sessions on the bind IP and configured hosts', { skip: !anchor }, async (t) => {
  const require = createRequire(anchor);
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  const { Context } = await load('@deepseek-ai/cordis');
  const hostConnection = await load('@deepseek-ai/dsh-client-connection');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());

  const bindIp = '192.0.2.10';
  const trustedHosts = ['trusted.example', 'pinned.example:6731'];
  const routes = new Map();
  ctx.provide('webServer', {
    host: bindIp, port: 0, protocol: 'http:',
    register(route) {
      assert.ok(!routes.has(route.path));
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  });
  ctx.provide('webStartup', { trustedHosts });
  const credentials = new Map();
  ctx.provide('credentials', {
    async modifyRecord(key, modify) {
      const record = await modify(credentials.get(key));
      if (record) credentials.set(key, record);
      return credentials.get(key);
    },
  });
  const fiber = ctx.plugin(hostConnection, { trustedHosts });
  await fiber.await();

  let dispatches = 0;
  let subscriptions = 0;
  injectWebRoutes(ctx, { versionStatus() { dispatches++; return { detail: { installedVersion: 'test' } }; } }, {
    eventHub: { subscribe(_req, res) { subscriptions++; res.writeHead(200); res.end(); return true; } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const connection = ctx.get('connection');
  function browserCookie(host) {
    const launch = new URL(connection.authenticatedUrl(`http://${host}/`));
    const res = response();
    connection.authorizeIndex({ method: 'GET', url: launch.pathname + launch.search, headers: { host } }, res);
    assert.equal(res.status, 303);
    const cookie = res.headers['set-cookie']?.split(';', 1)[0];
    assert.ok(cookie);
    return cookie;
  }

  const endpoints = [
    ['/mcp-connector/ui', 'GET', '/mcp-connector/ui/'],
    ['/mcp-connector/api', 'POST', '/mcp-connector/api'],
    ['/mcp-connector/events', 'GET', '/mcp-connector/events'],
  ];
  async function statuses(host, headers = {}) {
    const results = [];
    for (const [path, method, url] of endpoints) {
      const res = response();
      await routes.get(path)({
        method, url, headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin', ...headers },
        async *[Symbol.asyncIterator]() { yield Buffer.from('{"method":"versionStatus"}'); },
      }, res);
      results.push(res.status);
    }
    return results;
  }

  const host = `${bindIp}:6731`;
  const otherPort = `${bindIp}:48152`;
  const cookie = browserCookie(host);
  assert.deepEqual(await statuses(host), [401, 401, 401]);
  assert.deepEqual(await statuses(host, { cookie: `${cookie}invalid` }), [401, 401, 401]);
  assert.deepEqual(await statuses(otherPort, { cookie }), [401, 401, 401]);
  assert.deepEqual(await statuses(host, { cookie, origin: `http://${otherPort}` }), [403, 403, 403]);
  assert.deepEqual(await statuses(host, { cookie, origin: 'null' }), [403, 403, 403]);
  assert.deepEqual(await statuses(host, { cookie, 'sec-fetch-site': 'cross-site' }), [403, 403, 403]);
  assert.deepEqual(await statuses('unlisted.example:6731'), [403, 403, 403]);
  assert.deepEqual(await statuses('pinned.example:48152'), [403, 403, 403]);
  assert.equal(dispatches, 0);
  assert.equal(subscriptions, 0);

  for (const authority of [host, otherPort, 'trusted.example:48152', 'pinned.example:6731', '127.0.0.1:6731']) {
    assert.deepEqual(await statuses(authority, { cookie: browserCookie(authority) }), [200, 200, 200]);
  }
  assert.equal(dispatches, 5);
  assert.equal(subscriptions, 5);
});
