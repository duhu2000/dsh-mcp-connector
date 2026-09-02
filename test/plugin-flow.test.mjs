import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function makeLoader({ onCreate, onUpdate } = {}) {
  const entries = new Map();
  return {
    entries,
    async create({ id, name, config, disabled }) {
      await onCreate?.({ id, name, config, disabled });
      entries.set(id, { id, name, options: { config }, disabled });
    },
    async update(id, patch) {
      const e = entries.get(id);
      if (!e) throw new Error(`entry ${id} not found`);
      await onUpdate?.({ id, patch, entry: e });
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
      return () => defs.delete(def.name);
    },
    schemas() {
      return [...defs.values()].map(({ name, description = '', parameters = {} }) => ({ name, description, parameters }));
    },
  };
}

function makePluginContext({ shared, loaderHooks } = {}) {
  const logs = [];
  const loader = makeLoader(loaderHooks);
  const tools = makeToolsRegistry();
  const tables = shared?.tables ?? new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()], ['snapshots', makeTable()]]);
  if (!tables.has('snapshots')) tables.set('snapshots', makeTable());
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

  const snapshotTool = tools.defs.get('mcp_connector_snapshot');
  const preview = await snapshotTool.execute({ action: 'preview', snapshotId: result.detail.snapshotId });
  assert.equal(preview.ok, true);
  assert.equal(preview.detail.oauthRemovalCount, 2);
  const restored = await snapshotTool.execute({ action: 'restore', snapshotId: result.detail.snapshotId });
  assert.equal(restored.ok, true, restored.message);
  assert.equal(restored.detail.retiredGrantCount, 1);
  assert.equal(loader.entries.size, 0);
  assert.equal(oauth.state.revokedRefresh.size, 1, '恢复到连接前状态会撤销不再共享的 OAuth Grant');

  await oauth.close();
});

test('OAuth DCR client_secret_post/basic：换取、刷新和撤销均使用动态客户端密钥且不对外泄露', { timeout: 30000 }, async () => {
  for (const tokenEndpointAuthMethod of ['client_secret_post', 'client_secret_basic']) {
    const oauth = await createMockQccServer({
      tokenResources: ['company'],
      tokenEndpointAuthMethod,
    });
    const { ctx, tools, logs, tables } = makePluginContext();
    const { apply } = await import('../lib/index.js');
    const connector = {
      id: `oauth-${tokenEndpointAuthMethod}`,
      name: `OAuth ${tokenEndpointAuthMethod}`,
      category: '开发工具',
      auth: {
        mode: 'oauth2-pkce',
        issuer: oauth.base,
        scope: 'mcp:tools',
        clientName: 'dcr-secret-test',
        tokenEndpointAuthMethod,
      },
      servers: [{
        serverKey: 'company',
        url: `${oauth.base}/mcp/company/stream`,
        serverName: `oauth-${tokenEndpointAuthMethod}`,
        transport: 'streamable-http',
        headers: {},
      }],
    };

    try {
      await apply(ctx, baseConfig({ connectors: [connector] }));
      const pending = tools.defs.get('mcp_connector_connect').execute({ connectorId: connector.id }, { signal: undefined });
      await autoApprove(logs);
      const connected = await pending;
      assert.equal(connected.ok, true, connected.message);

      const grants = [...tables.get('grants').entries()];
      assert.equal(grants.length, 1);
      assert.equal(grants[0][1].clientSecret, oauth.state.clientSecret);
      assert.equal(grants[0][1].tokenEndpointAuthMethod, tokenEndpointAuthMethod);

      const catalog = await tools.defs.get('mcp_connector_catalog').execute({ keyword: connector.id });
      const status = await tools.defs.get('mcp_connector_status').execute({});
      const publicOutput = JSON.stringify({ connected, catalog, status, logs });
      assert.doesNotMatch(publicOutput, new RegExp(oauth.state.clientSecret));

      const { discoverServerMetadata, refreshAccessToken } = await import('../lib/oauth.js');
      const metadata = await discoverServerMetadata(oauth.base, 5000);
      const refreshed = await refreshAccessToken(metadata.tokenEndpoint, {
        clientId: grants[0][1].clientId,
        clientSecret: grants[0][1].clientSecret,
        tokenEndpointAuthMethod: grants[0][1].tokenEndpointAuthMethod,
        refreshToken: grants[0][1].refreshToken,
        resource: grants[0][1].authorizedResources[0],
        scope: grants[0][1].scope,
        timeoutMs: 5000,
      });
      assert.ok(refreshed.accessToken.length > 0);
      assert.equal(oauth.state.refreshCount, 1);

      const disconnected = await tools.defs.get('mcp_connector_disconnect').execute({ key: `${connector.id}-company` }, { signal: undefined });
      assert.equal(disconnected.ok, true, disconnected.message);
      assert.ok(oauth.state.clientAuthMethods.length >= 3, '应至少覆盖 code exchange、refresh、revoke');
      assert.ok(oauth.state.clientAuthMethods.every((method) => method === tokenEndpointAuthMethod));
    } finally {
      await oauth.close();
    }
  }
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

test('grantSharing=issuer：第二张同 issuer 卡片复用首张授权，不再打开授权页', { timeout: 30000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company', 'risk'] });
  const { ctx, tools, logs, tables, loader } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  const sharedAuth = {
    mode: 'oauth2-pkce',
    issuer: oauth.base,
    scope: 'mcp:tools',
    clientName: 'shared-grant-test',
    grantSharing: 'issuer',
  };
  const connectors = [
    {
      id: 'shared-company', name: '共享企业数据', auth: sharedAuth,
      servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'shared-company', transport: 'streamable-http', headers: {} }],
    },
    {
      id: 'shared-risk', name: '共享风险数据', auth: sharedAuth,
      servers: [{ serverKey: 'risk', url: `${oauth.base}/mcp/risk/stream`, serverName: 'shared-risk', transport: 'streamable-http', headers: {} }],
    },
  ];

  try {
    await apply(ctx, baseConfig({ connectors }));
    const connect = tools.defs.get('mcp_connector_connect');
    const first = connect.execute({ connectorId: 'shared-company' }, { signal: undefined });
    await autoApproveAt(logs, 0);
    const firstResult = await first;
    assert.equal(firstResult.ok, true, firstResult.message);
    assert.ok(loader.entries.has('mcp-shared-company-company'));
    assert.equal(loader.entries.has('mcp-shared-risk-risk'), false, '首次只启用用户点击的卡片');

    const secondResult = await connect.execute({ connectorId: 'shared-risk' }, { signal: undefined });
    assert.equal(secondResult.ok, true, secondResult.message);
    assert.equal(secondResult.detail.reusedGrant, true);
    assert.ok(loader.entries.has('mcp-shared-risk-risk'));
    assert.equal(extractAuthorizeUrls(logs).length, 1, '第二张卡片不得再次弹 OAuth 页面');
    assert.equal(oauth.state.registrationCount, 1, '同 issuer 只注册一个动态客户端');

    const grants = [...tables.get('grants').entries()];
    assert.equal(grants.length, 1);
    assert.deepEqual(grants[0][1].connectorIds.sort(), ['shared-company', 'shared-risk']);
    assert.deepEqual(grants[0][1].authorizedResources.sort(), [
      `${oauth.base}/mcp/company/stream`,
      `${oauth.base}/mcp/risk/stream`,
    ].sort());
  } finally {
    await oauth.close();
  }
});

