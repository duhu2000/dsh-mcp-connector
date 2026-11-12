import { enterpriseFixture } from './smart-mode-enterprise.mjs';
import { indexRawToolSources, RAW_TOOL_ORIGIN, normalizeSourceRelation } from '../../lib/source-relations.js';

export function rawDefinition(name, extra = {}) {
  return { name, description: 'Synthetic raw capability', inputSchema: { type: 'object', properties: {
    query: { type: 'string', default: 'fixture', examples: ['synthetic'], const: 'fixture' },
  } }, outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
  annotations: { readOnlyHint: true }, execution: { taskSupport: 'forbidden' }, ...extra };
}

export function sourceFixture({ full = false } = {}) {
  const { scope, records } = enterpriseFixture();
  const rows = [];
  const count = full ? 186 : 3, duplicated = full ? 170 : 1;
  const add = (i, server) => {
    const binding = scope.connections[server];
    rows.push({ origin: RAW_TOOL_ORIGIN, accountRef: scope.accountRef, groupId: scope.groupId,
      connectionKey: binding.connectionKey, serverName: binding.serverName,
      definition: rawDefinition(`fixture_capability_${i}`) });
  };
  for (let i = 0; i < count; i++) { add(i, i % 6); if (i < duplicated) add(i, (i + 1) % 6); }
  const index = indexRawToolSources(scope, rows);
  const paired = new Map();
  for (const source of index.values()) {
    if (!paired.has(source.rawName)) paired.set(source.rawName, []);
    paired.get(source.rawName).push(source);
  }
  const relations = [...paired].filter(([, members]) => members.length > 1).map(([name, members]) => relationFor(scope, name, members));
  const snapshot = (id, mode = 'smart') => ({ version: 1, sessionId: id, mode, policyVersion: 'fixture-v1', selection: 'user-confirmed',
    ...(mode === 'smart' ? { accountRef: scope.accountRef, groupId: scope.groupId } : {}) });
  return { scope, records, rows, index, relations, snapshot };
}

export function relationFor(scope, id, sources, extra = {}) {
  return normalizeSourceRelation({ version: 1, id, revision: 1,
    accountRef: scope.accountRef, groupId: scope.groupId, status: 'approved', enabled: true,
    validFrom: 10, expiresAt: 10000,
    members: sources.map((source, i) => ({ sourceId: source.sourceId, fingerprints: [source.definitionFingerprint], priority: i, verifiedSuperset: i === 0 })),
    review: { semantics: 'equivalent', billing: 'compatible', rateLimits: 'compatible', freshness: 'equivalent',
      evidenceHash: 'e'.repeat(64), reviewedAt: 10 }, ...extra,
  });
}

export function relationInput(relation) { const { version, revision, ...input } = relation; return input; }
