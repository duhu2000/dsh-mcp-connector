/**
 * 通道二：自定义配置连接（表单式填 transport/url/serverName/鉴权）。
 */
import { CUSTOM_CONNECTOR_ID } from '../constants.js';
import { assertSafeUrl, assertSafeHeaderName, slugServerName } from '../util.js';

function parseHeadersJson(headersJson) {
  if (headersJson === undefined || headersJson === null || headersJson === '') return {};
  let obj;
  if (typeof headersJson === 'string') {
    try {
      obj = JSON.parse(headersJson);
    } catch {
      throw new Error('headersJson 不是合法 JSON');
    }
  } else {
    obj = headersJson;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('headersJson 必须是 JSON 对象');
  const out = {};
  for (const [key, value] of Object.entries(obj)) out[assertSafeHeaderName(key)] = String(value);
  return out;
}

/**
 * @param {object} params { name, url, transport?, serverName?, authMode?, bearerToken?, apiKeyHeader?, apiKeyValue?, headersJson? }
 */
export function buildManualRecord(params = {}) {
  const name = String(params.name ?? '').trim();
  if (!name) throw new Error('name 必填');
  const url = assertSafeUrl(params.url).toString();
  const serverName = slugServerName(params.serverName ?? name);
  const transport = params.transport === 'sse' ? 'sse' : 'streamable-http';
  const headers = parseHeadersJson(params.headersJson);

  const authMode = params.authMode ?? 'none';
  let auth;
  if (authMode === 'bearer') {
    if (!params.bearerToken) throw new Error('authMode=bearer 时 bearerToken 必填');
    auth = { mode: 'bearer', bearerToken: String(params.bearerToken) };
  } else if (authMode === 'api-key') {
    const apiKeyHeader = assertSafeHeaderName(params.apiKeyHeader ?? 'X-Api-Key');
    if (params.apiKeyValue === undefined || params.apiKeyValue === '') throw new Error('authMode=api-key 时 apiKeyValue 必填');
    auth = { mode: 'api-key', apiKeyHeader, apiKeyValue: String(params.apiKeyValue) };
  } else if (authMode !== 'none') {
    throw new Error(`unsupported authMode: ${authMode}`);
  }

  return {
    key: `custom-${serverName}`,
    connectorId: CUSTOM_CONNECTOR_ID,
    kind: 'manual',
    name,
    transport,
    url,
    serverName,
    headers,
    auth,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
