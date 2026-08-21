import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMockQccServer } from './mock-oauth-server.mjs';

/* ───────────────────────── fake cordis ctx ───────────────────────── */

function makeTable() {
  const map = new Map();
  return {
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      return map.delete(key);
    },
    entries() {
      return [...map.entries()][Symbol.iterator]();
    },
  };
}

function makeLoader() {
  const entries = new Map();
  return {
    entries,
    async create({ id, name, config, disabled }) {
      entries.set(id, { id, name, options: { config }, disabled });
    },
    async update(id, patch) {
      const e = entries.get(id);
      if (!e) throw new Error(`entry ${id} not found`);
      if ('config' in patch) e.options.config = patch.config;
      if ('disabled' in patch) e.disabled = patch.disabled;
    },
    async remove(id) {
      entries.delete(id);
    },
    resolve(id) {
      const e = entries.get(id);
      if (!e) throw new Error(`entry ${id} not found`);
      return e;
    },
  };
}

function makeToolsRegistry() {
  const defs = new Map();
  return {
    defs,
    register(def) {
      defs.set(def.name, def);
      return () => {};
    },
  };
}

function makePluginContext({ shared } = {}) {
  const logs = [];
  const loader = makeLoader();
  const tools = makeToolsRegistry();
  const tables = shared?.tables ?? new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]);
  const domain = { tables, close: async () => {} };
  const disposers = [];
  const ctx = {
    loader,
    tools,
    storageDomain: { open: async () => domain },
    logger: () => ({
      info: (m) => logs.push(`[info] ${m}`),
      warn: (m) => logs.push(`[warn] ${m}`),
      error: (m) => logs.push(`[error] ${m}`),
    }),
    effect(fn) {
      const d = fn();
      if (typeof d === 'function') disposers.push(d);
    },
  };
  return { ctx, loader, tools, domain, tables, logs, disposers };
}

function baseConfig(overrides = {}) {
  return {
    catalogUrl: '',
    catalogTtlMs: 3600_000,
    connectors: [],
    persistSecrets: true,
    entryPrefix: 'mcp',
    callbackTimeoutMs: 30_000,
    requestTimeoutMs: 5_000,
    refreshSkewMs: 300_000,
    openBrowser: false,
    account: 'default',
    ...overrides,
  };
}

async function waitFor(fn, { timeout = 5000, interval = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, interval));
  }
}

function extractAuthorizeUrl(logs) {
  const line = logs.find((l) => l.includes('opening authorization page:'));
  return line.slice(line.indexOf('opening authorization page:') + 'opening authorization page:'.length).trim();
}

async function autoApprove(logs) {
  const authorizeUrl = await waitFor(() => (logs.some((l) => l.includes('opening authorization page:')) ? extractAuthorizeUrl(logs) : null));
  await fetch(`${authorizeUrl}&auto=1`, { redirect: 'follow' });
}

/* ───────────────────────── tests ───────────────────────── */

test('OAuth 一键连接：授权 → 挂载 mcp-client 条目 → 状态', { timeout: 30000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company', 'risk'] });
  const { ctx, loader, tools, logs } = makePluginContext();
  const { apply, Config } = await import('../lib/index.js');

  const connector = {
    id: 'acme',
    name: 'ACME 演示',
    category: '开发工具',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'test-client' },
    servers: [
      { serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'acme-company', transport: 'streamable-http', headers: {} },
      { serverKey: 'risk', url: `${oauth.base}/mcp/risk/stream`, serverName: 'acme-risk', transport: 'streamable-http', headers: {} },
    ],
  };

  await apply(ctx, baseConfig({ connectors: [connector] }));
  const connectTool = tools.defs.get('mcp_connector_connect');
  assert.ok(connectTool, 'connect tool registered');

  const promise = connectTool.execute({ connectorId: 'acme' }, { signal: undefined });
  await autoApprove(logs);
  const result = await promise;

  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.detail.keys.sort(), ['acme-company', 'acme-risk']);

  const e1 = loader.entries.get('mcp-acme-company');
  const e2 = loader.entries.get('mcp-acme-risk');
  assert.ok(e1 && e2, '两个受管条目已创建');
  assert.match(e1.options.config.headers.Authorization, /^Bearer /);
  assert.equal(e1.options.config.serverName, 'acme-company');

  const status = await tools.defs.get('mcp_connector_status').execute({});
  assert.equal(status.ok, true);
  assert.equal(status.detail.items.length, 2);
  assert.equal(status.detail.items[0].authMode, 'oauth');

  await oauth.close();
});

