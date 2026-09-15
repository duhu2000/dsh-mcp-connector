import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountWebRoutes, isTrustedWebRequest, resolveUiFile, splitUiPath } from '../lib/web.js';
import { StatusEventHub } from '../lib/status-events.js';

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
  write(body) {
    this.body += String(body);
    return true;
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

test('CLI 授权接口要求显式同源 Origin，拒绝自定义命令参数', async () => {
  const ctx = makeWctx();
  let starts = 0;
  mountWebRoutes(ctx, {}, { cliAuthService: {
    start: async () => { starts++; return { ok: true }; },
  } });
  const handler = ctx.routes.get('/mcp-connector/api').handler;
  for (const origin of [undefined, 'http://evil.invalid']) {
    const res = new FakeRes();
    await handler(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:3080', ...(origin ? { origin } : {}) }, body: JSON.stringify({ method: 'cliAuthStart', params: { confirmed: true } }) }), res);
    assert.equal(res.status, 403);
  }
  const invoke = async (params) => {
    const res = new FakeRes();
    await handler(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, body: JSON.stringify({ method: 'cliAuthStart', params }) }), res);
    return res;
  };
  assert.equal((await invoke({ command: 'evil', confirmed: true })).status, 400);
  assert.equal(starts, 0);
  assert.equal((await invoke({ confirmed: true })).status, 200);
  assert.equal(starts, 1);
});

const api = {
  versionStatus: async (force) => ({ ok: true, message: 'v0.2.23', detail: { installedVersion: '0.2.23', force } }),
  governance: async () => ({ ok: true, message: 'revision=2', detail: { revision: 2 } }),
  previewPolicy: async (input) => ({ ok: true, message: 'preview', detail: input }),
  applyPolicy: async (input) => ({ ok: true, message: 'applied', detail: input }),
  rollbackPolicy: async (revision) => ({ ok: true, message: 'rolled back', detail: { revision } }),
  scopeContext: async (workspaceId) => ({ ok: true, message: 'scope context', detail: { workspaceId } }),
  previewConnectionScope: async (input) => ({ ok: true, message: 'scope preview', detail: input }),
  applyConnectionScope: async (input) => ({ ok: true, message: 'scope applied', detail: input }),
  previewConnectionScopeRollback: async (revision) => ({ ok: true, message: 'scope rollback preview', detail: { revision } }),
  rollbackConnectionScope: async (revision) => ({ ok: true, message: 'scope rolled back', detail: { revision } }),
  catalog: async () => ({ ok: true, message: '3 个连接器', detail: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }),
  status: async () => ({ ok: true, message: '0 条', detail: { items: [] } }),
  connect: async (connectorId) => ({ ok: true, message: `connected ${connectorId}`, detail: {} }),
  renameConnection: async (key, name) => ({ ok: true, message: 'renamed', detail: { key, name } }),
  editableConnectionConfig: async (key) => ({ ok: true, message: 'editable', detail: { key, json: '{"connections":[]}' } }),
  reconfigureConnection: async (key, json) => ({ ok: true, message: 'reconfigured', detail: { key, jsonLength: json.length } }),
  exportConfig: async () => ({ ok: true, message: 'redacted', detail: { json: '{"redacted":true}' } }),
  toolSearch: async (input) => ({ ok: true, message: 'found', detail: { items: [{ name: input.query }] } }),
  toolDetail: async (input) => ({ ok: true, message: 'detail', detail: { tool: { name: input.toolName } } }),
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

  const versionRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'versionStatus', params: { force: true } }),
  }), versionRes);
  assert.equal(versionRes.status, 200);
  assert.deepEqual(JSON.parse(versionRes.body).detail, { installedVersion: '0.2.23', force: true });

  const exportRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'exportConfig', params: {} }),
  }), exportRes);
  assert.equal(exportRes.status, 200);
  assert.equal(JSON.parse(exportRes.body).detail.json, '{"redacted":true}');

  const renameRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'renameConnection', params: { key: 'json-demo', name: '生产数据' } }),
  }), renameRes);
  assert.equal(renameRes.status, 200);
  assert.deepEqual(JSON.parse(renameRes.body).detail, { key: 'json-demo', name: '生产数据' });

  const editableRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'editableConnectionConfig', params: { key: 'json-demo' } }),
  }), editableRes);
  assert.equal(editableRes.status, 200);
  assert.equal(JSON.parse(editableRes.body).detail.key, 'json-demo');

  const reconfigureRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'reconfigureConnection', params: { key: 'json-demo', json: '{}' } }),
  }), reconfigureRes);
  assert.equal(reconfigureRes.status, 200);
  assert.deepEqual(JSON.parse(reconfigureRes.body).detail, { key: 'json-demo', jsonLength: 2 });

  const searchRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'toolSearch', params: { query: 'lookup' } }),
  }), searchRes);
  assert.equal(JSON.parse(searchRes.body).detail.items[0].name, 'lookup');

  const detailRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'toolDetail', params: { toolName: 'lookup' } }),
  }), detailRes);
  assert.equal(JSON.parse(detailRes.body).detail.tool.name, 'lookup');

  const policyRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'previewPolicy', params: { scope: 'tool', effect: 'deny', connectorId: 'a' } }),
  }), policyRes);
  assert.equal(policyRes.status, 200);
  assert.equal(JSON.parse(policyRes.body).detail.scope, 'tool');

  const scopeRes = new FakeRes();
  await route.handler(fakeReq({
    method: 'POST',
    url: '/mcp-connector/api',
    headers: { host: '127.0.0.1:62929', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'previewConnectionScope', params: {
      key: 'a', mode: 'copy', targetScope: 'project', targetWorkspaceId: 'workspace-1',
    } }),
  }), scopeRes);
  assert.equal(scopeRes.status, 200);
  assert.equal(JSON.parse(scopeRes.body).detail.targetWorkspaceId, 'workspace-1');

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

