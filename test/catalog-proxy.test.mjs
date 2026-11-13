import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fixture = new URL('./fixtures/catalog-proxy/', import.meta.url);
const catalogModule = new URL('../lib/catalog.js', import.meta.url).href;
const catalog = [{ id: 'proxy-test', name: 'Proxy test', servers: [
  { serverKey: 'main', serverName: 'proxy-test', url: 'https://mcp.example.test' },
] }];

// Isolate environment variables and the optional Node native proxy flag from
// the test runner. The TLS fixture is trusted only in this child, never globally.
async function fetchInChild(url, proxyEnv = {}, options = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:https?_proxy|no_proxy|all_proxy|node_options|node_use_env_proxy|node_extra_ca_certs|node_tls_reject_unauthorized)$/i.test(key)));
  Object.assign(env, proxyEnv, { NODE_EXTRA_CA_CERTS: fileURLToPath(new URL('cert.pem', fixture)) });
  const script = `
    import assert from 'node:assert/strict';
    import { getGlobalDispatcher } from 'undici';
    import { fetchRemoteCatalog, fetchRemoteCatalogWithFallback } from ${JSON.stringify(catalogModule)};
    const [url, options] = JSON.parse(process.argv[1]);
    // Node 26 initializes a compatibility wrapper on the first native fetch.
    // Warm it without network I/O before checking that catalog requests leave
    // the Host dispatcher unchanged.
    if (!options.coldStart) await fetch('data:application/json,[]');
    const dispatcher = getGlobalDispatcher();
    if (options.forbidGlobalFetch) {
      globalThis.fetch = () => { throw new Error('proxy requests must use matching Undici fetch'); };
    }
    let output;
    try {
      let value;
      if (options.native) {
        value = await (await fetch(url)).json();
      } else if (options.mock) {
        globalThis.fetch = async (_url, init) => {
          assert.equal(Object.hasOwn(init, 'dispatcher'), false);
          return new Response('[]');
        };
        value = await fetchRemoteCatalog(url);
      } else if (options.fallbackUrls) {
        value = await fetchRemoteCatalogWithFallback(url, options.fallbackUrls, options);
      } else {
        value = await fetchRemoteCatalog(url, options);
      }
      output = { ok: true, value };
    } catch (error) {
      output = { ok: false, message: error.message, code: error.cause?.code };
    }
    assert.equal(getGlobalDispatcher(), dispatcher, 'must not replace the Host dispatcher');
    console.log(JSON.stringify(output));
  `;
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module', '-e', script, JSON.stringify([url, { requestTimeoutMs: 5000, ...options }]),
  ], { env, cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 10_000 });
  return JSON.parse(stdout);
}

async function listen(server, t) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) socket.destroy();
    await closed;
  });
  return server.address().port;
}

async function origin(t, { tls = false } = {}) {
  const requests = [];
  const handler = (req, res) => {
    requests.push({ url: req.url, etag: req.headers['if-none-match'] });
    if (req.url === '/slow') return;
    if (req.url === '/304') { res.writeHead(304); res.end(); return; }
    if (req.url === '/status') {
      res.writeHead(503);
      res.write('unfinished error body');
      return;
    }
    if (req.url === '/large') {
      res.writeHead(200, { 'Content-Length': 3 * 1024 * 1024 });
      res.write('unfinished oversized body');
      return;
    }
    if (req.url === '/invalid') { res.end('{'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"catalog-v1"' });
    res.end(JSON.stringify({ connectors: catalog }));
  };
  const server = tls ? createHttpsServer({
    key: readFileSync(new URL('key.pem', fixture)),
    cert: readFileSync(new URL('cert.pem', fixture)),
  }, handler) : createServer(handler);
  const port = await listen(server, t);
  return { port, requests, url: `${tls ? 'https' : 'http'}://127.0.0.1:${port}` };
}

async function proxy(t, originPort) {
  const tunnels = [];
  const server = createServer((_req, res) => { res.writeHead(405); res.end(); });
  server.on('connect', (req, socket, head) => {
    tunnels.push(req.url);
    // Never connect to arbitrary/external hosts from a test fixture.
    if (!['127.0.0.1', 'catalog.example.test'].some((host) => req.url === `${host}:${originPort}`)) {
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = connect(originPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => socket.destroy());
  });
  const port = await listen(server, t);
  return { url: `http://127.0.0.1:${port}`, tunnels };
}

test('catalog fetch uses a scoped environment proxy without Node flags', async (t) => {
  const target = await origin(t);
  const via = await proxy(t, target.port);
  const native = await fetchInChild(target.url, { HTTP_PROXY: via.url }, { native: true });
  assert.equal(native.ok, true);
  assert.equal(via.tunnels.length, 0, 'bare Node fetch reproduces ignored proxy variables');

  for (const name of ['HTTP_PROXY', 'http_proxy']) {
    await t.test(name, async () => {
      const before = via.tunnels.length;
      const result = await fetchInChild(target.url, { [name]: via.url }, { etag: '"previous"' });
      assert.equal(result.ok, true, result.message);
      assert.equal(result.value.connectors[0].id, 'proxy-test');
      assert.equal(result.value.etag, '"catalog-v1"');
      assert.equal(via.tunnels.length, before + 1);
      assert.equal(target.requests.at(-1).etag, '"previous"');
    });
  }
});

test('proxy catalog requests do not pass an external dispatcher to global fetch', async (t) => {
  const target = await origin(t, { tls: true });
  const via = await proxy(t, target.port);
  const result = await fetchInChild(`https://catalog.example.test:${target.port}`, {
    HTTPS_PROXY: via.url,
  }, { forbidGlobalFetch: true });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.value.connectors[0].id, 'proxy-test');
  assert.equal(via.tunnels.length, 1);
});

test('proxy catalog fetch works before native fetch initializes its dispatcher', async (t) => {
  const target = await origin(t, { tls: true });
  const via = await proxy(t, target.port);
  const result = await fetchInChild(`https://catalog.example.test:${target.port}`, {
    HTTPS_PROXY: via.url,
  }, { coldStart: true, forbidGlobalFetch: true });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.value.connectors[0].id, 'proxy-test');
  assert.equal(via.tunnels.length, 1);
});

test('HTTPS catalog uses HTTPS_PROXY and falls back to HTTP_PROXY', async (t) => {
  const target = await origin(t, { tls: true });
  const via = await proxy(t, target.port);
  const url = `https://catalog.example.test:${target.port}`;
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    await t.test(name, async () => {
      const before = via.tunnels.length;
      const result = await fetchInChild(url, { [name]: via.url });
      assert.equal(result.ok, true, result.message);
      assert.equal(result.value.connectors[0].id, 'proxy-test');
      assert.equal(via.tunnels.length, before + 1);
      assert.equal(via.tunnels.at(-1), `catalog.example.test:${target.port}`);
    });
  }
});