test('grantSharing=issuer：不同卡片并发连接也只发起一次授权', { timeout: 30000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company', 'risk'] });
  const { ctx, tools, logs, loader } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  const auth = { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'shared-concurrent', grantSharing: 'issuer' };
  const connectors = [
    { id: 'concurrent-company', name: '并发企业', auth, servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'concurrent-company', transport: 'streamable-http', headers: {} }] },
    { id: 'concurrent-risk', name: '并发风险', auth, servers: [{ serverKey: 'risk', url: `${oauth.base}/mcp/risk/stream`, serverName: 'concurrent-risk', transport: 'streamable-http', headers: {} }] },
  ];
  try {
    await apply(ctx, baseConfig({ connectors }));
    const connect = tools.defs.get('mcp_connector_connect');
    const first = connect.execute({ connectorId: 'concurrent-company' }, { signal: undefined });
    const second = connect.execute({ connectorId: 'concurrent-risk' }, { signal: undefined });
    await autoApproveAt(logs, 0);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.ok, true, firstResult.message);
    assert.equal(secondResult.ok, true, secondResult.message);
    assert.equal(extractAuthorizeUrls(logs).length, 1);
    assert.equal(oauth.state.registrationCount, 1);
    assert.ok(loader.entries.has('mcp-concurrent-company-company'));
    assert.ok(loader.entries.has('mcp-concurrent-risk-risk'));
  } finally {
    await oauth.close();
  }
});

test('升级启动时把历史同 issuer 多 Grant 归并为最新共享授权', async () => {
  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
  const auth = { mode: 'oauth2-pkce', issuer: 'https://oauth.example.com', scope: 'mcp:tools', clientName: 'upgrade-shared', grantSharing: 'issuer' };
  const connectors = [
    { id: 'upgrade-company', name: '历史企业', auth, servers: [{ serverKey: 'company', url: 'https://mcp.example.com/company', serverName: 'upgrade-company', transport: 'streamable-http', headers: {} }] },
    { id: 'upgrade-risk', name: '历史风险', auth, servers: [{ serverKey: 'risk', url: 'https://mcp.example.com/risk', serverName: 'upgrade-risk', transport: 'streamable-http', headers: {} }] },
  ];
  const resources = connectors.flatMap((connector) => connector.servers.map((server) => server.url));
  const now = Date.now();
  const oldKey = 'grant:default:historical-old';
  const newKey = 'grant:default:historical-new';
  await shared.tables.get('grants').put(oldKey, {
    key: oldKey, issuer: auth.issuer, clientId: 'old-client', scope: auth.scope, account: 'default',
    accessToken: 'old-access', accessTokenExpiresAt: now + 3_600_000, refreshToken: 'old-refresh',
    authorizedResources: resources, connectorIds: ['upgrade-company'], updatedAt: now - 10_000,
  });
  await shared.tables.get('grants').put(newKey, {
    key: newKey, issuer: auth.issuer, clientId: 'new-client', scope: auth.scope, account: 'default',
    accessToken: 'new-access', accessTokenExpiresAt: now + 3_600_000, refreshToken: 'new-refresh',
    authorizedResources: resources, connectorIds: ['upgrade-risk'], updatedAt: now,
  });
  for (const [connector, grantKey] of [[connectors[0], oldKey], [connectors[1], newKey]]) {
    const server = connector.servers[0];
    await shared.tables.get('connections').put(`${connector.id}-${server.serverKey}`, {
      key: `${connector.id}-${server.serverKey}`, connectorId: connector.id, kind: 'oauth', name: connector.name,
      serverKey: server.serverKey, transport: server.transport, url: server.url, serverName: server.serverName,
      headers: {}, auth: { mode: 'oauth', grantKey }, enabled: true, createdAt: now, updatedAt: now,
    });
  }

  const { ctx, tools, tables, logs } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));

  const status = await tools.defs.get('mcp_connector_status').execute({});
  assert.deepEqual([...new Set(status.detail.items.map((item) => item.grant.grantKey))], [newKey]);
  assert.equal([...tables.get('grants').entries()].length, 1);
  assert.deepEqual((await tables.get('grants').get(newKey)).connectorIds.sort(), ['upgrade-company', 'upgrade-risk']);
  assert.ok(logs.some((line) => line.includes('historical OAuth grant')));
});