test('无鉴权 / api-key 连接器：none 直连、api-key 引导 configure', { timeout: 15000 }, async () => {
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');

  const connectors = [
    {
      id: 'none-demo',
      name: '免鉴权演示',
      auth: { mode: 'none' },
      servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'none-a', transport: 'streamable-http', headers: {} }],
    },
    {
      id: 'apikey-demo',
      name: '密钥演示',
      auth: { mode: 'api-key', apiKeyHeader: 'X-Api-Key' },
      servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'key-a', transport: 'streamable-http', headers: {} }],
    },
  ];
  await apply(ctx, baseConfig({ connectors }));

  const connect = tools.defs.get('mcp_connector_connect');
  const none = await connect.execute({ connectorId: 'none-demo' }, { signal: undefined });
  assert.equal(none.ok, true);
  assert.ok(loader.entries.has('mcp-none-demo-a'));

  const key = await connect.execute({ connectorId: 'apikey-demo' }, { signal: undefined });
  assert.equal(key.ok, false);
  assert.match(key.message, /mcp_connector_configure/);
});

test('自定义 configure + JSON 导入 + 停用/断开', { timeout: 15000 }, async () => {
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());

  const conf = await tools.defs.get('mcp_connector_configure').execute({
    name: '我的数据源',
    url: 'https://mcp.example.com/stream',
    serverName: 'my',
    authMode: 'bearer',
    bearerToken: 'tok',
  });
  assert.equal(conf.ok, true, conf.message);
  const key = conf.detail.key;
  assert.equal(key, 'custom-my');
  assert.equal(loader.entries.get('mcp-custom-my').options.config.headers.Authorization, 'Bearer tok');

  const imp = await tools.defs.get('mcp_connector_import_json').execute({
    json: JSON.stringify({ mcpServers: { vendor: { type: 'streamable-http', url: 'https://vendor.example.com/mcp/stream', headers: { Authorization: 'Bearer vtok' } } } }),
  });
  assert.equal(imp.ok, true, imp.message);
  assert.equal(imp.detail.keys.length, 1);
  assert.equal(loader.entries.get('mcp-json-vendor').options.config.headers.Authorization, 'Bearer vtok');

  const off = await tools.defs.get('mcp_connector_set_enabled').execute({ key, enabled: false });
  assert.equal(off.ok, true);
  assert.equal(loader.entries.get(`mcp-${key}`).disabled, true);

  const dis = await tools.defs.get('mcp_connector_disconnect').execute({ key }, { signal: undefined });
  assert.equal(dis.ok, true);
  assert.equal(loader.entries.has(`mcp-${key}`), false);
});

