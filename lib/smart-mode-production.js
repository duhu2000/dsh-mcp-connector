import { createHash } from 'node:crypto';
import { SmartModeStore } from './smart-mode-store.js';
import { createSmartModeIntegration, SMART_INTEGRATION_HOST_CONTRACT } from './smart-mode-integration.js';
import { createSmartModeControl } from './smart-mode-control.js';
import { mountSmartModeControlRoutes } from './smart-mode-control-web.js';
import { normalizeSmartEnterpriseScope, QCC_ENTERPRISE_SERVERS } from './smart-mode-bindings.js';
import { canonicalSourceJson, RAW_TOOL_ORIGIN, sourceError } from './source-relations.js';
import { loadSmartModeHost } from './smart-mode-host.js';
import { publicToolName } from './governance.js';

const identity = (record) => createHash('sha256').update(JSON.stringify(record)).digest('hex');
const clone = (value) => JSON.parse(canonicalSourceJson(value));

/** One current account, one grant, exact built-in enterprise endpoints. */
export function resolveSmartProductionScope({ account, records, grants, descriptors }) {
  const descriptor = descriptors.find((value) => value.id === 'qcc-company');
  if (descriptor?.auth?.issuer !== 'https://agent.qcc.com') throw sourceError('SMART_ENTERPRISE_GROUP_UNAVAILABLE');
  const groups = [];
  for (const [key, entry] of grants) {
    const grant = entry.grant ?? entry;
    if (grant.account !== account || grant.issuer !== 'https://agent.qcc.com') continue;
    const connections = [];
    for (const name of QCC_ENTERPRISE_SERVERS) {
      const server = descriptor.servers.find((value) => value.serverName === name && value.serverKey === name.slice(4));
      if (server?.url !== `https://agent.qcc.com/mcp/${name.slice(4)}/stream` || server.transport !== 'streamable-http') break;
      const found = records.filter((record) => record.connectorId === descriptor.id && record.serverName === name
        && record.auth?.mode === 'oauth' && record.auth.grantKey === key && record.url === server.url && record.transport === server.transport);
      if (found.length !== 1) break;
      connections.push({ serverId: name, connectionKey: found[0].key, connectorId: descriptor.id, serverName: name });
    }
    if (connections.length === 6) groups.push({ accountRef: key, groupId: 'qcc-enterprise-six-v1', connections });
  }
  if (groups.length !== 1) throw sourceError(groups.length ? 'SMART_ENTERPRISE_GROUP_AMBIGUOUS' : 'SMART_ENTERPRISE_GROUP_UNAVAILABLE');
  return normalizeSmartEnterpriseScope(groups[0]);
}

/** Normal-plugin composition; available controls do not enable smart defaults.
 * Original raw definitions stay in memory. No connection/OAuth/schema cache is
 * migrated. No real relation or readonly approval is produced by this adapter.
 */
