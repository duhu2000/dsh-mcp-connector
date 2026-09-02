/**
 * 可携带的脱敏配置与快照公开摘要。
 *
 * 快照中的完整 ConnectionRecord 只进入本机 storage-domain；所有公开返回值都必须
 * 先经过本模块转换，避免 Token、Header/env 值与本地路径进入对话或 Web API。
 */

export const REDACTED_VALUE = '<REDACTED:REENTER>';
export const REDACTED_LOCAL_VALUE = '<REDACTED:LOCAL_VALUE>';
export const REDACTED_EXPORT_FORMAT = 'dsh-mcp-connector.redacted';
export const REDACTED_EXPORT_VERSION = 1;
export const SNAPSHOT_LIMIT = 20;

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function safeUrl(raw) {
  if (!raw) return { value: undefined, redacted: false };
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) {
      return { value: REDACTED_VALUE, redacted: true };
    }
    return { value: url.toString(), redacted: false };
  } catch {
    return { value: REDACTED_VALUE, redacted: true };
  }
}

function safeCommand(command) {
  if (!command) return { value: undefined, redacted: false };
  const value = String(command);
  if (/^[A-Za-z0-9_.@+-]+$/.test(value)) return { value, redacted: false };
  return { value: REDACTED_LOCAL_VALUE, redacted: true };
}

function redactedObjectValues(input) {
  return Object.fromEntries(Object.keys(input ?? {}).sort().map((key) => [key, REDACTED_VALUE]));
}

function portableName(record) {
  const name = String(record.name ?? '').trim();
  if (!name || /[\\/]|^[A-Za-z]:|file:/i.test(name)) {
    return record.serverName;
  }
  return name;
}

function exportPortableConnection(record) {
  const redactedFields = [];
  const base = {
    name: portableName(record),
    serverName: record.serverName,
    transport: record.transport,
    enabled: record.enabled !== false,
  };

  if (record.transport === 'stdio') {
    const command = safeCommand(record.command);
    base.command = command.value;
    if (command.redacted) redactedFields.push('command');
    if ((record.args ?? []).length) {
      base.args = record.args.map(() => REDACTED_VALUE);
      redactedFields.push('args');
    } else {
      base.args = [];
    }
    if (Object.keys(record.env ?? {}).length) {
      base.env = redactedObjectValues(record.env);
      redactedFields.push('env');
    }
    if (record.cwd) {
      base.cwd = REDACTED_LOCAL_VALUE;
      redactedFields.push('cwd');
    }
  } else {
    const url = safeUrl(record.url);
    base.url = url.value;
    if (url.redacted) redactedFields.push('url');
    if (Object.keys(record.headers ?? {}).length) {
      base.headers = redactedObjectValues(record.headers);
      redactedFields.push('headers');
    }
    if (record.auth?.mode === 'bearer') {
      base.authMode = 'bearer';
      base.bearerToken = REDACTED_VALUE;
      redactedFields.push('bearerToken');
    } else if (record.auth?.mode === 'api-key') {
      base.authMode = 'api-key';
      base.apiKeyHeader = record.auth.apiKeyHeader || 'X-Api-Key';
      base.apiKeyValue = REDACTED_VALUE;
      redactedFields.push('apiKeyValue');
    } else {
      base.authMode = 'none';
    }
  }

  if (redactedFields.length) base.redactedFields = redactedFields;
  return base;
}

function exportOauthReference(record) {
  return {
    connectorId: record.connectorId,
    serverKey: record.serverKey,
    name: portableName(record),
    serverName: record.serverName,
    enabled: record.enabled !== false,
    action: 'reconnect-oauth',
  };
}

/** 生成可复制/下载的 JSON；OAuth、凭据与本地路径永不进入结果。 */
export function exportRedactedConnections(records, { exportedAt = Date.now() } = {}) {
  const sorted = [...records].sort((a, b) => a.key.localeCompare(b.key));
  const connections = sorted.filter((record) => record.auth?.mode !== 'oauth').map(exportPortableConnection);
  const oauthConnections = sorted.filter((record) => record.auth?.mode === 'oauth').map(exportOauthReference);
  return {
    format: REDACTED_EXPORT_FORMAT,
    version: REDACTED_EXPORT_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    redacted: true,
    instructions: '将 <REDACTED:REENTER> 与 <REDACTED:LOCAL_VALUE> 替换为本机真实值后再导入；OAuth 项请从市场重新授权。',
    connections,
    oauthConnections,
  };
}

export function stringifyRedactedExport(records, options) {
  return JSON.stringify(exportRedactedConnections(records, options), null, 2);
}

export function unresolvedRedactions(value, path = '$', output = []) {
  if (value === REDACTED_VALUE || value === REDACTED_LOCAL_VALUE) output.push(path);
  else if (Array.isArray(value)) value.forEach((item, index) => unresolvedRedactions(item, `${path}[${index}]`, output));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) unresolvedRedactions(item, `${path}.${key}`, output);
  }
  return output;
}

export function snapshotPublicSummary(snapshot, grants = new Map()) {
  const oauthRecords = snapshot.records.filter((record) => record.auth?.mode === 'oauth');
  const unavailableOauth = oauthRecords.filter((record) => {
    const entry = record.auth?.grantKey ? grants.get(record.auth.grantKey) : null;
    return !entry || entry.needsReauth;
  });
  return {
    id: snapshot.key,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    targetKeys: uniqueStrings(snapshot.targetKeys),
    existingCount: snapshot.records.length,
    absentCount: snapshot.absentKeys.length,
    restorable: unavailableOauth.length === 0,
    requiresReauthorization: unavailableOauth.length > 0,
    oauthConnectionCount: oauthRecords.length,
  };
}
