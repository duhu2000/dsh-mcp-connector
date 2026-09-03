#!/usr/bin/env node
/** 本地 UI 契约测试壳：不读凭据、不连接真实 MCP，只提供可交互的 mock API。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConnectorDescriptor } from '../lib/schema.js';
import { auditDescriptor, auditRawDescriptor, mergeCatalog } from '../lib/catalog.js';
import { normalizeGovernanceMutation, publicToolName, resolveGovernancePolicy } from '../lib/governance.js';
import { ConnectionScopeService, bindingForConnection, scopeLabel } from '../lib/connection-scopes.js';

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
let governanceRevision = 0;
let governanceRules = [];
let governanceHistory = [];
let persistedScopes;
const scopeService = new ConnectionScopeService({
  async get() { return persistedScopes; },
  async put(value) { persistedScopes = structuredClone(value); },
});
await scopeService.load();
const mockWorkspace = { workspaceId: 'workspace-mock', title: '无凭据验收项目' };
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

const governanceCapabilities = {
  executionGuard: true,
  visibilityRestriction: true,
};

function governanceRuleId(rule) {
  const parts = rule.scope === 'connection'
    ? [rule.scope, rule.connectorId]
    : rule.scope === 'server'
      ? [rule.scope, rule.connectorId, rule.serverName]
      : [rule.scope, rule.connectorId, rule.serverName, rule.toolName];
  return parts.map((part) => encodeURIComponent(part)).join(':');
}

function directEffect(scope, connectorId, serverName, toolName) {
  return governanceRules.find((rule) => (
    rule.scope === scope
    && rule.connectorId === connectorId
    && (scope === 'connection' || rule.serverName === serverName)
    && (scope !== 'tool' || rule.toolName === toolName)
  ))?.effect ?? 'inherit';
}

function nextRules(input) {
  const mutation = normalizeGovernanceMutation(input);
  const id = governanceRuleId(mutation);
  const rules = governanceRules.filter((rule) => rule.id !== id);
  if (mutation.effect !== 'inherit') rules.push({ ...mutation, id });
  return { mutation, rules: rules.sort((left, right) => left.id.localeCompare(right.id)) };
}

function governanceDetail() {
  return {
    version: 1,
    revision: governanceRevision,
    updatedAt: null,
    precedence: ['tool', 'server', 'connection', 'default'],
    precedenceLabel: 'Tool > Server > Connection > 默认允许；连接停用不可被 allow 覆盖',
    rules: governanceRules.map((rule) => ({ ...rule, status: 'active', statusLabel: '已生效' })),
    history: governanceHistory.map((item) => ({ revision: item.revision, createdAt: item.createdAt, ruleCount: item.rules.length })),
    capabilities: governanceCapabilities,
  };
}

function policyImpact(connectorId, serverName, beforeRules, afterRules) {
  const tools = Array.from({ length: 125 }, (_, index) => `mock_tool_${String(index + 1).padStart(3, '0')}`);
  const changes = tools.flatMap((toolName) => {
    const target = { connectorId, serverName, toolName, publicName: publicToolName(serverName, toolName), connectionEnabled: true };
    const before = resolveGovernancePolicy(target, beforeRules);
    const after = resolveGovernancePolicy(target, afterRules);
    return before.effect === after.effect && before.source === after.source ? [] : [{
      connectorId,
      serverName,
      publicName: target.publicName,
      before: before.effect,
      after: after.effect,
      source: after.source,
      sourceLabel: after.sourceLabel,
    }];
  });
  return {
    observedToolCount: tools.length,
    changedToolCount: changes.length,
    newlyDenied: changes.filter((change) => change.before !== 'deny' && change.after === 'deny').length,
    newlyAllowed: changes.filter((change) => change.before === 'deny' && change.after !== 'deny').length,
    changes: changes.slice(0, 50),
  };
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
  <script>
    window.addEventListener('message', (event) => {
      const frame = document.querySelector('iframe');
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'mcp-connector:workspace-context-request') {
        frame.contentWindow.postMessage({
          type: 'mcp-connector:workspace-context',
          workspace: ${JSON.stringify(mockWorkspace)}
        }, window.location.origin);
      }
    });
  </script>
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
      scope: {
        binding: scopeService.binding(`${item.id}:${server.serverKey}`),
        label: scopeLabel(scopeService.binding(`${item.id}:${server.serverKey}`), new Map([[mockWorkspace.workspaceId, mockWorkspace.title]])),
      },
    })));
    const scopeDocument = scopeService.snapshot();
    json(res, { ok: true, detail: { items, scope: {
      revision: scopeDocument.revision,
      history: scopeDocument.history.map((item) => ({ revision: item.revision, createdAt: item.createdAt, bindingCount: item.bindings.length })),
    } } }); return;
  }
  if (method === 'migrationPreview') { json(res, { ok: true, detail: { pendingCount: 0, items: [] } }); return; }
  if (method === 'governance') {
    const detail = governanceDetail();
    json(res, { ok: true, message: `Mock 治理策略 revision=${detail.revision}`, detail }); return;
  }
  if (method === 'previewPolicy') {
    try {
      const connector = catalog.find((item) => item.id === params.connectorId);
      const fallbackServer = connector?.servers?.[0]?.serverName ?? 'mock-server';
      const { mutation, rules } = nextRules(params);
      const changed = JSON.stringify(rules) !== JSON.stringify(governanceRules);
      const impact = policyImpact(params.connectorId, params.serverName || fallbackServer, governanceRules, rules);
      json(res, {
        ok: true,
        message: changed
          ? `Mock 策略预览：将影响 ${impact.changedToolCount}/${impact.observedToolCount} 个 Host 已观察工具`
          : 'Mock 策略预览：目标规则没有变化',
        detail: { baseRevision: governanceRevision, mutation, changed, impact, capabilities: governanceCapabilities },
      }); return;
    } catch (error) {
      json(res, { ok: false, message: `Mock 策略预览失败: ${error.message}` }); return;
    }
  }
  if (method === 'applyPolicy') {
    if (params.expectedRevision !== governanceRevision) {
      json(res, { ok: false, message: `Mock 策略已变化（当前 revision=${governanceRevision}），请重新预览` }); return;
    }
    try {
      const connector = catalog.find((item) => item.id === params.connectorId);
      const fallbackServer = connector?.servers?.[0]?.serverName ?? 'mock-server';
      const { rules } = nextRules(params);
      const changed = JSON.stringify(rules) !== JSON.stringify(governanceRules);
      const impact = policyImpact(params.connectorId, params.serverName || fallbackServer, governanceRules, rules);
      const previousRevision = governanceRevision;
      if (changed) {
        governanceHistory.push({ revision: previousRevision, createdAt: Date.now(), rules: governanceRules.map((rule) => ({ ...rule })) });
        governanceHistory = governanceHistory.slice(-20);
        governanceRules = rules;
        governanceRevision += 1;
      }
      json(res, {
        ok: true,
        message: changed ? `Mock 策略已应用（revision=${governanceRevision}）` : 'Mock 策略没有变化',
        detail: { ...governanceDetail(), impact, changed, rollbackRevision: previousRevision },
      }); return;
    } catch (error) {
      json(res, { ok: false, message: `Mock 策略应用失败: ${error.message}` }); return;
    }
  }
  if (method === 'rollbackPolicy') {
    if (params.expectedRevision !== governanceRevision) {
      json(res, { ok: false, message: `Mock 策略已变化（当前 revision=${governanceRevision}），请重新读取` }); return;
    }
    const target = governanceHistory.find((item) => item.revision === params.rollbackRevision);
    if (!target) { json(res, { ok: false, message: `Mock 找不到 revision=${params.rollbackRevision}` }); return; }
    const previousRevision = governanceRevision;
    governanceHistory.push({ revision: previousRevision, createdAt: Date.now(), rules: governanceRules.map((rule) => ({ ...rule })) });
    governanceHistory = governanceHistory.slice(-20);
    governanceRules = target.rules.map((rule) => ({ ...rule }));
    governanceRevision += 1;
    json(res, { ok: true, message: `Mock 已恢复 revision=${params.rollbackRevision} 的策略内容`, detail: { ...governanceDetail(), changed: true, rollbackRevision: previousRevision } }); return;
  }
  if (method === 'scopeContext') {
    const document = scopeService.snapshot();
    json(res, { ok: true, message: `Mock 连接作用域 revision=${document.revision}`, detail: {
      revision: document.revision,
      workspaces: [{ id: mockWorkspace.workspaceId, title: mockWorkspace.title }],
      history: document.history.map((item) => ({ revision: item.revision, createdAt: item.createdAt, bindingCount: item.bindings.length })),
      credentialsStoredInScopeDocument: false,
    } }); return;
  }
  if (method === 'previewConnectionScope') {
    try {
      const target = params.targetScope === 'project'
        ? { scope: 'project', workspaceId: params.targetWorkspaceId }
        : { scope: 'global' };
      const preview = scopeService.preview({ connectionKey: params.key, mode: params.mode, target });
      const serverName = catalog.flatMap((item) => item.servers).find((server) => params.key.endsWith(`:${server.serverKey}`))?.serverName ?? params.key;
      json(res, { ok: true, message: 'Mock 作用域预览：将影响 1 个 Server、125 个已知工具；凭据不会复制', detail: {
        ...preview,
        key: params.key,
        mode: params.mode,
        canApply: true,
        credentialsCopied: false,
        impact: { serverCount: 1, toolCount: 125, servers: [{ serverName, tools: ['mock_tool_001', 'mock_tool_002'] }] },
      } }); return;
    } catch (error) {
      json(res, { ok: false, message: `Mock 作用域预览失败: ${error.message}` }); return;
    }
  }
  if (method === 'applyConnectionScope') {
    try {
      const target = params.targetScope === 'project'
        ? { scope: 'project', workspaceId: params.targetWorkspaceId }
        : { scope: 'global' };
      const result = await scopeService.apply({ connectionKey: params.key, mode: params.mode, target }, { expectedRevision: params.expectedRevision });
      json(res, { ok: true, message: `Mock 连接作用域已更新（revision=${result.document.revision}）`, detail: {
        revision: result.document.revision,
        rollbackRevision: result.previousRevision,
        changed: result.changed,
        credentialsCopied: false,
      } }); return;
    } catch (error) {
      json(res, { ok: false, message: `Mock 作用域应用失败: ${error.message}` }); return;
    }
  }
  if (method === 'previewConnectionScopeRollback') {
    const document = scopeService.snapshot();
    json(res, { ok: true, message: 'Mock 作用域回滚预览', detail: {
      baseRevision: document.revision,
      rollbackRevision: params.rollbackRevision,
      impact: { serverCount: 1, toolCount: 125, servers: [{ serverName: 'mock-server', tools: ['mock_tool_001', 'mock_tool_002'] }] },
      credentialsCopied: false,
    } }); return;
  }
  if (method === 'rollbackConnectionScope') {
    try {
      const result = await scopeService.rollback(params.rollbackRevision, { expectedRevision: params.expectedRevision });
      json(res, { ok: true, message: `Mock 已恢复 revision=${params.rollbackRevision} 的作用域绑定`, detail: {
        revision: result.document.revision,
        rollbackRevision: result.previousRevision,
        changed: result.changed,
        credentialsCopied: false,
      } }); return;
    } catch (error) {
      json(res, { ok: false, message: `Mock 作用域回滚失败: ${error.message}` }); return;
    }
  }
  if (method === 'toolsList') {
    const connector = catalog.find((item) => item.id === params.connectorId);
    const server = connector?.servers?.[0] ?? { serverKey: 'mock', serverName: 'mock-server' };
    const tools = Array.from({ length: 125 }, (_, index) => {
      const name = `mock_tool_${String(index + 1).padStart(3, '0')}`;
      const publicName = publicToolName(server.serverName, name);
      const resolved = resolveGovernancePolicy({
        connectorId: params.connectorId,
        serverName: server.serverName,
        toolName: name,
        publicName,
        connectionEnabled: true,
      }, governanceRules);
      return {
        name,
        publicName,
        title: `Mock 工具 ${index + 1}`,
        description: `本地无凭据 UI 验收数据：用于验证分批渲染与搜索的第 ${index + 1} 个工具。`,
        policy: {
          configuredEffect: directEffect('tool', params.connectorId, server.serverName, name),
          desiredEffect: resolved.effect,
          source: resolved.source,
          sourceLabel: resolved.sourceLabel,
          observed: true,
          finalState: resolved.effect === 'deny' ? 'denied' : 'allowed',
          enforced: true,
        },
      };
    });
    const serverResolved = resolveGovernancePolicy({ connectorId: params.connectorId, serverName: server.serverName, connectionEnabled: true }, governanceRules);
    healthStates.set(params.connectorId, 'healthy');
    json(res, { ok: true, detail: {
      totalTools: tools.length,
      connectionState: 'healthy',
      governance: {
        revision: governanceRevision,
        connectionPolicy: directEffect('connection', params.connectorId),
        precedenceLabel: 'Tool > Server > Connection > 默认允许',
        capabilities: governanceCapabilities,
      },
      servers: [{
        serverKey: server.serverKey,
        serverName: server.serverName,
        ok: true,
        policy: {
          configuredEffect: directEffect('server', params.connectorId, server.serverName),
          desiredEffect: serverResolved.effect,
          source: serverResolved.source,
          sourceLabel: serverResolved.sourceLabel,
          lifecycleEnabled: true,
        },
        tools,
      }],
    } }); return;
  }
  if (method === 'healthCheck') {
    const ids = params.connectorId ? [params.connectorId] : [...connected];
    ids.forEach((id) => healthStates.set(id, 'healthy'));
    json(res, { ok: true, message: `已检查 ${ids.length} 个连接器：${ids.length} 个正常`, detail: { items: ids.map((connectorId) => ({ connectorId, connectionState: 'healthy' })) } }); return;
  }
  if (method === 'connect') {
    const connector = catalog.find((item) => item.id === params.connectorId);
    connected.add(params.connectorId);
    await scopeService.assignMany((connector?.servers ?? []).map((server) => `${params.connectorId}:${server.serverKey}`), params.scope === 'project'
      ? { scope: 'project', workspaceId: params.workspaceId }
      : { scope: 'global' });
    json(res, { ok: true, message: 'Mock 连接成功' }); return;
  }
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