test('市场 Bearer 连接器一次填写凭据批量连接全部 Server', { timeout: 15000 }, async () => {
  const connectors = [{
    id: 'legal-market',
    name: '法律数据市场',
    auth: { mode: 'bearer' },
    servers: [
      { serverKey: 'law', url: 'https://legal.example.com/mcp-law', serverName: 'legal-law', headers: { Accept: 'application/json, text/event-stream' } },
      { serverKey: 'case', url: 'https://legal.example.com/mcp-case', serverName: 'legal-case' },
    ],
  }];
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));

  const configured = await tools.defs.get('mcp_connector_configure').execute({
    connectorId: 'legal-market',
    bearerToken: 'shared-token',
  });
  assert.equal(configured.ok, true, configured.message);
  assert.deepEqual(configured.detail.keys, ['legal-market-law', 'legal-market-case']);
  assert.equal(loader.entries.get('mcp-legal-market-law').options.config.headers.Authorization, 'Bearer shared-token');
  assert.equal(loader.entries.get('mcp-legal-market-law').options.config.headers.Accept, 'application/json, text/event-stream');
  assert.equal(loader.entries.get('mcp-legal-market-case').options.config.headers.Authorization, 'Bearer shared-token');

  const status = await tools.defs.get('mcp_connector_status').execute({});
  assert.equal(status.detail.items.filter((item) => item.connectorId === 'legal-market').length, 2);
  const catalog = await tools.defs.get('mcp_connector_catalog').execute({});
  assert.equal(catalog.detail.items.find((item) => item.id === 'legal-market')?.connected.length, 2);
});

test('URL 安装 + 目录上下架', { timeout: 15000 }, async () => {
  const catalogSrv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'url-demo',
        name: 'URL 安装演示',
        auth: { mode: 'none' },
        servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'url-a', transport: 'streamable-http', headers: {} }],
      }),
    );
  });
  await new Promise((r) => catalogSrv.listen(0, '127.0.0.1', r));
  const port = catalogSrv.address().port;

  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
  const { ctx, tools, tables } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());

  const installed = await tools.defs.get('mcp_connector_install_from_url').execute({ url: `http://127.0.0.1:${port}/connector.json` });
  assert.equal(installed.ok, true, installed.message);

  const cat = await tools.defs.get('mcp_connector_catalog').execute({ keyword: 'URL 安装' });
  assert.equal(cat.ok, true);
  assert.equal(cat.detail.items.length, 1);
  assert.equal(cat.detail.items[0].id, 'url-demo');
  assert.equal((await tables.get('catalog').get('dynamic')).connectors[0].id, 'url-demo', 'URL 安装描述应持久化');

  const restarted = makePluginContext({ shared });
  await apply(restarted.ctx, baseConfig());
  const restoredCatalog = await restarted.tools.defs.get('mcp_connector_catalog').execute({ keyword: 'URL 安装' });
  assert.equal(restoredCatalog.detail.items[0].id, 'url-demo', '重启后应恢复 URL 安装的目录条目');

  const pub = await tools.defs.get('mcp_connector_publish').execute({ connectorId: 'url-demo', published: false });
  assert.equal(pub.ok, true);
  const cat2 = await tools.defs.get('mcp_connector_catalog').execute({ keyword: 'URL 安装' });
  assert.equal(cat2.detail.items.length, 0, '下架后不可见');

  catalogSrv.close();
});

test('重启恢复：连接记录持久化并重新挂载条目', { timeout: 30000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company'] });
  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };

  const first = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  const connector = {
    id: 'acme',
    name: 'ACME',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'test' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'acme-company', transport: 'streamable-http', headers: {} }],
  };
  await apply(first.ctx, baseConfig({ connectors: [connector] }));
  const promise = first.tools.defs.get('mcp_connector_connect').execute({ connectorId: 'acme' }, { signal: undefined });
  await autoApprove(first.logs);
  await promise;
  assert.ok(first.loader.entries.has('mcp-acme-company'));

  // 模拟重启：同一份表，新的 ctx
  const second = makePluginContext({ shared });
  await apply(second.ctx, baseConfig({ connectors: [connector] }));
  assert.ok(second.loader.entries.has('mcp-acme-company'), '重启后恢复条目');
  assert.match(second.loader.entries.get('mcp-acme-company').options.config.headers.Authorization, /^Bearer /);

  const status = await second.tools.defs.get('mcp_connector_status').execute({});
  assert.equal(status.detail.items.length, 1);

  await oauth.close();
});
