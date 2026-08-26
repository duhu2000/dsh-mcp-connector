/**
 * MCP连接器插件（DeepSeek Harness / Cordis）
 *
 * 能力：
 *   - 连接器目录（内置 + 远程 registry + config 注入 + 本地上下架覆盖）
 *   - 三通道连接：通用 OAuth(PKCE) / 自定义配置 / 粘贴 JSON / URL 安装
 *   - 连接记录与 OAuth grant 持久化（ctx.storageDomain），重启恢复
 *   - 通过 ctx.loader 动态配置 @deepseek-ai/dsh-mcp-client 条目
 *   - 对话工具：mcp_connector_catalog / connect / configure / import_json /
 *     install_from_url / status / set_enabled / disconnect / refresh_catalog / publish
 */
import z from '@deepseek-ai/schemastery';
import {
  DEFAULT_ACCOUNT,
  DEFAULT_CATALOG_URL,
  DEFAULT_CATALOG_FALLBACK_URLS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_REFRESH_SKEW_MS,
  DEFAULT_REFRESH_RETRY_BASE_MS,
  DEFAULT_REFRESH_RETRY_MAX_MS,
  DEFAULT_CATALOG_TTL_MS,
} from './constants.js';
import { defineConnectorDomain, ConnectionStore, GrantStore, CatalogStore } from './stores.js';
import { normalizeConnectorDescriptor, normalizeConnectionRecord } from './schema.js';
import { loadBundledCatalog, fetchRemoteCatalogWithFallback, mergeCatalog, listCatalog, auditDescriptor, auditRawDescriptor, readLimitedJson } from './catalog.js';
import { oauthAuthorize } from './connectors/oauth-connector.js';
import { buildManualRecord } from './connectors/manual-connector.js';
import { normalizeJsonImport } from './connectors/json-connector.js';
import { discoverServerMetadata, refreshAccessToken, revokeRefreshToken, extractTokenResources } from './oauth.js';
import { provision, disable, remove, entryIdFor } from './mcp-provision.js';
import { classifyConnectionError, validateConnectionRecords } from './mcp-validation.js';
import { listMcpTools, McpHttpError } from './mcp-http.js';
import { registerTools } from './tools.js';
import { mountWebRoutes } from './web.js';
import { assertSafeUrl } from './util.js';
import { readLegacyGrantCandidates, planLegacyMigration, toConnectorGrant, toConnectionRecords } from './migration.js';
import { classifyRefreshFailure, refreshRetryDelay } from './grant-lifecycle.js';

export const name = 'mcp-connector';

const LEGACY_OAUTH_PLUGINS = [
  {
    id: 'qcc-mcp-oauth',
    servers: ['qcc-company', 'qcc-risk', 'qcc-ipr', 'qcc-operation', 'qcc-history', 'qcc-executive'],
  },
  {
    id: 'qcc-legal-mcp-oauth',
    servers: ['qcc-regulation', 'qcc-case'],
  },
];

export const inject = ['tools', 'storageDomain', 'loader'];

export const Config = z.object({
  /** 远程目录 URL（默认公共 registry；显式空字符串 = 仅内置目录） */
  catalogUrl: z.string().default(DEFAULT_CATALOG_URL),
  /** 远程目录缓存 TTL（ms） */
  catalogTtlMs: z.number().default(DEFAULT_CATALOG_TTL_MS),
  /** 额外注入的连接器描述（ops/测试用，优先级高于远程 registry） */
  connectors: z.array(z.any()).default([]),
  /** 是否把连接与凭证持久化（false = 仅内存） */
  persistSecrets: z.boolean().default(true),
  /** 受管 mcp-client 条目 id 前缀 */
  entryPrefix: z.string().default('mcp'),
  /** 等待 OAuth 回调超时（ms） */
  callbackTimeoutMs: z.number().default(300_000),
  /** 网络请求超时（ms） */
  requestTimeoutMs: z.number().default(DEFAULT_REQUEST_TIMEOUT_MS),
  /** 首次启动并完成 MCP initialize + tools/list 的超时（ms） */
  startupTimeoutMs: z.number().default(DEFAULT_STARTUP_TIMEOUT_MS),
  /** 提前刷新阈值（ms） */
  refreshSkewMs: z.number().default(DEFAULT_REFRESH_SKEW_MS),
  /** 刷新暂时失败后的首次重试间隔（ms） */
  refreshRetryBaseMs: z.number().default(DEFAULT_REFRESH_RETRY_BASE_MS),
  /** 刷新暂时失败后的最大重试间隔（ms） */
  refreshRetryMaxMs: z.number().default(DEFAULT_REFRESH_RETRY_MAX_MS),
  /** 是否自动打开浏览器（false = 仅打印授权 URL） */
  openBrowser: z.boolean().default(true),
  /** 授权账号标识（预留多账号） */
  account: z.string().default(DEFAULT_ACCOUNT),
});

