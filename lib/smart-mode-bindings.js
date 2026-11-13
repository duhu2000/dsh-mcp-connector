const error = (code) => Object.assign(new Error(`Smart bindings: ${code}`), { code });
export const QCC_ENTERPRISE_SERVERS = Object.freeze(['qcc-company', 'qcc-risk', 'qcc-ipr', 'qcc-operation', 'qcc-history', 'qcc-executive']);

export function normalizeSmartEnterpriseScope(scope) {
  if (typeof scope?.accountRef !== 'string' || !scope.accountRef || typeof scope.groupId !== 'string' || !scope.groupId || !Array.isArray(scope.connections)
      || scope.connections.length !== 6) throw error('INVALID_ENTERPRISE_SCOPE');
  const connections = scope.connections.map((binding) => {
    if (!QCC_ENTERPRISE_SERVERS.includes(binding.serverId) || typeof binding.connectionKey !== 'string' || !binding.connectionKey
        || typeof binding.connectorId !== 'string' || !binding.connectorId || typeof binding.serverName !== 'string'
        || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(binding.serverName)) throw error('INVALID_ENTERPRISE_SCOPE');
    return Object.freeze({ serverId: binding.serverId, connectionKey: binding.connectionKey,
      connectorId: binding.connectorId, serverName: binding.serverName });
  });
  for (const field of ['serverId', 'connectionKey', 'serverName']) {
    if (new Set(connections.map((binding) => binding[field])).size !== 6) throw error('INVALID_ENTERPRISE_SCOPE');
  }
  return Object.freeze({ accountRef: scope.accountRef, groupId: scope.groupId, connections: Object.freeze(connections) });
}

const sync = (value) => {
  if (value?.then) { Promise.resolve(value).catch(() => {}); throw error('ASYNC_BINDING_VIEW'); }
  return value;
};
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const scopeKey = (scope) => JSON.stringify({ ...scope,
  connections: [...scope.connections].sort((a, b) => a.serverId.localeCompare(b.serverId)) });

export function assertSmartEnterpriseRecordView(view, scope) {
  if (typeof view?.records !== 'function' || scopeKey(normalizeSmartEnterpriseScope(view.scope)) !== scopeKey(scope)) {
    throw error('RECORD_VIEW_SCOPE_MISMATCH');
  }
  return view;
}

/** Trusted, in-memory view. Never migrates/writes connections or credentials.
 * Legacy bindings require unique, exact catalog evidence on every read. Once
 * inferred, their endpoint/transport stay pinned until a new view is created.
 */
export function createSmartEnterpriseRecordView({ scope: inputScope, getRecords, getConnectorDescriptors = () => [] } = {}) {
  const scope = normalizeSmartEnterpriseScope(inputScope), inferred = new Map();
  if ([getRecords, getConnectorDescriptors].some((fn) => typeof fn !== 'function')) throw error('MISSING_BINDING_CALLBACK');
  function records() {
    const value = sync(getRecords());
    if (!value || typeof value[Symbol.iterator] !== 'function') throw error('INVALID_BINDING_RECORDS');
    const rows = [...value], replacements = new Map();
    let descriptors;
    for (const binding of scope.connections) {
      const matches = rows.filter((row) => row.key === binding.connectionKey), row = matches[0];
      const expectedKey = binding.serverId.slice(4);
      if (matches.length > 1 || (row && (row.serverName !== binding.serverName || row.connectorId !== binding.connectorId
          || row.auth?.mode !== 'oauth' || row.auth.grantKey !== scope.accountRef
          || (row.serverKey !== undefined && row.serverKey !== expectedKey)))
          || rows.some((other) => other.serverName === binding.serverName && other.key !== binding.connectionKey)) throw error('GROUP_BINDING_CHANGED');
      if (rows.some((other) => typeof other.serverName === 'string' && other.serverName !== binding.serverName
          && (other.serverName.startsWith(`${binding.serverName}__`) || binding.serverName.startsWith(`${other.serverName}__`)))) throw error('AMBIGUOUS_TOOL_NAMESPACE');
      if (!row || (row.serverKey !== undefined && !inferred.has(row.key))) continue;
      descriptors ??= sync(getConnectorDescriptors());
      if (!Array.isArray(descriptors)) throw error('LEGACY_BINDING_UNVERIFIED');
      const connectors = descriptors.filter((item) => item.id === binding.connectorId);
      if (connectors.length !== 1 || !Array.isArray(connectors[0].servers)) throw error('LEGACY_BINDING_UNVERIFIED');
      const servers = connectors[0].servers.filter((server) => server.serverKey === expectedKey || server.serverName === binding.serverName);
      const server = servers[0];
      if (servers.length !== 1 || server.serverKey !== expectedKey || server.serverName !== binding.serverName
          || row.transport !== 'streamable-http' || server.transport !== row.transport
          || typeof row.url !== 'string' || !row.url || server.url !== row.url) throw error('LEGACY_BINDING_UNVERIFIED');
      const identity = JSON.stringify([row.connectorId, row.serverName, row.url, row.transport, expectedKey]);
      if (inferred.has(row.key) && inferred.get(row.key) !== identity) throw error('GROUP_BINDING_CHANGED');
      inferred.set(row.key, identity);
      // Copy nested authentication/headers too: a permission callback must not
      // mutate the backing store by changing the effective legacy record.
      replacements.set(row.key, freeze({ ...JSON.parse(JSON.stringify(row)), serverKey: expectedKey }));
    }
    return rows.map((row) => replacements.get(row.key) ?? row);
  }
  return Object.freeze({ scope, records });
}
