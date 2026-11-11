export const LEGACY_PLUGINS = [
  {
    pluginId: 'qcc-mcp-oauth',
    connectorHint: 'qcc-company',
    domainName: 'qcc_mcp_oauth',
    packageName: 'qcc-dsh-mcp-oauth',
    resources: { 'qcc-company': 'company', 'qcc-risk': 'risk', 'qcc-ipr': 'ipr', 'qcc-operation': 'operation', 'qcc-history': 'history', 'qcc-executive': 'executive' },
  },
  {
    pluginId: 'qcc-legal-mcp-oauth',
    connectorHint: 'qcc-legal',
    domainName: 'qcc_legal_mcp_oauth',
    packageName: 'qcc-dsh-mcp-legal-oauth',
    resources: { 'qcc-regulation': 'legal-regulation', 'qcc-case': 'legal-case' },
  },
];

function enumerateEntries(loader, fallbackIds) {
  if (typeof loader?.entries === 'function') {
    try { return Array.from(loader.entries(), entry => ({ entry, id: entry.id ?? entry.options?.id })); }
    catch { /* Older loaders may expose only resolve(). */ }
  } else if (loader?.entries instanceof Map) {
    return Array.from(loader.entries, ([id, entry]) => ({ entry, id: entry.id ?? id }));
  }
  const entries = [];
  for (const id of fallbackIds) {
    try {
      const entry = loader?.resolve(id);
      if (entry) entries.push({ entry, id: entry.id ?? id });
    } catch { /* resolve throws for a missing entry. */ }
  }
  return entries;
}

function isActive({ entry }) {
  return entry.disabled !== true && entry.options?.disabled !== true;
}

function isLegacyClient(entry, oldName) {
  // The legal legacy client and the connector use identical entry IDs but different
  // serverName values. Checking ownership here also protects disable and remove.
  const name = entry.options?.name ?? entry.name;
  return name === '@deepseek-ai/dsh-mcp-client' && entry.options?.config?.serverName === oldName;
}

export function legacyClientOwnsEntry(loader, id, serverName) {
  const plugin = LEGACY_PLUGINS.find(item => Object.hasOwn(item.resources, serverName));
  if (!plugin) return false;
  try {
    const entry = loader.resolve(id);
    if (!entry) return false;
    const oldName = plugin.resources[serverName];
    return id.endsWith(`-${oldName}`) && isLegacyClient(entry, oldName);
  } catch { return false; }
}

export function pendingRestartConflict(source, serverName, t) {
  if (!source?.pending) return null;
  const plugin = LEGACY_PLUGINS.find(item => source.candidateId?.startsWith(item.domainName + ':'));
  return {
    kind: 'restart', pluginId: plugin?.pluginId, packageName: plugin?.packageName, pluginActive: false,
    entryIds: [], pluginEntryIds: [], legacyServerNames: [], serverNames: [serverName], serverName,
    message: t('旧授权等待交接，请完整退出并重启 DSH'),
  };
}

export function detectLegacyConflicts(loader, servers, t) {
  const requested = new Set(servers.map(server => server.serverName));
  const plugins = LEGACY_PLUGINS.filter(plugin => Object.keys(plugin.resources).some(name => requested.has(name)));
  if (!plugins.length) return [];
  const entries = enumerateEntries(loader, plugins.flatMap(plugin => [
    plugin.pluginId, ...Object.values(plugin.resources).map(name => `mcp-qcc-${name}`),
  ]));
  const conflicts = [];
  for (const { pluginId, packageName, resources } of plugins) {
    const parents = entries.filter(({ entry, id }) => {
      const name = entry.options?.name ?? entry.name;
      return name === packageName || (!name && (entry.options?.id ?? id) === pluginId);
    });
    const prefixes = ['mcp-qcc', ...parents.map(({ entry }) => entry.options?.config?.mcpEntryPrefix).filter(Boolean)];
    const pluginEntryIds = parents.filter(isActive).map(item => item.id);
    const pluginActive = pluginEntryIds.length > 0;
    for (const [serverName, oldName] of Object.entries(resources)) {
      if (!requested.has(serverName)) continue;
      const expectedIds = new Set(prefixes.map(prefix => `${prefix}-${oldName}`));
      const entryIds = entries.filter(item => expectedIds.has(item.entry.options?.id ?? item.id)
        && isActive(item) && isLegacyClient(item.entry, oldName)).map(item => item.id);
      if (!pluginActive && !entryIds.length) continue;
      const message = pluginActive
        ? t('旧插件 {pluginId} 仍在管理企查查授权；请停用旧插件并重启 DSH', { pluginId })
        : t('旧服务条目 {entryIds} 仍启用；请停用这些条目并完整重启 DSH', { entryIds: entryIds.join('、') });
      conflicts.push({ pluginId, packageName, pluginActive, kind: pluginActive ? 'plugin' : 'residual',
        pluginEntryIds, entryIds, legacyServerNames: entryIds.length ? [oldName] : [], serverName, serverNames: [serverName], message });
    }
  }
  return conflicts;
}

export const legacyServerNames = LEGACY_PLUGINS.flatMap(plugin => Object.keys(plugin.resources).map(serverName => ({ serverName })));
