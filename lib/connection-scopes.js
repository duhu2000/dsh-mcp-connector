/**
 * Connection visibility scopes.
 *
 * Credentials remain in the existing ConnectionRecord/Grant stores. This
 * document only binds a connection key to profile-global visibility and/or
 * stable DSH Workspace ids, so copying or promoting a scope never copies a
 * credential.
 */

export const CONNECTION_SCOPE_HISTORY_LIMIT = 20;
export const CONNECTION_SCOPE_TYPES = ['global', 'project'];

function cloneBinding(binding) {
  return {
    connectionKey: binding.connectionKey,
    global: binding.global,
    projects: [...binding.projects],
  };
}

function normalizeProjects(input) {
  return [...new Set((Array.isArray(input) ? input : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))].sort();
}

export function normalizeScopeTarget(input) {
  const scope = typeof input?.scope === 'string' ? input.scope.trim() : '';
  if (!CONNECTION_SCOPE_TYPES.includes(scope)) throw new Error(`不支持的连接作用域: ${scope || '(空)'}`);
  if (scope === 'global') return { scope: 'global' };
  const workspaceId = typeof input?.workspaceId === 'string' ? input.workspaceId.trim() : '';
  if (!workspaceId) throw new Error('project 作用域必须指定 workspaceId');
  return { scope: 'project', workspaceId };
}

export function normalizeScopeBinding(input) {
  const connectionKey = typeof input?.connectionKey === 'string' ? input.connectionKey.trim() : '';
  if (!connectionKey) throw new Error('connectionKey 必填');
  const projects = normalizeProjects(input?.projects);
  const global = input?.global === true;
  if (!global && projects.length === 0) throw new Error(`连接 "${connectionKey}" 至少需要一个作用域`);
  return { connectionKey, global, projects };
}

function normalizeBindings(input) {
  const byKey = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    // An absent binding is intentionally legacy-global. A present but corrupt
    // binding must never be dropped into that fallback, which could expose a
    // project-only connection globally.
    const binding = normalizeScopeBinding(raw);
    byKey.set(binding.connectionKey, binding);
  }
  return [...byKey.values()].sort((a, b) => a.connectionKey.localeCompare(b.connectionKey));
}

export function normalizeScopeDocument(input) {
  const revision = Number.isInteger(input?.revision) && input.revision >= 0 ? input.revision : 0;
  const history = [];
  for (const item of Array.isArray(input?.history) ? input.history : []) {
    if (!Number.isInteger(item?.revision) || item.revision < 0) continue;
    history.push({
      revision: item.revision,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
      bindings: normalizeBindings(item.bindings),
    });
  }
  return {
    key: 'active',
    version: 1,
    revision,
    updatedAt: Number.isFinite(input?.updatedAt) ? input.updatedAt : 0,
    bindings: normalizeBindings(input?.bindings),
    history: history.slice(-CONNECTION_SCOPE_HISTORY_LIMIT),
  };
}

/** Missing binding is the backward-compatible profile/global assignment. */
export function bindingForConnection(bindings, connectionKey) {
  const match = (Array.isArray(bindings) ? bindings : []).find((binding) => binding.connectionKey === connectionKey);
  return match ? cloneBinding(match) : { connectionKey, global: true, projects: [] };
}

export function scopeTargets(binding) {
  const normalized = normalizeScopeBinding(binding);
  return [
    ...(normalized.global ? [{ scope: 'global' }] : []),
    ...normalized.projects.map((workspaceId) => ({ scope: 'project', workspaceId })),
  ];
}

export function scopeLabel(binding, workspaceNames = new Map()) {
  const targets = scopeTargets(binding);
  return targets.map((target) => target.scope === 'global'
    ? '全局'
    : `项目：${workspaceNames.get(target.workspaceId) || target.workspaceId}`).join('、');
}

export function connectionVisibleInWorkspace(binding, workspaceId) {
  const normalized = normalizeScopeBinding(binding);
  return normalized.global || (typeof workspaceId === 'string' && normalized.projects.includes(workspaceId));
}

export function mutateScopeBinding(binding, { mode, target }) {
  const normalized = normalizeScopeBinding(binding);
  const nextTarget = normalizeScopeTarget(target);
  if (!['copy', 'move'].includes(mode)) throw new Error(`不支持的作用域变更模式: ${mode}`);
  if (mode === 'move') {
    return normalizeScopeBinding({
      connectionKey: normalized.connectionKey,
      global: nextTarget.scope === 'global',
      projects: nextTarget.scope === 'project' ? [nextTarget.workspaceId] : [],
    });
  }
  return normalizeScopeBinding({
    connectionKey: normalized.connectionKey,
    global: normalized.global || nextTarget.scope === 'global',
    projects: nextTarget.scope === 'project'
      ? [...normalized.projects, nextTarget.workspaceId]
      : normalized.projects,
  });
}