test('历史最新 Grant 已失效时先验证并选择仍可刷新的共享授权', { timeout: 10000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company', 'risk'] });
  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
  const auth = { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'upgrade-validated', grantSharing: 'issuer' };
  const connectors = [
    { id: 'validated-company', name: '历史企业', auth, servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'validated-company', transport: 'streamable-http', headers: {} }] },
    { id: 'validated-risk', name: '历史风险', auth, servers: [{ serverKey: 'risk', url: `${oauth.base}/mcp/risk/stream`, serverName: 'validated-risk', transport: 'streamable-http', headers: {} }] },
  ];
  const resources = connectors.map((connector) => connector.servers[0].url);
  const now = Date.now();
  const validKey = 'grant:default:older-but-valid';
  const invalidKey = 'grant:default:newer-but-invalid';
  oauth.state.clients.set('valid-client', { clientSecret: undefined, tokenEndpointAuthMethod: 'none' });
  oauth.state.clients.set('invalid-client', { clientSecret: undefined, tokenEndpointAuthMethod: 'none' });
  oauth.state.refreshTokens.set('valid-refresh', { accessToken: 'expired', clientId: 'valid-client', expiresIn: 3600 });
  await shared.tables.get('grants').put(validKey, {
    key: validKey, issuer: oauth.base, clientId: 'valid-client', tokenEndpointAuthMethod: 'none',
    scope: auth.scope, account: 'default', accessToken: 'expired-valid', accessTokenExpiresAt: now - 1_000,
    refreshToken: 'valid-refresh', authorizedResources: resources, connectorIds: ['validated-company'], updatedAt: now - 10_000,
  });
  await shared.tables.get('grants').put(invalidKey, {
    key: invalidKey, issuer: oauth.base, clientId: 'invalid-client', tokenEndpointAuthMethod: 'none',
    scope: auth.scope, account: 'default', accessToken: 'expired-invalid', accessTokenExpiresAt: now - 1_000,
    refreshToken: 'invalid-refresh', authorizedResources: resources, connectorIds: ['validated-risk'], updatedAt: now,
  });
  for (const [connector, grantKey] of [[connectors[0], validKey], [connectors[1], invalidKey]]) {
    const server = connector.servers[0];
    await shared.tables.get('connections').put(`${connector.id}-${server.serverKey}`, {
      key: `${connector.id}-${server.serverKey}`, connectorId: connector.id, kind: 'oauth', name: connector.name,
      serverKey: server.serverKey, transport: server.transport, url: server.url, serverName: server.serverName,
      headers: {}, auth: { mode: 'oauth', grantKey }, enabled: true, createdAt: now, updatedAt: now,
    });
  }

  const { ctx, tools, tables } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  try {
    await apply(ctx, baseConfig({ connectors }));
    const status = await tools.defs.get('mcp_connector_status').execute({});
    assert.deepEqual([...new Set(status.detail.items.map((item) => item.grant.grantKey))], [validKey]);
    assert.equal([...tables.get('grants').entries()].length, 1);
    assert.equal(oauth.state.refreshAttempts, 2, '应先拒绝新的失效 Grant，再刷新较旧的有效 Grant');
    assert.equal(oauth.state.refreshCount, 1);
  } finally {
    await oauth.close();
  }
});

test('并发进程轮换 refresh token 后重读持久化 Grant，避免误判重新授权', { timeout: 10000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company'] });
  const baseGrantTable = makeTable();
  let storageReads = 0;
  const grantKey = 'grant:default:rotated-elsewhere';
  const oldRefreshToken = 'refresh-token-used-by-other-process';
  const newRefreshToken = 'refresh-token-persisted-by-other-process';
  const now = Date.now();
  const connector = {
    id: 'refresh-rotation', name: '跨进程轮换',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'rotation-test' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'refresh-rotation-company', transport: 'streamable-http', headers: {} }],
  };
  oauth.state.clients.set('stored-client', { clientSecret: undefined, tokenEndpointAuthMethod: 'none' });
  oauth.state.refreshTokens.set(newRefreshToken, { accessToken: 'expired', clientId: 'stored-client', expiresIn: 3600 });
  const oldGrant = {
    key: grantKey, issuer: oauth.base, clientId: 'stored-client', tokenEndpointAuthMethod: 'none',
    scope: 'mcp:tools', account: 'default', accessToken: 'expired-access', accessTokenExpiresAt: now - 1_000,
    refreshToken: oldRefreshToken, authorizedResources: [connector.servers[0].url], connectorIds: [connector.id], updatedAt: now - 10_000,
  };
  const rotatedGrant = { ...oldGrant, refreshToken: newRefreshToken, updatedAt: now };
  await baseGrantTable.put(grantKey, oldGrant);
  const grants = {
    ...baseGrantTable,
    async get(key) {
      storageReads += 1;
      if (storageReads === 1) await baseGrantTable.put(grantKey, rotatedGrant);
      return baseGrantTable.get(key);
    },
  };
  const shared = { tables: new Map([['connections', makeTable()], ['grants', grants], ['catalog', makeTable()]]) };
  await shared.tables.get('connections').put('refresh-rotation-company', {
    key: 'refresh-rotation-company', connectorId: connector.id, kind: 'oauth', name: connector.name,
    serverKey: 'company', transport: 'streamable-http', url: connector.servers[0].url,
    serverName: 'refresh-rotation-company', headers: {}, auth: { mode: 'oauth', grantKey },
    enabled: true, createdAt: now, updatedAt: now,
  });
  const { ctx, tools, loader, logs } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  try {
    await apply(ctx, baseConfig({ connectors: [connector] }));
    const status = await tools.defs.get('mcp_connector_status').execute({});
    assert.equal(status.detail.items[0].grant.needsReauth, false);
    assert.ok(loader.entries.has('mcp-refresh-rotation-company'));
    assert.equal(oauth.state.refreshCount, 1);
    assert.ok(logs.some((line) => /concurrent rotation|cross-process journal token/.test(line)));
  } finally {
    await oauth.close();
  }
});

