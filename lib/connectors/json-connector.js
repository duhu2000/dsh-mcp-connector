/**
 * 通道三：粘贴 JSON 配置（兼容 { mcpServers: {...} } 与 { connections: [...] }）。
 * 批量预校验，任一非法整体拒绝；stdio 类（command/args）显式跳过并提示。
 */
import { JSON_CONNECTOR_ID } from '../constants.js';
import { assertSafeUrl, assertSafeHeaderName, slugServerName } from '../util.js';

function parseInput(input) {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (error) {
      throw new Error(`JSON 解析失败: ${error.message}`);
    }
  }
  return input;
}

function coerceHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) out[assertSafeHeaderName(key)] = String(value);
  return out;
}

/** 静态 headers 中的 Authorization: Bearer ... 提升为 auth.bearer，其余保留为静态头 */
function extractAuth(headers) {
  const h = coerceHeaders(headers);
  const authKey = Object.keys(h).find((k) => k.toLowerCase() === 'authorization');
  if (authKey && /^Bearer\s+(.+)$/i.test(h[authKey])) {
    const token = h[authKey].replace(/^Bearer\s+/i, '');
    delete h[authKey];
    return { auth: { mode: 'bearer', bearerToken: token }, headers: h };
  }
  return { auth: undefined, headers: h };
}

function authFromFields(item) {
  const authMode = item.authMode ?? 'none';
  if (authMode === 'bearer') {
    return { mode: 'bearer', bearerToken: String(item.bearerToken ?? '') };
  }
  if (authMode === 'api-key') {
    return {
      mode: 'api-key',
      apiKeyHeader: assertSafeHeaderName(item.apiKeyHeader ?? 'X-Api-Key'),
      apiKeyValue: String(item.apiKeyValue ?? ''),
    };
  }
  if (authMode === 'none') return undefined;
  throw new Error(`unsupported authMode: ${authMode}`);
}

/**
 * @param {string|object} input
 * @returns {{ records: object[], skipped: string[] }}
 */
export function normalizeJsonImport(input) {
  const obj = parseInput(input);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('JSON 顶层必须是对象');

  const records = [];
  const skipped = [];

  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    for (const [name, cfg] of Object.entries(obj.mcpServers)) {
      if (!cfg || typeof cfg !== 'object') {
        skipped.push(`${name}(非法条目)`);
        continue;
      }
      if (cfg.command || cfg.args) {
        skipped.push(`${name}(stdio 暂不支持)`);
        continue;
      }
      if (!cfg.url) {
        skipped.push(`${name}(缺 url)`);
        continue;
      }
      const transport = cfg.transport ?? cfg.type ?? 'streamable-http';
      const { auth, headers } = extractAuth(cfg.headers ?? cfg.httpHeaders);
      records.push({
        key: `json-${slugServerName(cfg.serverName ?? name)}`,
        connectorId: JSON_CONNECTOR_ID,
        kind: 'json',
        name: cfg.name ?? name,
        transport: transport === 'sse' ? 'sse' : 'streamable-http',
        url: assertSafeUrl(cfg.url).toString(),
        serverName: slugServerName(cfg.serverName ?? name),
        headers,
        auth,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  } else if (Array.isArray(obj.connections)) {
    for (const item of obj.connections) {
      if (!item || typeof item !== 'object') {
        skipped.push('(非法条目)');
        continue;
      }
      if (item.command || item.args) {
        skipped.push(`${item.name ?? '(未命名)'}(stdio 暂不支持)`);
        continue;
      }
      if (!item.url) {
        skipped.push(`${item.name ?? '(未命名)'}(缺 url)`);
        continue;
      }
      const name = String(item.name ?? item.serverName ?? '');
      if (!name) {
        skipped.push('(缺 name/serverName)');
        continue;
      }
      records.push({
        key: `json-${slugServerName(item.serverName ?? name)}`,
        connectorId: JSON_CONNECTOR_ID,
        kind: 'json',
        name,
        transport: item.transport === 'sse' ? 'sse' : 'streamable-http',
        url: assertSafeUrl(item.url).toString(),
        serverName: slugServerName(item.serverName ?? name),
        headers: coerceHeaders(item.headers),
        auth: authFromFields(item),
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  } else {
    throw new Error('不支持的 JSON 格式：期望 { mcpServers: {...} } 或 { connections: [...] }');
  }

  if (records.length === 0) {
    throw new Error(`没有可导入的连接${skipped.length ? `（跳过：${skipped.join('、')}）` : ''}`);
  }
  return { records, skipped };
}