function replaceBinding(bindings, nextBinding) {
  return normalizeBindings([
    ...bindings.filter((binding) => binding.connectionKey !== nextBinding.connectionKey),
    nextBinding,
  ]);
}

export class ConnectionScopeService {
  constructor(store, { now = () => Date.now(), historyLimit = CONNECTION_SCOPE_HISTORY_LIMIT } = {}) {
    this.store = store;
    this.now = now;
    this.historyLimit = historyLimit;
    this.document = normalizeScopeDocument(null);
  }

  async load() {
    // Storage read/validation failures are not equivalent to a missing legacy
    // document. Propagate them so the plugin fails closed instead of treating
    // every connection as profile-global.
    this.document = normalizeScopeDocument(await this.store.get());
    return this.snapshot();
  }

  snapshot() {
    return {
      ...this.document,
      bindings: this.document.bindings.map(cloneBinding),
      history: this.document.history.map((item) => ({
        ...item,
        bindings: item.bindings.map(cloneBinding),
      })),
    };
  }

  binding(connectionKey) {
    return bindingForConnection(this.document.bindings, connectionKey);
  }

  preview({ connectionKey, mode, target }) {
    const current = this.binding(connectionKey);
    const next = mutateScopeBinding(current, { mode, target });
    return {
      baseRevision: this.document.revision,
      current,
      next,
      changed: JSON.stringify(current) !== JSON.stringify(next),
    };
  }

  async apply(input, { expectedRevision } = {}) {
    if (expectedRevision !== undefined && expectedRevision !== this.document.revision) {
      throw new Error(`连接作用域已变化（当前 revision=${this.document.revision}），请重新预览`);
    }
    const preview = this.preview(input);
    if (!preview.changed) return { changed: false, previousRevision: this.document.revision, document: this.snapshot() };
    return this.commitBindings(replaceBinding(this.document.bindings, preview.next));
  }

  async assign(connectionKey, target, options) {
    return this.apply({ connectionKey, mode: 'move', target }, options);
  }

  async assignMany(connectionKeys, target, { expectedRevision } = {}) {
    if (expectedRevision !== undefined && expectedRevision !== this.document.revision) {
      throw new Error(`连接作用域已变化（当前 revision=${this.document.revision}），请重新预览`);
    }
    const normalizedTarget = normalizeScopeTarget(target);
    let bindings = this.document.bindings;
    let changed = false;
    for (const connectionKey of [...new Set(connectionKeys.map(String))].sort()) {
      const current = bindingForConnection(bindings, connectionKey);
      const next = mutateScopeBinding(current, { mode: 'move', target: normalizedTarget });
      if (JSON.stringify(current) === JSON.stringify(next)) continue;
      bindings = replaceBinding(bindings, next);
      changed = true;
    }
    if (!changed) return { changed: false, previousRevision: this.document.revision, document: this.snapshot() };
    return this.commitBindings(bindings);
  }

  async rollback(targetRevision, { expectedRevision } = {}) {
    if (!Number.isInteger(targetRevision) || targetRevision < 0) throw new Error('rollbackRevision 必须是非负整数');
    if (expectedRevision !== undefined && expectedRevision !== this.document.revision) {
      throw new Error(`连接作用域已变化（当前 revision=${this.document.revision}），请重新读取`);
    }
    const target = targetRevision === this.document.revision
      ? { revision: targetRevision, bindings: this.document.bindings }
      : this.document.history.find((item) => item.revision === targetRevision);
    if (!target) throw new Error(`找不到可回滚的连接作用域 revision=${targetRevision}`);
    if (targetRevision === this.document.revision) {
      return { changed: false, previousRevision: targetRevision, document: this.snapshot() };
    }
    const result = await this.commitBindings(target.bindings);
    return { ...result, restoredRevision: targetRevision };
  }

