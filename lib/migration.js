/**
 * 两个旧企查查 OAuth 插件的只读发现与迁移转换。
 * 迁移只复制授权到新 storage domain；绝不删除旧凭据或卸载旧插件。
 */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

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

const LEGACY_SOURCES = [
  { domainName: 'qcc_mcp_oauth', sourcePlugin: 'qcc-dsh-mcp-oauth', connectorHint: 'qcc-company' },
  { domainName: 'qcc_legal_mcp_oauth', sourcePlugin: 'qcc-dsh-mcp-legal-oauth', connectorHint: 'qcc-legal' },
];

function legacyDomain(name) {
  return defineDomain({ name, version: 1, tables: { grants: domainTable(legacyGrantSchema) } });
}

export async function readLegacyGrantCandidates(storageDomain, { openClosed = false } = {}) {
  const candidates = [];
  const warnings = [];
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
          warnings.push(`${source.sourcePlugin}:${storageKey} 记录格式不兼容`);
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
      warnings.push(`${source.sourcePlugin} 读取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (ownsDomain) await domain?.close?.().catch(() => {});
    }
  }
  return { candidates, warnings };
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

export function toConnectorGrant(candidate, { key, account, connectorIds }) {
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
    updatedAt: Date.now(),
  };
}

export function toConnectionRecords(plan, grantKey, { enabled = true, lastError } = {}) {
  const now = Date.now();
  return plan.matchedServers.map((server) => ({
    key: `${plan.connector.id}-${server.serverKey}`,
    connectorId: plan.connector.id,
    kind: 'oauth',
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