export async function createSmartModeProduction(ctx, { account, getRecords, getGrants, getDescriptors,
  isRecordUsable, isRecordVisible, isToolAllowed, isManuallyActive,
  logger, t, hostBindings, requestDiscovery = () => {}, now = () => Date.now(),
} = {}) {
  const host = hostBindings ?? await loadSmartModeHost(ctx);
  // Capture admitted services before a Cordis fiber starts asynchronous disposal.
  // Reading required services from an inactive injecting Context is forbidden.
  const integrationContext = { tools: ctx.tools, agents: ctx.agents, on: ctx.on.bind(ctx) };
  const profileDir = host.getHostProfileDir();
  let scope, integration, control, closed = false, issue, sequence = 0, pending, publishing = false, publishedStamp;
  let registrations = new Map(), recordStamp;
  const raw = new Map(), generations = new Map();
  const report = (code) => { issue = code; logger?.warn?.(`smart enterprise: ${code}`); };

  function invalidate() {
    publishedStamp = undefined;
    if (integration?.status().enabled) integration.invalidateViews({ expectedRevision: integration.status().viewRevision });
  }
  function publishRaw() {
    if (closed || publishing || !scope || !integration?.status().enabled) return;
    const records = [...getRecords()], rows = [];
    for (const binding of scope.connections) {
      const record = records.find((entry) => entry.key === binding.connectionKey), cached = raw.get(binding.connectionKey);
      // Disabled/deleted/unusable members contribute no definitions. They must
      // not keep the other permitted members waiting for a list we cannot run.
      if (!record || record.enabled === false || isRecordUsable(record) !== true) continue;
      if (record.auth?.grantKey !== scope.accountRef) return;
      if (!cached || cached.identity !== identity(record)) return;
      rows.push(...cached.tools.map((definition) => ({ origin: RAW_TOOL_ORIGIN, accountRef: scope.accountRef,
        groupId: scope.groupId, connectionKey: binding.connectionKey, serverName: binding.serverName, definition })));
    }
    const registeredRows = rows.filter((row) => ctx.tools.get(publicToolName(row.serverName, row.definition.name)));
    const nextRegistrations = new Map(registeredRows.map((row) => {
      const name = publicToolName(row.serverName, row.definition.name); return [name, ctx.tools.get(name)];
    }));
    const stamp = createHash('sha256').update(canonicalSourceJson(registeredRows)).digest('hex');
    if (stamp === publishedStamp && [...nextRegistrations].every(([key, value]) => registrations.get(key) === value)) return;
    publishing = true;
    try {
      integration.publishViews({ rawSources: registeredRows }, { expectedRevision: integration.status().viewRevision });
      publishedStamp = stamp; registrations = nextRegistrations; issue = undefined;
    }
    catch (error) { report(error.code ?? 'SMART_RAW_PUBLICATION_FAILED'); }
    finally { publishing = false; }
  }
  async function makeIntegration() {
    publishedStamp = undefined; registrations = new Map();
    integration = await createSmartModeIntegration(integrationContext, { enabled: true, hostContract: SMART_INTEGRATION_HOST_CONTRACT,
      profileDir, getHostProfileDir: host.getHostProfileDir, scope,
      getRecords, getConnectorDescriptors: getDescriptors, isRecordUsable, isRecordVisible, isToolAllowed, isManuallyActive,
      classifyInput: host.classifyInput, isNativeExecutor: host.isNativeExecutor, projectToolSchema: host.projectToolSchema,
      now, t,
    });
    publishRaw();
  }
  async function setLayerEnabled(enabled) {
    if (closed) throw sourceError('SMART_PRODUCTION_CLOSED');
    if (!enabled) { if (integration?.status().mounted) await integration.dispose(); return; }
    if (!integration?.status().enabled) await makeIntegration();
    if (!integration.status().mounted) await integration.mount();
    publishRaw();
  }
  async function reconcile() {
    if (closed || control) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        scope = resolveSmartProductionScope({ account, records: [...getRecords()], grants: getGrants(), descriptors: getDescriptors() });
        recordStamp = identity(scope.connections.map((binding) => [...getRecords()].find((record) => record.key === binding.connectionKey)));
        await makeIntegration();
        control = await createSmartModeControl({ enabled: true, profileDir, scope, getIntegration: () => integration,
          getAgents: () => ctx.agents.list(), sessionActions: host.sessionActions, setLayerEnabled, now, t });
        const store = await SmartModeStore.open({ profileDir });
        try {
          const policy = await store.refreshDefaultPolicy(scope.accountRef, scope.groupId);
          if (policy?.mode === 'smart') await setLayerEnabled(true);
        } finally { await store.close(); }
        issue = undefined;
      } catch (error) {
        report(error.code ?? 'SMART_PRODUCTION_UNAVAILABLE');
        if (!control) { await integration?.dispose(); integration = undefined; }
      }
    })();
    try { await pending; } finally { pending = undefined; }
  }
  const stopRoute = mountSmartModeControlRoutes(ctx, {
    async dispatch(method, args, principal) {
      if (closed) throw sourceError('SMART_PRODUCTION_CLOSED');
      await reconcile();
      if (!control) throw sourceError(issue ?? 'SMART_ENTERPRISE_GROUP_UNAVAILABLE');
      return control.dispatch(method, args, principal);
    },
  }, { enabled: true, authorizeRequest: (request) => host.authorizeRequest(request, scope),
    capabilities: async () => { await reconcile(); return { enabled: Boolean(control), errorCode: issue ?? null }; }, now });
  const stopChanges = ctx.on('tools/change', () => {
    if (closed || publishing) return;
    if ([...registrations].some(([name, definition]) => ctx.tools.get(name) !== definition)) {
      registrations = new Map(); raw.clear(); invalidate(); requestDiscovery(); return;
    }
    publishRaw();
  });
  try { await reconcile(); } catch { /* Stable diagnostics above; legacy remains available. */ }
  return {
    reconcile,
    recordsChanged() {
      if (closed) return;
      if (scope) {
        const stamp = identity(scope.connections.map((binding) => [...getRecords()].find((record) => record.key === binding.connectionKey) ?? null));
        if (stamp === recordStamp) return;
        recordStamp = stamp; invalidate(); raw.clear(); requestDiscovery();
      }
      void reconcile();
    },
    beginDiscovery(record) {
      if (closed || !QCC_ENTERPRISE_SERVERS.includes(record.serverName)) return;
      const ticket = ++sequence; generations.set(record.key, ticket); raw.delete(record.key);
      if (scope?.connections.some((entry) => entry.connectionKey === record.key)) invalidate();
      return { key: record.key, ticket, identity: identity(record) };
    },
    completeDiscovery(receipt, tools) {
      if (closed || !receipt || generations.get(receipt.key) !== receipt.ticket) return;
      const record = [...getRecords()].find((entry) => entry.key === receipt.key);
      if (!record || identity(record) !== receipt.identity) return;
      try { raw.set(receipt.key, { identity: receipt.identity, tools: clone(tools) }); publishRaw(); }
      catch (error) { report(error.code ?? 'SMART_RAW_PUBLICATION_FAILED'); invalidate(); }
    },
    status() { return { available: Boolean(control), mounted: integration?.status().mounted === true, errorCode: issue ?? null }; },
    async close() {
      if (closed) return;
      integration?.assertCanDispose();
      closed = true; stopRoute(); stopChanges(); await pending;
      await control?.close(); await integration?.dispose(); raw.clear();
    },
  };
}