test('两个 DSH Host 同时刷新时只轮换一次 Refresh Token', { timeout: 15000 }, async () => {
  const oauth = await createMockQccServer({ tokenResources: ['company'] });
  const journalDir = await mkdtemp(join(tmpdir(), 'mcp-cross-process-'));
  const grantKey = 'grant:default:cross-process';
  const now = Date.now();
  const connector = {
    id: 'cross-process', name: '跨 Host 刷新',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'cross-process-test' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'cross-process-company', transport: 'streamable-http', headers: {} }],
  };
  oauth.state.clients.set('cross-process-client', { clientSecret: undefined, tokenEndpointAuthMethod: 'none' });
  oauth.state.refreshTokens.set('cross-process-refresh', {
    accessToken: 'expired', clientId: 'cross-process-client', expiresIn: 3600,
  });
  const storedGrant = {
    key: grantKey, issuer: oauth.base, clientId: 'cross-process-client', tokenEndpointAuthMethod: 'none',
    scope: 'mcp:tools', account: 'default', accessToken: 'expired-access', accessTokenExpiresAt: now - 1_000,
    refreshToken: 'cross-process-refresh', authorizedResources: [connector.servers[0].url],
    connectorIds: [connector.id], updatedAt: now - 10_000,
  };
  function hostState() {
    const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
    return shared.tables.get('grants').put(grantKey, { ...storedGrant }).then(async () => {
      await shared.tables.get('connections').put('cross-process-company', {
        key: 'cross-process-company', connectorId: connector.id, kind: 'oauth', name: connector.name,
        serverKey: 'company', transport: 'streamable-http', url: connector.servers[0].url,
        serverName: 'cross-process-company', headers: {}, auth: { mode: 'oauth', grantKey },
        enabled: true, createdAt: now, updatedAt: now,
      });
      return shared;
    });
  }
  try {
    const [sharedA, sharedB] = await Promise.all([hostState(), hostState()]);
    const hostA = makePluginContext({ shared: sharedA });
    const hostB = makePluginContext({ shared: sharedB });
    const { apply } = await import('../lib/index.js');
    await Promise.all([
      apply(hostA.ctx, baseConfig({ connectors: [connector], __grantJournalDir: journalDir })),
      apply(hostB.ctx, baseConfig({ connectors: [connector], __grantJournalDir: journalDir })),
    ]);

    assert.equal(oauth.state.refreshCount, 1, '一次性 Refresh Token 只能被一个 Host 消耗');
    for (const host of [hostA, hostB]) {
      const status = await host.tools.defs.get('mcp_connector_status').execute({});
      assert.equal(status.detail.items[0].grant.needsReauth, false);
      assert.ok(host.loader.entries.has('mcp-cross-process-company'));
    }
    assert.ok(
      [...hostA.logs, ...hostB.logs].some((line) => line.includes('cross-process journal token')),
      '等待者应采用首个 Host 写入的新 Token',
    );
  } finally {
    await oauth.close();
    await rm(journalDir, { recursive: true, force: true });
  }
});

