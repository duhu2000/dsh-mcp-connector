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

function extractAuthorizeUrls(logs) {
  return logs
    .filter((line) => line.includes('opening authorization page:'))
    .map((line) => line.slice(line.indexOf('opening authorization page:') + 'opening authorization page:'.length).trim());
}

async function autoApprove(logs) {
  const authorizeUrl = await waitFor(() => (logs.some((l) => l.includes('opening authorization page:')) ? extractAuthorizeUrl(logs) : null));
  await fetch(`${authorizeUrl}&auto=1`, { redirect: 'follow' });
}

async function autoApproveAt(logs, index) {
  const authorizeUrl = await waitFor(() => extractAuthorizeUrls(logs)[index]);
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

test('同一连接器并发点击 OAuth 连接时只发起一次授权', { timeout: 30000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company'] });
  const { ctx, tools, logs, tables } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  const connector = {
    id: 'oauth-concurrent',
    name: '并发授权演示',
    category: '开发工具',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'test-client' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'oauth-concurrent-company', transport: 'streamable-http', headers: {} }],
  };

  try {
    await apply(ctx, baseConfig({ connectors: [connector] }));
    const connect = tools.defs.get('mcp_connector_connect');
    const first = connect.execute({ connectorId: connector.id }, { signal: undefined });
    const second = connect.execute({ connectorId: connector.id }, { signal: undefined });
    await autoApproveAt(logs, 0);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.ok, true, firstResult.message);
    assert.equal(secondResult.ok, true, secondResult.message);
    assert.equal(firstResult.detail.grantKey, secondResult.detail.grantKey);
    assert.equal(extractAuthorizeUrls(logs).length, 1, '只应打开一个授权页面');
    assert.equal([...tables.get('grants').entries()].length, 1, '只应保存一组 grant');
  } finally {
    await oauth.close();
  }
});

test('重新 OAuth 授权成功后撤销并删除已不再引用的旧 grant', { timeout: 30000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company'], uniqueClientIds: true });
  const { ctx, tools, logs, tables } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  const connector = {
    id: 'oauth-reauth',
    name: '重新授权演示',
    category: '开发工具',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'test-client' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'oauth-reauth-company', transport: 'streamable-http', headers: {} }],
  };

  try {
    await apply(ctx, baseConfig({ connectors: [connector] }));
    const connect = tools.defs.get('mcp_connector_connect');

    const first = connect.execute({ connectorId: connector.id }, { signal: undefined });
    await autoApproveAt(logs, 0);
    const firstResult = await first;
    assert.equal(firstResult.ok, true, firstResult.message);

    const second = connect.execute({ connectorId: connector.id }, { signal: undefined });
    await autoApproveAt(logs, 1);
    const secondResult = await second;
    assert.equal(secondResult.ok, true, secondResult.message);
    assert.notEqual(secondResult.detail.grantKey, firstResult.detail.grantKey);
    assert.equal(secondResult.detail.retiredGrantCount, 1);
    assert.equal(await tables.get('grants').get(firstResult.detail.grantKey), undefined, '旧 grant 应从本地存储删除');
    assert.equal([...tables.get('grants').entries()].length, 1, '重新授权后只保留当前 grant');
    assert.equal(oauth.state.revokedRefresh.size, 1, '旧 refresh token 应尽力撤销');
  } finally {
    await oauth.close();
  }
});

