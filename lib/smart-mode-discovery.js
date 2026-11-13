import { createHash } from 'node:crypto';
import { normalizeSmartEnterpriseScope } from './smart-mode-restrictions.js';
import { canonicalSourceJson, indexRawToolSources, RAW_TOOL_ORIGIN, sourceError } from './source-relations.js';

const copy = (value) => JSON.parse(canonicalSourceJson(value));
const sync = (value) => {
  if (value?.then) { Promise.resolve(value).catch(() => {}); throw sourceError('ASYNC_DISCOVERY_BINDING'); }
  return value;
};

/** Trusted metadata producer; never calls a tool, grants a review, or registers
 * a Host definition. The caller supplies raw tools/list, before cache cleaning.
 * All six results are published atomically. Credentials are memory-only.
 */
export function createSmartModeDiscoveryPublisher({ enabled = false, scope: inputScope,
  getRecords, listTools, isRecordUsable, integration,
} = {}) {
  if (!enabled) return { refresh: async () => ({ enabled: false }), dispose() {} };
  const scope = normalizeSmartEnterpriseScope(inputScope);
  if ([getRecords, listTools, isRecordUsable, integration?.publishViews,
    integration?.invalidateViews, integration?.status].some((fn) => typeof fn !== 'function')) {
    throw sourceError('MISSING_DISCOVERY_CALLBACK');
  }
  let pending, closed = false;

  function records() {
    const all = sync(getRecords());
    if (!Array.isArray(all)) throw sourceError('INVALID_DISCOVERY_RECORDS');
    return scope.connections.map((binding) => {
      const matches = all.filter((row) => row.key === binding.connectionKey);
      const row = matches[0];
      if (matches.length !== 1 || row.connectorId !== binding.connectorId || row.serverName !== binding.serverName
          || row.serverKey !== binding.serverId.slice(4) || row.auth?.mode !== 'oauth'
          || row.auth.grantKey !== scope.accountRef || row.enabled === false || sync(isRecordUsable(row)) !== true
          || all.some((other) => other.key !== row.key && other.serverName === row.serverName)) {
        throw sourceError('DISCOVERY_BINDING_CHANGED');
      }
      // Snapshot all fields (including endpoint and credential binding) without
      // storing them in an artifact. Detect in-place mutations as well as swaps.
      return JSON.parse(JSON.stringify(row));
    });
  }
  const digest = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

  async function run() {
    // Invalidate before I/O: a failed refresh never leaves prepared stale tools
    // dispatchable. CAS also keeps a delayed producer from reviving a new view.
    const start = integration.status().viewRevision;
    const { revision } = integration.invalidateViews({ expectedRevision: start });
    try {
      const selected = records(), bindingDigest = digest(selected), rows = [], counts = [];
      for (const record of selected) {
        if (closed) throw sourceError('DISCOVERY_CLOSED');
        const listed = await listTools(record);
        if (!listed || !Array.isArray(listed.tools)) throw sourceError('INVALID_RAW_DISCOVERY');
        const definitions = copy(listed.tools);
        rows.push(...definitions.map((definition) => ({ origin: RAW_TOOL_ORIGIN,
          accountRef: scope.accountRef, groupId: scope.groupId,
          connectionKey: record.key, serverName: record.serverName, definition })));
        counts.push({ serverName: record.serverName, count: definitions.length });
        if (closed || digest(records()) !== bindingDigest) throw sourceError('DISCOVERY_BINDING_CHANGED');
      }
      const index = indexRawToolSources(scope, rows);
      if (closed) throw sourceError('DISCOVERY_CLOSED');
      const result = sync(integration.publishViews({ rawSources: rows }, { expectedRevision: revision }));
      return { enabled: true, ...result, servers: counts, definitionCount: index.size };
    } catch {
      // Remote errors may contain URLs/credentials/body text. Only expose a
      // stable code; the trusted transport can keep its own redacted diagnosis.
      throw sourceError(closed ? 'DISCOVERY_CLOSED' : 'RAW_DISCOVERY_FAILED');
    }
  }
  return {
    refresh() {
      if (closed) return Promise.reject(sourceError('DISCOVERY_CLOSED'));
      if (!pending) {
        pending = run();
        pending.then(() => { pending = undefined; }, () => { pending = undefined; });
      }
      return pending;
    },
    dispose() { closed = true; },
  };
}