test('grantSharing=issuer 不跨 MCP 资源域复用 Bearer Token', { timeout: 30000 }, async () => {
  const firstOAuth = await createMockQccServer({ tokenResources: ['company'] });
  const secondOAuth = await createMockQccServer({ tokenResources: ['risk'] });
  const { ctx, tools, logs } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  const auth = { mode: 'oauth2-pkce', issuer: firstOAuth.base, scope: 'mcp:tools', clientName: 'origin-fence', grantSharing: 'issuer' };
  const connectors = [
    { id: 'origin-first', name: '域一', auth, servers: [{ serverKey: 'company', url: `${firstOAuth.base}/mcp/company/stream`, serverName: 'origin-first', transport: 'streamable-http', headers: {} }] },
    { id: 'origin-second', name: '域二', auth, servers: [{ serverKey: 'risk', url: `${secondOAuth.base}/mcp/risk/stream`, serverName: 'origin-second', transport: 'streamable-http', headers: {} }] },
  ];
  try {
    await apply(ctx, baseConfig({ connectors }));
    const connect = tools.defs.get('mcp_connector_connect');
    const first = connect.execute({ connectorId: 'origin-first' }, { signal: undefined });
    await autoApproveAt(logs, 0);
    assert.equal((await first).ok, true);

    const second = connect.execute({ connectorId: 'origin-second' }, { signal: undefined });
    await autoApproveAt(logs, 1);
    const secondResult = await second;
    assert.equal(secondResult.ok, true, secondResult.message);
    assert.equal(secondResult.detail.reusedGrant, undefined);
    assert.equal(extractAuthorizeUrls(logs).length, 2, '不同资源域必须分别授权，不能复用现有 Bearer Token');
    assert.equal(firstOAuth.state.registrationCount, 1);
    assert.equal(secondOAuth.state.registrationCount, 1);
  } finally {
    await firstOAuth.close();
    await secondOAuth.close();
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

test('启动刷新遇到暂时性 OAuth 故障时记录原因、自动重试且不要求重新授权', { timeout: 10000 }, async () => {
  const oauth = await createMockQccServer({ refreshFailures: 1 });
  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
  const grantKey = 'grant:default:transient';
  const refreshToken = 'sensitive-refresh-token-transient';
  const connector = {
    id: 'refresh-transient', name: '刷新暂时故障',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'refresh-test' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'refresh-transient-company', transport: 'streamable-http', headers: {} }],
  };
  oauth.state.clients.set('stored-client', { clientSecret: undefined, tokenEndpointAuthMethod: 'none' });
  oauth.state.refreshTokens.set(refreshToken, { accessToken: 'expired', clientId: 'stored-client', expiresIn: 3600 });
  await shared.tables.get('grants').put(grantKey, {
    key: grantKey, issuer: oauth.base, clientId: 'stored-client', tokenEndpointAuthMethod: 'none',
    scope: 'mcp:tools', account: 'default', accessToken: 'expired-access-token',
    accessTokenExpiresAt: Date.now() - 1_000, refreshToken,
    authorizedResources: [`${oauth.base}/mcp/company/stream`], connectorIds: [connector.id], updatedAt: Date.now(),
  });
  await shared.tables.get('connections').put('refresh-transient-company', {
    key: 'refresh-transient-company', connectorId: connector.id, kind: 'oauth', name: connector.name,
    serverKey: 'company', transport: 'streamable-http', url: `${oauth.base}/mcp/company/stream`,
    serverName: 'refresh-transient-company', headers: {}, auth: { mode: 'oauth', grantKey },
    enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
  });
  const { ctx, tools, logs, loader } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  try {
    await apply(ctx, baseConfig({ connectors: [connector], refreshRetryBaseMs: 1_000, refreshRetryMaxMs: 1_000 }));
    const statusDuringRetry = await tools.defs.get('mcp_connector_status').execute({});
    assert.equal(statusDuringRetry.detail.items[0].connectionState, 'recovering');
    assert.equal(statusDuringRetry.detail.items[0].grant.needsReauth, false);
    assert.equal(statusDuringRetry.detail.items[0].grant.refreshFailureKind, 'transient');
    assert.ok(logs.some((line) => line.includes('phase=startup') && line.includes('code=server_error') && line.includes('classification=transient')));
    assert.doesNotMatch(logs.join('\n'), new RegExp(refreshToken));

    await waitFor(() => oauth.state.refreshCount === 1 && loader.entries.has('mcp-refresh-transient-company'), { timeout: 5000 });
    const stored = await shared.tables.get('grants').get(grantKey);
    assert.ok(stored.accessTokenExpiresAt > Date.now() + 3_000_000, '成功刷新后应保存真实过期时间而不是减去 skew');
    assert.equal(oauth.state.refreshAttempts, 2);
  } finally {
    await oauth.close();
  }
});

test('启动刷新收到 invalid_grant 时才标记需重新授权，并记录可诊断错误码', { timeout: 10000 }, async () => {
  const oauth = await createMockQccServer();
  const shared = { tables: new Map([['connections', makeTable()], ['grants', makeTable()], ['catalog', makeTable()]]) };
  const grantKey = 'grant:default:permanent';
  const refreshToken = 'sensitive-refresh-token-permanent';
  const connector = {
    id: 'refresh-permanent', name: '刷新永久失效',
    auth: { mode: 'oauth2-pkce', issuer: oauth.base, scope: 'mcp:tools', clientName: 'refresh-test' },
    servers: [{ serverKey: 'company', url: `${oauth.base}/mcp/company/stream`, serverName: 'refresh-permanent-company', transport: 'streamable-http', headers: {} }],
  };
  oauth.state.clients.set('stored-client', { clientSecret: undefined, tokenEndpointAuthMethod: 'none' });
  await shared.tables.get('grants').put(grantKey, {
    key: grantKey, issuer: oauth.base, clientId: 'stored-client', tokenEndpointAuthMethod: 'none',
    scope: 'mcp:tools', account: 'default', accessToken: 'expired-access-token',
    accessTokenExpiresAt: Date.now() - 1_000, refreshToken,
    authorizedResources: [`${oauth.base}/mcp/company/stream`], connectorIds: [connector.id], updatedAt: Date.now(),
  });
  await shared.tables.get('connections').put('refresh-permanent-company', {
    key: 'refresh-permanent-company', connectorId: connector.id, kind: 'oauth', name: connector.name,
    serverKey: 'company', transport: 'streamable-http', url: `${oauth.base}/mcp/company/stream`,
    serverName: 'refresh-permanent-company', headers: {}, auth: { mode: 'oauth', grantKey },
    enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
  });
  const { ctx, tools, logs, loader } = makePluginContext({ shared });
  const { apply } = await import('../lib/index.js');
  try {
    await apply(ctx, baseConfig({ connectors: [connector] }));
    const status = await tools.defs.get('mcp_connector_status').execute({});
    assert.equal(status.detail.items[0].connectionState, 'reauth');
    assert.equal(status.detail.items[0].grant.needsReauth, true);
    assert.equal(status.detail.items[0].grant.refreshFailureKind, 'permanent');
    assert.equal(status.detail.items[0].grant.refreshRetryAt, null);
    assert.equal(loader.entries.has('mcp-refresh-permanent-company'), false, '不得用已过期 Token 启动 mcp-client');
    assert.ok(logs.some((line) => line.includes('phase=startup') && line.includes('code=invalid_grant') && line.includes('classification=permanent')));
    assert.doesNotMatch(logs.join('\n'), new RegExp(refreshToken));
  } finally {
    await oauth.close();
  }
});

test('检测到旧企查查 OAuth 插件仍启用时阻断同名 Server，避免凭据覆盖', async () => {
  const { ctx, tools, logs, loader } = makePluginContext();
  loader.entries.set('qcc-mcp-oauth', { id: 'qcc-mcp-oauth', disabled: false, options: { config: {} } });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());
  const result = await tools.defs.get('mcp_connector_connect').execute({ connectorId: 'qcc-company' }, { signal: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.detail.kind, 'plugin-conflict');
  assert.equal(result.detail.pluginId, 'qcc-mcp-oauth');
  assert.match(result.message, /停用旧插件并重启 DSH/);
  assert.ok(logs.some((line) => line.includes('legacy OAuth plugin conflict')));
  assert.equal(extractAuthorizeUrls(logs).length, 0);
});

test('无鉴权 / api-key 连接器：none 直连、api-key 引导 configure', { timeout: 15000 }, async () => {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'none', version: '1' } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');

  const connectors = [
    {
      id: 'none-demo',
      name: '免鉴权演示',
      auth: { mode: 'none' },
      servers: [{ serverKey: 'a', url, serverName: 'none-a', transport: 'streamable-http', headers: {} }],
    },
    {
      id: 'apikey-demo',
      name: '密钥演示',
      auth: { mode: 'api-key', apiKeyHeader: 'X-Api-Key' },
      servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'key-a', transport: 'streamable-http', headers: {} }],
    },
  ];
  await apply(ctx, baseConfig({ connectors }));

  try {
    const connect = tools.defs.get('mcp_connector_connect');
    const none = await connect.execute({ connectorId: 'none-demo' }, { signal: undefined });
    assert.equal(none.ok, true, none.message);
    assert.ok(loader.entries.has('mcp-none-demo-a'));

    const key = await connect.execute({ connectorId: 'apikey-demo' }, { signal: undefined });
    assert.equal(key.ok, false);
    assert.match(key.message, /mcp_connector_configure/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
      json: JSON.stringify({ mcpServers: { vendor: { type: 'streamable-http', url: manualUrl, headers: { Authorization: 'Bearer vtok' } } } }),
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

test('脱敏导出、配置快照预览与原子恢复可重复执行', { timeout: 15000 }, async () => {
  const manualServer = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'snapshot', version: '1' } } }));
  });
  await new Promise((resolve) => manualServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${manualServer.address().port}/mcp`;
  const { ctx, loader, tools, tables } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());

  try {
    const configure = tools.defs.get('mcp_connector_configure');
    const first = await configure.execute({ name: 'Snapshot Demo', serverName: 'snapshot-demo', url, authMode: 'bearer', bearerToken: 'old-token' });
    assert.equal(first.ok, true, first.message);
    assert.ok(first.detail.snapshotId);

    const second = await configure.execute({ name: 'Snapshot Demo', serverName: 'snapshot-demo', url, authMode: 'bearer', bearerToken: 'new-token' });
    assert.equal(second.ok, true, second.message);
    assert.equal(loader.entries.get('mcp-custom-snapshot-demo').options.config.headers.Authorization, 'Bearer new-token');

    const exported = await tools.defs.get('mcp_connector_export_config').execute({});
    assert.equal(exported.ok, true);
    assert.doesNotMatch(exported.detail.json, /old-token|new-token/);
    assert.match(exported.detail.json, /<REDACTED:REENTER>/);

    const snapshotTool = tools.defs.get('mcp_connector_snapshot');
    const listed = await snapshotTool.execute({ action: 'list' });
    assert.equal(listed.ok, true);
    assert.ok(listed.detail.items.some((item) => item.id === second.detail.snapshotId));
    assert.doesNotMatch(JSON.stringify(listed), /old-token|new-token/);

    const preview = await snapshotTool.execute({ action: 'preview', snapshotId: second.detail.snapshotId });
    assert.equal(preview.ok, true);
    assert.equal(preview.detail.restorable, true);
    assert.deepEqual(preview.detail.restoreKeys, ['custom-snapshot-demo']);

    const restored = await snapshotTool.execute({ action: 'restore', snapshotId: second.detail.snapshotId });
    assert.equal(restored.ok, true, restored.message);
    assert.equal(loader.entries.get('mcp-custom-snapshot-demo').options.config.headers.Authorization, 'Bearer old-token');
    const restoredAgain = await snapshotTool.execute({ action: 'restore', snapshotId: second.detail.snapshotId });
    assert.equal(restoredAgain.ok, true, restoredAgain.message);
    assert.equal([...tables.get('connections').entries()].length, 1);

    const disconnected = await tools.defs.get('mcp_connector_disconnect').execute({ key: 'custom-snapshot-demo' }, { signal: undefined });
    assert.equal(disconnected.ok, true);
    assert.equal(loader.entries.has('mcp-custom-snapshot-demo'), false);
    const undoDisconnect = await snapshotTool.execute({ action: 'restore', snapshotId: disconnected.detail.snapshotId });
    assert.equal(undoDisconnect.ok, true, undoDisconnect.message);
    assert.equal(loader.entries.get('mcp-custom-snapshot-demo').options.config.headers.Authorization, 'Bearer old-token');
  } finally {
    await new Promise((resolve) => manualServer.close(resolve));
  }
});

test('手动 HTTP initialize 失败时不保存、不启用且保留可操作错误', { timeout: 15000 }, async () => {
  const invalidServer = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(503); res.end();
  });
  await new Promise((resolve) => invalidServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${invalidServer.address().port}/mcp`;
  const { ctx, loader, tools, tables } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig());

  try {
    const configured = await tools.defs.get('mcp_connector_configure').execute({
      name: 'qa-unreachable',
      serverName: 'qa-unreachable',
      transport: 'streamable-http',
      url,
      authMode: 'none',
    });
    assert.equal(configured.ok, false);
    assert.match(configured.message, /连接验证失败/);
    assert.match(configured.message, /未保存连接/);
    assert.equal(loader.entries.size, 0);
    assert.equal((await tools.defs.get('mcp_connector_status').execute({})).detail.items.length, 0);
    assert.equal([...tables.get('connections').entries()].length, 0);
  } finally {
    await new Promise((resolve) => invalidServer.close(resolve));
  }
});

