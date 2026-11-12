/** P1-03: explicit scope, native restrictions + guards; no production mounting. */
import { readHostRestrictionNames } from './host-tool-names.js';
import { normalizeSmartModeSnapshot } from './smart-mode-schema.js';
import { MCP_CONNECTOR_MANAGEMENT_NAMES, createSmartManagementTools } from './tools.js';

export const SMART_RESTRICTION_HOST_CONTRACT = 'dsh-tools-restrictable-view-v1';
export const QCC_ENTERPRISE_SERVERS = Object.freeze(['qcc-company', 'qcc-risk', 'qcc-ipr', 'qcc-operation', 'qcc-history', 'qcc-executive']);
const error = (code) => Object.assign(new Error(`Smart restrictions: ${code}`), { code });
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

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

export function createSmartModeRestrictionController(ctx, {
  enabled = false, hostContract, scope: inputScope, getRecords, getCatalogEntries = () => [],
  getPreparedNames = () => [], isRecordUsable, isRecordVisible, isToolAllowed,
  isManuallyActive = () => false, onBlocked = () => {}, sourceSearch, prepareTools, releaseTools,
  assertPreparedReady = () => {}, getResourceStatus, t,
} = {}) {
  const states = new Map();
  let scope, mounted = false, disposed = false, syncing = false;
  let stops = [];
  const management = new Set(MCP_CONNECTOR_MANAGEMENT_NAMES);

  function owner(name) {
    const matches = scope.connections.filter((binding) => name.startsWith(`mcp__${binding.serverName}__`));
    if (matches.length > 1) throw error('AMBIGUOUS_TOOL_NAMESPACE');
    return matches[0];
  }

  function records() {
    const rows = [...getRecords()];
    for (const binding of scope.connections) {
      const matches = rows.filter((record) => record.key === binding.connectionKey);
      const record = matches[0];
      if (matches.length > 1 || (record && (record.serverName !== binding.serverName
          || record.connectorId !== binding.connectorId || record.auth?.mode !== 'oauth' || record.auth?.grantKey !== scope.accountRef
          || record.serverKey !== binding.serverId.slice(4)))
          || rows.some((other) => other.serverName === binding.serverName && other.key !== binding.connectionKey)) {
        throw error('GROUP_BINDING_CHANGED');
      }
      if (rows.some((other) => typeof other.serverName === 'string' && other.serverName !== binding.serverName
          && (other.serverName.startsWith(`${binding.serverName}__`) || binding.serverName.startsWith(`${other.serverName}__`)))) {
        throw error('AMBIGUOUS_TOOL_NAMESPACE');
      }
    }
    return rows;
  }

  function eligible(name, agent, rows, { discovery = false } = {}) {
    const binding = owner(name);
    if (!binding) return false;
    const record = rows.find((row) => row.key === binding.connectionKey);
    return Boolean(record && record.enabled !== false && isRecordUsable(record, agent) === true
      && isRecordVisible(record, agent) === true && isToolAllowed(name, record, agent) === true
      && (discovery || record.injectionMode !== 'session' || isManuallyActive(name, record, agent) === true));
  }

  function block(state, code) {
    state.error = code;
    try { onBlocked({ sessionId: state.agent.id, code }); } catch {}
  }

  function refreshAgent(agent) {
    const state = states.get(agent);
    if (disposed || !state || state.snapshot.mode !== 'smart' || state.installing) return;
    if (syncing) return;
    syncing = true;
    try {
      const rows = records();
      if (ctx.tools.get('mcp_connector_session_tools') !== state.legacySessionTool) throw error('LEGACY_SESSION_ENTRY_CHANGED');
      const names = readHostRestrictionNames(ctx.tools, agent);
      const prepared = new Set(getPreparedNames(agent));
      // Own/ancestor business registrations can escape Host masks. Never create
      // one here, and refuse the inference if another plugin shadows this group.
      for (const name of names.visible.filter((name) => owner(name))) {
        if (agent.ctx.tools.get(name, agent) !== ctx.tools.get(name)) throw error('BUSINESS_TOOL_SHADOW');
      }
      for (const name of ['mcp_connector_discover', 'mcp_connector_session_tools']) {
        if (agent.ctx.tools.get(name, agent) !== state.localDefinitions.get(name)) throw error('MANAGEMENT_TOOL_SHADOW');
      }
      const denied = names.restrictable.filter((name) => management.has(name)
        || (owner(name) && (!prepared.has(name) || !eligible(name, agent, rows))));
      if (!same(denied, state.denied)) {
        const previous = state.stopMask;
        // Install replacement before disposing the previous restriction.
        const replacement = denied.length ? agent.ctx.tools.restrict({ deny: denied }) : undefined;
        if (denied.length && typeof replacement !== 'function') throw error('RESTRICTION_DISPOSER_REQUIRED');
        state.stopMask = replacement;
        state.denied = denied;
        previous?.();
      }
      state.error = undefined;
    } catch (cause) { block(state, cause.code ?? 'RESTRICTION_REFRESH_FAILED'); }
    finally { syncing = false; }
  }

  function refresh() {
    for (const agent of states.keys()) refreshAgent(agent);
  }

  function assertReady(agent, { resourceMaintenance = false } = {}) {
    if (!enabled || disposed) return;
    const state = states.get(agent);
    if (!state) throw error('UNATTACHED_AGENT');
    if (state.snapshot.mode === 'compat') return;
    const before = state.denied;
    refreshAgent(agent);
    if (state.error) throw error(state.error);
    if (!same(before, state.denied)) throw error('SMART_VISIBILITY_CHANGED');
    if (!resourceMaintenance) assertPreparedReady(agent);
  }

  function status(agent) {
    const state = states.get(agent);
    if (!state) return { mode: enabled ? 'unattached' : 'disabled' };
    return { mode: state.snapshot.mode, groupId: state.snapshot.groupId ?? null,
      blocked: Boolean(state.error), errorCode: state.error ?? null,
      deniedCount: state.denied.length,
      preparedCount: state.snapshot.mode === 'smart' ? [...new Set(getPreparedNames(agent))].filter((name) => owner(name)).length : 0 };
  }

  function search(agent, { query, limit = 10 }) {
    assertReady(agent);
    if (sourceSearch) return Promise.resolve(sourceSearch(agent, { query, limit })).then((result) => {
      if (!states.has(agent)) throw error('UNATTACHED_AGENT');
      assertReady(agent);
      if (!Array.isArray(result?.items)) throw error('INVALID_SOURCE_SEARCH_RESULT');
      const prepared = new Set(getPreparedNames(agent));
      // Selection owns canonical identity; only this layer knows the actual
      // preparation state. Do not replace it with a selector's placeholder.
      return { ...result, items: result.items.map((item) => ({ ...item, prepared: prepared.has(item.publicName) })) };
    });
    const rows = records();
    const known = new Set(readHostRestrictionNames(ctx.tools, agent).restrictable);
    const prepared = new Set(getPreparedNames(agent));
    const term = query.trim().toLowerCase();
    const items = [];
    for (const entry of getCatalogEntries()) {
      const name = entry.publicName;
      if (typeof name !== 'string' || !owner(name) || owner(name).connectionKey !== entry.connectionKey
          || !eligible(name, agent, rows, { discovery: true })) continue;
      const title = String(entry.title ?? '').slice(0, 160);
      const summary = String(entry.description ?? '').slice(0, 480);
      if (!`${name} ${title} ${summary}`.toLowerCase().includes(term)) continue;
      const binding = owner(name);
      items.push({ publicName: name, connectionKey: binding.connectionKey, serverName: binding.serverName,
        title, summary, registered: known.has(name), prepared: prepared.has(name),
        manual: rows.find((row) => row.key === binding.connectionKey).injectionMode === 'session' });
      if (items.length >= limit) break;
    }
    return { items, source: 'cache', discoveryOnly: true };
  }

  // Discovery/selection must inspect pre-restriction registration, not conclude
  // that a tool is unauthorized merely because our own prepare mask hides it.
  function inspectSource(agent, source) {
    const state = states.get(agent);
    if (!state || state.snapshot.mode !== 'smart') return Object.freeze({ discoverable: false, available: false });
    const binding = owner(source.publicName);
    if (!binding || binding.connectionKey !== source.connectionKey || binding.serverName !== source.serverName) {
      return Object.freeze({ discoverable: false, available: false });
    }
    const rows = records();
    const names = readHostRestrictionNames(ctx.tools, agent);
    const registered = names.restrictable.includes(source.publicName);
    const shadow = names.visible.includes(source.publicName)
      && agent.ctx.tools.get(source.publicName, agent) !== ctx.tools.get(source.publicName);
    const discoverable = eligible(source.publicName, agent, rows, { discovery: true });
    const permitted = eligible(source.publicName, agent, rows);
    return Object.freeze({ discoverable, available: registered && !shadow && permitted && !state.error && !state.installing,
      registered, manualPending: discoverable && !permitted, shadow });
  }

  function release(agent, state) {
    if (states.get(agent) !== state) return;
    if (agent.status !== 'idle') throw error('ROLLBACK_REQUIRES_IDLE_AGENT');
    states.delete(agent);
    state.stopMask?.();
    state.stopLocals.splice(0).reverse().forEach((stop) => stop());
  }

  function installMode(agent, value) {
    if (!enabled) return () => {};
    if (!mounted || disposed) throw error('CONTROLLER_NOT_MOUNTED');
    if (states.has(agent)) throw error('AGENT_ALREADY_ATTACHED');
    if (['get', 'register', 'restrict'].some((method) => typeof agent.ctx?.tools?.[method] !== 'function')) throw error('UNSUPPORTED_AGENT_TOOLS');
    const snapshot = normalizeSmartModeSnapshot(value, agent.id);
    if (snapshot.mode === 'smart' && (snapshot.accountRef !== scope.accountRef || snapshot.groupId !== scope.groupId)) {
      throw error('SNAPSHOT_SCOPE_MISMATCH');
    }
    const state = { agent, snapshot, denied: [], stopLocals: [], localDefinitions: new Map(), installing: true };
    states.set(agent, state);
    if (snapshot.mode === 'compat') return () => release(agent, state);
    try {
      records();
      const original = ctx.tools.get('mcp_connector_session_tools');
      if (!original?.execute || !original.parameters?.properties?.action?.enum) throw error('LEGACY_SESSION_ENTRY_MISSING');
      state.legacySessionTool = original;
      const defs = createSmartManagementTools({ agent, legacySessionTool: original, assertReady, status, search,
        prepare: prepareTools, release: releaseTools,
        resourceStatus: getResourceStatus, refresh: refreshAgent, t });
      for (const def of defs) {
        state.stopLocals.push(agent.ctx.tools.register(def));
        state.localDefinitions.set(def.name, def);
      }
      state.installing = false;
      refreshAgent(agent);
      if (state.error) throw error(state.error);
    } catch (cause) {
      states.delete(agent);
      state.stopMask?.();
      state.stopLocals.reverse().forEach((stop) => stop());
      throw cause;
    }
    return () => release(agent, state);
  }

  function guard(execution) {
    const state = states.get(execution.agent);
    if (!state || state.snapshot.mode !== 'smart') return undefined; // legacy/automation unchanged
    const name = execution.name;
    try {
      if (!owner(name) && !management.has(name) && name !== 'mcp_connector_discover') return undefined;
      if (state.error) return `SMART_RESTRICTION_BLOCKED:${state.error}`;
      if (management.has(name) || name === 'mcp_connector_discover') {
        const local = state.localDefinitions.get(name);
        return local && execution.agent.ctx.tools.get(name, execution.agent) === local ? undefined : 'SMART_MANAGEMENT_DENIED';
      }
      if (!owner(name)) return undefined;
      if (!ctx.tools.get(name) || execution.agent.ctx.tools.get(name, execution.agent) !== ctx.tools.get(name)) return 'SMART_BUSINESS_SHADOW_DENIED';
      if (!new Set(getPreparedNames(execution.agent)).has(name) || !eligible(name, execution.agent, records())) return 'SMART_BUSINESS_NOT_PREPARED_OR_ALLOWED';
      assertPreparedReady(execution.agent);
      return undefined;
    } catch { return 'SMART_RESTRICTION_CHECK_FAILED'; }
  }

  function mount(agentCtx) {
    if (!enabled) return () => {};
    if (mounted || disposed) throw error('ALREADY_MOUNTED');
    if (hostContract !== SMART_RESTRICTION_HOST_CONTRACT || typeof ctx.tools?.guard !== 'function'
        || typeof ctx.tools?.view !== 'function') throw error('UNVERIFIED_RESTRICTION_HOST');
    for (const callback of [getRecords, isRecordUsable, isRecordVisible, isToolAllowed]) {
      if (typeof callback !== 'function') throw error('MISSING_PERMISSION_CALLBACK');
    }
    scope = normalizeSmartEnterpriseScope(inputScope);
    records();
    const acquired = [];
    try {
      const stopGuard = ctx.tools.guard(guard);
      if (typeof stopGuard !== 'function') throw error('GUARD_DISPOSER_REQUIRED');
      acquired.push(stopGuard);
      const stopEvents = agentCtx.on('tools/change', refresh);
      if (typeof stopEvents !== 'function') throw error('EVENT_DISPOSER_REQUIRED');
      acquired.push(stopEvents);
      const stopDisposed = agentCtx.on('agent/disposed', ({ agent }) => {
        const state = states.get(agent);
        if (state) release(agent, state);
      });
      if (typeof stopDisposed !== 'function') throw error('EVENT_DISPOSER_REQUIRED');
      acquired.push(stopDisposed);
    } catch (cause) { acquired.reverse().forEach((stop) => stop()); throw cause; }
    stops = acquired;
    mounted = true;
    return dispose;
  }

  function dispose() {
    if ([...states.keys()].some((agent) => agent.status !== 'idle')) throw error('ROLLBACK_REQUIRES_IDLE_AGENT');
    disposed = true;
    for (const [agent, state] of states) release(agent, state);
    stops.splice(0).reverse().forEach((stop) => stop());
  }

  return { mount, installMode, assertReady, refresh, status, inspectSource,
    restrictionError: (agent) => states.get(agent)?.error,
    sourceRegistration: (agent, source) => inspectSource(agent, source).available ? ctx.tools.get(source.publicName) : undefined,
    sourceVisible: (agent, source, registration) => Boolean(registration && agent.ctx.tools.get(source.publicName, agent) === registration),
    sessionSnapshot: (agent) => states.get(agent)?.snapshot, dispose,
    lifecycleBindings: () => ({ installMode, assertModeReady: assertReady }) };
}
