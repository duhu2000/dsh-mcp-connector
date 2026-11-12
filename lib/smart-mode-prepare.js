import { z } from 'zod';
import { normalizeSmartEnterpriseScope } from './smart-mode-restrictions.js';
import { normalizeSmartModeSnapshot } from './smart-mode-schema.js';
import { sourceDecisionHash, sourceError } from './source-relations.js';
import { createPreparedResourceManager } from './smart-mode-resources.js';

const ref = z.string().min(1).max(512);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// Independent of equivalence approval, MCP annotations and name prefixes.
// Only a trusted, published review view may supply these records.
export const readOnlyReviewSchema = z.strictObject({
  version: z.literal(1), accountRef: ref, groupId: ref, sourceId: hash,
  definitionFingerprint: hash, enabled: z.boolean(), validFrom: time, expiresAt: time,
  review: z.strictObject({ effect: z.literal('read-only'), evidenceHash: hash, reviewedAt: time }),
}).refine((value) => value.expiresAt > value.validFrom, { message: 'Invalid review lifetime' });

export function normalizeReadOnlyReview(value) {
  const parsed = readOnlyReviewSchema.safeParse(value);
  if (!parsed.success) throw sourceError('INVALID_READ_ONLY_REVIEW');
  return parsed.data;
}

const argsSchema = z.strictObject({ capabilityIds: z.array(ref).min(1).max(8) })
  .refine((value) => new Set(value.capabilityIds).size === value.capabilityIds.length);
const equal = (a, b) => sourceDecisionHash(a) === sourceDecisionHash(b);
const binding = (source) => ({ sourceId: source.sourceId, publicName: source.publicName,
  definitionFingerprint: source.definitionFingerprint, connectionKey: source.connectionKey, serverName: source.serverName });