test('stdio Host 启动失败时不保存且返回进程诊断', { timeout: 15000 }, async () => {
  const startupError = Object.assign(new Error('spawn uvx ENOENT'), { code: 'ENOENT' });
  const { ctx, loader, tools, tables } = makePluginContext({
    loaderHooks: {
      onCreate: async ({ name }) => {
        if (name === '@deepseek-ai/dsh-mcp-client') throw startupError;
      },
    },
  });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({
    connectors: [{
      id: 'stdio-failure', name: 'Stdio Failure', auth: { mode: 'none' },
      servers: [{ serverKey: 'main', transport: 'stdio', serverName: 'stdio-failure', command: 'uvx', args: ['missing-server'] }],
    }],
  }));

  const connected = await tools.defs.get('mcp_connector_connect').execute({ connectorId: 'stdio-failure' }, { signal: undefined });
  assert.equal(connected.ok, false);
  assert.equal(connected.detail.kind, 'process-not-found');
  assert.match(connected.message, /启动命令不存在/);
  assert.match(connected.message, /未保存连接/);
  assert.equal(loader.entries.size, 0);
  assert.equal((await tools.defs.get('mcp_connector_status').execute({})).detail.items.length, 0);
  assert.equal([...tables.get('connections').entries()].length, 0);
});

