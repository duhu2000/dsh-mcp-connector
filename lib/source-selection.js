import { z } from 'zod';
import { normalizeSmartEnterpriseScope } from './smart-mode-restrictions.js';
import { normalizeSmartModeSnapshot } from './smart-mode-schema.js';
import {
  indexRawToolSources, identifySourceCandidates, normalizeSourceRelation,
  sourceDecisionHash, sourceError,
} from './source-relations.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema = z.strictObject({
  sessionId: z.string().min(1), accountRef: z.string().min(1), groupId: z.string().min(1),
  capabilityId: z.string().min(1), kind: z.enum(['source', 'compare']),
  sources: z.array(z.strictObject({ sourceId: hash, definitionFingerprint: hash })).min(1).max(8),
  evidenceHash: hash, expiresAt: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if ((value.kind === 'source' && value.sources.length !== 1) || (value.kind === 'compare' && value.sources.length < 2)
      || new Set(value.sources.map((source) => source.sourceId)).size !== value.sources.length) {
    ctx.addIssue({ code: 'custom', message: 'Invalid trusted source intent' });
  }
});
const relationKey = (relation) => `relation:${relation.id}`;
const sourceKey = (source) => `source:${source.sourceId}`;
const summary = (source) => ({ sourceId: source.sourceId, publicName: source.publicName,
  connectionKey: source.connectionKey, serverName: source.serverName,
  definitionFingerprint: source.definitionFingerprint });