export async function apply(ctx, config) {
  const logger = ctx.logger('mcp-connector');

  const domain = await ctx.storageDomain.open(defineConnectorDomain());
  ctx.effect(() => () => {
    domain.close().catch((error) => logger.warn(`domain close: ${error.message}`));
  });

  const connectionStore = new ConnectionStore(domain);
  const grantStore = new GrantStore(domain);
  const catalogStore = new CatalogStore(domain);

  const state = {
    merged: [],                 // 合并后的连接器目录（含上下架覆盖）
    remoteConnectors: [],       // 远程 registry 最新拉取结果
    dynamic: new Map(),         // URL 安装的临时连接器
    overrides: new Map(),       // id -> { published?, featured? }
    connections: new Map(),     // key -> ConnectionRecord
    grants: new Map(),          // grantKey -> { grant, timer, refreshPromise, needsReauth, refreshFailure* }
    health: new Map(),          // connectorId -> 最近一次主动连通性检查摘要（不持久化）
    oauthConnects: new Map(),   // sharingKey -> { promise, requestedConnectorIds }（防同 issuer 重复弹窗）
    warnedLegacyConflicts: new Set(),
  };

  /* ───────────────────────── 目录加载 ───────────────────────── */

  async function recomputeMerged() {
    const bundled = loadBundledCatalog();
    const configConnectors = (config.connectors ?? []).map((raw) => auditDescriptor(normalizeConnectorDescriptor(raw)));
    const sources = [bundled, state.remoteConnectors, configConnectors, [...state.dynamic.values()]];
    state.merged = mergeCatalog(sources, state.overrides);
  }

  function catalogFallbackUrls() {
    return config.catalogUrl === DEFAULT_CATALOG_URL ? DEFAULT_CATALOG_FALLBACK_URLS : [];
  }

  function warnCatalogSourceFailure({ index, error }) {
    const source = index === 0 ? 'primary' : `fallback ${index}`;
    logger.warn(`catalog fetch ${source} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  async function loadCatalog() {
    const dynamicRec = await catalogStore.getDynamic().catch(() => null);
    if (dynamicRec?.connectors) {
      for (const raw of dynamicRec.connectors) {
        try {
          const descriptor = auditDescriptor(normalizeConnectorDescriptor(auditRawDescriptor(raw)));
          state.dynamic.set(descriptor.id, descriptor);
        } catch (error) {
          logger.warn(`skip invalid locally installed connector: ${error.message}`);
        }
      }
    }
    // 本地覆盖
    const overridesRec = await catalogStore.getOverrides().catch(() => null);
    if (overridesRec?.connectors) {
      const map = new Map();
      for (const patch of overridesRec.connectors) {
        if (patch && typeof patch === 'object' && patch.id) map.set(patch.id, patch);
      }
      state.overrides = map;
    }
    // 远程 registry（含缓存）
    if (config.catalogUrl) {
      const cached = await catalogStore.getRemote().catch(() => null);
      try {
        const fetched = await fetchRemoteCatalogWithFallback(
          config.catalogUrl,
          catalogFallbackUrls(),
          {
            requestTimeoutMs: config.requestTimeoutMs,
            etag: cached?.etag,
            onSourceError: warnCatalogSourceFailure,
          },
        );
        if (fetched.notModified) {
          state.remoteConnectors = cached?.connectors ?? [];
        } else {
          state.remoteConnectors = fetched.connectors;
          if (config.persistSecrets || true) {
            await catalogStore.putRemote({ etag: fetched.etag, connectors: fetched.connectors }).catch(() => {});
          }
        }
      } catch (error) {
        logger.warn(`catalog fetch failed (using cache if any): ${error.message}`);
        state.remoteConnectors = cached?.connectors ?? [];
      }
    }
    await recomputeMerged();
  }

  /* ───────────────────────── 旧 OAuth 插件冲突 ───────────────────────── */

  function loaderEntryActive(id) {
    try {
      const entry = ctx.loader.resolve(id);
      return !!entry && entry.disabled !== true && entry.options?.disabled !== true;
    } catch {
      return false;
    }
  }

  function activeLegacyPlugin(definition) {
    if (loaderEntryActive(definition.id)) return definition.id;
    // 兼容旧插件本体已经移除、但其动态 mcp-client 条目仍残留的配置树。
    return definition.servers.some((serverName) => loaderEntryActive(`mcp-${serverName}`))
      ? definition.id
      : null;
  }

  function legacyConflictForServer(serverName) {
    for (const definition of LEGACY_OAUTH_PLUGINS) {
      if (definition.servers.includes(serverName) && activeLegacyPlugin(definition)) return definition.id;
    }
    return null;
  }

  function legacyConflictForRecord(record) {
    const pluginId = legacyConflictForServer(record?.serverName);
    if (!pluginId) return null;
    return {
      pluginId,
      serverName: record.serverName,
      message: `检测到旧插件 ${pluginId} 仍在管理同名服务 ${record.serverName}；请停用旧插件并重启 DSH`,
    };
  }

  function legacyConflictForConnector(connector) {
    for (const server of connector?.servers ?? []) {
      const pluginId = legacyConflictForServer(server.serverName);
      if (pluginId) {
        return {
          pluginId,
          serverName: server.serverName,
          message: `检测到旧插件 ${pluginId} 仍在管理同名服务 ${server.serverName}；为避免凭据覆盖，请停用旧插件并重启 DSH 后再连接`,
        };
      }
    }
    return null;
  }

  function warnLegacyConflict(conflict) {
    if (!conflict || state.warnedLegacyConflicts.has(conflict.pluginId)) return;
    state.warnedLegacyConflicts.add(conflict.pluginId);
    logger.warn(`legacy OAuth plugin conflict: ${conflict.message}`);
  }

  function detectLegacyPluginConflicts() {
    const conflicts = [];
    for (const definition of LEGACY_OAUTH_PLUGINS) {
      if (!activeLegacyPlugin(definition)) continue;
      const conflict = {
        pluginId: definition.id,
        message: `检测到旧插件 ${definition.id} 仍处于启用状态；它会与 MCP连接器重复管理企查查 Server`,
      };
      conflicts.push(conflict);
      warnLegacyConflict(conflict);
    }
    return conflicts;
  }

  /* ───────────────────────── grant 刷新 ───────────────────────── */

  function grantRuntime(grant) {
    return {
      grant,
      timer: undefined,
      refreshPromise: null,
      needsReauth: false,
      refreshFailureKind: null,
      refreshFailureCount: 0,
      lastRefreshError: null,
      refreshRetryAt: null,
    };
  }

  function grantMap() {
    const map = new Map();
    for (const [key, g] of state.grants) map.set(key, g.grant);
    return map;
  }

  async function refreshGrant(grantKey) {
    const entry = state.grants.get(grantKey);
    if (!entry || !entry.grant.refreshToken) {
      const error = new Error('no refresh token available');
      error.code = 'missing_refresh_token';
      throw error;
    }
    if (entry.grant.clientSecret && entry.grant.clientSecretExpiresAt > 0
        && entry.grant.clientSecretExpiresAt * 1000 <= Date.now()) {
      const error = new Error('OAuth dynamic client secret expired');
      error.code = 'client_secret_expired';
      throw error;
    }
    if (entry.refreshPromise) return entry.refreshPromise;
    entry.refreshPromise = (async () => {
      const metadata = await discoverServerMetadata(entry.grant.issuer, config.requestTimeoutMs);
      const token = await refreshAccessToken(metadata.tokenEndpoint, {
        clientId: entry.grant.clientId,
        clientSecret: entry.grant.clientSecret,
        tokenEndpointAuthMethod: entry.grant.tokenEndpointAuthMethod ?? 'none',
        refreshToken: entry.grant.refreshToken,
        // 多资源共享 Grant 不应在刷新时被第一个 resource 意外收窄。
        resource: entry.grant.authorizedResources.length === 1 ? entry.grant.authorizedResources[0] : undefined,
        scope: entry.grant.scope,
        timeoutMs: config.requestTimeoutMs,
      });
      const refreshedResources = extractTokenResources(token.accessToken);
      const next = {
        ...entry.grant,
        accessToken: token.accessToken,
        // 持久化真实过期时间；提前刷新只用于定时调度，不能冒充 Token 已过期。
        accessTokenExpiresAt: Date.now() + token.expiresIn * 1000,
        refreshToken: token.refreshToken ?? entry.grant.refreshToken,
        authorizedResources: refreshedResources?.length ? refreshedResources : entry.grant.authorizedResources,
        updatedAt: Date.now(),
      };
      entry.grant = next;
      entry.needsReauth = false;
      entry.refreshFailureKind = null;
      entry.refreshFailureCount = 0;
      entry.lastRefreshError = null;
      entry.refreshRetryAt = null;
      state.grants.set(grantKey, entry);
      if (config.persistSecrets) await grantStore.put(next);
      for (const [key, record] of state.connections) {
        if (record.auth?.grantKey !== grantKey || record.enabled === false) continue;
        const conflict = legacyConflictForRecord(record);
        if (conflict) {
          warnLegacyConflict(conflict);
          continue;
        }
        await provision(ctx, config, record, grantMap()).catch((error) => {
          logger.warn(`re-provision "${key}" after OAuth refresh failed: ${error.message}`);
        });
      }
      scheduleRefresh(grantKey);
      return next;
    })();
    try {
      return await entry.refreshPromise;
    } finally {
      entry.refreshPromise = null;
    }
  }

  function scheduleRefresh(grantKey, { delayMs } = {}) {
    const entry = state.grants.get(grantKey);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    const tokenLifetime = Math.max(0, entry.grant.accessTokenExpiresAt - (entry.grant.updatedAt || Date.now()));
    const effectiveSkew = Math.min(
      Math.max(0, config.refreshSkewMs),
      Math.max(1_000, Math.floor(tokenLifetime * 0.1)),
    );
    const delay = delayMs === undefined
      ? Math.max(0, entry.grant.accessTokenExpiresAt - effectiveSkew - Date.now())
      : Math.max(0, delayMs);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      refreshGrantWithRecovery(grantKey, 'scheduled').catch(() => {});
    }, delay);
    entry.timer.unref?.();
  }

  function recordRefreshFailure(grantKey, error, phase) {
    const entry = state.grants.get(grantKey);
    if (!entry) return classifyRefreshFailure(error);
    const failure = classifyRefreshFailure(error);
    entry.refreshFailureCount = (entry.refreshFailureCount ?? 0) + 1;
    entry.refreshFailureKind = failure.kind;
    entry.lastRefreshError = failure.message;
    entry.needsReauth = failure.permanent;
    entry.refreshRetryAt = null;

    const status = failure.httpStatus ? ` http=${failure.httpStatus}` : '';
    const action = failure.permanent ? 'reauthorization required' : 'automatic retry scheduled';
    logger.warn(`OAuth grant refresh failed phase=${phase} grant=${grantKey} code=${failure.code}${status} classification=${failure.kind}: ${failure.message}; ${action}`);

    if (!failure.permanent) {
      const delay = refreshRetryDelay(
        entry.refreshFailureCount,
        config.refreshRetryBaseMs,
        config.refreshRetryMaxMs,
      );
      entry.refreshRetryAt = Date.now() + delay;
      scheduleRefresh(grantKey, { delayMs: delay });
    }
    return failure;
  }

  async function refreshGrantWithRecovery(grantKey, phase) {
    try {
      return await refreshGrant(grantKey);
    } catch (error) {
      // 多个调用方可能等待同一个 refreshPromise；同一次失败只能记一次并调度一个重试。
      if (!error.refreshFailure) error.refreshFailure = recordRefreshFailure(grantKey, error, phase);
      throw error;
    }
  }

  async function retireGrantIfUnused(grantKey, { revoke = false } = {}) {
    if ([...state.connections.values()].some((record) => record.auth?.grantKey === grantKey)) return false;
    const entry = state.grants.get(grantKey);
    if (!entry) return false;
    if (revoke && entry.grant.refreshToken) {
      try {
        const metadata = await discoverServerMetadata(entry.grant.issuer, config.requestTimeoutMs);
        if (metadata.revocationEndpoint) {
          await revokeRefreshToken(metadata.revocationEndpoint, {
            clientId: entry.grant.clientId,
            clientSecret: entry.grant.clientSecret,
            tokenEndpointAuthMethod: entry.grant.tokenEndpointAuthMethod ?? 'none',
            refreshToken: entry.grant.refreshToken,
            timeoutMs: config.requestTimeoutMs,
          });
        }
      } catch (error) {
        logger.warn(`retire unused grant ${grantKey}: revoke failed, removing local copy: ${error.message}`);
      }
    }
    if (entry.timer) clearTimeout(entry.timer);
    state.grants.delete(grantKey);
    if (config.persistSecrets) await grantStore.delete(grantKey).catch(() => {});
    return true;
  }

  async function pruneOrphanGrants({ revoke = false } = {}) {
    let removed = 0;
    for (const grantKey of [...state.grants.keys()]) {
      if (await retireGrantIfUnused(grantKey, { revoke })) removed += 1;
    }
    return removed;
  }

  /* ───────────────────────── 连接记录落库 / 挂载 ───────────────────────── */

  function clearRecordHealth(record) {
    if (record?.connectorId) state.health.delete(record.connectorId);
  }

  async function persistRecord(record) {
    // 存储成功后才更新内存，避免落盘失败却在当前进程显示为“已安装”。
    if (config.persistSecrets) await connectionStore.put(record);
    state.connections.set(record.key, record);
    clearRecordHealth(record);
  }

  async function restorePersistedRecord(key, original) {
    const current = state.connections.get(key);
    if (config.persistSecrets) {
      if (original) await connectionStore.put(original);
      else await connectionStore.delete(key);
    }
    if (original) state.connections.set(key, original);
    else state.connections.delete(key);
    clearRecordHealth(current);
    clearRecordHealth(original);
  }

  async function restoreProvisionedEntry(record, original) {
    if (original) await provision(ctx, config, original, grantMap(), { failOnStartupError: false });
    else await remove(ctx, config, record);
  }

  async function provisionUntilReady(record, original, { strictStartup = true } = {}) {
    if (!strictStartup) {
      return provision(ctx, config, record, grantMap(), { failOnStartupError: false });
    }
    const startupTimeoutMs = Math.max(1_000, Number(config.startupTimeoutMs) || DEFAULT_STARTUP_TIMEOUT_MS);
    const timeoutError = Object.assign(
      new Error(`MCP Server 启动与工具同步超过 ${Math.ceil(startupTimeoutMs / 1000)} 秒`),
      { code: 'ETIMEDOUT' },
    );
    let timer;
    const task = provision(ctx, config, record, grantMap(), { failOnStartupError: true });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError), startupTimeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([task, deadline]);
    } catch (error) {
      if (error === timeoutError) {
        // loader 可能仍在等待 SDK 请求；它最终成功时必须恢复旧条目/移除新条目，绝不迟到落库。
        task.then(
          () => restoreProvisionedEntry(record, original).catch((rollbackError) => {
            logger.error(`late startup rollback "${record.key}" failed: ${rollbackError.message}`);
          }),
          () => {},
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function rollbackProvisionedRecords(records, originals) {
    const failures = [];
    for (const record of [...records].reverse()) {
      try {
        await restoreProvisionedEntry(record, originals.get(record.key));
      } catch (error) {
        failures.push(error);
        logger.error(`connection rollback "${record.key}" failed: ${error.message}`);
      }
    }
    return failures;
  }

  async function commitConnectionRecords(records, { strictStartup = true } = {}) {
    const originals = new Map(records.map((record) => [record.key, state.connections.get(record.key)]));
    const staged = records.map((record) => {
      const existing = originals.get(record.key);
      return existing ? { ...existing, ...record, updatedAt: Date.now() } : record;
    });
    const provisioned = [];
    let activeRecord;
    try {
      for (const record of staged) {
        activeRecord = record;
        await provisionUntilReady(record, originals.get(record.key), { strictStartup });
        provisioned.push(record);
      }
    } catch (error) {
      await rollbackProvisionedRecords(provisioned, originals);
      const wrapped = new Error(`MCP Server "${activeRecord?.serverName ?? activeRecord?.key ?? 'unknown'}" 未完成启动`, { cause: error });
      wrapped.connectionRecord = activeRecord;
      throw wrapped;
    }

    try {
      for (const record of staged) await persistRecord(record);
    } catch (error) {
      const rollbackErrors = await rollbackProvisionedRecords(provisioned, originals);
      for (const record of staged) {
        try {
          await restorePersistedRecord(record.key, originals.get(record.key));
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
          logger.error(`connection storage rollback "${record.key}" failed: ${rollbackError.message}`);
        }
      }
      const wrapped = new Error('连接记录持久化失败，已回滚 Host 条目', { cause: error });
      wrapped.connectionRecord = activeRecord;
      wrapped.rollbackErrors = rollbackErrors;
      throw wrapped;
    }
    return staged;
  }

  async function upsertRecord(record, options) {
    return (await commitConnectionRecords([record], options))[0];
  }

  function grantFailure(record) {
    if (record.auth?.mode !== 'oauth') return null;
    const conflict = legacyConflictForRecord(record);
    if (conflict) {
      warnLegacyConflict(conflict);
      return { ok: false, kind: 'conflict', serverKey: record.serverKey, serverName: record.serverName, message: conflict.message };
    }
    const grantKey = record.auth.grantKey;
    const entry = grantKey ? state.grants.get(grantKey) : null;
    if (!entry) return { ok: false, kind: 'auth', serverKey: record.serverKey, serverName: record.serverName, message: 'OAuth 授权缺失，请重新授权' };
    const clientSecretExpired = entry.grant.clientSecret && entry.grant.clientSecretExpiresAt > 0
      && entry.grant.clientSecretExpiresAt * 1000 <= Date.now();
    if (entry.needsReauth || clientSecretExpired) {
      return { ok: false, kind: 'auth', serverKey: record.serverKey, serverName: record.serverName, message: 'OAuth 授权已过期或刷新失败，请重新授权' };
    }
    if (entry.grant.accessTokenExpiresAt <= Date.now()) {
      return {
        ok: false,
        kind: 'refresh',
        serverKey: record.serverKey,
        serverName: record.serverName,
        message: entry.refreshPromise
          ? 'OAuth Access Token 已到期，正在自动刷新'
          : `OAuth 刷新暂时失败，正在自动重试${entry.lastRefreshError ? `：${entry.lastRefreshError}` : ''}`,
      };
    }
    return null;
  }

  function registeredStdioTools(record) {
    if (typeof ctx.tools?.schemas !== 'function') {
      return { supported: false, tools: [] };
    }
    const prefix = `mcp__${record.serverName}__`;
    try {
      const tools = ctx.tools.schemas()
        .filter((schema) => typeof schema?.name === 'string' && schema.name.startsWith(prefix))
        .map((schema) => ({
          name: schema.name.slice(prefix.length),
          publicName: schema.name,
          title: schema.title || schema.name.slice(prefix.length),
          description: schema.description || '',
        }));
      return { supported: true, tools };
    } catch (error) {
      logger.warn(`read registered tools for "${record.serverName}" failed: ${error.message}`);
      return { supported: true, tools: [], error };
    }
  }

  function readinessResults(records, validationResults = []) {
    return records.map((record, index) => {
      const validated = validationResults[index];
      return {
        ...(validated ?? {}),
        ok: true,
        kind: 'connected',
        serverKey: record.serverKey,
        serverName: record.serverName,
        message: record.transport === 'stdio'
          ? 'Host 已完成 stdio MCP 初始化与首次工具同步'
          : validated?.message,
      };
    });
  }

  function connectionSetupFailure(error, prefix = '连接失败') {
    const record = error?.connectionRecord;
    const classified = classifyConnectionError(error, { transport: record?.transport });
    return {
      ok: false,
      message: `${prefix}：${classified.message}。未保存连接，请修正后重试。`,
      detail: {
        kind: classified.kind,
        serverKey: record?.serverKey,
        serverName: record?.serverName,
        ...(classified.exitCode !== undefined ? { exitCode: classified.exitCode } : {}),
      },
    };
  }

  function healthSummary(connectorId, records, results, checkedAt = Date.now()) {
    const enabledRecords = records.filter((record) => record.enabled !== false);
    const availableServers = results.filter((result) => result.ok && result.kind !== 'managed').length;
    const pendingServers = results.filter((result) => result.ok && result.kind === 'managed').length;
    const failedServers = results.filter((result) => !result.ok).length;
    const authFailures = results.filter((result) => !result.ok && result.kind === 'auth').length;
    const refreshFailures = results.filter((result) => !result.ok && result.kind === 'refresh').length;
    let connectionState = 'configured';
    if (records.length === 0) connectionState = 'disconnected';
    else if (enabledRecords.length === 0) connectionState = 'disabled';
    else if (failedServers === 0 && pendingServers === 0 && availableServers > 0) connectionState = 'healthy';
    else if (availableServers > 0 && (failedServers > 0 || pendingServers > 0)) connectionState = 'degraded';
    else if (pendingServers > 0 && failedServers === 0) connectionState = 'configured';
    else if (authFailures > 0) connectionState = 'reauth';
    else if (refreshFailures > 0) connectionState = 'recovering';
    else if (failedServers > 0) connectionState = 'unavailable';
    const labels = {
      disconnected: '未连接', configured: '已配置', disabled: '已停用', healthy: '已连接',
      degraded: '部分异常', reauth: '需重新授权', recovering: '自动重试中', unavailable: '连接异常',
    };
    return {
      connectorId,
      connectionState,
      label: labels[connectionState],
      configuredServers: records.length,
      enabledServers: enabledRecords.length,
      availableServers,
      pendingServers,
      failedServers,
      checkedAt,
      results,
    };
  }

  function connectorHealth(connectorId) {
    const records = [...state.connections.values()].filter((record) => record.connectorId === connectorId);
    if (records.length === 0) return healthSummary(connectorId, records, [], null);
    if (records.every((record) => record.enabled === false)) return healthSummary(connectorId, records, [], null);
    const immediateFailures = records.filter((record) => record.enabled !== false).map(grantFailure).filter(Boolean);
    if (immediateFailures.length > 0) return healthSummary(connectorId, records, immediateFailures, Date.now());
    const cached = state.health.get(connectorId);
    return cached ?? {
      ...healthSummary(connectorId, records, [], null),
      connectionState: 'configured',
      label: '已配置',
    };
  }

  function cacheHealth(connectorId, records, results) {
    const summary = healthSummary(connectorId, records, results);
    state.health.set(connectorId, summary);
    return summary;
  }

  function resolveCredentialValues(connector, params = {}) {
    const raw = params.credentialValues && typeof params.credentialValues === 'object' && !Array.isArray(params.credentialValues)
      ? params.credentialValues
      : {};
    const values = {};
    const fields = connector.auth.credentialFields ?? [];
    for (const [index, field] of fields.entries()) {
      let value = raw[field.key];
      // 兼容旧调用方：单一/首个凭据仍可通过 bearerToken 或 apiKeyValue 传入。
      if ((value === undefined || value === '') && (field.key === 'credential' || index === 0)) {
        value = connector.auth.mode === 'bearer' ? params.bearerToken : params.apiKeyValue;
      }
      if (field.required && (value === undefined || String(value).trim() === '')) {
        throw new Error(`${field.label} 必填`);
      }
      if (value !== undefined && String(value) !== '') values[field.key] = String(value);
    }
    return values;
  }

  function bindStdioCredentials(server, credentialValues) {
    const env = { ...(server.env ?? {}) };
    for (const [envName, credentialKey] of Object.entries(server.credentialBindings ?? {})) {
      const value = credentialValues[credentialKey];
      if (value !== undefined && value !== '') env[envName] = value;
    }
    return env;
  }

  /* ───────────────────────── OAuth Grant 共享 ───────────────────────── */

  function canonicalIssuer(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return String(value ?? '').replace(/\/+$/, '');
    }
  }

  function oauthResourceOrigins(connector) {
    return [...new Set((connector.servers ?? []).map((server) => {
      try { return new URL(server.url).origin; } catch { return ''; }
    }).filter(Boolean))].sort();
  }

  function oauthSharingConnectors(connector) {
    if (connector.auth?.grantSharing !== 'issuer' || !connector.auth.issuer) return [connector];
    const issuer = canonicalIssuer(connector.auth.issuer);
    const resourceOrigins = new Set(oauthResourceOrigins(connector));
    const matches = state.merged.filter((candidate) => (
      candidate.published !== false
      && candidate.auth?.mode === 'oauth2-pkce'
      && candidate.auth.grantSharing === 'issuer'
      && canonicalIssuer(candidate.auth.issuer) === issuer
      && candidate.auth.scope === connector.auth.scope
      && candidate.auth.tokenEndpointAuthMethod === connector.auth.tokenEndpointAuthMethod
      // 防止同 issuer 的第三方描述把共享 Bearer Token 聚合到其他资源域名。
      && oauthResourceOrigins(candidate).every((origin) => resourceOrigins.has(origin))
    ));
    // 授权请求的 resource 必须优先使用用户点击的卡片；其余同组 Server 只用于识别共享范围。
    return [connector, ...matches.filter((candidate) => candidate.id !== connector.id)];
  }

  function oauthSharingKey(connector) {
    if (connector.auth?.grantSharing !== 'issuer' || !connector.auth.issuer) return `connector:${connector.id}`;
    return `issuer:${config.account}:${canonicalIssuer(connector.auth.issuer)}:${connector.auth.scope}:${connector.auth.tokenEndpointAuthMethod}:${oauthResourceOrigins(connector).join(',')}`;
  }

  function oauthAuthorizationDescriptor(connector, sharingConnectors) {
    if (sharingConnectors.length === 1) return connector;
    const seen = new Set();
    const servers = [];
    for (const candidate of sharingConnectors) {
      for (const server of candidate.servers) {
        if (seen.has(server.url)) continue;
        seen.add(server.url);
        servers.push({ ...server, serverKey: `${candidate.id}:${server.serverKey}` });
      }
    }
    return { ...connector, servers };
  }

  function oauthRecordsFor(connectors, authorizedResources, grantKey) {
    const granted = new Set(authorizedResources);
    const now = Date.now();
    const records = [];
    for (const connector of connectors) {
      for (const server of connector.servers.filter((candidate) => granted.has(candidate.url))) {
        records.push({
          key: `${connector.id}-${server.serverKey}`,
          connectorId: connector.id,
          kind: 'oauth',
          name: connector.servers.length > 1 ? `${connector.name}·${server.serverKey}` : connector.name,
          serverKey: server.serverKey,
          transport: server.transport,
          url: server.url,
          serverName: server.serverName,
          headers: server.headers,
          auth: { mode: 'oauth', grantKey },
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return records;
  }

  function ensureRequestedConnectorsAuthorized(requestedIds, records) {
    const connectedIds = new Set(records.map((record) => record.connectorId));
    const missing = [...requestedIds].filter((id) => !connectedIds.has(id));
    if (missing.length === 0) return;
    throw new Error(`本次授权未包含连接器所需的 MCP 资源：${missing.join(', ')}`);
  }

  async function findReusableSharedGrant(connector) {
    if (connector.auth?.grantSharing !== 'issuer' || !connector.auth.issuer) return null;
    const issuer = canonicalIssuer(connector.auth.issuer);
    for (const [grantKey, entry] of state.grants) {
      const grant = entry.grant;
      if (entry.needsReauth
          || grant.account !== config.account
          || grant.scope !== connector.auth.scope
          || (grant.tokenEndpointAuthMethod ?? 'none') !== connector.auth.tokenEndpointAuthMethod
          || canonicalIssuer(grant.issuer) !== issuer) continue;

      if (grant.accessTokenExpiresAt <= Date.now()) {
        try {
          await refreshGrantWithRecovery(grantKey, 'shared-connect');
        } catch (error) {
          if (error.refreshFailure?.kind === 'transient') {
            return { temporaryFailure: error.refreshFailure };
          }
          continue;
        }
      }
      if (connector.servers.some((server) => entry.grant.authorizedResources.includes(server.url))) {
        return { grantKey, entry };
      }
    }
    return null;
  }

  async function attachConnectorsToGrant(grantKey, entry, connectors, requestedIds) {
    const usableConnectors = connectors.filter((connector) => {
      const conflict = legacyConflictForConnector(connector);
      if (!conflict) return true;
      warnLegacyConflict(conflict);
      return false;
    });
    const records = oauthRecordsFor(usableConnectors, entry.grant.authorizedResources, grantKey);
    ensureRequestedConnectorsAuthorized(requestedIds, records);
    const connectedConnectorIds = [...new Set(records.map((record) => record.connectorId))];
    const previous = entry.grant;
    const next = {
      ...previous,
      connectorIds: [...new Set([...(previous.connectorIds ?? []), ...connectedConnectorIds])],
      updatedAt: Date.now(),
    };
    entry.grant = next;
    if (config.persistSecrets) await grantStore.put(next);
    try {
      const committed = await commitConnectionRecords(records);
      for (const connector of usableConnectors) {
        const own = committed.filter((record) => record.connectorId === connector.id);
        if (own.length > 0) cacheHealth(connector.id, own, readinessResults(own));
      }
      scheduleRefresh(grantKey);
      return committed;
    } catch (error) {
      entry.grant = previous;
      if (config.persistSecrets) await grantStore.put(previous).catch((rollbackError) => {
        logger.error(`shared grant rollback ${grantKey} failed: ${rollbackError.message}`);
      });
      throw error;
    }
  }

  /* ───────────────────────── api 门面 ───────────────────────── */

  const api = {
    async catalog({ category, keyword } = {}) {
      const items = listCatalog(state.merged, { category, keyword, publishedOnly: true }).map((d) => {
        const health = connectorHealth(d.id);
        return ({
        id: d.id,
        name: d.name,
        vendor: d.vendor,
        icon: d.icon,
        category: d.category,
        summary: d.summary,
        description: d.description,
        tags: d.tags,
        featured: d.featured,
        homepage: d.homepage,
        promptVariables: d.promptVariables ?? [],
        authMode: d.auth.mode,
        apiKeyHeader: d.auth.apiKeyHeader,
        credentialName: d.auth.credentialName,
        credentialPlaceholder: d.auth.credentialPlaceholder,
        credentialDescription: d.auth.credentialDescription,
        credentialHelpLabel: d.auth.credentialHelpLabel,
        credentialFields: d.auth.credentialFields ?? [],
        prompts: d.prompts ?? [],
        probeStatus: d.probeStatus,
        probeCheckedAt: d.probeCheckedAt,
        probeReportUrl: d.probeReportUrl,
        toolsSnapshot: d.toolsSnapshot ?? [],
        connected: [...state.connections.values()].filter((r) => r.connectorId === d.id).map((r) => r.key),
        connectionState: health.connectionState,
        connectionLabel: health.label,
        healthCheckedAt: health.checkedAt,
        availableServers: health.availableServers,
        failedServers: health.failedServers,
        servers: (d.servers ?? []).map((s) => ({
          serverKey: s.serverKey,
          url: s.url,
          command: s.command,
          args: s.args,
          credentialBindings: s.credentialBindings,
          transport: s.transport,
          serverName: s.serverName,
        })),
        });
      });
      return {
        ok: true,
        message: `共 ${items.length} 个已上架连接器`,
        detail: { items },
      };
    },

    async connect(connectorId, serverKey, signal) {
      const connector = state.merged.find((d) => d.id === connectorId);
      if (!connector) return { ok: false, message: `连接器 "${connectorId}" 不存在（可先 mcp_connector_refresh_catalog 或 mcp_connector_catalog 查看）` };

      if (connector.auth.mode === 'oauth2-pkce') {
        const conflict = legacyConflictForConnector(connector);
        if (conflict) {
          warnLegacyConflict(conflict);
          return { ok: false, message: conflict.message, detail: { kind: 'plugin-conflict', pluginId: conflict.pluginId, serverName: conflict.serverName } };
        }

        const sharingKey = oauthSharingKey(connector);
        const inFlight = state.oauthConnects.get(sharingKey);
        if (inFlight) {
          inFlight.requestedConnectorIds.add(connector.id);
          return inFlight.promise;
        }
        const requestedConnectorIds = new Set([connector.id]);
        const promise = (async () => {
          try {
            const sharingConnectors = oauthSharingConnectors(connector);
            const reusable = await findReusableSharedGrant(connector);
            if (reusable?.temporaryFailure) {
              return {
                ok: false,
                message: `OAuth 授权刷新暂时失败（${reusable.temporaryFailure.code}），插件将自动重试，无需重新授权`,
                detail: { kind: 'refresh-retry', retrying: true },
              };
            }
            if (reusable?.entry) {
              const requestedConnectors = sharingConnectors.filter((item) => requestedConnectorIds.has(item.id));
              const committed = await attachConnectorsToGrant(
                reusable.grantKey,
                reusable.entry,
                requestedConnectors,
                requestedConnectorIds,
              );
              const created = committed.map((record) => record.key);
              return {
                ok: true,
                message: `已复用同账号 OAuth 授权连接 ${requestedConnectors.length} 个连接器（${created.length} 个 MCP server），无需再次授权`,
                detail: { keys: created, grantKey: reusable.grantKey, reusedGrant: true, retiredGrantCount: 0 },
              };
            }

            const sharingConnectorIds = new Set(sharingConnectors.map((item) => item.id));
            const previousGrantKeys = new Set(
              [...state.grants]
                .filter(([, entry]) => entry.grant.connectorIds?.some((id) => sharingConnectorIds.has(id)))
                .map(([key]) => key),
            );
            const authorizationConnector = oauthAuthorizationDescriptor(connector, sharingConnectors);
            const authz = await oauthAuthorize({ connector: authorizationConnector, config, logger, signal });
            const grantKey = grantStore.keyFor(config.account, authz.issuer, authz.clientId, authz.scope);
            const entryResource = authz.entryResource;
            const authorizedResources = authz.grantedResources?.length ? authz.grantedResources : [entryResource];
            const alreadyConnectedIds = new Set(
              [...state.connections.values()]
                .filter((record) => sharingConnectorIds.has(record.connectorId))
                .map((record) => record.connectorId),
            );
            const targetIds = new Set([...alreadyConnectedIds, ...requestedConnectorIds]);
            const targetConnectors = sharingConnectors.filter((item) => targetIds.has(item.id));
            const previewRecords = oauthRecordsFor(targetConnectors, authorizedResources, grantKey);
            ensureRequestedConnectorsAuthorized(requestedConnectorIds, previewRecords);
            const grantedConnectorIds = [...new Set(previewRecords.map((record) => record.connectorId))];
            const grant = {
              key: grantKey,
              issuer: authz.issuer,
              clientId: authz.clientId,
              clientSecret: authz.clientSecret,
              clientSecretExpiresAt: authz.clientSecretExpiresAt,
              tokenEndpointAuthMethod: authz.tokenEndpointAuthMethod ?? 'none',
              clientName: authz.clientName,
              scope: authz.scope,
              account: config.account,
              accessToken: authz.token.accessToken,
              accessTokenExpiresAt: Date.now() + authz.token.expiresIn * 1000,
              refreshToken: authz.token.refreshToken ?? '',
              authorizedResources,
              connectorIds: grantedConnectorIds,
              updatedAt: Date.now(),
            };
            const runtime = grantRuntime(grant);
            state.grants.set(grantKey, runtime);
            if (config.persistSecrets) await grantStore.put(grant);
            const committed = await attachConnectorsToGrant(grantKey, runtime, targetConnectors, requestedConnectorIds);
            const created = committed.map((record) => record.key);
            let retiredGrantCount = 0;
            for (const previousKey of previousGrantKeys) {
              if (previousKey !== grantKey && await retireGrantIfUnused(previousKey, { revoke: true })) retiredGrantCount += 1;
            }
            return {
              ok: true,
              message: sharingConnectors.length > 1
                ? `OAuth 授权成功；已为同一账号保存共享授权并连接 ${targetConnectors.length} 个连接器（${created.length} 个 MCP server）`
                : `已连接 "${connector.name}"（${created.length} 个 MCP server），共 ${created.length} 条`,
              detail: { keys: created, grantKey, sharedGrant: sharingConnectors.length > 1, retiredGrantCount },
            };
          } catch (error) {
            logger.error(`oauth connect failed: ${error.message}`);
            await pruneOrphanGrants();
            return error?.connectionRecord
              ? connectionSetupFailure(error)
              : { ok: false, message: `连接失败: ${error.message}` };
          }
        })();
        state.oauthConnects.set(sharingKey, { promise, requestedConnectorIds });
        try {
          return await promise;
        } finally {
          if (state.oauthConnects.get(sharingKey)?.promise === promise) state.oauthConnects.delete(sharingKey);
        }
      }

      if (connector.auth.mode === 'none') {
        const server = connector.servers.find((item) => item.serverKey === serverKey) ?? connector.servers[0];
        const record = {
          key: `${connector.id}-${server.serverKey}`,
          connectorId: connector.id,
          kind: 'manual',
          name: connector.name,
          serverKey: server.serverKey,
          transport: server.transport,
          url: server.url,
          command: server.command,
          args: server.args,
          env: server.env,
          cwd: server.cwd,
          serverName: server.serverName,
          headers: server.headers,
          auth: undefined,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const validation = await validateConnectionRecords([record], { timeoutMs: config.requestTimeoutMs });
        if (!validation.ok) return { ...validation, detail: { connectorId: connector.id, ...validation.detail } };
        try {
          const [committed] = await commitConnectionRecords([record]);
          cacheHealth(connector.id, [committed], readinessResults([committed], validation.detail.results));
          return { ok: true, message: `已连接 "${connector.name}"`, detail: { key: committed.key } };
        } catch (error) {
          return connectionSetupFailure(error);
        }
      }

      // bearer / api-key 型：目录不含密钥，引导自定义配置
      return {
        ok: false,
        message:
          `连接器 "${connector.name}" 需要凭据（${connector.auth.mode}），目录不含密钥。` +
          '请用 mcp_connector_configure 在本机填写目录声明的凭据字段。',
        detail: {
          transport: connector.servers[0].transport,
          url: connector.servers[0].url,
          command: connector.servers[0].command,
          serverName: connector.servers[0].serverName,
          credentialFields: connector.auth.credentialFields ?? [],
        },
      };
    },

    async configure(params) {
      try {
        const connectorId = String(params?.connectorId ?? '').trim();
        if (connectorId) {
          const connector = state.merged.find((item) => item.id === connectorId);
          if (!connector) throw new Error(`连接器 "${connectorId}" 不存在`);
          if (!['bearer', 'api-key'].includes(connector.auth.mode)) {
            throw new Error(`连接器 "${connector.name}" 不是 Bearer/API Key 凭据型`);
          }
          const records = [];
          const credentialValues = resolveCredentialValues(connector, params);
          const primaryCredential = credentialValues[connector.auth.credentialFields?.[0]?.key ?? 'credential'];
          for (const server of connector.servers) {
            const record = buildManualRecord({
              name: connector.servers.length > 1 ? `${connector.name}·${server.serverKey}` : connector.name,
              url: server.url,
              serverName: server.serverName,
              transport: server.transport,
              command: server.command,
              args: server.args,
              envJson: server.transport === 'stdio' ? bindStdioCredentials(server, credentialValues) : undefined,
              cwd: server.cwd,
              headersJson: server.headers,
              authMode: server.transport === 'stdio' ? 'none' : connector.auth.mode,
              bearerToken: params.bearerToken ?? primaryCredential,
              apiKeyHeader: params.apiKeyHeader || connector.auth.apiKeyHeader,
              apiKeyValue: params.apiKeyValue ?? primaryCredential,
            });
            record.key = `${connector.id}-${server.serverKey}`;
            record.connectorId = connector.id;
            record.serverKey = server.serverKey;
            records.push(record);
          }
          const validation = await validateConnectionRecords(records, { timeoutMs: config.requestTimeoutMs });
          if (!validation.ok) return { ...validation, detail: { connectorId: connector.id, ...validation.detail } };

          const committed = await commitConnectionRecords(records);
          const created = committed.map((record) => record.key);
          cacheHealth(connector.id, committed, readinessResults(committed, validation.detail.results));
          return {
            ok: true,
            message: `已配置并连接 "${connector.name}"（${created.length} 个 MCP Server）`,
            detail: { connectorId: connector.id, keys: created },
          };
        }
        const record = buildManualRecord(params);
        const validation = await validateConnectionRecords([record], { timeoutMs: config.requestTimeoutMs });
        if (!validation.ok) return validation;
        const [committed] = await commitConnectionRecords([record]);
        cacheHealth(committed.connectorId, [committed], readinessResults([committed], validation.detail.results));
        return { ok: true, message: `已配置并连接 "${committed.name}"（serverName=${committed.serverName}）`, detail: { key: committed.key, serverName: committed.serverName } };
      } catch (error) {
        return error?.connectionRecord
          ? connectionSetupFailure(error, '配置失败')
          : { ok: false, message: `配置失败: ${error.message}` };
      }
    },

    async importJson(json) {
      try {
        const { records, skipped } = normalizeJsonImport(json);
        const validation = await validateConnectionRecords(records, {
          timeoutMs: config.requestTimeoutMs,
          concurrency: 4,
        });
        if (!validation.ok) return validation;
        const committed = await commitConnectionRecords(records);
        const keys = committed.map((record) => record.key);
        const grouped = new Map();
        for (const record of committed) {
          if (!grouped.has(record.connectorId)) grouped.set(record.connectorId, []);
          grouped.get(record.connectorId).push(record);
        }
        for (const [connectorId, connectorRecords] of grouped) {
          const results = connectorRecords.map((record) => {
            const index = committed.findIndex((item) => item.key === record.key);
            return readinessResults([record], [validation.detail.results[index]])[0];
          });
          cacheHealth(connectorId, connectorRecords, results);
        }
        const extra = skipped.length ? `；跳过：${skipped.join('、')}` : '';
        return {
          ok: true,
          message: `已导入并连接 ${keys.length} 个 MCP${extra}；JSON 导入属于本机连接，不会自动上架市场`,
          detail: { keys, skipped },
        };
      } catch (error) {
        return error?.connectionRecord
          ? connectionSetupFailure(error, '导入失败')
          : { ok: false, message: `导入失败: ${error.message}` };
      }
    },

    async installFromUrl(url) {
      try {
        assertSafeUrl(url);
        const response = await fetch(url, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
        assertSafeUrl(response.url || url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await readLimitedJson(response);
        const list = Array.isArray(data) ? data : Array.isArray(data?.connectors) ? data.connectors : [data];
        const normalized = list.map((raw) => auditDescriptor(normalizeConnectorDescriptor(auditRawDescriptor(raw))));
        for (const d of normalized) state.dynamic.set(d.id, d);
        await catalogStore.putDynamic([...state.dynamic.values()]);
        await recomputeMerged();
        if (normalized.length === 1) {
          const one = normalized[0];
          if (one.auth.mode === 'none' || one.auth.mode === 'oauth2-pkce') {
            return api.connect(one.id, undefined, undefined);
          }
          return { ok: true, message: `已安装连接器 "${one.name}"（需凭据，请用 mcp_connector_configure）`, detail: { connectorId: one.id } };
        }
        return { ok: true, message: `已安装 ${normalized.length} 个连接器，可在目录中连接`, detail: { ids: normalized.map((d) => d.id) } };
      } catch (error) {
        return { ok: false, message: `URL 安装失败: ${error.message}` };
      }
    },

    async status() {
      const items = [];
      for (const [key, record] of state.connections) {
        const health = record.connectorId ? connectorHealth(record.connectorId) : null;
        const recordHealth = health?.results?.find((result) => result.serverKey === record.serverKey || result.serverName === record.serverName);
        let grantInfo = null;
        if (record.auth?.grantKey) {
          const g = state.grants.get(record.auth.grantKey);
          grantInfo = g
            ? {
                grantKey: record.auth.grantKey,
                accessTokenExpiresAt: g.grant.accessTokenExpiresAt,
                needsReauth: !!g.needsReauth,
                refreshFailureKind: g.refreshFailureKind,
                lastRefreshError: g.lastRefreshError,
                refreshRetryAt: g.refreshRetryAt,
              }
            : { grantKey: record.auth.grantKey, missing: true };
        }
        items.push({
          key,
          name: record.name,
          connectorId: record.connectorId,
          kind: record.kind,
          serverName: record.serverName,
          url: record.url,
          transport: record.transport,
          endpoint: record.transport === 'stdio' ? `stdio · ${record.command}` : record.url,
          enabled: record.enabled !== false,
          authMode: record.auth?.mode ?? 'none',
          grant: grantInfo,
          lastError: record.lastError ?? null,
          connectionState: recordHealth?.ok && recordHealth.kind !== 'managed'
            ? 'healthy'
            : recordHealth ? health.connectionState : health?.connectionState ?? 'configured',
          healthCheckedAt: health?.checkedAt ?? null,
          healthMessage: recordHealth?.message ?? null,
        });
      }
      return { ok: true, message: `共 ${items.length} 条连接`, detail: { items } };
    },

    async healthCheck(connectorId) {
      const targetIds = connectorId
        ? [String(connectorId)]
        : [...new Set([...state.connections.values()].map((record) => record.connectorId).filter(Boolean))];
      const summaries = [];
      for (const id of targetIds) {
        const records = [...state.connections.values()].filter((record) => record.connectorId === id);
        const enabledRecords = records.filter((record) => record.enabled !== false);
        if (records.length === 0 || enabledRecords.length === 0) {
          const summary = healthSummary(id, records, [], Date.now());
          state.health.set(id, summary);
          summaries.push(summary);
          continue;
        }
        const immediateResults = [];
        const checkable = [];
        for (const record of enabledRecords) {
          const failure = grantFailure(record);
          if (failure) immediateResults.push(failure);
          else if (record.transport === 'stdio') {
            const registered = registeredStdioTools(record);
            if (registered.tools.length > 0) {
              immediateResults.push({
                ok: true,
                kind: 'connected',
                serverKey: record.serverKey,
                serverName: record.serverName,
                toolCount: registered.tools.length,
                message: `Host 已注册 ${registered.tools.length} 个工具`,
              });
            } else {
              immediateResults.push({
                ok: true,
                kind: 'managed',
                serverKey: record.serverKey,
                serverName: record.serverName,
                message: registered.supported
                  ? 'Host 尚未注册该 stdio Server 的工具'
                  : '当前 Host 无法读取 stdio 工具注册状态',
              });
            }
          } else checkable.push(record);
        }
        let checkedResults = [];
        if (checkable.length > 0) {
          const validation = await validateConnectionRecords(checkable, {
            timeoutMs: Math.min(config.requestTimeoutMs, 5_000),
            concurrency: 4,
            grants: grantMap(),
          });
          checkedResults = validation.detail.results;
        }
        summaries.push(cacheHealth(id, records, [...immediateResults, ...checkedResults]));
      }
      const healthy = summaries.filter((item) => item.connectionState === 'healthy').length;
      const attention = summaries.filter((item) => ['reauth', 'recovering', 'degraded', 'unavailable'].includes(item.connectionState)).length;
      return {
        ok: true,
        message: targetIds.length === 0
          ? '暂无已配置连接'
          : `已检查 ${summaries.length} 个连接器：${healthy} 个正常${attention ? `，${attention} 个需处理` : ''}`,
        detail: { items: summaries, healthy, attention },
      };
    },

    async migrationPreview({ scanStored = false } = {}) {
      const { candidates, warnings } = await readLegacyGrantCandidates(ctx.storageDomain, { openClosed: scanStored });
      const plans = planLegacyMigration(candidates, state.merged, state.connections);
      const items = plans.map((plan) => plan.summary);
      const pendingCount = items.filter((item) => item.migratable && !item.alreadyMigrated).length;
      return {
        ok: true,
        message: pendingCount > 0 ? `检测到 ${pendingCount} 个可迁移的旧企查查授权` : '未发现待迁移的旧企查查授权',
        detail: { items, pendingCount, warnings, destructive: false },
      };
    },

    async migrateLegacy(candidateIds = []) {
      const { candidates, warnings } = await readLegacyGrantCandidates(ctx.storageDomain, { openClosed: true });
      const selected = candidateIds.length > 0 ? candidates.filter((candidate) => candidateIds.includes(candidate.id)) : candidates;
      const plans = planLegacyMigration(selected, state.merged, state.connections);
      const migrated = [];
      const skipped = [];
      for (const plan of plans) {
        if (!plan.summary.migratable) { skipped.push(`${plan.summary.sourcePlugin}(未匹配当前目录)`); continue; }
        if (plan.summary.alreadyMigrated) { skipped.push(`${plan.summary.connectorName}(已迁移)`); continue; }
        const grantKey = grantStore.keyFor(config.account, plan.candidate.grant.issuer, plan.candidate.grant.clientId, plan.candidate.grant.scope);
        const grant = toConnectorGrant(plan.candidate, { key: grantKey, account: config.account, connectorIds: [plan.connector.id] });
        state.grants.set(grantKey, grantRuntime(grant));
        if (config.persistSecrets) await grantStore.put(grant);

        let enabled = true;
        let provisionNow = true;
        let lastError;
        const legacyConflict = legacyConflictForConnector(plan.connector);
        if (legacyConflict) {
          warnLegacyConflict(legacyConflict);
          provisionNow = false;
          lastError = `${legacyConflict.message}；授权已复制，重启后将由 MCP连接器恢复`;
        }
        if (grant.accessTokenExpiresAt <= Date.now()) {
          try { await refreshGrantWithRecovery(grantKey, 'legacy-migration'); }
          catch (error) {
            const permanent = error.refreshFailure?.permanent === true;
            enabled = !permanent;
            provisionNow = false;
            lastError = permanent
              ? `旧授权已失效，请重新连接：${error.refreshFailure?.message ?? error.message}`
              : `旧授权刷新暂时失败，正在自动重试：${error.refreshFailure?.message ?? error.message}`;
          }
        } else {
          scheduleRefresh(grantKey);
        }
        const records = toConnectionRecords(plan, grantKey, { enabled, lastError });
        for (const record of records) {
          if (enabled && provisionNow) await upsertRecord(record);
          else await persistRecord(record);
        }
        migrated.push({ connectorId: plan.connector.id, keys: records.map((record) => record.key), enabled });
      }
      return {
        ok: true,
        message: migrated.length > 0
          ? `已复制 ${migrated.length} 组旧授权；原插件和原凭据均保留，请确认新连接可用后再停用旧插件`
          : '没有需要迁移的旧授权',
        detail: { migrated, skipped, warnings, sourceCredentialsPreserved: true },
      };
    },

    async setEnabled(key, enabled) {
      const record = state.connections.get(key);
      if (!record) return { ok: false, message: `连接 "${key}" 不存在` };
      const next = { ...record, enabled: !!enabled, updatedAt: Date.now() };
      if (next.enabled) {
        try {
          const [committed] = await commitConnectionRecords([next]);
          if (committed.connectorId) cacheHealth(committed.connectorId, [committed], readinessResults([committed]));
          return { ok: true, message: `已启用 "${committed.name}"` };
        } catch (error) {
          return connectionSetupFailure(error, '启用失败');
        }
      }
      await disable(ctx, config, next);
      try {
        await persistRecord(next);
      } catch (error) {
        await provision(ctx, config, record, grantMap(), { failOnStartupError: false }).catch((rollbackError) => {
          logger.error(`disable rollback "${record.key}" failed: ${rollbackError.message}`);
        });
        throw error;
      }
      return { ok: true, message: `已停用 "${next.name}"` };
    },

    async disconnect(key, signal) {
      const record = state.connections.get(key);
      if (!record) return { ok: false, message: `连接 "${key}" 不存在` };

      if (record.auth?.grantKey) {
        await remove(ctx, config, record);
        state.connections.delete(key);
        if (record.connectorId) state.health.delete(record.connectorId);
        if (config.persistSecrets) await connectionStore.delete(key).catch(() => {});
        const stillUsed = [...state.connections.values()].some((r) => r.auth?.grantKey === record.auth.grantKey);
        if (!stillUsed) {
          const g = state.grants.get(record.auth.grantKey);
          if (g?.grant.refreshToken) {
            try {
              const metadata = await discoverServerMetadata(g.grant.issuer, config.requestTimeoutMs);
              if (metadata.revocationEndpoint) {
                await revokeRefreshToken(metadata.revocationEndpoint, {
                  clientId: g.grant.clientId,
                  clientSecret: g.grant.clientSecret,
                  tokenEndpointAuthMethod: g.grant.tokenEndpointAuthMethod ?? 'none',
                  refreshToken: g.grant.refreshToken,
                  timeoutMs: config.requestTimeoutMs,
                });
              }
            } catch (error) {
              logger.warn(`revoke failed (continuing disconnect): ${error.message}`);
            }
          }
          if (g?.timer) clearTimeout(g.timer);
          state.grants.delete(record.auth.grantKey);
          if (config.persistSecrets) await grantStore.delete(record.auth.grantKey).catch(() => {});
        }
        return { ok: true, message: `已断开 "${record.name}"${stillUsed ? '（授权仍被其他连接共享）' : '（已撤销授权）'}` };
      }

      await remove(ctx, config, record);
      state.connections.delete(key);
      if (record.connectorId) state.health.delete(record.connectorId);
      if (config.persistSecrets) await connectionStore.delete(key).catch(() => {});
      return { ok: true, message: `已断开 "${record.name}"` };
    },

    async refreshCatalog() {
      if (!config.catalogUrl) {
        await recomputeMerged();
        const visibleCount = listCatalog(state.merged, { publishedOnly: true }).length;
        return { ok: true, message: `市场已刷新，共 ${visibleCount} 个连接器` };
      }
      try {
        const fetched = await fetchRemoteCatalogWithFallback(
          config.catalogUrl,
          catalogFallbackUrls(),
          {
            requestTimeoutMs: config.requestTimeoutMs,
            onSourceError: warnCatalogSourceFailure,
          },
        );
        state.remoteConnectors = fetched.connectors;
        await catalogStore.putRemote({ etag: fetched.etag, connectors: fetched.connectors }).catch(() => {});
        await recomputeMerged();
        const visibleCount = listCatalog(state.merged, { publishedOnly: true }).length;
        return { ok: true, message: `市场已刷新，共 ${visibleCount} 个连接器` };
      } catch (error) {
        return { ok: false, message: `刷新失败: ${error.message}` };
      }
    },

    async publish(connectorId, published) {
      const connector = state.merged.find((d) => d.id === connectorId);
      if (!connector) return { ok: false, message: `连接器 "${connectorId}" 不存在` };
      state.overrides.set(connectorId, { id: connectorId, published: !!published });
      await catalogStore.putOverrides([...state.overrides.values()]).catch(() => {});
      await recomputeMerged();
      return { ok: true, message: `已将 "${connector.name}" ${published ? '上架' : '下架'}` };
    },

    /**
     * 从已连接的 MCP server 动态获取工具清单
     * 通过 MCP JSON-RPC 协议调用 tools/list 方法
     */
    async toolsList(connectorId) {
      const connector = state.merged.find((d) => d.id === connectorId);
      if (!connector) return { ok: false, message: `连接器 "${connectorId}" 不存在` };

      const records = [...state.connections.values()].filter((r) => r.connectorId === connectorId && r.enabled !== false);
      if (!records.length) {
        const servers = (connector.toolsSnapshot ?? []).map((snapshot) => ({
          serverKey: snapshot.serverKey,
          serverName: snapshot.serverName ?? connector.servers.find((server) => server.serverKey === snapshot.serverKey)?.serverName,
          ok: true,
          preview: true,
          tools: snapshot.tools,
        }));
        if (servers.length === 0) return { ok: false, message: `连接器 "${connector.name}" 尚未连接，且目录暂无工具快照` };
        const totalTools = servers.reduce((sum, server) => sum + server.tools.length, 0);
        return {
          ok: true,
          message: `目录预览：${servers.length} 个 server，${totalTools} 个工具`,
          detail: { connectorId, servers, totalTools, source: 'snapshot' },
        };
      }

      const servers = [];
      for (const record of records) {
        if (record.transport === 'stdio') {
          const registered = registeredStdioTools(record);
          const snapshot = (connector.toolsSnapshot ?? []).find((item) =>
            item.serverKey === record.serverKey || item.serverName === record.serverName);
          const liveTools = registered.tools;
          servers.push({
            serverKey: record.serverKey || record.name,
            serverName: record.serverName,
            ok: liveTools.length > 0,
            managed: true,
            live: liveTools.length > 0,
            preview: liveTools.length === 0 && Boolean(snapshot),
            tools: liveTools.length > 0
              ? liveTools
              : (snapshot?.tools ?? []).map((tool) => ({
                  name: tool.name,
                  title: tool.title || tool.name,
                  description: tool.description || '',
                })),
            ...(liveTools.length === 0 ? {
              errorKind: registered.supported ? 'startup' : 'host-version',
              error: registered.supported
                ? 'Host 尚未注册该 stdio Server 的工具，请检查启动日志后重试'
                : '当前 DSH Host 不支持读取工具注册状态，请升级 Host 后重试',
            } : {}),
          });
          continue;
        }
        try {
          const listed = await listMcpTools(record, {
            timeoutMs: config.requestTimeoutMs,
            grants: grantMap(),
          });
          servers.push({
            serverKey: record.serverKey || record.name,
            serverName: record.serverName,
            ok: true,
            tools: listed.tools.map((t) => ({
              name: t.name,
              title: t.title || t.name,
              description: t.description || '',
            })),
          });
        } catch (error) {
          if (error instanceof McpHttpError) {
            servers.push({
              serverKey: record.serverKey || record.name,
              serverName: record.serverName,
              ok: false,
              error: error.message,
              errorKind: error.kind,
              tools: [],
            });
            continue;
          }
          const classified = classifyConnectionError(error);
          servers.push({ serverKey: record.serverKey || record.name, serverName: record.serverName, ok: false, error: classified.message, errorKind: classified.kind, tools: [] });
        }
      }

      const totalTools = servers.reduce((sum, s) => sum + (s.tools?.length || 0), 0);
      const availableServers = servers.filter((server) => server.ok).length;
      const failedServers = servers.length - availableServers;
      const pendingManagedServers = servers.filter((server) => server.managed && !server.ok).length;
      const health = cacheHealth(connectorId, records, servers.map((server) => server.ok
        ? { ok: true, kind: 'connected', serverKey: server.serverKey, serverName: server.serverName }
        : { ok: false, kind: server.errorKind ?? 'network', serverKey: server.serverKey, serverName: server.serverName, message: server.error }));
      const failureSummary = servers.filter((server) => !server.ok).slice(0, 3)
        .map((server) => `${server.serverName || server.serverKey}：${server.error}`).join('；');
      return {
        ok: availableServers > 0,
        message: failedServers > 0
          ? `工具加载失败：${failureSummary}${failedServers > 3 ? `；另有 ${failedServers - 3} 个 Server 不可用` : ''}${availableServers > 0 ? `；${availableServers} 个 Server 仍可用` : ''}`
          : `共 ${servers.length} 个 server，${totalTools} 个工具`,
        detail: {
          connectorId,
          servers,
          totalTools,
          availableServers,
          failedServers,
          pendingManagedServers,
          connectionState: health.connectionState,
        },
      };
    },
  };

  /* ───────────────────────── 启动恢复 ───────────────────────── */

  await loadCatalog();
  detectLegacyPluginConflicts();

  for (const [key, raw] of await connectionStore.entries().catch(() => [])) {
    try {
      const record = normalizeConnectionRecord(raw);
      state.connections.set(key, record);
    } catch (error) {
      logger.warn(`skip invalid stored connection "${key}": ${error.message}`);
    }
  }
  for (const [key, raw] of await grantStore.entries().catch(() => [])) {
    try {
      state.grants.set(key, grantRuntime(raw));
    } catch (error) {
      logger.warn(`skip invalid stored grant "${key}": ${error.message}`);
    }
  }

  const prunedGrantCount = await pruneOrphanGrants();
  if (prunedGrantCount > 0) logger.info(`removed ${prunedGrantCount} unreferenced OAuth grant(s) from local storage`);

  for (const [grantKey, g] of state.grants) {
    if (g.grant.accessTokenExpiresAt <= Date.now()) {
      try {
        await refreshGrantWithRecovery(grantKey, 'startup');
      } catch {}
    } else {
      scheduleRefresh(grantKey);
    }
  }
  for (const [key, record] of state.connections) {
    if (record.enabled !== false) {
      const failure = grantFailure(record);
      if (failure) {
        logger.warn(`skip provision "${key}" at startup: ${failure.message}`);
        continue;
      }
      await provision(ctx, config, record, grantMap()).catch((error) => {
        logger.warn(`provision "${key}" failed: ${error.message}`);
      });
    }
  }

  const disposeTools = registerTools(ctx, api);

  /* ───────────────────────── web 半区（图形化市场）──────────────────────── */
  // webServer / webRuntime 仅存在于 web 部署；无此服务时静默跳过（纯对话工具场景仍可用）。
  let disposeWeb = null;
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer', 'webRuntime'], (wctx) => {
        disposeWeb = mountWebRoutes(wctx, api, { logger });
        logger.info('mcp-connector web UI mounted at /mcp-connector/ui/');
      });
    } catch (error) {
      logger.warn(`mcp-connector web UI not mounted (webServer unavailable): ${error.message}`);
    }
  }

  ctx.effect(() => () => {
    disposeTools();
    disposeWeb?.();
    for (const g of state.grants.values()) if (g.timer) clearTimeout(g.timer);
  });

  logger.info(`mcp-connector active（目录 ${state.merged.length} 个连接器，已连接 ${state.connections.size} 条）`);
}

export { entryIdFor };
