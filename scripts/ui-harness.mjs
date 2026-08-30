#!/usr/bin/env node
/** 本地 UI 契约测试壳：不读凭据、不连接真实 MCP，只提供可交互的 mock API。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConnectorDescriptor } from '../lib/schema.js';
import { auditDescriptor, auditRawDescriptor, mergeCatalog } from '../lib/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

async function loadCatalogFile(path) {
  const document = JSON.parse(await readFile(path, 'utf8'));
  const items = Array.isArray(document) ? document : document.connectors ?? [];
  return items.map((item) => auditDescriptor(normalizeConnectorDescriptor(auditRawDescriptor(item))));
}

const catalogSources = [await loadCatalogFile(join(root, 'catalog/catalog.json'))];
if (process.env.MCP_CONNECTOR_UI_CATALOG_PATH) {
  catalogSources.push(await loadCatalogFile(process.env.MCP_CONNECTOR_UI_CATALOG_PATH));
}
const catalog = mergeCatalog(catalogSources).filter((item) => item.published !== false);

// A fresh harness never claims a real authorization. Tests may connect to the mock API explicitly.
const connected = new Set();
const healthStates = new Map();
const bundledAssets = new Map([
  ['qcc-logo.svg', 'image/svg+xml'],
  ['pkulaw-logo.png', 'image/png'],
  ['wind-logo.png', 'image/png'],
]);

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function captureShell() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCP连接器 · 无凭据验收环境</title>
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; background: #e5e7eb; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
  .capture-panel { width: min(800px, 90vw); height: min(800px, 85vh); display: flex; flex-direction: column; overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.18); }
  .capture-header { min-height: 64px; display: flex; align-items: center; gap: 10px; padding: 16px 24px; border-bottom: 1px solid #e5e7eb; color: #111827; }
  .capture-title { font-size: 18px; font-weight: 650; }
  .capture-version, .capture-state { padding: 2px 8px; border-radius: 999px; background: #f3f4f6; color: #6b7280; font-size: 12px; font-weight: 600; }
  .capture-state { margin-left: auto; color: #047857; background: #ecfdf5; }
  iframe { flex: 1; width: 100%; min-height: 0; border: 0; background: transparent; }
</style>
</head>
<body>
  <section class="capture-panel" aria-label="MCP连接器产品面板">
    <header class="capture-header"><span aria-hidden="true">🧩</span><span class="capture-title">MCP连接器</span><span class="capture-version">v${packageJson.version}</span><span class="capture-state">无凭据 Mock</span></header>
    <iframe src="/mcp-connector/ui/" title="MCP连接器"></iframe>
  </section>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const body = Buffer.from(captureShell());
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.byteLength }); res.end(body); return;
  }
  if (req.method === 'GET' && req.url === '/mcp-connector/ui/') {
    const body = await readFile(join(root, 'ui/index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); return;
  }
  const assetName = req.url?.match(/^\/mcp-connector\/ui\/assets\/([^/?#]+)$/)?.[1];
  if (req.method === 'GET' && assetName && bundledAssets.has(assetName)) {
    const body = await readFile(join(root, 'ui/assets', assetName));
    res.writeHead(200, { 'content-type': bundledAssets.get(assetName) }); res.end(body); return;
  }
  if (req.method !== 'POST' || req.url !== '/mcp-connector/api') { res.writeHead(404); res.end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { method, params = {} } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (method === 'catalog') {
    json(res, { ok: true, detail: { items: catalog.map((item) => ({
      ...item,
      authMode: item.auth.mode,
      apiKeyHeader: item.auth.apiKeyHeader,
      credentialName: item.auth.credentialName,
      credentialPlaceholder: item.auth.credentialPlaceholder,
      credentialDescription: item.auth.credentialDescription,
      credentialHelpLabel: item.auth.credentialHelpLabel,
      connected: connected.has(item.id) ? [`${item.id}-main`] : [],
      connectionState: connected.has(item.id) ? (healthStates.get(item.id) ?? 'configured') : 'disconnected',
      connectionLabel: healthStates.get(item.id) === 'healthy' ? '已连接' : connected.has(item.id) ? '已配置' : '未连接',
    })) } }); return;
  }
  if (method === 'status') {
    const items = catalog.filter((item) => connected.has(item.id)).flatMap((item) => item.servers.map((server) => ({
      key: `${item.id}:${server.serverKey}`,
      connectorId: item.id,
      name: item.name,
      serverName: server.serverName,
      endpoint: server.url || server.command || '本地 Mock',
      authMode: item.auth.mode === 'oauth2-pkce' ? 'oauth' : item.auth.mode,
      enabled: true,
      connectionState: healthStates.get(item.id) ?? 'configured',
    })));
    json(res, { ok: true, detail: { items } }); return;
  }
  if (method === 'migrationPreview') { json(res, { ok: true, detail: { pendingCount: 0, items: [] } }); return; }
  if (method === 'toolsList') {
    const connector = catalog.find((item) => item.id === params.connectorId);
    const server = connector?.servers?.[0] ?? { serverKey: 'mock', serverName: 'mock-server' };
    const tools = Array.from({ length: 125 }, (_, index) => ({
      name: `mock_tool_${String(index + 1).padStart(3, '0')}`,
      title: `Mock 工具 ${index + 1}`,
      description: `本地无凭据 UI 验收数据：用于验证分批渲染与搜索的第 ${index + 1} 个工具。`,
    }));
    healthStates.set(params.connectorId, 'healthy');
    json(res, { ok: true, detail: { totalTools: tools.length, connectionState: 'healthy', servers: [{ serverKey: server.serverKey, serverName: server.serverName, ok: true, tools }] } }); return;
  }
  if (method === 'healthCheck') {
    const ids = params.connectorId ? [params.connectorId] : [...connected];
    ids.forEach((id) => healthStates.set(id, 'healthy'));
    json(res, { ok: true, message: `已检查 ${ids.length} 个连接器：${ids.length} 个正常`, detail: { items: ids.map((connectorId) => ({ connectorId, connectionState: 'healthy' })) } }); return;
  }
  if (method === 'connect') { connected.add(params.connectorId); json(res, { ok: true, message: 'Mock 连接成功' }); return; }
  if (method === 'configure') {
    if (params.connectorId === 'wind-stock-data' && params.bearerToken !== 'valid-wind-key') {
      json(res, { ok: false, message: '连接验证失败：wind_stock_data：Key/Token 无效、已过期或当前账号没有该 Server 权限（HTTP 401）。未保存连接，请修正后重试。' }); return;
    }
    if (params.connectorId) connected.add(params.connectorId);
    json(res, { ok: true, message: `Mock 已配置 ${params.connectorId || params.name}` }); return;
  }
  if (method === 'importJson') {
    try { JSON.parse(params.json); }
    catch (error) { json(res, { ok: false, message: `导入失败: JSON 解析失败: ${error.message}` }); return; }
    json(res, { ok: true, message: 'Mock JSON 导入成功' }); return;
  }
  if (method === 'installFromUrl') { json(res, { ok: true, message: 'Mock 描述 URL 安装成功' }); return; }
  if (method === 'refreshCatalog') { json(res, { ok: true, message: `市场已刷新，共 ${catalog.length} 个连接器` }); return; }
  if (method === 'migrateLegacy') { json(res, { ok: true, message: 'Mock 迁移成功' }); return; }
  json(res, { ok: false, message: `Mock 未实现 ${method}` }, 400);
});

server.listen(Number(process.env.MCP_CONNECTOR_UI_PORT ?? 4173), '127.0.0.1', () => {
  const address = server.address();
  console.log(`MCP connector UI harness: http://127.0.0.1:${address.port}/mcp-connector/ui/`);
});
