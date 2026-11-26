/**
 * MCP 条目动态配置：通过 ctx.loader 创建/更新/停用/移除 @deepseek-ai/dsh-mcp-client 条目。
 * entryId = {entryPrefix}-{record.key}；serverName 决定工具名前缀，生命周期内不变 → 幂等。
 */

import { cliBridgeArgs } from './cli-providers.js';
import { effectiveLocalRecord } from './local-overrides.js';

/**
 * 会改变「加载什么代码」的环境变量：与 stdio-startup-guard.js 的 DROP_ENV_PATTERN 保持一致。
 * 这些键即使是连接级显式声明也不进 DSH_STDIO_EXPLICIT_ENV（守卫侧同样先判危险模式），
 * 否则远端卡片可以借 env 拿到任意代码执行（实测缺陷 S-4）。
 */
const DANGEROUS_LOADER_ENV = /^(?:electron_run_as_node|node_options|node_extra_ca_certs|node_path|ld_.*|dyld_.*|perl5lib|perllib|perl5opt|pythonpath|pythonhome|pythonstartup|bash_env|env|gconv_path)$/i;
import { fileURLToPath } from 'node:url';

const STDIO_STARTUP_GUARD = fileURLToPath(new URL('./stdio-startup-guard.js', import.meta.url));

/**
 * 桌面宿主（Electron 内嵌 DSH）的 `process.execPath` 是可执行文件本体：只有带上
 * `ELECTRON_RUN_AS_NODE` 才会作为 Node 运行 guard 脚本；CLI 宿主（node 进程）不需要。
 * 该变量只服务于 guard 自身，guard 启动真实 server 前会把它移除。
 */
function isElectronRuntime() {
  return typeof process.versions?.electron === 'string';
}

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

export function buildEntryConfig(record, grants, { failOnStartupError = false, startupRequestTimeoutMs } = {}) {
  record = effectiveLocalRecord(record);
  if (record.transport === 'sse') {
    // Keep the user record remote/SSE; adapt only the host entry, without runtime package installation.
    return {
      transport: 'stdio', serverName: record.serverName, command: process.execPath,
      args: [fileURLToPath(new URL('./legacy-sse-bridge.js', import.meta.url))],
      env: {
        DSH_LEGACY_SSE_CONFIG: JSON.stringify({ url: record.url, headers: authHeaders(record, grants) }),
        ...(isElectronRuntime() ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      cwd: process.cwd(), failOnStartupError,
    };
  }
  if (record.transport === 'stdio') {
    const env = { ...(record.env ?? {}) };
    if (record.auth?.mode === 'oauth' && record.oauthTokenEnv) {
      const grant = record.auth.grantKey ? grants.get(record.auth.grantKey) : null;
      if (grant?.accessToken) env[record.oauthTokenEnv] = `Bearer ${grant.accessToken}`;
    }
    const guarded = startupRequestTimeoutMs !== undefined;
    if (guarded && (!Number.isSafeInteger(startupRequestTimeoutMs) || startupRequestTimeoutMs < 100 || startupRequestTimeoutMs > 2_147_483_647)) {
      throw new RangeError('stdio startup request timeout must be an integer between 100 and 2147483647 ms');
    }
    const args = cliBridgeArgs(record);
    return {
      transport: 'stdio',
      serverName: record.serverName,
      command: guarded ? process.execPath : record.command,
      args: guarded ? [STDIO_STARTUP_GUARD, '--timeout-ms', String(startupRequestTimeoutMs), '--', record.command, ...args] : args,
      env: guarded
        ? {
            ...env,
            ...(isElectronRuntime() ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
            // 告诉守卫哪些 key 是连接级显式声明，据此跳过「危险加载器变量」剥离。
            // 只上报**非危险**键：危险加载器变量（NODE_OPTIONS / LD_* / PYTHONPATH 等）
            // 即使显式声明也不豁免，否则远端卡片可借 env 执行任意代码（实测缺陷 S-4）。
            // 守卫侧同样会先判危险模式，这里是双保险，避免把豁免面扩得过大。
            DSH_STDIO_EXPLICIT_ENV: Object.keys(record.env ?? {})
              .filter((key) => !DANGEROUS_LOADER_ENV.test(key))
              .join(','),
          }
        : env,
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
export async function provision(ctx, config, record, grants, { failOnStartupError = false, startupRequestTimeoutMs } = {}) {
  const id = entryIdFor(config, record);
  const entryConfig = buildEntryConfig(record, grants, { failOnStartupError, startupRequestTimeoutMs });
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
