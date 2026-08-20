/**
 * 无凭据连接器探针：Schema/密钥/唯一性、端点 initialize、OAuth 元数据和图标。
 * 只读公开端点，不注册 OAuth client，不触发真实授权。
 */
import { auditDescriptor, auditRawDescriptor } from './catalog.js';
import { normalizeConnectorDescriptor } from './schema.js';
import { discoverProtectedResource, discoverServerMetadata } from './oauth.js';
import { assertSafeUrl } from './util.js';
import { MCP_PROTOCOL_VERSION } from './constants.js';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function parseMcpPayload(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
    return undefined;
  }
  try { return JSON.parse(text); } catch { return undefined; }
}

async function probeServer(server, authMode, timeoutMs) {
  const startedAt = Date.now();
  const result = {
    serverKey: server.serverKey,
    serverName: server.serverName,
    url: server.url,
    reachable: false,
    mcp: false,
    oauth: authMode !== 'oauth2-pkce' ? 'not-required' : 'unchecked',
    tools: [],
  };
  try {
    const response = await fetchWithTimeout(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'dsh-mcp-connector-probe', version: '1.0' },
        },
      }),
    }, timeoutMs);
    result.httpStatus = response.status;
    result.reachable = response.status !== 404 && response.status < 500;
    const text = await response.text();
    const payload = parseMcpPayload(text, response.headers.get('content-type') ?? '');
    result.mcp = response.status === 401 || response.status === 403 || response.status === 405 || response.status === 406
      || payload?.jsonrpc === '2.0' || !!payload?.result?.protocolVersion || !!payload?.error;
    if (payload?.result?.tools) result.tools = payload.result.tools;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  if (authMode === 'oauth2-pkce' && result.reachable) {
    try {
      const resource = await discoverProtectedResource(server.url, timeoutMs);
      const issuer = resource.authorizationServers[0];
      const metadata = await discoverServerMetadata(issuer, timeoutMs);
      result.oauth = 'pass';
      result.oauthMetadata = {
        issuer: metadata.issuer,
        authorizationEndpoint: metadata.authorizationEndpoint,
        tokenEndpoint: metadata.tokenEndpoint,
        registrationEndpoint: metadata.registrationEndpoint,
        revocationEndpoint: metadata.revocationEndpoint,
      };
    } catch (error) {
      result.oauth = 'fail';
      result.oauthError = error instanceof Error ? error.message : String(error);
    }
  }
  result.durationMs = Date.now() - startedAt;
  return result;
}

async function probeIcon(icon, timeoutMs) {
  if (!icon || icon.startsWith('/') || icon.startsWith('data:image/')) return { ok: true, kind: 'bundled' };
  try {
    assertSafeUrl(icon);
    let response = await fetchWithTimeout(icon, { method: 'HEAD' }, timeoutMs);
    assertSafeUrl(response.url || icon);
    if (response.status === 405) {
      response = await fetchWithTimeout(icon, { method: 'GET' }, timeoutMs);
      assertSafeUrl(response.url || icon);
    }
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function validateRegistryDescriptors(rawList) {
  if (!Array.isArray(rawList)) throw new Error('registry connectors 必须是数组');
  const ids = new Set();
  const serverNames = new Set();
  return rawList.map((raw, index) => {
    const descriptor = auditDescriptor(normalizeConnectorDescriptor(auditRawDescriptor(raw, `connectors[${index}]`)));
    if (ids.has(descriptor.id)) throw new Error(`重复 connector id: ${descriptor.id}`);
    ids.add(descriptor.id);
    for (const server of descriptor.servers) {
      if (serverNames.has(server.serverName)) throw new Error(`重复 serverName: ${server.serverName}`);
      serverNames.add(server.serverName);
    }
    return descriptor;
  });
}

export async function probeConnector(raw, { timeoutMs = 15_000 } = {}) {
  const checkedAt = Date.now();
  let descriptor;
  try {
    descriptor = validateRegistryDescriptors([raw])[0];
  } catch (error) {
    return {
      id: raw?.id ?? '(unknown)',
      status: 'fail',
      checkedAt,
      errors: [error instanceof Error ? error.message : String(error)],
      servers: [],
    };
  }

  const servers = [];
  for (const server of descriptor.servers) {
    servers.push(await probeServer(server, descriptor.auth.mode, timeoutMs));
  }
  const icon = await probeIcon(descriptor.icon, timeoutMs);
  const hardFailures = servers.filter((server) => !server.reachable || !server.mcp);
  const oauthFailures = servers.filter((server) => server.oauth === 'fail');
  const status = hardFailures.length > 0 ? 'fail' : oauthFailures.length > 0 || !icon.ok ? 'partial' : 'pass';
  const toolsSnapshot = servers
    .filter((server) => server.tools.length > 0)
    .map((server) => ({
      serverKey: server.serverKey,
      serverName: server.serverName,
      tools: server.tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description })),
    }));
  return {
    id: descriptor.id,
    status,
    checkedAt,
    durationMs: Date.now() - checkedAt,
    icon,
    servers,
    toolsSnapshot,
  };
}