test('启动时自动清理历史孤立 grant，并保留连接仍引用的 grant', async () => {
  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
  const now = Date.now();
  const referencedKey = 'grant:default:referenced';
  const orphanKey = 'grant:default:orphan';
  const grantBase = {
    issuer: 'https://oauth.example.com',
    clientName: 'startup-prune-test',
    scope: 'mcp:tools',
    account: 'default',
    accessToken: 'test-access-token',
    accessTokenExpiresAt: now + 60_000,
    refreshToken: 'test-refresh-token',
    authorizedResources: ['https://mcp.example.com/stream'],
    connectorIds: ['startup-prune'],
    updatedAt: now,
  };
  await shared.tables.get('grants').put(referencedKey, { ...grantBase, key: referencedKey, clientId: 'referenced-client' });
  await shared.tables.get('grants').put(orphanKey, { ...grantBase, key: orphanKey, clientId: 'orphan-client' });
  await shared.tables.get('connections').put('startup-prune-server', {
    key: 'startup-prune-server',
    connectorId: 'startup-prune',
    kind: 'oauth',
    name: '启动清理演示',
    serverKey: 'server',
    transport: 'streamable-http',
    url: 'https://mcp.example.com/stream',
    serverName: 'startup-prune-server',
    headers: {},
    auth: { mode: 'oauth', grantKey: referencedKey },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const { ctx, logs } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());

  assert.ok(await shared.tables.get('grants').get(referencedKey), '连接仍引用的 grant 必须保留');
  assert.equal(await shared.tables.get('grants').get(orphanKey), undefined, '历史孤立 grant 应删除');
  assert.equal([...shared.tables.get('grants').entries()].length, 1);
  assert.ok(logs.some((line) => line.includes('removed 1 unreferenced OAuth grant(s)')));
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
  const manualServer = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'manual', version: '1' } } }));
  });
  await new Promise((resolve) => manualServer.listen(0, '127.0.0.1', resolve));
  const manualUrl = `http://127.0.0.1:${manualServer.address().port}/mcp`;
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());

  try {
    const conf = await tools.defs.get('mcp_connector_configure').execute({
      name: '我的数据源',
      url: manualUrl,
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
  } finally {
    await new Promise((resolve) => manualServer.close(resolve));
  }
});

test('市场 Bearer 连接器一次填写凭据批量连接全部 Server', { timeout: 15000 }, async () => {
  const marketServer = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    if (req.headers.authorization !== 'Bearer shared-token') {
      res.writeHead(401); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'legal', version: '1' } } }));
  });
  await new Promise((resolve) => marketServer.listen(0, '127.0.0.1', resolve));
  const marketBase = `http://127.0.0.1:${marketServer.address().port}`;
  const connectors = [{
    id: 'legal-market',
    name: '法律数据市场',
    auth: { mode: 'bearer' },
    servers: [
      { serverKey: 'law', url: `${marketBase}/mcp-law`, serverName: 'legal-law', headers: { Accept: 'application/json, text/event-stream' } },
      { serverKey: 'case', url: `${marketBase}/mcp-case`, serverName: 'legal-case' },
    ],
  }];
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));

  try {
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
    assert.equal(catalog.detail.items.find((item) => item.id === 'legal-market')?.connectionState, 'healthy');
  } finally {
    await new Promise((resolve) => marketServer.close(resolve));
  }
});

test('市场凭据校验失败时不进入已安装、不持久化 Key', { timeout: 15000 }, async () => {
  const authServer = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(401); res.end();
  });
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${authServer.address().port}/mcp`;
  const connectors = [{
    id: 'wind-invalid',
    name: 'Wind Invalid',
    auth: { mode: 'bearer' },
    servers: [{ serverKey: 'stock', url, serverName: 'wind-invalid', headers: {} }],
  }];
  const { ctx, loader, tools, tables } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));
  try {
    const configured = await tools.defs.get('mcp_connector_configure').execute({ connectorId: 'wind-invalid', bearerToken: 'wrong-key' });
    assert.equal(configured.ok, false);
    assert.match(configured.message, /连接验证失败/);
    assert.match(configured.message, /未保存连接/);
    assert.equal(loader.entries.size, 0);
    assert.equal((await tools.defs.get('mcp_connector_status').execute({})).detail.items.length, 0);
    assert.equal([...tables.get('connections').entries()].length, 0);
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
  }
});

test('凭据型连接器在有状态会话中携带 Bearer Token 并加载全部工具分页', { timeout: 15000 }, async () => {
  const seen = { methods: [], authorization: [], sessionIds: [], protocolVersions: [], cursors: [] };
  const sessionId = 'session-for-tools-list';
  const mcpServer = createServer(async (req, res) => {
    seen.authorization.push(req.headers.authorization);
    seen.sessionIds.push(req.headers['mcp-session-id']);
    seen.protocolVersions.push(req.headers['mcp-protocol-version']);
    if (req.method === 'DELETE') {
      seen.methods.push('DELETE');
      res.writeHead(req.headers['mcp-session-id'] === sessionId ? 204 : 400);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const method = body.method;
    seen.methods.push(method);
    if (method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'wind', version: '1' } } }));
      return;
    }
    if (req.headers['mcp-session-id'] !== sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing session id' }));
      return;
    }
    if (method === 'notifications/initialized') {
      res.writeHead(202); res.end(); return;
    }
    seen.cursors.push(body.params?.cursor);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body.params?.cursor
      ? { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'history', description: '查询历史行情' }] } }
      : { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'quote', description: '查询行情' }], nextCursor: 'page-2' } }));
  });
  await new Promise((resolve) => mcpServer.listen(0, '127.0.0.1', resolve));
  const port = mcpServer.address().port;

  try {
    const connectors = [{
      id: 'wind-demo',
      name: 'Wind Demo',
      auth: { mode: 'bearer' },
      servers: [{ serverKey: 'stock', url: `http://127.0.0.1:${port}/mcp`, serverName: 'wind-demo', headers: {} }],
    }];
    const { ctx, tools } = makePluginContext();
    const { apply } = await import('../lib/index.js');
    await apply(ctx, baseConfig({ connectors }));

    const configured = await tools.defs.get('mcp_connector_configure').execute({
      connectorId: 'wind-demo',
      bearerToken: 'wind-key',
    });
    assert.equal(configured.ok, true, configured.message);

    const listed = await tools.defs.get('mcp_connector_tools_list').execute({ connectorId: 'wind-demo' });
    assert.equal(listed.ok, true, listed.message);
    assert.equal(listed.detail.totalTools, 2);
    assert.deepEqual(listed.detail.servers[0].tools.map((tool) => tool.name), ['quote', 'history']);
    assert.deepEqual(seen.methods, ['initialize', 'initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'DELETE']);
    assert.deepEqual(seen.cursors, [undefined, 'page-2']);
    assert.ok(seen.authorization.every((header) => header === 'Bearer wind-key'));
    assert.equal(seen.sessionIds[2], sessionId, 'initialized 通知必须携带会话头');
    assert.equal(seen.sessionIds[3], sessionId, 'tools/list 必须携带会话头');
    assert.equal(seen.protocolVersions[3], '2025-03-26');
    assert.equal(seen.protocolVersions[4], '2025-03-26');
  } finally {
    await new Promise((resolve) => mcpServer.close(resolve));
  }
});