test('stdio 市场连接、自定义配置与 JSON 导入均透传给 dsh-mcp-client', { timeout: 15000 }, async () => {
  const httpServer = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'switch', version: '1' } } }));
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const httpUrl = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  const { ctx, loader, tools } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({
    connectors: [{
      id: 'local-market', name: 'Local Market', auth: { mode: 'none' },
      servers: [{
        serverKey: 'main', transport: 'stdio', serverName: 'local-market', command: 'uvx',
        args: ['trusted-local-server'], env: { LOG_LEVEL: 'info' }, cwd: '/tmp',
      }],
    }],
  }));

  try {
    const connected = await tools.defs.get('mcp_connector_connect').execute({ connectorId: 'local-market' }, { signal: undefined });
    assert.equal(connected.ok, true, connected.message);
    assert.deepEqual(loader.entries.get('mcp-local-market-main').options.config, {
      transport: 'stdio', serverName: 'local-market', command: 'uvx', args: ['trusted-local-server'],
      env: { LOG_LEVEL: 'info' }, cwd: '/tmp', failOnStartupError: true,
    });
    const pendingHealth = await tools.defs.get('mcp_connector_health_check').execute({ connectorId: 'local-market' });
    assert.equal(pendingHealth.detail.items[0].connectionState, 'unknown');
    assert.equal(pendingHealth.detail.items[0].diagnostic.code, 'host-tools-pending');
    assert.match(pendingHealth.detail.items[0].diagnostic.action, /Host 日志|重新检查/);
    const pendingTools = await tools.defs.get('mcp_connector_tools_list').execute({ connectorId: 'local-market' });
    assert.equal(pendingTools.ok, false);
    assert.equal(pendingTools.detail.servers[0].errorKind, 'startup');
    assert.equal(pendingTools.detail.connectionState, 'unknown');
    assert.equal(pendingTools.detail.unknownServers, 1);
    assert.equal(pendingTools.detail.diagnostic.code, 'host-tools-pending');
    tools.register({ name: 'mcp__local-market__search', description: 'Search local market', parameters: {} });
    const readyHealth = await tools.defs.get('mcp_connector_health_check').execute({ connectorId: 'local-market' });
    assert.equal(readyHealth.detail.items[0].connectionState, 'healthy');
    const listed = await tools.defs.get('mcp_connector_tools_list').execute({ connectorId: 'local-market' });
    assert.equal(listed.ok, true, listed.message);
    assert.equal(listed.detail.servers[0].live, true);
    assert.equal(listed.detail.servers[0].tools[0].name, 'search');

    const configured = await tools.defs.get('mcp_connector_configure').execute({
    name: 'Local Files', transport: 'stdio', serverName: 'local-files', command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    envJson: JSON.stringify({ LOG_LEVEL: 'info' }), cwd: '/tmp',
  });
    assert.equal(configured.ok, true, configured.message);
    assert.deepEqual(loader.entries.get('mcp-custom-local-files').options.config, {
    transport: 'stdio', serverName: 'local-files', command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { LOG_LEVEL: 'info' }, cwd: '/tmp', failOnStartupError: true,
    });

    const switchedToHttp = await tools.defs.get('mcp_connector_configure').execute({
    name: 'Local Files', transport: 'streamable-http', serverName: 'local-files',
      url: httpUrl, authMode: 'none',
    });
    assert.equal(switchedToHttp.ok, true, switchedToHttp.message);
    assert.deepEqual(loader.entries.get('mcp-custom-local-files').options.config, {
      transport: 'streamable-http', serverName: 'local-files', url: httpUrl,
      headers: {}, failOnStartupError: true,
    });

    const switchedBackToStdio = await tools.defs.get('mcp_connector_configure').execute({
    name: 'Local Files', transport: 'stdio', serverName: 'local-files', command: 'uvx', args: ['trusted-server'],
  });
    assert.equal(switchedBackToStdio.ok, true, switchedBackToStdio.message);
    assert.deepEqual(loader.entries.get('mcp-custom-local-files').options.config, {
    transport: 'stdio', serverName: 'local-files', command: 'uvx', args: ['trusted-server'],
      env: {}, cwd: process.cwd(), failOnStartupError: true,
    });

    const imported = await tools.defs.get('mcp_connector_import_json').execute({
    json: JSON.stringify({ mcpServers: { memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } } }),
  });
    assert.equal(imported.ok, true, imported.message);
    assert.equal(loader.entries.get('mcp-json-memory').options.config.transport, 'stdio');
    assert.equal(loader.entries.get('mcp-json-memory').options.config.command, 'npx');
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('stdio 市场凭据绑定：多字段只在本机注入 env，目录和状态不返回真实值', { timeout: 15000 }, async () => {
  const connector = {
    id: 'stdio-secure-market',
    name: 'Stdio Secure Market',
    auth: {
      mode: 'api-key',
      credentialFields: [
        { key: 'apiToken', label: 'API Token', required: true, secret: true },
        { key: 'region', label: '区域', required: true, secret: false },
      ],
    },
    servers: [{
      serverKey: 'main',
      transport: 'stdio',
      serverName: 'stdio-secure-market',
      command: 'uvx',
      args: ['vendor-mcp'],
      env: { LOG_LEVEL: 'info' },
      credentialBindings: { VENDOR_API_TOKEN: 'apiToken', VENDOR_REGION: 'region' },
    }],
  };
  const { ctx, loader, tools, tables, logs } = makePluginContext();
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors: [connector] }));

  const connect = await tools.defs.get('mcp_connector_connect').execute({ connectorId: connector.id }, { signal: undefined });
  assert.equal(connect.ok, false);
  assert.equal(connect.detail.transport, 'stdio');
  assert.equal(connect.detail.command, 'uvx');
  assert.equal(connect.detail.credentialFields.length, 2);

  const missing = await tools.defs.get('mcp_connector_configure').execute({
    connectorId: connector.id,
    credentialValues: { apiToken: 'stdio-local-secret' },
  });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /区域 必填/);
  assert.equal([...tables.get('connections').entries()].length, 0);

  const configured = await tools.defs.get('mcp_connector_configure').execute({
    connectorId: connector.id,
    credentialValues: { apiToken: 'stdio-local-secret', region: 'cn-east-1' },
  });
  assert.equal(configured.ok, true, configured.message);
  assert.deepEqual(loader.entries.get('mcp-stdio-secure-market-main').options.config, {
    transport: 'stdio',
    serverName: 'stdio-secure-market',
    command: 'uvx',
    args: ['vendor-mcp'],
    env: {
      LOG_LEVEL: 'info',
      VENDOR_API_TOKEN: 'stdio-local-secret',
      VENDOR_REGION: 'cn-east-1',
    },
    cwd: process.cwd(),
    failOnStartupError: true,
  });
  assert.equal([...tables.get('connections').entries()][0][1].env.VENDOR_API_TOKEN, 'stdio-local-secret');

  const catalog = await tools.defs.get('mcp_connector_catalog').execute({ keyword: connector.id });
  const status = await tools.defs.get('mcp_connector_status').execute({});
  assert.deepEqual(catalog.detail.items[0].servers[0].credentialBindings, {
    VENDOR_API_TOKEN: 'apiToken',
    VENDOR_REGION: 'region',
  });
  assert.doesNotMatch(JSON.stringify({ connect, configured, catalog, status, logs }), /stdio-local-secret/);
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

