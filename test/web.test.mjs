import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountWebRoutes, isTrustedWebRequest } from '../lib/web.js';

/* ───────────────────────── fake http 对象 ───────────────────────── */

class FakeRes {
  constructor() {
    this.status = 0;
    this.headers = {};
    this.body = '';
  }
  writeHead(status, headers) {
    this.status = status;
    Object.assign(this.headers, headers ?? {});
  }
  end(body) {
    if (body !== undefined) this.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  }
}

function fakeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = {
    method,
    url,
    headers,
  };
  if (body !== undefined) {
    const data = Buffer.from(body);
    req[Symbol.asyncIterator] = async function* () {
      yield data;
    };
  } else {
    req[Symbol.asyncIterator] = async function* () {};
  }
  return req;
}

function makeWctx() {
  const routes = new Map();
  return {
    routes,
    webRuntime: { trustedHosts: [] },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => {};
      },
    },
  };
}

const api = {
  catalog: async () => ({ ok: true, message: '3 个连接器', detail: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }),
  status: async () => ({ ok: true, message: '0 条', detail: { items: [] } }),
  connect: async (connectorId) => ({ ok: true, message: `connected ${connectorId}`, detail: {} }),
};

/* ───────────────────────── 测试 ───────────────────────── */

test('fence：回环 + 同源放行', () => {
  assert.equal(isTrustedWebRequest({ headers: { host: '127.0.0.1:62929' } }), true);
  assert.equal(isTrustedWebRequest({ headers: { host: 'localhost:62929', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:62929' } }), true);
});

test('fence：跨站 / 外部域名拒绝', () => {
  assert.equal(isTrustedWebRequest({ headers: { host: '127.0.0.1:62929', 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(isTrustedWebRequest({ headers: { host: 'evil.example.com' } }), false);
  assert.equal(isTrustedWebRequest({ headers: { host: '127.0.0.1:62929', origin: 'http://evil.example.com' } }), false);
  assert.equal(isTrustedWebRequest({ headers: {} }), false);
});

test('api 路由：method 白名单调度 + 非 POST/未知方法', async () => {
  const wctx = makeWctx();
  mountWebRoutes(wctx, api, { logger: { warn() {} } });
  const route = wctx.routes.get('/mcp-connector/api');
  assert.ok(route, 'api 路由已注册');

  const res = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'catalog', params: {} }),
  }), res);
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.detail.items.length, 3);

  const res2 = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929' },
    body: JSON.stringify({ method: 'stealSecrets' }),
  }), res2);
  assert.equal(res2.status, 400);
  assert.equal(JSON.parse(res2.body).ok, false);

  const res3 = new FakeRes();
  await route.handler(fakeReq({ method: 'GET', url: '/mcp-connector/api', headers: { host: '127.0.0.1:62929' } }), res3);
  assert.equal(res3.status, 405);
});

test('api 路由：跨站被 fence 拒绝', async () => {
  const wctx = makeWctx();
  mountWebRoutes(wctx, api, { logger: { warn() {} } });
  const route = wctx.routes.get('/mcp-connector/api');
  const res = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ method: 'status' }),
  }), res);
  assert.equal(res.status, 403);
});

test('ui 路由：返回 SPA 首页 / 目录穿越 404', async () => {
  const wctx = makeWctx();
  mountWebRoutes(wctx, api, { logger: { warn() {} } });
  const route = wctx.routes.get('/mcp-connector/ui');
  assert.ok(route, 'ui 路由已注册');

  const res = new FakeRes();
  await route.handler(fakeReq({ method: 'GET', url: '/mcp-connector/ui/', headers: { host: '127.0.0.1:62929' } }), res);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.body, /MCP连接器/);

  const logoRes = new FakeRes();
  await route.handler(fakeReq({ method: 'GET', url: '/mcp-connector/ui/assets/qcc-logo.svg', headers: { host: '127.0.0.1:62929' } }), logoRes);
  assert.equal(logoRes.status, 200);
  assert.equal(logoRes.headers['content-type'], 'image/svg+xml');
  assert.match(logoRes.body, /aria-label="企查查"/);

  const res2 = new FakeRes();
  await route.handler(fakeReq({ method: 'GET', url: '/mcp-connector/ui/../../package.json', headers: { host: '127.0.0.1:62929' } }), res2);
  assert.equal(res2.status, 404);
});