test('NO_PROXY bypasses the catalog proxy, including ports and wildcard', async (t) => {
  const target = await origin(t);
  const via = await proxy(t, target.port);
  for (const [name, value] of [
    ['NO_PROXY', '127.0.0.1'], ['no_proxy', `127.0.0.1:${target.port}`], ['NO_PROXY', '*'],
  ]) {
    await t.test(`${name}=${value}`, async () => {
      const result = await fetchInChild(target.url, { HTTP_PROXY: via.url, [name]: value });
      assert.equal(result.ok, true, result.message);
      assert.equal(via.tunnels.length, 0);
    });
  }
  const result = await fetchInChild(target.url, {
    HTTP_PROXY: via.url, NO_PROXY: `127.0.0.1:${target.port + 1}`,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(via.tunnels.length, 1, 'a different port must not bypass the proxy');
});

test('lowercase proxy settings take precedence, including empty values', {
  skip: process.platform === 'win32' ? 'Windows environment names are case-insensitive' : false,
}, async (t) => {
  const target = await origin(t);
  const via = await proxy(t, target.port);
  let result = await fetchInChild(target.url, { HTTP_PROXY: 'http://127.0.0.1:1', http_proxy: via.url });
  assert.equal(result.ok, true, result.message);
  assert.equal(via.tunnels.length, 1);
  result = await fetchInChild(target.url, { HTTP_PROXY: via.url, http_proxy: '' }, { mock: true });
  assert.equal(result.ok, true, result.message);
  result = await fetchInChild(target.url, { HTTP_PROXY: via.url, NO_PROXY: '*', no_proxy: '' });
  assert.equal(result.ok, true, result.message);
  assert.equal(via.tunnels.length, 2, 'empty lowercase NO_PROXY shadows uppercase');
});

test('without proxy variables catalog fetch preserves the Host dispatcher', async () => {
  const result = await fetchInChild('https://catalog.example.test', {}, { mock: true });
  assert.equal(result.ok, true, result.message);
});

test('proxy requests retain 304, fallback, errors and request timeout behavior', async (t) => {
  const target = await origin(t);
  const via = await proxy(t, target.port);
  const env = { HTTP_PROXY: via.url };
  const notModified = await fetchInChild(`${target.url}/304`, env, { etag: '"previous"' });
  assert.deepEqual(notModified, { ok: true, value: { notModified: true } });
  const fallback = await fetchInChild(`${target.url}/status`, env, {
    etag: '"primary"', fallbackUrls: [`${target.url}/catalog`],
  });
  assert.equal(fallback.ok, true, fallback.message);
  assert.equal(fallback.value.etag, undefined);
  assert.deepEqual(target.requests.slice(-2), [
    { url: '/status', etag: '"primary"' }, { url: '/catalog', etag: undefined },
  ]);
  for (const [path, message] of [
    ['/status', /HTTP 503/], ['/large', /超过/], ['/invalid', /JSON 解析失败/], ['/slow', /timeout/],
  ]) {
    await t.test(path, async () => {
      const result = await fetchInChild(`${target.url}${path}`, env, {
        requestTimeoutMs: path === '/slow' ? 100 : 5000,
      });
      assert.equal(result.ok, false);
      assert.match(result.message, message);
    });
  }
});

test('rejected proxy tunnel does not silently retry a direct catalog request', async (t) => {
  const target = await origin(t);
  const via = await proxy(t, target.port + 1); // This proxy rejects the actual origin.
  const result = await fetchInChild(target.url, { HTTP_PROXY: via.url });
  assert.equal(result.ok, false);
  assert.equal(via.tunnels.length, 1);
  assert.equal(target.requests.length, 0);
});
