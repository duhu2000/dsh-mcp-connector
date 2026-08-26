/**
 * MCP 条目动态配置：通过 ctx.loader 创建/更新/停用/移除 @deepseek-ai/dsh-mcp-client 条目。
 * entryId = {entryPrefix}-{record.key}；serverName 决定工具名前缀，生命周期内不变 → 幂等。
 */

export function entryIdFor(config, record) {
  return `${config.entryPrefix}-${record.key}`;
}

/** 由连接记录 + grant 集合构造条目 headers（含鉴权头） */
export function authHeaders(record, grants) {
  const headers = { ...(record.headers ?? {}) };
  if (!record.auth) return headers;
  if (record.auth.mode === 'oauth') {
    const grant = record.auth.grantKey ? grants.get(record.auth.grantKey) : null;
    if (grant?.accessToken) headers.Authorization = `Bearer ${grant.accessToken}`;
  } else if (record.auth.mode === 'bearer') {
    if (record.auth.bearerToken) headers.Authorization = `Bearer ${record.auth.bearerToken}`;
  } else if (record.auth.mode === 'api-key') {
    if (record.auth.apiKeyHeader && record.auth.apiKeyValue !== undefined && record.auth.apiKeyValue !== '') {
      headers[record.auth.apiKeyHeader] = record.auth.apiKeyValue;
    }
  }
  return headers;
}

export function buildEntryConfig(record, grants, { failOnStartupError = false } = {}) {
  if (record.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: record.serverName,
      command: record.command,
      args: record.args ?? [],
      env: record.env ?? {},
      cwd: record.cwd || process.cwd(),
      failOnStartupError,
    };
  }
  return {
    transport: 'streamable-http',
    serverName: record.serverName,
    url: record.url,
    headers: authHeaders(record, grants),
    failOnStartupError,
  };
}

function hasEntry(ctx, id) {
  try {
    ctx.loader.resolve(id);
    return true;
  } catch {
    return false;
  }
}

/** 创建或更新一条 mcp-client 条目（幂等；serverName 不变则工具名不变） */
export async function provision(ctx, config, record, grants, { failOnStartupError = false } = {}) {
  const id = entryIdFor(config, record);
  const entryConfig = buildEntryConfig(record, grants, { failOnStartupError });
  const disabled = record.enabled === false;
  if (hasEntry(ctx, id)) {
    const existing = ctx.loader.resolve(id);
    const previous = existing?.options?.config ?? {};
    const nextConfig = previous.transport && previous.transport !== entryConfig.transport
      ? entryConfig
      : { ...previous, ...entryConfig };
    await ctx.loader.update(id, { config: nextConfig, disabled });
  } else {
    await ctx.loader.create({ id, name: '@deepseek-ai/dsh-mcp-client', config: entryConfig, disabled });
  }
  return id;
}

/** 停用（保留记录，可重新启用） */
export async function disable(ctx, config, record) {
  const id = entryIdFor(config, record);
  if (hasEntry(ctx, id)) await ctx.loader.update(id, { disabled: true });
  return id;
}

/** 移除条目 */
export async function remove(ctx, config, record) {
  const id = entryIdFor(config, record);
  if (hasEntry(ctx, id)) await ctx.loader.remove(id);
  return id;
}

/** 按 serverName 判重（幂等 upsert 用） */
export function dedupeByServerName(records) {
  const seen = new Map();
  for (const record of records) {
    if (seen.has(record.serverName)) continue;
    seen.set(record.serverName, record);
  }
  return [...seen.values()];
}