/** Opt-in, Agent-local preparation only. Never registers, approves or executes a business tool. */
export function createSmartModePrepareController({
  enabled = false, scope: inputScope, restrictions, selector, getReadOnlyReviews, now = () => Date.now(),
  resources: resourcePolicy, getBudgetSchemas, isNativeExecutor, timers,
} = {}) {
  const scope = enabled ? normalizeSmartEnterpriseScope(inputScope) : undefined;
  const states = new Map();
  const invalidEntries = new WeakSet();
  let disposed = false, stopDisposed;
  if (enabled && (['sessionSnapshot', 'assertReady', 'refresh', 'sourceRegistration', 'sourceVisible', 'restrictionError'].some((name) => typeof restrictions?.[name] !== 'function')
      || ['select', 'selectManyNow'].some((name) => typeof selector?.[name] !== 'function') || typeof getReadOnlyReviews !== 'function')) {
    throw sourceError('MISSING_PREPARE_CALLBACK');
  }
  const resources = enabled && resourcePolicy?.enabled === true ? createPreparedResourceManager({
    policy: resourcePolicy, scope, getBudgetSchemas, isNativeExecutor, now, states, timers,
    validEntries: liveEntries, publish, enqueue,
  }) : undefined;

  function clock() {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw sourceError('INVALID_PREPARE_CLOCK');
    return at;
  }

  function snapshot(agent) {
    if (!agent || typeof agent.id !== 'string' || agent.session?.id !== agent.id) throw sourceError('PREPARE_AGENT_REQUIRED');
    const original = restrictions.sessionSnapshot(agent);
    const value = normalizeSmartModeSnapshot(original, agent.id);
    if (value.mode !== 'smart') throw sourceError('PREPARE_REQUIRES_SMART_MODE');
    if (value.accountRef !== scope.accountRef || value.groupId !== scope.groupId) throw sourceError('PREPARE_SCOPE_MISMATCH');
    return original;
  }

  function reviews() {
    const rows = getReadOnlyReviews(scope.accountRef, scope.groupId);
    if (rows?.then) {
      Promise.resolve(rows).catch(() => {});
      throw sourceError('ASYNC_READ_ONLY_COMMIT_STATE');
    }
    if (!Array.isArray(rows)) throw sourceError('INVALID_READ_ONLY_VIEW');
    const index = new Map();
    for (const row of rows) {
      const value = normalizeReadOnlyReview(row);
      if (value.accountRef !== scope.accountRef || value.groupId !== scope.groupId) continue;
      const key = `${value.sourceId}:${value.definitionFingerprint}`;
      if (index.has(key)) throw sourceError('DUPLICATE_READ_ONLY_REVIEW');
      index.set(key, value);
    }
    return index;
  }

  function reviewFor(source, index) {
    const review = index.get(`${source.sourceId}:${source.definitionFingerprint}`), at = clock();
    if (!review || !review.enabled || at < review.validFrom || at >= review.expiresAt || review.review.reviewedAt > at) {
      throw sourceError('READ_ONLY_REVIEW_REQUIRED');
    }
    return review;
  }

  function liveEntries(agent, state) {
    if (snapshot(agent) !== state.snapshot) throw sourceError('PREPARE_SESSION_CHANGED');
    if (!state.entries.size) return new Map();
    const plans = [...new Map([...state.entries.values()].map((entry) => [entry.plan.capabilityId, entry.plan])).values()];
    const fresh = new Map(selector.selectManyNow(agent, plans.map((plan) => plan.capabilityId)).map((plan) => [plan.capabilityId, plan]));
    const index = reviews(), result = new Map();
    for (const [name, entry] of state.entries) {
      if (invalidEntries.has(entry)) continue;
      const plan = fresh.get(entry.plan.capabilityId);
      if (plan?.status !== 'selected' || plan.relationRevision !== entry.plan.relationRevision
          || restrictions.sourceRegistration(agent, entry.source) !== entry.registration
          || !plan.selected.some((source) => equal(binding(source), binding(entry.source)))) {
        invalidEntries.add(entry); continue;
      }
      try {
        if (equal(reviewFor(entry.source, index), entry.review)) result.set(name, entry);
        else invalidEntries.add(entry);
      } catch { invalidEntries.add(entry); }
    }
    return result;
  }

  function getPreparedNames(agent) {
    if (!enabled || disposed) return [];
    const state = states.get(agent);
    if (!state) return [];
    // Operational Host mask failures block dispatch separately. They are not
    // evidence that a previously valid review/permission was revoked.
    if (restrictions.restrictionError?.(agent)) return [];
    try {
      const entries = liveEntries(agent, state);
      return [...(resources ? resources.visible(state, entries) : entries).keys()];
    } catch {
      for (const entry of state.entries.values()) invalidEntries.add(entry);
      return [];
    }
  }

  function assertState(agent, state, signal) {
    if (signal?.aborted) throw sourceError('PREPARE_CANCELED');
    if (disposed || states.get(agent) !== state || snapshot(agent) !== state.snapshot) throw sourceError('PREPARE_SESSION_CHANGED');
  }

  async function commit(agent, state, args, signal) {
    assertState(agent, state, signal);
    resources?.checkAgent(agent, state);
    restrictions.refresh();
    restrictions.assertReady(agent, { resourceMaintenance: true });
    const plans = [];
    for (const capabilityId of args.capabilityIds) {
      const plan = await selector.select(agent, { capabilityId });
      assertState(agent, state, signal);
      if (plan.status !== 'selected') throw sourceError(plan.reason ?? 'PREPARE_SOURCE_UNAVAILABLE');
      plans.push(plan);
    }
    if (plans.reduce((sum, plan) => sum + plan.selected.length, 0) > 8) throw sourceError('PREPARE_BATCH_LIMIT');
    const reviewed = reviews();
    const additions = plans.flatMap((plan) => plan.selected.map((source) => ({ plan, source,
      registration: restrictions.sourceRegistration(agent, source), review: reviewFor(source, reviewed) })));
    // Everything below is synchronous. Published source/relation/intent/review
    // callbacks must be pure current-state reads; async-only views are rejected.
    const fresh = selector.selectManyNow(agent, args.capabilityIds);
    if (!equal(fresh, plans)) throw sourceError('PREPARE_SELECTION_CHANGED');
    const finalReviews = reviews();
    for (const entry of additions) {
      if (!equal(reviewFor(entry.source, finalReviews), entry.review)) throw sourceError('READ_ONLY_REVIEW_CHANGED');
      if (!entry.registration || restrictions.sourceRegistration(agent, entry.source) !== entry.registration) throw sourceError('PREPARE_REGISTRATION_CHANGED');
    }
    assertState(agent, state, signal);
    if (resources) restrictions.refresh();
    restrictions.assertReady(agent, { resourceMaintenance: true });
    const previous = state.entries;
    liveEntries(agent, state);
    // P1-05 keeps reservations; the opt-in resource planner can reclaim them
    // only after verifying that no active invocation/batch still references them.
    const next = new Map(previous);
    for (const plan of plans) {
      const prior = [...previous.values()].filter((entry) => entry.plan.capabilityId === plan.capabilityId);
      if (prior.some((entry) => !plan.selected.some((source) => source.sourceId === entry.source.sourceId))) {
        if (!resources) throw sourceError('PREPARED_SOURCE_CHANGE_REQUIRES_RELEASE');
        if (prior.some((entry) => resources.pinned(state, entry.source.publicName))) throw sourceError('RESOURCE_ENTRY_IN_FLIGHT');
        for (const entry of prior) next.delete(entry.source.publicName);
      }
    }
    for (const entry of additions) next.set(entry.source.publicName, resources
      ? resources.reuse(state, entry.source.publicName, entry, (old, fresh) => !invalidEntries.has(old)
        && old.plan.capabilityId === fresh.plan.capabilityId && old.plan.relationRevision === fresh.plan.relationRevision
        && old.registration === fresh.registration && equal(binding(old.source), binding(fresh.source)) && equal(old.review, fresh.review)) : entry);
    const draft = resources?.plan(agent, state, next, additions.map((entry) => entry.source.publicName));
    if (!resources && next.size > 32) throw sourceError('PREPARED_SET_LIMIT');
    const preparedCount = publish(agent, state, draft?.entries ?? next, additions, draft, signal);
    return { ok: true, message: 'SMART_PREPARE_READY', detail: {
      prepared: additions.map((entry) => entry.source.publicName), preparedCount,
      ...(draft ? { evicted: draft.evicted, estimatedTokens: draft.estimatedTokens } : {}),
      nextInferenceBoundary: true, businessExecuted: false,
    } };
  }

  function publish(agent, state, next, additions = [], draft, signal) {
    assertState(agent, state, signal);
    const previous = state.entries, previousRecords = state.resources?.records;
    state.entries = next;
    if (draft) state.resources.records = draft.records;
    let preparedCount;
    try {
      restrictions.refresh();
      if (restrictions.restrictionError(agent)) throw sourceError('PREPARE_RESTRICTION_FAILED');
      restrictions.assertReady(agent);
      assertState(agent, state, signal);
      const loaded = new Set(getPreparedNames(agent));
      preparedCount = loaded.size;
      if (additions.some((entry) => !loaded.has(entry.source.publicName)
          || !restrictions.sourceVisible(agent, entry.source, entry.registration))) throw sourceError('PREPARE_COMMIT_INVALIDATED');
      resources?.schedule(agent, state);
    } catch (cause) {
      state.entries = previous;
      if (draft) state.resources.records = previousRecords;
      // If Host refresh also fails during rollback, its existing mask is kept
      // and native guard/admission remain blocked. Never widen to all tools.
      restrictions.refresh();
      // Recovery from an operational error first clears the blocked state
      // using an empty prepared view. Reconcile once more with the restored,
      // independently revalidated prior entries; persistent failures stay blocked.
      if (!restrictions.restrictionError(agent)) restrictions.refresh();
      try { resources?.schedule(agent, state); } catch {} // Keep original failure; expiry guards remain active.
      throw cause;
    }
    return preparedCount;
  }

  function enqueue(agent, state, work) {
    const task = state.tail.then(() => { assertState(agent, state); return work(); });
    state.tail = task.catch(() => {});
    return task;
  }

  async function prepare(agent, args, execution = {}) {
    if (!enabled || disposed) return { ok: false, message: 'SMART_PREPARE_DISABLED' };
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) return { ok: false, message: 'INVALID_PREPARE_ARGUMENTS' };
    try {
      const current = snapshot(agent);
      if (!states.has(agent)) {
        const state = { snapshot: current, entries: new Map(), tail: Promise.resolve() };
        resources?.init(state); states.set(agent, state);
      }
      const state = states.get(agent);
      return await enqueue(agent, state, () => commit(agent, state, parsed.data, execution.signal));
    } catch (cause) {
      return { ok: false, message: cause.code ?? 'SMART_PREPARE_FAILED', detail: { businessExecuted: false } };
    }
  }

  function mount(agentCtx) {
    if (!enabled || disposed) return () => {};
    if (stopDisposed) throw sourceError('PREPARE_ALREADY_MOUNTED');
    try {
      resources?.mount(agentCtx);
      stopDisposed = agentCtx.on('agent/disposed', ({ agent }) => {
        const state = states.get(agent); if (state) resources?.forget(state);
        states.delete(agent);
      });
      if (typeof stopDisposed !== 'function') throw sourceError('EVENT_DISPOSER_REQUIRED');
    } catch (error) { resources?.dispose(); stopDisposed = undefined; throw error; }
    return dispose;
  }

  function dispose() {
    if ([...states.keys()].some((agent) => agent.status !== 'idle')) throw sourceError('PREPARE_DISPOSE_REQUIRES_IDLE_AGENT');
    resources?.dispose();
    disposed = true;
    states.clear(); stopDisposed?.(); stopDisposed = undefined;
    if (enabled) restrictions.refresh();
  }

  return { prepare, getPreparedNames, mount, dispose,
    assertResourceReady: (agent) => !disposed ? resources?.assertReady(agent) : undefined,
    resourceStatus: (agent) => !disposed && resources ? resources.status(agent) : { enabled: false },
    async release(agent, args, execution) {
      if (!resources || disposed) return { ok: false, message: 'SMART_RESOURCES_DISABLED' };
      try { snapshot(agent); return await resources.release(agent, args, execution); }
      catch (cause) { return { ok: false, message: cause.code ?? 'SMART_RELEASE_FAILED' }; }
    },
    async collect(agent) {
      if (!resources || disposed) return { ok: false, message: 'SMART_RESOURCES_DISABLED' };
      try { snapshot(agent); return await resources.collect(agent); }
      catch (cause) { return { ok: false, message: cause.code ?? 'SMART_COLLECTION_FAILED' }; }
    },
  };
}
