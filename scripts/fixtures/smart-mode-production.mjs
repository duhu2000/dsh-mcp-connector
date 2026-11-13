import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { apply, Config } from '../../lib/index.js';
import { sourceFixture } from './source-selection.mjs';
import { profileHarness, temporaryProfile, host, tick, bounded } from './smart-mode-profile.mjs';

/** Actual normal apply(), Host HTTP/Connection/SessionController, Native and
 * JSONL. Only connector KV, file-upload/attachment and loader fixtures are
 * synthetic. No real credential, tool body, model adapter or service endpoint.
 */
export async function productionHarness(t, options = {}) {
  const path = options.profileDir ?? await temporaryProfile(t), data = sourceFixture();
  data.scope.groupId = 'qcc-enterprise-six-v1';
  for (const record of data.records.filter((record) => record.auth.grantKey === data.scope.accountRef)) Object.assign(record, {
    kind: 'oauth', name: record.serverName, url: `https://agent.qcc.com/mcp/${record.serverKey}/stream`, transport: 'streamable-http',
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  data.records.splice(6); // Other-account coverage is added explicitly by tests.
  let cleanup;
  const h = await profileHarness(t, path, { data, reviews: [], mount: false, management: false, humanCommands: true,
    beforeReply: options.beforeReply, beforeClose: () => cleanup?.() });
  const root = h.ctx.root;
  const require = createRequire(createRequire(process.env.DSH_HOST_INTEGRATION_ANCHOR).resolve('@deepseek-ai/dsh-agent-loop'));
  const load = (name) => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
  const records = new Map(data.records.map((record) => [record.key, record]));
  const grant = { key: data.scope.accountRef, issuer: 'https://agent.qcc.com', account: 'default',
    clientId: 'synthetic-client', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
    accessTokenExpiresAt: Date.now() + 3600000, authorizedResources: data.records.map((row) => row.url),
    connectorIds: ['qcc-company'], scope: 'mcp:tools', updatedAt: Date.now() };
  const maps = new Map(Object.entries({ connections: records, grants: new Map([[grant.key, grant]]) }));
  const tables = new Map(['connections', 'grants', 'catalog', 'snapshots', 'governance', 'connection_scopes', 'tool_catalog', 'connection_statistics'].map((name) => {
    const map = maps.get(name) ?? new Map(); maps.set(name, map);
    return [name, { get: async (key) => map.get(key), put: async (key, value) => { map.set(key, value); },
      delete: async (key) => map.delete(key), entries: () => [...map.entries()] }];
  }));
  const entries = new Map(), logs = [];
  root.provide('storageDomain', { open: async () => ({ tables, close: async () => {} }) });
  root.provide('loader', {
    entries: () => entries.values(), resolve: (id) => { if (!entries.has(id)) throw new Error('missing synthetic entry'); return entries.get(id); },
    async create(row) { entries.set(row.id, { id: row.id, options: row }); },
    async update(id, patch) { Object.assign(entries.get(id).options, patch); }, async remove(id) { entries.delete(id); },
  });
  root.provide('profileContext', { dir: path, installAnchor: process.env.DSH_HOST_INTEGRATION_ANCHOR });
  const workspaceRows = [{ id: 'workspace-a', path, title: 'Synthetic project', sessionIds: [],
    async attachSession(id) { if (!this.sessionIds.includes(id)) this.sessionIds.push(id); } }];
  if (options.multipleWorkspaces) {
    const other = join(path, 'second-project'); await fs.mkdir(other);
    workspaceRows.push({ ...workspaceRows[0], id: 'workspace-b', path: other, sessionIds: [] });
  }
  root.provide('workspaceRegistry', { list: () => workspaceRows, get: (id) => workspaceRows.find((row) => row.id === id), archivedSessionIds: [] });
  const credentials = new Map();
  root.provide('credentials', { async modifyRecord(key, modify) {
    const change = await modify(credentials.get(key)); if (change) credentials.set(key, change); return credentials.get(key);
  } });
  root.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'offline-validation', model: 'no-update' }) });
  root.provide('attachments', { imageLimits: { maxMessageImageBytes: 1024, maxImageBytes: 1024,
    maxImagesPerMessage: 1, maxImagePixels: 1024, maxImageDimension: 32, mediaTypes: ['image/png'] },
    admitPromptContent: async (content) => content });
  root.provide('fileUploads', { registerAgentResolver: () => () => {}, resolve: () => undefined,
    bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) });
  root.provide('fs', {});
  root.plugin((await load('dsh-typert-registry')).TypertRegistry);
  root.plugin((await load('dsh-api-remote-access')).RemoteAccessService);
  root.plugin((await load('dsh-host-webserver')).WebServer, { host: '127.0.0.1', port: 0 });
  const connectionFiber = root.plugin(await load('dsh-client-connection'));
  await bounded(connectionFiber.await()).catch((error) => { throw new Error(`Host Connection startup failed: ${error.message}`); });
  root.plugin((await load('dsh-api-gateway')).TypertGatewayService, {});
  root.plugin((await load('dsh-session-query-sqlite')).SqliteSessionQueryEngine, { path: join(path, 'query.sqlite'), openAt: 'never' });
  root.plugin((await load('dsh-api-session-controller')).SessionController, { nativeOpen: false });
  root.provide('webStartup', {});
  const dependencyNames = ['sessionController', 'webServer', 'connection', 'workspaceRegistry', 'storageDomain', 'loader', 'tools', 'agents', 'sessions', 'sessionPersistence', 'commands', 'profileContext'];
  const services = await bounded(new Promise((resolve) => root.plugin({ inject: dependencyNames, apply: resolve }))).catch((error) => {
    throw new Error(`production dependencies: ${JSON.stringify(dependencyNames.map((name) => [name, Boolean(root.get(name))]))}`, { cause: error });
  });
  const origin = services.webServer.getOrigin();
  const fetchNative = globalThis.fetch;
  let metadataCalls = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
    if (target.origin === origin) return fetchNative(url, init);
    assert.equal(target.origin, 'https://agent.qcc.com', 'no unrelated network is permitted');
    const request = JSON.parse(init.body ?? '{}'); metadataCalls++;
    if (request.method === 'notifications/initialized' || init.method === 'DELETE') return new Response(null, { status: 202 });
    assert.ok(['initialize', 'tools/list'].includes(request.method), 'no business method is permitted');
    const record = data.records.find((row) => row.url === target.href); assert.ok(record);
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'synthetic', version: '1' } }
      : { tools: data.rows.filter((row) => row.connectionKey === record.key).map((row) => row.definition) };
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  services.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
    if (services.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('synthetic host'); }
  } });
  let cookie;
  const signed = await fetchNative(services.connection.authenticatedUrl(origin), { redirect: 'manual' });
  cookie = signed.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const config = Config({ catalogUrl: '', persistSecrets: true, openBrowser: false, account: 'default',
    __grantJournalDir: join(path, 'grant-journal'), ...options.config });
  // Internal test override must be explicit: Config strips unknown fields.
  config.__grantJournalDir = join(path, 'grant-journal');
  let pluginContext;
  const fiber = root.plugin({ inject: ['tools', 'storageDomain', 'loader', 'workspaceRegistry'], async apply(ctx) {
    pluginContext = ctx;
    const original = ctx.logger;
    Object.defineProperty(ctx, 'logger', { value: (...args) => {
      const logger = original.call(ctx, ...args);
      return { info: (...values) => logs.push(['info', ...values]), warn: (...values) => logs.push(['warn', ...values]), error: (...values) => logs.push(['error', ...values]) };
    } });
    await apply(ctx, config);
  } });
  await bounded(fiber.await()).catch((error) => { throw new Error('normal connector apply timed out', { cause: error }); });
  async function waitFor(check) {
    for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 20)); }
    throw new Error(`production fixture did not settle: ${JSON.stringify(logs)}`);
  }
  const url = `${origin}/mcp-connector/smart-control/`;
  await waitFor(async () => (await fetchNative(`${url}capabilities`, { headers: { cookie } })).status === 200);
  const page = await (await fetchNative(url, { headers: { cookie } })).text();
  const nonce = page.match(/name="control-nonce" content="([a-f0-9]+)"/)?.[1]; assert.ok(nonce);
  async function rpc(method, params = {}, headers = {}) {
    const response = await fetchNative(`${url}api`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json', 'x-mcp-control-nonce': nonce, ...headers,
    }, body: JSON.stringify({ method, params }) });
    return { status: response.status, ...(await response.json()) };
  }
  async function legacy(method, params = {}) {
    return (await fetchNative(`${origin}/mcp-connector/api`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }) })).json();
  }
  async function prompt(sessionId, content = 'Synthetic owner input; reply OK only.', extra = {}) {
    await services.sessionController.prompt({ sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: content }], ...extra }, new AbortController().signal);
    await bounded(h.ctx.agents.get(sessionId).whenIdle()); await tick();
  }
  // Production-created handles belong to the API controller, not h.create().
  cleanup = async () => {
    for (const agent of h.ctx.agents.list()) { agent.cancel({ kind: 'user' }); await agent.whenIdle(); }
    await fiber.dispose();
    fetchMock.mock.restore();
  };
  return { h, path, services, url, origin, cookie, rpc, legacy, prompt, logs, maps, tables, config, workspaceRows, waitFor, pluginContext,
    async operatorCookie() {
      const response = await fetchNative(services.connection.authenticatedUrl(`${origin}/connect`), { redirect: 'manual' });
      return response.headers.get('set-cookie')?.split(';')[0];
    },
    async enable() {
      const state = await rpc('state'); assert.equal(state.ok, true, JSON.stringify(state));
      const preview = await rpc('previewMode', { mode: 'smart', expectedRevision: state.result.policyRevision });
      assert.equal(preview.ok, true, JSON.stringify(preview));
      const committed = await rpc('commit', { previewId: preview.result.previewId }); assert.equal(committed.ok, true, JSON.stringify(committed)); return committed.result;
    },
    get metadataCalls() { return metadataCalls; },
  };
}
