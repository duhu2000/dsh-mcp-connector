/**
 * 两个旧企查查 OAuth 插件的只读发现与迁移转换。
 * 迁移只复制授权到新 storage domain；绝不删除旧凭据或卸载旧插件。
 */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js';
import { LEGACY_PLUGINS } from './legacy-plugin-conflict.js';

/** 缺省译文：中文（既有调用点与测试无需改动）。 */
const tZh = createTranslator(DEFAULT_LOCALE);

const legacyGrantSchema = z.object({
  issuer: z.string(),
  clientId: z.string(),
  scope: z.string(),
  accessToken: z.string(),
  accessTokenExpiresAt: z.number(),
  refreshToken: z.string(),
  authorizedResources: z.array(z.string()),
  entryResource: z.string(),
  clientName: z.string(),
  updatedAt: z.number(),
});

const LEGACY_SOURCES = LEGACY_PLUGINS.map(({ domainName, packageName: sourcePlugin, connectorHint }) => ({
  domainName, sourcePlugin, connectorHint,
}));

function legacyDomain(name) {
  return defineDomain({ name, version: 1, tables: { grants: domainTable(legacyGrantSchema) } });
}

export async function readLegacyGrantCandidates(storageDomain, { openClosed = false, t = tZh } = {}) {
  const candidates = [];
  const warnings = [];
  const unreadable = new Set();
  for (const source of LEGACY_SOURCES) {
    let domain;
    let ownsDomain = false;
    try {
      domain = storageDomain.get?.(source.domainName);
      if (!domain) {
        if (!openClosed) continue;
        domain = await storageDomain.open(legacyDomain(source.domainName));
        ownsDomain = true;
      }
      const table = domain.tables.get('grants');
      for (const [storageKey, raw] of table?.entries?.() ?? []) {
        const parsed = legacyGrantSchema.safeParse(raw);
        if (!parsed.success) {
          unreadable.add(`${source.domainName}:${storageKey}`);
          warnings.push(t('{plugin}:{key} 记录格式不兼容', { plugin: source.sourcePlugin, key: storageKey }));
          continue;
        }
        candidates.push({
          id: `${source.domainName}:${storageKey}`,
          ...source,
          storageKey,
          grant: parsed.data,
        });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') unreadable.add(source.domainName);
      warnings.push(t('{plugin} 读取失败：{error}', {
        plugin: source.sourcePlugin,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (ownsDomain) await domain?.close?.().catch(() => {});
    }
  }
  return { candidates, warnings, unreadable };
}

export function planLegacyMigration(candidates, catalog, connections = new Map()) {
  return candidates.map((candidate) => {
    const connector = catalog.find((item) => item.id === candidate.connectorHint);
    const resources = new Set(candidate.grant.authorizedResources ?? []);
    if (candidate.grant.entryResource) resources.add(candidate.grant.entryResource);
    const matchedServers = (connector?.servers ?? []).filter((server) => resources.has(server.url));
    const connectionKeys = matchedServers.map((server) => `${connector.id}-${server.serverKey}`);
    return {
      candidate,
      connector,
      matchedServers,
      connectionKeys,
      summary: {
        id: candidate.id,
        sourcePlugin: candidate.sourcePlugin,
        connectorId: connector?.id ?? candidate.connectorHint,
        connectorName: connector?.name ?? candidate.connectorHint,
        clientName: candidate.grant.clientName,
        issuer: candidate.grant.issuer,
        accessTokenExpiresAt: candidate.grant.accessTokenExpiresAt,
        expired: candidate.grant.accessTokenExpiresAt <= Date.now(),
        resourceCount: candidate.grant.authorizedResources.length,
        matchedServerCount: matchedServers.length,
        matchedServerNames: matchedServers.map((server) => server.serverName),
        alreadyMigrated: connectionKeys.length > 0 && connectionKeys.every((key) => connections.has(key)),
        migratable: !!connector && matchedServers.length > 0,
      },
    };
  });
}

export function toConnectorGrant(candidate, { key, account, connectorIds, pending = false }) {
  return {
    key,
    issuer: candidate.grant.issuer,
    clientId: candidate.grant.clientId,
    clientName: candidate.grant.clientName,
    scope: candidate.grant.scope,
    account,
    accessToken: candidate.grant.accessToken,
    accessTokenExpiresAt: candidate.grant.accessTokenExpiresAt,
    refreshToken: candidate.grant.refreshToken,
    authorizedResources: candidate.grant.authorizedResources,
    connectorIds,
    legacySource: { candidateId: candidate.id, updatedAt: candidate.grant.updatedAt, pending },
    updatedAt: Date.now(),
  };
}

export function toConnectionRecords(plan, grantKey, { enabled = true, lastError } = {}) {
  const now = Date.now();
  return plan.matchedServers.map((server) => ({
    key: `${plan.connector.id}-${server.serverKey}`,
    connectorId: plan.connector.id,
    kind: 'oauth',
    serverKey: server.serverKey,
    name: plan.connector.servers.length > 1 ? `${plan.connector.name}·${server.serverKey}` : plan.connector.name,
    transport: server.transport,
    url: server.url,
    serverName: server.serverName,
    headers: server.headers,
    auth: { mode: 'oauth', grantKey },
    enabled,
    lastError,
    createdAt: now,
    updatedAt: now,
  }));
}