  async commitBindings(bindings) {
    const now = this.now();
    const previousRevision = this.document.revision;
    const history = [...this.document.history, {
      revision: previousRevision,
      createdAt: now,
      bindings: this.document.bindings.map(cloneBinding),
    }].slice(-this.historyLimit);
    const next = normalizeScopeDocument({
      ...this.document,
      revision: previousRevision + 1,
      updatedAt: now,
      bindings,
      history,
    });
    await this.store.put(next);
    this.document = next;
    return { changed: true, previousRevision, document: this.snapshot() };
  }
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/** Host-enforced workspace visibility for project-only MCP connections. */
export function createHostScopeController(ctx, {
  getBindings,
  getRecords,
  workspaceIdForAgent,
  logger,
} = {}) {
  let disposed = false;
  let agentsMounted = false;
  let mountedAgentCtx = null;
  let agentMountDispose = null;
  const restrictions = new Map();

  const records = () => [...(getRecords?.() ?? [])];
  const bindings = () => [...(getBindings?.() ?? [])];

  function recordForPublicName(name) {
    if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
    return records()
      .filter((record) => name.startsWith(`mcp__${record.serverName}__`))
      .sort((a, b) => b.serverName.length - a.serverName.length)[0] ?? null;
  }

  function visible(record, agent) {
    const binding = bindingForConnection(bindings(), record.key);
    const workspaceId = agent ? workspaceIdForAgent?.(agent) : undefined;
    return connectionVisibleInWorkspace(binding, workspaceId);
  }

  const disposeGuard = typeof ctx.tools?.guard === 'function'
    ? ctx.tools.guard((execution) => {
        const record = recordForPublicName(execution.name);
        if (!record || visible(record, execution.agent)) return undefined;
        return `MCP 工具 ${execution.name} 不属于当前工作区`;
      })
    : null;

  function observedPublicNames() {
    if (typeof ctx.tools?.schemas !== 'function') return [];
    try {
      return ctx.tools.schemas().map((schema) => schema?.name)
        .filter((name) => typeof name === 'string' && recordForPublicName(name))
        .sort();
    } catch (error) {
      logger?.warn?.(`scope read Host tools failed: ${error.message}`);
      return [];
    }
  }

  function installRestriction(agent) {
    const denied = observedPublicNames().filter((name) => {
      const record = recordForPublicName(name);
      return record && !visible(record, agent);
    });
    const current = restrictions.get(agent);
    if (current && sameNames(current.denied, denied)) return;
    if (denied.length === 0) {
      current?.dispose?.();
      restrictions.delete(agent);
      return;
    }
    try {
      const dispose = agent.ctx.tools.restrict({ deny: denied });
      restrictions.set(agent, { denied, dispose });
      current?.dispose?.();
    } catch (error) {
      logger?.warn?.(`scope restrict agent "${agent.id ?? 'unknown'}" failed: ${error.message}`);
    }
  }

  let syncing = false;
  let pending = false;
  function refresh() {
    if (disposed || !agentsMounted) return;
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      const live = new Set(mountedAgentCtx?.agents?.list?.() ?? []);
      for (const agent of live) installRestriction(agent);
      for (const agent of restrictions.keys()) if (!live.has(agent)) restrictions.delete(agent);
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        refresh();
      }
    }
  }

  function mountAgents(agentCtx) {
    agentMountDispose?.();
    agentsMounted = true;
    mountedAgentCtx = agentCtx;
    const stopCreated = agentCtx.on?.('agent/created', refresh);
    const stopDisposed = agentCtx.on?.('agent/disposed', ({ agent }) => restrictions.delete(agent));
    const stopToolsChange = agentCtx.on?.('tools/change', refresh);
    refresh();
    agentMountDispose = () => {
      agentsMounted = false;
      mountedAgentCtx = null;
      stopCreated?.();
      stopDisposed?.();
      stopToolsChange?.();
      for (const entry of restrictions.values()) entry.dispose?.();
      restrictions.clear();
      agentMountDispose = null;
    };
    return agentMountDispose;
  }

  return {
    refresh,
    mountAgents,
    inspect(name, agent) {
      const record = recordForPublicName(name);
      if (!record) return null;
      const binding = bindingForConnection(bindings(), record.key);
      return { record, binding, workspaceId: agent ? workspaceIdForAgent?.(agent) : undefined, visible: visible(record, agent) };
    },
    capabilities() {
      return {
        executionGuard: Boolean(disposeGuard),
        visibilityRestriction: agentsMounted && typeof ctx.tools?.restrict === 'function',
        workspaceRegistry: typeof workspaceIdForAgent === 'function',
        restrictedAgents: restrictions.size,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      agentMountDispose?.();
      disposeGuard?.();
    },
  };
}
