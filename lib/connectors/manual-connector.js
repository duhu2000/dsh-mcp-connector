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

function parseEnvJson(envJson) {
  if (envJson === undefined || envJson === null || envJson === '') return {};
  let obj;
  if (typeof envJson === 'string') {
    try {
      obj = JSON.parse(envJson);
    } catch {
      throw new Error('envJson 不是合法 JSON');
    }
  } else {
    obj = envJson;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('envJson 必须是 JSON 对象');
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`非法环境变量名: ${key}`);
    out[key] = String(value);
  }
  return out;
}

/**
 * @param {object} params { name, url, transport?, serverName?, authMode?, bearerToken?, apiKeyHeader?, apiKeyValue?, headersJson? }
 */
export function buildManualRecord(params = {}) {
  const name = String(params.name ?? '').trim();
  if (!name) throw new Error('name 必填');
  const serverName = slugServerName(params.serverName ?? name);
  const rawTransport = params.transport ?? 'streamable-http';
  const transport = rawTransport === 'sse' ? 'streamable-http' : rawTransport;
  if (!['streamable-http', 'stdio'].includes(transport)) throw new Error(`unsupported transport: ${rawTransport}`);

  if (transport === 'stdio') {
    const command = String(params.command ?? '').trim();
    if (!command) throw new Error('transport=stdio 时 command 必填');
    if (params.authMode && params.authMode !== 'none') throw new Error('stdio 鉴权请通过 envJson 传入环境变量');
    if (params.args !== undefined && !Array.isArray(params.args)) throw new Error('args 必须是字符串数组');
    const args = (params.args ?? []).map((value) => String(value));
    const env = parseEnvJson(params.envJson ?? params.env);
    return {
      key: `custom-${serverName}`,
      connectorId: CUSTOM_CONNECTOR_ID,
      kind: 'manual',
      name,
      transport,
      command,
      args,
      env,
      cwd: String(params.cwd ?? '').trim(),
      serverName,
      headers: {},
      auth: undefined,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const url = assertSafeUrl(params.url).toString();
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