test('历史凭据失效导致所有 Server 失败时 toolsList 明确返回不可用', { timeout: 15000 }, async () => {
  let allow = true;
  const mcpServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!allow) { res.writeHead(401); res.end(); return; }
    const method = JSON.parse(Buffer.concat(chunks).toString('utf8')).method;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(method === 'initialize'
      ? { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'wind', version: '1' } } }
      : { jsonrpc: '2.0', id: 1, result: { tools: [] } }));
  });
  await new Promise((resolve) => mcpServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${mcpServer.address().port}/mcp`;
  const connectors = [{ id: 'wind-expired', name: 'Wind Expired', auth: { mode: 'bearer' }, servers: [{ serverKey: 'stock', url, serverName: 'wind-expired', headers: {} }] }];
  const { ctx, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));
  try {
    const configured = await tools.defs.get('mcp_connector_configure').execute({ connectorId: 'wind-expired', bearerToken: 'initially-valid' });
    assert.equal(configured.ok, true, configured.message);
    allow = false;
    const listed = await tools.defs.get('mcp_connector_tools_list').execute({ connectorId: 'wind-expired' });
    assert.equal(listed.ok, false);
    assert.equal(listed.detail.availableServers, 0);
    assert.equal(listed.detail.failedServers, 1);
    assert.match(listed.detail.servers[0].error, /凭据无效|权限/);
    assert.equal(listed.detail.connectionState, 'reauth');
    const health = await tools.defs.get('mcp_connector_health_check').execute({ connectorId: 'wind-expired' });
    assert.equal(health.ok, true);
    assert.equal(health.detail.items[0].connectionState, 'reauth');
    const catalog = await tools.defs.get('mcp_connector_catalog').execute({ keyword: 'Wind Expired' });
    assert.equal(catalog.detail.items[0].connectionState, 'reauth');
    assert.equal(catalog.detail.items[0].connectionLabel, '需重新授权');
    const status = await tools.defs.get('mcp_connector_status').execute({});
    assert.equal(status.detail.items[0].connectionState, 'reauth');
  } finally {
    await new Promise((resolve) => mcpServer.close(resolve));
  }
});

test('未配置远程目录时刷新市场也返回正常用户提示', async () => {
  const { ctx, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());
  const refreshed = await tools.defs.get('mcp_connector_refresh_catalog').execute({});
  assert.equal(refreshed.ok, true);
  assert.match(refreshed.message, /^市场已刷新，共 \d+ 个连接器$/);
  assert.doesNotMatch(refreshed.message, /catalogUrl|无远程目录/);
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