test('多 Server 严格启动中途失败时原子回滚已创建条目与连接记录', { timeout: 15000 }, async () => {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'batch', version: '1' } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const connectors = [{
    id: 'batch-startup',
    name: 'Batch Startup',
    auth: { mode: 'bearer' },
    servers: [
      { serverKey: 'first', url, serverName: 'batch-first', headers: {} },
      { serverKey: 'second', url, serverName: 'batch-second', headers: {} },
    ],
  }];
  const { ctx, loader, tools, tables } = makePluginContext({
    loaderHooks: {
      onCreate: async ({ id }) => {
        if (id === 'mcp-batch-startup-second') throw new Error('initial tool synchronization failed');
      },
    },
  });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));

  try {
    const configured = await tools.defs.get('mcp_connector_configure').execute({
      connectorId: 'batch-startup', bearerToken: 'batch-token',
    });
    assert.equal(configured.ok, false);
    assert.match(configured.message, /未保存连接/);
    assert.equal(loader.entries.size, 0, '首个已创建 Host 条目必须回滚');
    assert.equal([...tables.get('connections').entries()].length, 0);
    assert.equal([...tables.get('snapshots').entries()].length, 0, '失败操作不保留无效的预变更快照');
    assert.equal((await tools.defs.get('mcp_connector_status').execute({})).detail.items.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('多 Server 快照恢复中途失败时原子保留恢复前 Host 与持久化配置', { timeout: 15000 }, async () => {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'restore', version: '1' } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const connectors = [{
    id: 'batch-restore',
    name: 'Batch Restore',
    auth: { mode: 'bearer' },
    servers: [
      { serverKey: 'first', url, serverName: 'restore-first', headers: {} },
      { serverKey: 'second', url, serverName: 'restore-second', headers: {} },
    ],
  }];
  let failRestore = false;
  const { ctx, loader, tools, tables } = makePluginContext({
    loaderHooks: {
      onUpdate: async ({ id, patch }) => {
        if (failRestore && id === 'mcp-batch-restore-second'
          && patch.config?.headers?.Authorization === 'Bearer old-token') {
          throw new Error('simulated second restore failure');
        }
      },
    },
  });
  const { apply } = await import('../lib/index.js');
  await apply(ctx, baseConfig({ connectors }));

  try {
    const configure = tools.defs.get('mcp_connector_configure');
    const initial = await configure.execute({ connectorId: 'batch-restore', bearerToken: 'old-token' });
    assert.equal(initial.ok, true, initial.message);
    const changed = await configure.execute({ connectorId: 'batch-restore', bearerToken: 'new-token' });
    assert.equal(changed.ok, true, changed.message);

    failRestore = true;
    const restored = await tools.defs.get('mcp_connector_snapshot').execute({ action: 'restore', snapshotId: changed.detail.snapshotId });
    assert.equal(restored.ok, false);
    assert.match(restored.message, /快照恢复失败/);
    for (const id of ['mcp-batch-restore-first', 'mcp-batch-restore-second']) {
      assert.equal(loader.entries.get(id).options.config.headers.Authorization, 'Bearer new-token');
    }
    for (const [, record] of tables.get('connections').entries()) {
      assert.equal(record.auth.bearerToken, 'new-token');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
    assert.equal(listed.detail.diagnostic.stage, 'authentication');
    assert.ok(Number.isInteger(listed.detail.lastSuccessfulAt));
    const health = await tools.defs.get('mcp_connector_health_check').execute({ connectorId: 'wind-expired' });
    assert.equal(health.ok, true);
    assert.equal(health.detail.items[0].connectionState, 'reauth');
    const catalog = await tools.defs.get('mcp_connector_catalog').execute({ keyword: 'Wind Expired' });
    assert.equal(catalog.detail.items[0].connectionState, 'reauth');
    assert.equal(catalog.detail.items[0].connectionLabel, '需重新授权');
    assert.equal(catalog.detail.items[0].diagnostic.code, 'auth');
    assert.equal(catalog.detail.items[0].lastSuccessfulAt, listed.detail.lastSuccessfulAt);
    const status = await tools.defs.get('mcp_connector_status').execute({});
    assert.equal(status.detail.items[0].connectionState, 'reauth');
    assert.equal(status.detail.items[0].diagnostic.stage, 'authentication');
    assert.equal(status.detail.items[0].lastSuccessfulAt, listed.detail.lastSuccessfulAt);
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
  const catalogSrv = createServer(async (req, res) => {
    if (req.url === '/mcp') {
      for await (const _chunk of req) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'url-demo', version: '1' } } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'url-demo',
        name: 'URL 安装演示',
        auth: { mode: 'none' },
        servers: [{ serverKey: 'a', url: `http://${req.headers.host}/mcp`, serverName: 'url-a', transport: 'streamable-http', headers: {} }],
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