/** Selection only. No business execution, approval UI or Host mutation. */
export function createSourceSelector({
  enabled = false, scope: inputScope, getSessionSnapshot, getRawSources, getRelations,
  inspectSource, getUserSourceIntent = () => undefined, now = () => Date.now(),
} = {}) {
  const scope = enabled ? normalizeSmartEnterpriseScope(inputScope) : undefined;
  const sessions = new Map();
  let disposed = false, stopDisposed;
  if (enabled && [getSessionSnapshot, getRawSources, getRelations, inspectSource, getUserSourceIntent].some((callback) => typeof callback !== 'function')) {
    throw sourceError('MISSING_SOURCE_CALLBACK');
  }

  function memory(agent) {
    if (!sessions.has(agent)) sessions.set(agent, { successful: new Map(), failures: new Map() });
    return sessions.get(agent);
  }

  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw sourceError('INVALID_SOURCE_CLOCK');
    return value;
  }

  function mode(agent) {
    if (!agent || typeof agent.id !== 'string' || agent.session?.id !== agent.id) throw sourceError('SOURCE_AGENT_REQUIRED');
    const snapshot = normalizeSmartModeSnapshot(getSessionSnapshot(agent), agent.id);
    if (snapshot.mode === 'smart' && (snapshot.accountRef !== scope.accountRef || snapshot.groupId !== scope.groupId)) throw sourceError('SOURCE_SCOPE_MISMATCH');
    return snapshot;
  }

  function permissionFor(agent, source) {
    const permission = inspectSource(agent, source);
    if (permission?.then) throw sourceError('ASYNC_SOURCE_PERMISSION');
    const registered = permission?.registered === true
      || (permission?.registered !== false && permission?.available === true);
    return Object.freeze({ discoverable: permission?.discoverable === true, registered,
      available: registered && permission?.discoverable === true && permission?.available === true,
      manualPending: permission?.manualPending === true });
  }

  async function current(agent) {
    if (!enabled || disposed) return { status: 'disabled' };
    const snapshot = mode(agent);
    if (snapshot.mode !== 'smart') return { status: 'compat' };
    const [rows, documents] = await Promise.all([getRawSources(agent), getRelations(scope.accountRef, scope.groupId)]);
    if (!Array.isArray(rows) || !Array.isArray(documents)) throw sourceError('INVALID_SOURCE_SNAPSHOT');
    if (sourceDecisionHash(mode(agent)) !== sourceDecisionHash(snapshot)) throw sourceError('SOURCE_MODE_CHANGED');
    return buildView(agent, snapshot, rows, documents);
  }

  function buildView(agent, snapshot, rows, documents) {
    if (!Array.isArray(rows) || !Array.isArray(documents)) throw sourceError('INVALID_SOURCE_SNAPSHOT');
    const sources = indexRawToolSources(scope, rows);
    const permissions = new Map();
    for (const source of sources.values()) permissions.set(source.sourceId, permissionFor(agent, source));
    const relations = [], seenIds = new Set(), inactive = new Map();
    const quarantined = new Set();
    const at = clock();
    for (const value of documents) {
      if (value.accountRef !== scope.accountRef || value.groupId !== scope.groupId) continue;
      const relation = normalizeSourceRelation(value);
      if (seenIds.has(relation.id)) throw sourceError('DUPLICATE_RELATION_ID');
      seenIds.add(relation.id);
      if (relation.status !== 'approved') { inactive.set(relationKey(relation), 'RELATION_NOT_APPROVED'); continue; }
      const reason = !relation.enabled ? 'RELATION_DISABLED' : at < relation.validFrom ? 'RELATION_NOT_YET_VALID'
        : at >= relation.expiresAt ? 'RELATION_EXPIRED' : relation.review.reviewedAt > at ? 'REVIEW_NOT_YET_VALID' : undefined;
      if (reason) { inactive.set(relationKey(relation), reason); continue; }
      const changed = relation.members.some((member) => sources.has(member.sourceId)
        && !member.fingerprints.includes(sources.get(member.sourceId).definitionFingerprint));
      if (changed) {
        inactive.set(relationKey(relation), 'SOURCE_DEFINITION_CHANGED');
        relation.members.forEach((member) => quarantined.add(member.sourceId));
        continue;
      }
      relations.push(relation);
    }
    // No transitive merge: overlapping approvals can have different billing or
    // freshness conclusions. Quarantine only their groups until reviewed.
    const memberOwners = new Map();
    for (const relation of relations) for (const member of relation.members) {
      if (!memberOwners.has(member.sourceId)) memberOwners.set(member.sourceId, []);
      memberOwners.get(member.sourceId).push(relation);
    }
    for (const owners of memberOwners.values()) if (owners.length > 1) {
      for (const relation of owners) {
        inactive.set(relationKey(relation), 'OVERLAPPING_RELATIONS');
        relation.members.forEach((member) => quarantined.add(member.sourceId));
      }
    }
    const capabilities = new Map(), covered = new Set();
    for (const relation of relations) {
      if (inactive.has(relationKey(relation)) || relation.members.some((member) => quarantined.has(member.sourceId))) continue;
      const members = relation.members.filter((member) => sources.has(member.sourceId));
      if (!members.length) continue;
      members.forEach((member) => covered.add(member.sourceId));
      capabilities.set(relationKey(relation), { id: relationKey(relation), relation,
        members: members.map((member) => ({ ...member, source: sources.get(member.sourceId) })) });
    }
    for (const source of sources.values()) if (!covered.has(source.sourceId) && !quarantined.has(source.sourceId)) {
      capabilities.set(sourceKey(source), { id: sourceKey(source), members: [{ sourceId: source.sourceId,
        source, priority: 0, verifiedSuperset: false }] });
    }
    const stamp = sourceDecisionHash({ snapshot,
      sources: [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      permissions: [...permissions].sort(([a], [b]) => a.localeCompare(b)),
      relations: documents.filter((value) => value.accountRef === scope.accountRef && value.groupId === scope.groupId).sort((a, b) => a.id.localeCompare(b.id)),
    });
    return { status: 'smart', snapshot, sources, permissions, capabilities, inactive, quarantined, stamp };
  }

  function ranked(agent, view, capability, availableOnly = true) {
    const used = memory(agent).successful.get(capability.id);
    return capability.members.filter((member) => view.permissions.get(member.sourceId)[availableOnly ? 'available' : 'discoverable'])
      .sort((a, b) => Number(b.sourceId === used) - Number(a.sourceId === used)
        || Number(b.verifiedSuperset) - Number(a.verifiedSuperset) || a.priority - b.priority || a.sourceId.localeCompare(b.sourceId));
  }

  async function search(agent, args = {}) {
    if (Object.keys(args).some((key) => !['query', 'limit'].includes(key)) || typeof args.query !== 'string' || !args.query.trim()
        || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100))) throw sourceError('INVALID_SOURCE_QUERY');
    const view = await current(agent);
    if (view.status !== 'smart') return { mode: view.status, items: [], discoveryOnly: true };
    const term = args.query.trim().toLowerCase(), items = [];
    for (const capability of view.capabilities.values()) {
      const visible = ranked(agent, view, capability, false);
      if (!visible.some(({ source }) => `${source.publicName} ${source.rawName} ${source.serverName} ${source.title} ${source.description}`.toLowerCase().includes(term))) continue;
      const chosen = ranked(agent, view, capability)[0] ?? visible[0];
      const permission = view.permissions.get(chosen.sourceId);
      items.push({ capabilityId: capability.id, ...summary(chosen.source),
        title: chosen.source.title.slice(0, 160), summary: chosen.source.description.slice(0, 480),
        aliases: visible.filter((member) => member !== chosen).map(({ source }) => summary(source)),
        registered: permission.registered,
        available: permission.available, manual: permission.manualPending, prepared: false,
        relationStatus: capability.relation ? 'approved' : 'unapproved',
      });
    }
    return { mode: 'smart', items: items.slice(0, args.limit ?? 10), total: items.length, source: 'raw-definition-index', discoveryOnly: true };
  }

  function parseIntent(agent, capabilityId, view, value) {
    if (value === undefined) return undefined;
    const parsed = intentSchema.safeParse(value);
    if (!parsed.success || parsed.data.sessionId !== agent.id || parsed.data.accountRef !== scope.accountRef || parsed.data.groupId !== scope.groupId) throw sourceError('INVALID_TRUSTED_SOURCE_INTENT');
    const intent = parsed.data;
    if (intent.capabilityId !== capabilityId) return undefined;
    if (intent.expiresAt <= clock()) throw sourceError('TRUSTED_SOURCE_INTENT_EXPIRED');
    for (const requested of intent.sources) {
      const source = view.sources.get(requested.sourceId);
      if (!source || requested.definitionFingerprint !== source.definitionFingerprint) throw sourceError('EXPLICIT_SOURCE_DEFINITION_CHANGED');
    }
    return intent;
  }

  async function trustedIntent(agent, capabilityId, view) {
    return parseIntent(agent, capabilityId, view, await getUserSourceIntent(agent));
  }

  function selectionArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).some((key) => key !== 'capabilityId') || typeof args.capabilityId !== 'string') throw sourceError('INVALID_SOURCE_SELECTION');
  }

  async function select(agent, args = {}) {
    selectionArgs(args);
    const view = await current(agent);
    const intent = view.status === 'smart' && view.capabilities.has(args.capabilityId)
      ? await trustedIntent(agent, args.capabilityId, view) : undefined;
    return choose(agent, args, view, intent);
  }

  function choose(agent, args, view, intent) {
    const blocked = (reason) => ({ status: 'blocked', capabilityId: args.capabilityId, reason, selected: [] });
    if (view.status !== 'smart') return { status: view.status, selected: [] };
    if (view.inactive.has(args.capabilityId)) return blocked(view.inactive.get(args.capabilityId));
    const capability = view.capabilities.get(args.capabilityId);
    if (!capability) return blocked('CAPABILITY_UNAVAILABLE');
    if (sourceDecisionHash(mode(agent)) !== sourceDecisionHash(view.snapshot)) throw sourceError('SOURCE_MODE_CHANGED');
    if (capability.relation && clock() >= capability.relation.expiresAt) return blocked('RELATION_EXPIRED');
    for (const member of capability.members) view.permissions.set(member.sourceId, permissionFor(agent, member.source));
    const failed = memory(agent).failures.get(capability.id);
    if (failed && (!intent || intent.evidenceHash === failed.evidenceHash)) return { ...blocked('SOURCE_SWITCH_REQUIRES_CONFIRMATION'),
      alternatives: ranked(agent, view, capability).map(({ source }) => summary(source)) };
    let chosen;
    if (intent) {
      chosen = intent.sources.map((request) => capability.members.find((member) => member.sourceId === request.sourceId));
      if (chosen.some((member) => !member || !view.permissions.get(member.sourceId).available)) return blocked('EXPLICIT_SOURCE_DENIED');
    } else {
      const canonical = ranked(agent, view, capability)[0];
      if (!canonical) return blocked(capability.members.every((member) => !view.permissions.get(member.sourceId).registered)
        ? 'HOST_TOOL_NOT_REGISTERED' : capability.members.some((member) => view.permissions.get(member.sourceId).manualPending)
          ? 'MANUAL_ACTIVATION_REQUIRED' : 'NO_EFFECTIVE_SOURCE');
      chosen = [canonical];
    }
    const selected = chosen.map(({ source }) => summary(source));
    const receipt = intent?.evidenceHash ?? null;
    return { status: 'selected', capabilityId: capability.id, selected,
      aliases: ranked(agent, view, capability, false).filter((member) => !chosen.includes(member)).map(({ source }) => summary(source)),
      budgetException: intent?.kind === 'compare', relationRevision: capability.relation?.revision ?? null,
      decisionFingerprint: sourceDecisionHash({ stamp: view.stamp, selected, receipt }),
    };
  }

  async function validateSelection(agent, plan) {
    if (plan?.status !== 'selected') return false;
    const fresh = await select(agent, { capabilityId: plan.capabilityId });
    return sameSelection(fresh, plan);
  }

  function sameSelection(fresh, plan) {
    return fresh.status === 'selected' && fresh.decisionFingerprint === plan.decisionFingerprint
      && sourceDecisionHash(fresh.selected) === sourceDecisionHash(plan.selected)
      && fresh.budgetException === plan.budgetException && fresh.relationRevision === plan.relationRevision;
  }

  function sync(value) {
    if (value?.then) {
      Promise.resolve(value).catch(() => {});
      throw sourceError('ASYNC_SOURCE_COMMIT_STATE');
    }
    return value;
  }

  // Commit/dispatch fence: no await between current published state and the
  // caller's in-memory commit. Async-only adapters fail closed on this path.
  function selectNow(agent, args = {}) {
    selectionArgs(args);
    return selectManyNow(agent, [args.capabilityId])[0];
  }

  function selectManyNow(agent, capabilityIds) {
    if (!Array.isArray(capabilityIds) || capabilityIds.length > 32
        || capabilityIds.some((id) => typeof id !== 'string')) throw sourceError('INVALID_SOURCE_SELECTION');
    if (!enabled || disposed) return capabilityIds.map(() => ({ status: 'disabled', selected: [] }));
    const snapshot = mode(agent);
    if (snapshot.mode !== 'smart') return capabilityIds.map(() => ({ status: 'compat', selected: [] }));
    const view = buildView(agent, snapshot, sync(getRawSources(agent)), sync(getRelations(scope.accountRef, scope.groupId)));
    const receipt = sync(getUserSourceIntent(agent));
    return capabilityIds.map((capabilityId) => choose(agent, { capabilityId }, view,
      view.capabilities.has(capabilityId) ? parseIntent(agent, capabilityId, view, receipt) : undefined));
  }

  function validateSelectionNow(agent, plan) {
    return plan?.status === 'selected' && sameSelection(selectNow(agent, { capabilityId: plan.capabilityId }), plan);
  }

  async function recordSuccessfulUse(agent, sourceId) {
    const view = await current(agent);
    if (view.status !== 'smart' || !view.permissions.get(sourceId)?.available) return false;
    const capability = [...view.capabilities.values()].find((entry) => entry.members.some((member) => member.sourceId === sourceId));
    if (!capability) return false;
    const state = memory(agent);
    state.successful.set(capability.id, sourceId);
    const failed = state.failures.get(capability.id);
    if (failed) {
      // A concurrent comparison can finish successfully after a peer failed.
      // That result is usage evidence, not new permission to retry or switch.
      try {
        const intent = await trustedIntent(agent, capability.id, view);
        if (sessions.get(agent) === state && state.failures.get(capability.id) === failed
            && intent && intent.evidenceHash !== failed.evidenceHash
            && intent.sources.some((source) => source.sourceId === sourceId)) state.failures.delete(capability.id);
      } catch {} // Expired/missing receipts leave the failure latch intact.
    }
    return true;
  }

  async function recordFailure(agent, capabilityId, sourceId) {
    const view = await current(agent);
    if (view.status !== 'smart' || !view.capabilities.get(capabilityId)?.members.some((member) => member.sourceId === sourceId)) return false;
    const state = memory(agent);
    // A result can fail after its original receipt has expired. Failure must
    // still latch instead of accidentally enabling automatic source switching.
    let evidenceHash = null;
    try {
      const parsed = intentSchema.safeParse(await getUserSourceIntent(agent));
      if (parsed.success && parsed.data.sessionId === agent.id && parsed.data.accountRef === scope.accountRef
          && parsed.data.groupId === scope.groupId && parsed.data.capabilityId === capabilityId) evidenceHash = parsed.data.evidenceHash;
    } catch {}
    if (sessions.get(agent) !== state || disposed) return false;
    state.failures.set(capabilityId, { sourceId, evidenceHash });
    return true;
  }

  function mount(agentCtx) {
    if (!enabled || disposed) return () => {};
    if (stopDisposed) throw sourceError('SOURCE_SELECTOR_ALREADY_MOUNTED');
    stopDisposed = agentCtx.on('agent/disposed', ({ agent }) => sessions.delete(agent));
    return dispose;
  }

  function dispose() { disposed = true; stopDisposed?.(); stopDisposed = undefined; sessions.clear(); }
  return { search, select, selectNow, selectManyNow, validateSelection, validateSelectionNow, recordSuccessfulUse, recordFailure, mount, dispose,
    async candidates(agent) { const view = await current(agent); return view.status === 'smart' ? identifySourceCandidates(view.sources) : []; } };
}
