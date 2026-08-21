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
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_REFRESH_SKEW_MS,
  DEFAULT_CATALOG_TTL_MS,
} from './constants.js';
import { defineConnectorDomain, ConnectionStore, GrantStore, CatalogStore } from './stores.js';
import { normalizeConnectorDescriptor, normalizeConnectionRecord } from './schema.js';
import { loadBundledCatalog, fetchRemoteCatalog, mergeCatalog, listCatalog, auditDescriptor, auditRawDescriptor, readLimitedJson } from './catalog.js';
import { oauthAuthorize } from './connectors/oauth-connector.js';
import { buildManualRecord } from './connectors/manual-connector.js';
import { normalizeJsonImport } from './connectors/json-connector.js';
import { discoverServerMetadata, refreshAccessToken, revokeRefreshToken } from './oauth.js';
import { provision, disable, remove, entryIdFor, authHeaders } from './mcp-provision.js';
import { classifyConnectionError, validateConnectionRecords } from './mcp-validation.js';
import { registerTools } from './tools.js';
import { mountWebRoutes } from './web.js';
import { assertSafeUrl } from './util.js';
import { readLegacyGrantCandidates, planLegacyMigration, toConnectorGrant, toConnectionRecords } from './migration.js';

export const name = 'mcp-connector';

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
  /** 提前刷新阈值（ms） */
  refreshSkewMs: z.number().default(DEFAULT_REFRESH_SKEW_MS),
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
    grants: new Map(),          // grantKey -> { grant, timer, refreshPromise, needsReauth }
  };

  /* ───────────────────────── 目录加载 ───────────────────────── */

  async function recomputeMerged() {
    const bundled = loadBundledCatalog();
    const configConnectors = (config.connectors ?? []).map((raw) => auditDescriptor(normalizeConnectorDescriptor(raw)));
    const sources = [bundled, state.remoteConnectors, configConnectors, [...state.dynamic.values()]];
    state.merged = mergeCatalog(sources, state.overrides);
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
        const fetched = await fetchRemoteCatalog(config.catalogUrl, {
          requestTimeoutMs: config.requestTimeoutMs,
          etag: cached?.etag,
        });
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

  /* ───────────────────────── grant 刷新 ───────────────────────── */

  function grantMap() {
    const map = new Map();
    for (const [key, g] of state.grants) map.set(key, g.grant);
    return map;
  }

  async function refreshGrant(grantKey) {
    const entry = state.grants.get(grantKey);
    if (!entry || !entry.grant.refreshToken) throw new Error('no refresh token available');
    if (entry.refreshPromise) return entry.refreshPromise;
    entry.refreshPromise = (async () => {
      const metadata = await discoverServerMetadata(entry.grant.issuer, config.requestTimeoutMs);
      const token = await refreshAccessToken(metadata.tokenEndpoint, {
        clientId: entry.grant.clientId,
        refreshToken: entry.grant.refreshToken,
        resource: entry.grant.authorizedResources[0],
        scope: entry.grant.scope,
        timeoutMs: config.requestTimeoutMs,
      });
      const next = {
        ...entry.grant,
        accessToken: token.accessToken,
        accessTokenExpiresAt: Date.now() + token.expiresIn * 1000 - config.refreshSkewMs,
        refreshToken: token.refreshToken ?? entry.grant.refreshToken,
      };
      entry.grant = next;
      entry.needsReauth = false;
      state.grants.set(grantKey, entry);
      if (config.persistSecrets) await grantStore.put(next);
      for (const [key, record] of state.connections) {
        if (record.auth?.grantKey === grantKey) await provision(ctx, config, record, grantMap());
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

  function scheduleRefresh(grantKey) {
    const entry = state.grants.get(grantKey);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    const delay = Math.max(0, entry.grant.accessTokenExpiresAt - Date.now());
    entry.timer = setTimeout(() => {
      refreshGrant(grantKey).catch((error) => {
        entry.needsReauth = true;
        logger.warn(`grant ${grantKey} refresh failed: ${error.message}`);
      });
    }, delay);
    entry.timer.unref?.();
  }

  /* ───────────────────────── 连接记录落库 / 挂载 ───────────────────────── */

  async function persistRecord(record) {
    state.connections.set(record.key, record);
    if (config.persistSecrets) await connectionStore.put(record);
  }

  async function upsertRecord(record) {
    const existing = state.connections.get(record.key);
    const merged = existing ? { ...existing, ...record, updatedAt: Date.now() } : record;
    await persistRecord(merged);
    await provision(ctx, config, merged, grantMap());
    return merged;
  }

  /* ───────────────────────── api 门面 ───────────────────────── */

  const api = {
    async catalog({ category, keyword } = {}) {
      const items = listCatalog(state.merged, { category, keyword, publishedOnly: true }).map((d) => ({
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
        prompts: d.prompts ?? [],
        probeStatus: d.probeStatus,
        probeCheckedAt: d.probeCheckedAt,
        probeReportUrl: d.probeReportUrl,
        toolsSnapshot: d.toolsSnapshot ?? [],
        connected: [...state.connections.values()].filter((r) => r.connectorId === d.id).map((r) => r.key),
        servers: (d.servers ?? []).map((s) => ({
          serverKey: s.serverKey,
          url: s.url,
          transport: s.transport,
          serverName: s.serverName,
        })),
      }));
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
        try {
          const authz = await oauthAuthorize({ connector, config, logger, signal });
          const grantKey = grantStore.keyFor(config.account, authz.issuer, authz.clientId, authz.scope);
          const entryResource = authz.entryResource;
          const grant = {
            key: grantKey,
            issuer: authz.issuer,
            clientId: authz.clientId,
            clientName: authz.clientName,
            scope: authz.scope,
            account: config.account,
            accessToken: authz.token.accessToken,
            accessTokenExpiresAt: Date.now() + authz.token.expiresIn * 1000 - config.refreshSkewMs,
            refreshToken: authz.token.refreshToken ?? '',
            authorizedResources: connector.servers
              .filter((s) => authz.grantedKeys.includes(s.serverKey))
              .map((s) => s.url).length
              ? connector.servers.filter((s) => authz.grantedKeys.includes(s.serverKey)).map((s) => s.url)
              : [entryResource],
            connectorIds: [connector.id],
            updatedAt: Date.now(),
          };
          state.grants.set(grantKey, { grant, timer: undefined, refreshPromise: null, needsReauth: false });
          if (config.persistSecrets) await grantStore.put(grant);

          const created = [];
          for (const sk of authz.grantedKeys) {
            const server = connector.servers.find((s) => s.serverKey === sk);
            if (!server) continue;
            const record = {
              key: `${connector.id}-${sk}`,
              connectorId: connector.id,
              kind: 'oauth',
              name: connector.servers.length > 1 ? `${connector.name}·${sk}` : connector.name,
              serverKey: sk,
              transport: server.transport,
              url: server.url,
              serverName: server.serverName,
              headers: server.headers,
              auth: { mode: 'oauth', grantKey },
              enabled: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            await upsertRecord(record);
            created.push(record.key);
          }
          scheduleRefresh(grantKey);
          return { ok: true, message: `已连接 "${connector.name}"（${created.length} 个 MCP server），共 ${created.length} 条`, detail: { keys: created, grantKey } };
        } catch (error) {
          logger.error(`oauth connect failed: ${error.message}`);
          return { ok: false, message: `连接失败: ${error.message}` };
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
          serverName: server.serverName,
          headers: server.headers,
          auth: undefined,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await upsertRecord(record);
        return { ok: true, message: `已连接 "${connector.name}"`, detail: { key: record.key } };
      }

      // bearer / api-key 型：目录不含密钥，引导自定义配置
      return {
        ok: false,
        message:
          `连接器 "${connector.name}" 需要凭据（${connector.auth.mode}），目录不含密钥。` +
          `请用 mcp_connector_configure 提供：url=${connector.servers[0].url}, serverName=${connector.servers[0].serverName}`,
        detail: { url: connector.servers[0].url, serverName: connector.servers[0].serverName },
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
          for (const server of connector.servers) {
            const record = buildManualRecord({
              name: connector.servers.length > 1 ? `${connector.name}·${server.serverKey}` : connector.name,
              url: server.url,
              serverName: server.serverName,
              transport: server.transport,
              headersJson: server.headers,
              authMode: connector.auth.mode,
              bearerToken: params.bearerToken,
              apiKeyHeader: params.apiKeyHeader || connector.auth.apiKeyHeader,
              apiKeyValue: params.apiKeyValue,
            });
            record.key = `${connector.id}-${server.serverKey}`;
            record.connectorId = connector.id;
            record.serverKey = server.serverKey;
            records.push(record);
          }
          const validation = await validateConnectionRecords(records, { timeoutMs: config.requestTimeoutMs });
          if (!validation.ok) return { ...validation, detail: { connectorId: connector.id, ...validation.detail } };

          const created = [];
          for (const record of records) {
            await upsertRecord(record);
            created.push(record.key);
          }
          return {
            ok: true,
            message: `已配置并连接 "${connector.name}"（${created.length} 个 MCP Server）`,
            detail: { connectorId: connector.id, keys: created },
          };
        }
        const record = buildManualRecord(params);
        await upsertRecord(record);
        return { ok: true, message: `已配置并连接 "${record.name}"（serverName=${record.serverName}）`, detail: { key: record.key, serverName: record.serverName } };
      } catch (error) {
        return { ok: false, message: `配置失败: ${error.message}` };
      }
    },

    async importJson(json) {
      try {
        const { records, skipped } = normalizeJsonImport(json);
        const keys = [];
        for (const record of records) {
          await upsertRecord(record);
          keys.push(record.key);
        }
        const extra = skipped.length ? `；跳过：${skipped.join('、')}` : '';
        return {
          ok: true,
          message: `已导入并连接 ${keys.length} 个 MCP${extra}；JSON 导入属于本机连接，不会自动上架市场`,
          detail: { keys, skipped },
        };
      } catch (error) {
        return { ok: false, message: `导入失败: ${error.message}` };
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
        let grantInfo = null;
        if (record.auth?.grantKey) {
          const g = state.grants.get(record.auth.grantKey);
          grantInfo = g
            ? {
                grantKey: record.auth.grantKey,
                accessTokenExpiresAt: g.grant.accessTokenExpiresAt,
                needsReauth: !!g.needsReauth,
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
          enabled: record.enabled !== false,
          authMode: record.auth?.mode ?? 'none',
          grant: grantInfo,
          lastError: record.lastError ?? null,
        });
      }
      return { ok: true, message: `共 ${items.length} 条连接`, detail: { items } };
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
        state.grants.set(grantKey, { grant, timer: undefined, refreshPromise: null, needsReauth: false });
        if (config.persistSecrets) await grantStore.put(grant);

        let enabled = true;
        let lastError;
        if (grant.accessTokenExpiresAt <= Date.now()) {
          try { await refreshGrant(grantKey); }
          catch (error) {
            enabled = false;
            lastError = `旧授权已过期且刷新失败，请重新连接：${error instanceof Error ? error.message : String(error)}`;
            state.grants.get(grantKey).needsReauth = true;
          }
        } else {
          scheduleRefresh(grantKey);
        }
        const records = toConnectionRecords(plan, grantKey, { enabled, lastError });
        for (const record of records) {
          if (enabled) await upsertRecord(record);
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
      record.enabled = !!enabled;
      await persistRecord(record);
      if (record.enabled) await provision(ctx, config, record, grantMap());
      else await disable(ctx, config, record);
      return { ok: true, message: `已${record.enabled ? '启用' : '停用'} "${record.name}"` };
    },

    async disconnect(key, signal) {
      const record = state.connections.get(key);
      if (!record) return { ok: false, message: `连接 "${key}" 不存在` };

      if (record.auth?.grantKey) {
        await remove(ctx, config, record);
        state.connections.delete(key);
        if (config.persistSecrets) await connectionStore.delete(key).catch(() => {});
        const stillUsed = [...state.connections.values()].some((r) => r.auth?.grantKey === record.auth.grantKey);
        if (!stillUsed) {
          const g = state.grants.get(record.auth.grantKey);
          if (g?.grant.refreshToken) {
            try {
              const metadata = await discoverServerMetadata(g.grant.issuer, config.requestTimeoutMs);
              await revokeRefreshToken(metadata.revocationEndpoint, {
                clientId: g.grant.clientId,
                refreshToken: g.grant.refreshToken,
                timeoutMs: config.requestTimeoutMs,
              });
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
        const fetched = await fetchRemoteCatalog(config.catalogUrl, { requestTimeoutMs: config.requestTimeoutMs });
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
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...authHeaders(record, grantMap()),
        };

        try {
          const response = await fetch(record.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
              params: {},
            }),
            signal: AbortSignal.timeout(config.requestTimeoutMs),
          });

          if (!response.ok) {
            const error = response.status === 401 || response.status === 403
              ? `凭据无效、已过期或权限不足（HTTP ${response.status}）`
              : `HTTP ${response.status}`;
            servers.push({ serverKey: record.serverKey || record.name, serverName: record.serverName, ok: false, error, tools: [] });
            continue;
          }

          const contentType = response.headers.get('content-type') || '';
          let result;
          if (contentType.includes('text/event-stream')) {
            // Parse SSE response
            const text = await response.text();
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  result = JSON.parse(line.slice(6));
                  break;
                } catch {}
              }
            }
          } else {
            result = await response.json();
          }

          const tools = result?.result?.tools ?? [];
          servers.push({
            serverKey: record.serverKey || record.name,
            serverName: record.serverName,
            ok: true,
            tools: tools.map((t) => ({
              name: t.name,
              title: t.title || t.name,
              description: t.description || '',
            })),
          });
        } catch (error) {
          const classified = classifyConnectionError(error);
          servers.push({ serverKey: record.serverKey || record.name, serverName: record.serverName, ok: false, error: classified.message, errorKind: classified.kind, tools: [] });
        }
      }

      const totalTools = servers.reduce((sum, s) => sum + (s.tools?.length || 0), 0);
      const availableServers = servers.filter((server) => server.ok).length;
      const failedServers = servers.length - availableServers;
      const failureSummary = servers.filter((server) => !server.ok).slice(0, 3)
        .map((server) => `${server.serverName || server.serverKey}：${server.error}`).join('；');
      return {
        ok: availableServers > 0,
        message: failedServers > 0
          ? `工具加载失败：${failureSummary}${failedServers > 3 ? `；另有 ${failedServers - 3} 个 Server 不可用` : ''}${availableServers > 0 ? `；${availableServers} 个 Server 仍可用` : ''}`
          : `共 ${servers.length} 个 server，${totalTools} 个工具`,
        detail: { connectorId, servers, totalTools, availableServers, failedServers },
      };
    },
  };

  /* ───────────────────────── 启动恢复 ───────────────────────── */

  await loadCatalog();

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
      state.grants.set(key, { grant: raw, timer: undefined, refreshPromise: null, needsReauth: false });
    } catch (error) {
      logger.warn(`skip invalid stored grant "${key}": ${error.message}`);
    }
  }

  for (const [grantKey, g] of state.grants) {
    if (g.grant.accessTokenExpiresAt <= Date.now()) {
      try {
        await refreshGrant(grantKey);
      } catch {
        g.needsReauth = true;
      }
    } else {
      scheduleRefresh(grantKey);
    }
  }
  for (const [key, record] of state.connections) {
    if (record.enabled !== false) {
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