test('events 路由：同源 GET 建立 SSE，跨站与非 GET 被拒绝', async () => {
  const wctx = makeWctx();
  const eventHub = new StatusEventHub({ heartbeatMs: 60_000 });
  mountWebRoutes(wctx, api, { logger: { warn() {} }, eventHub });
  const route = wctx.routes.get('/mcp-connector/events');
  assert.ok(route, 'events 路由已注册');

  const res = new FakeRes();
  await route.handler(fakeReq({ method: 'GET', url: '/mcp-connector/events', headers: { host: '127.0.0.1:62929' } }), res);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.match(res.body, /event: ready/);

  const methodRes = new FakeRes();
  await route.handler(fakeReq({ method: 'POST', url: '/mcp-connector/events', headers: { host: '127.0.0.1:62929' } }), methodRes);
  assert.equal(methodRes.status, 405);

  const forbiddenRes = new FakeRes();
  await route.handler(fakeReq({ method: 'GET', url: '/mcp-connector/events', headers: { host: 'evil.example.com' } }), forbiddenRes);
  assert.equal(forbiddenRes.status, 403);
  eventHub.dispose();
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

test('Windows 路径：URL 始终按正斜杠分段且静态资源不误报 404', () => {
  assert.deepEqual(splitUiPath('/assets/qcc-logo.svg'), ['assets', 'qcc-logo.svg']);
  assert.deepEqual(splitUiPath('\\assets\\qcc-logo.svg'), ['assets', 'qcc-logo.svg']);
  assert.equal(splitUiPath('/assets/%2e%2e/package.json'), undefined);
  assert.equal(splitUiPath('\\..\\package.json'), undefined);

  const asset = resolveUiFile('\\assets\\qcc-logo.svg');
  assert.equal(asset.ok, true);
  assert.equal(asset.rel, 'assets/qcc-logo.svg');
  assert.equal(resolveUiFile('\\..\\package.json').ok, false);
});
