import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { SmartModeStore } from './smart-mode-store.js';
import { createSmartModeLifecycleAdapter, SMART_MODE_HOST_CONTRACT } from './smart-mode-lifecycle.js';
import { createSmartModeRestrictionController, normalizeSmartEnterpriseScope, SMART_RESTRICTION_HOST_CONTRACT } from './smart-mode-restrictions.js';
import { createSourceSelector } from './source-selection.js';
import { canonicalSourceJson, indexRawToolSources, normalizeSourceRelation, sourceError } from './source-relations.js';
import { createSmartModePrepareController, normalizeReadOnlyReview } from './smart-mode-prepare.js';
import { SMART_RESOURCE_HOST_CONTRACT } from './smart-mode-resources.js';
import { createSmartEnterpriseRecordView } from './smart-mode-bindings.js';

export const SMART_INTEGRATION_HOST_CONTRACT = 'dsh-smart-native-profile-v1';
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const copy = (value) => freeze(JSON.parse(canonicalSourceJson(value)));
const sync = (value) => {
  if (value?.then) { Promise.resolve(value).catch(() => {}); throw sourceError('ASYNC_INTEGRATION_VIEW'); }
  return value;
};

/** Explicit-profile opt-in composition. Production apply() never calls this. */
export async function createSmartModeIntegration(ctx, {
  enabled = false, hostContract, profileDir, getHostProfileDir, scope: inputScope,
  getRecords, getConnectorDescriptors, isRecordUsable, isRecordVisible, isToolAllowed, isManuallyActive,
  classifyInput, isNativeExecutor, projectToolSchema, getUserSourceIntent = () => undefined,
  initialViews = { rawSources: [], readOnlyReviews: [] }, policyVersion = 'smart-enterprise-v1',
  resources: resourcePolicy = {}, now = () => Date.now(), storeOptions = {}, onBlocked, t,
} = {}) {
  if (!enabled) return { mount: async () => () => {}, dispose: async () => {}, status: () => ({ enabled: false }) };
  if (hostContract !== SMART_INTEGRATION_HOST_CONTRACT) throw sourceError('UNVERIFIED_INTEGRATION_HOST');
  if (typeof profileDir !== 'string' || !isAbsolute(profileDir)) throw sourceError('EXPLICIT_PROFILE_REQUIRED');
  for (const callback of [getHostProfileDir, getRecords, isRecordUsable, isRecordVisible, isToolAllowed,
    classifyInput, isNativeExecutor, projectToolSchema, getUserSourceIntent]) {
    if (typeof callback !== 'function') throw sourceError('MISSING_INTEGRATION_CALLBACK');
  }
  const scope = normalizeSmartEnterpriseScope(inputScope);
  const selected = sync(getHostProfileDir());
  if (typeof selected !== 'string' || !isAbsolute(selected)
      || await realpath(resolve(selected)) !== await realpath(resolve(profileDir))) throw sourceError('INTEGRATION_PROFILE_MISMATCH');
  const expectedProfile = resolve(selected);
  if (!policyVersion || typeof policyVersion !== 'string') throw sourceError('INVALID_INTEGRATION_POLICY_VERSION');
  const recordView = createSmartEnterpriseRecordView({ scope, getRecords, getConnectorDescriptors });
  const store = await SmartModeStore.open({ ...storeOptions, profileDir });
  let views = { revision: 0, rows: [], reviews: [], registrations: new Map(), index: new Map() };
  let relations = [], controlError, viewError, controlTicket = 0, mounted = false, closed = false;
  let lifecycle, restrictions, selector, prepare, stopOutcomes, outcomeError;

  function profile() {
    const current = sync(getHostProfileDir());
    if (closed || typeof current !== 'string' || !isAbsolute(current) || resolve(current) !== expectedProfile) throw sourceError('INTEGRATION_PROFILE_CHANGED');
  }
  function published() {
    profile();
    if (controlError) throw sourceError(controlError);
    if (viewError) throw sourceError(viewError);
    if (outcomeError) throw sourceError(outcomeError);
    for (const [name, definition] of views.registrations) {
      if (ctx.tools.get(name) !== definition) throw sourceError('RAW_VIEW_STALE');
    }
    return views;
  }

  // Trusted discovery/maintenance API, never a model-visible action. Full raw
  // tools/list definitions must be supplied before any sanitizing/cache step.
  function publishViews(input, { expectedRevision } = {}) {
    profile();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision === Number.MAX_SAFE_INTEGER || expectedRevision !== views.revision) throw sourceError('VIEW_REVISION_CONFLICT');
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => !['rawSources', 'readOnlyReviews'].includes(key))) throw sourceError('INVALID_PUBLISHED_VIEW');
    const rows = input.rawSources === undefined ? views.rows : copy(input.rawSources);
    if (!Array.isArray(rows)) throw sourceError('INVALID_PUBLISHED_VIEW');
    const index = indexRawToolSources(scope, rows);
    if (input.readOnlyReviews !== undefined && !Array.isArray(input.readOnlyReviews)) throw sourceError('INVALID_PUBLISHED_REVIEWS');
    const reviews = input.readOnlyReviews === undefined ? views.reviews : copy(input.readOnlyReviews.map(normalizeReadOnlyReview));
    if (!Array.isArray(reviews) || reviews.some((review) => review.accountRef !== scope.accountRef || review.groupId !== scope.groupId)
        || new Set(reviews.map((review) => `${review.sourceId}:${review.definitionFingerprint}`)).size !== reviews.length) throw sourceError('INVALID_PUBLISHED_REVIEWS');
    const registrations = input.rawSources === undefined ? views.registrations : new Map();
    if (input.rawSources !== undefined) for (const source of index.values()) {
      const definition = ctx.tools.get(source.publicName);
      if (!definition) throw sourceError('RAW_SOURCE_NOT_REGISTERED');
      registrations.set(source.publicName, definition);
    }
    // Review-only maintenance must not acknowledge a failed raw refresh.
    if (viewError && input.rawSources === undefined) throw sourceError(viewError);
    views = { revision: views.revision + 1, rows, reviews, registrations, index };
    viewError = undefined;
    restrictions?.refresh();
    return { revision: views.revision, sourceCount: index.size, reviewCount: reviews.length };
  }

  function invalidateViews({ expectedRevision } = {}) {
    profile();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision === Number.MAX_SAFE_INTEGER
        || expectedRevision !== views.revision) throw sourceError('VIEW_REVISION_CONFLICT');
    views = { ...views, revision: views.revision + 1 };
    viewError = 'RAW_DISCOVERY_UNAVAILABLE';
    restrictions?.refresh();
    return { revision: views.revision };
  }

  async function refreshControl() {
    profile();
    const ticket = ++controlTicket;
    try {
      const [, documents] = await Promise.all([store.refreshDefaultPolicy(scope.accountRef, scope.groupId),
        store.listSourceRelations(scope.accountRef, scope.groupId)]);
      const normalized = documents.map(normalizeSourceRelation);
      if (closed || ticket !== controlTicket) return false;
      relations = freeze(normalized); controlError = undefined;
      restrictions?.refresh(); return true;
    } catch (error) {
      if (!closed && ticket === controlTicket) {
        controlError = error.code ?? 'CONTROL_REFRESH_FAILED'; relations = []; restrictions?.refresh();
      }
      throw error;
    }
  }

  function selectDefault(agent) {
    profile();
    if (controlError) throw sourceError(controlError);
    const policy = store.selectDefault(scope.accountRef, scope.groupId);
    if (policy?.mode === 'smart' && (!Number.isSafeInteger(policy.enabledAt)
        || !Number.isSafeInteger(agent.session?.header?.createdAt) || agent.session.header.createdAt < policy.enabledAt)) return undefined;
    return policy;
  }

  try {
    publishViews(initialViews, { expectedRevision: 0 });
    await refreshControl();
    restrictions = createSmartModeRestrictionController(ctx, {
      enabled: true, hostContract: SMART_RESTRICTION_HOST_CONTRACT, scope,
      getRecords, recordView, isRecordUsable, isRecordVisible, isToolAllowed, isManuallyActive, onBlocked, t,
      getPreparedNames: (agent) => prepare?.getPreparedNames(agent) ?? [],
      sourceSearch: (agent, args) => selector.search(agent, args),
      prepareTools: (agent, args, exec) => prepare.prepare(agent, args, exec),
      releaseTools: (agent, args, exec) => prepare.release(agent, args, exec),
      assertPreparedReady: (agent) => { published(); prepare?.assertResourceReady(agent); },
      getResourceStatus: (agent) => prepare.resourceStatus(agent),
    });
    selector = createSourceSelector({ enabled: true, scope, now,
      getSessionSnapshot: restrictions.sessionSnapshot, inspectSource: restrictions.inspectSource,
      getRawSources: () => published().rows, getRelations: () => { published(); return relations; },
      getUserSourceIntent,
    });
    prepare = createSmartModePrepareController({ enabled: true, scope, now, restrictions, selector,
      getReadOnlyReviews: () => published().reviews,
      resources: { ...resourcePolicy, enabled: true, hostContract: SMART_RESOURCE_HOST_CONTRACT },
      isNativeExecutor,
      getBudgetSchemas: (agent, names) => names.map((name) => {
        const definition = agent.ctx.tools.get(name, agent) ?? ctx.tools.get(name);
        if (!definition) throw sourceError('BUDGET_DEFINITION_MISSING');
        return copy(sync(projectToolSchema(definition)));
      }),
    });
    lifecycle = createSmartModeLifecycleAdapter({ enabled: true, hostContract: SMART_MODE_HOST_CONTRACT,
      readSnapshot: (id) => store.readSnapshot(id), writeSnapshot: (value) => store.writeSnapshot(value),
      ...restrictions.lifecycleBindings(), classifyInput, selectDefault, onBlocked,
    });
  } catch (error) { await store.close(); throw error; }

  function assertCanDispose() {
    lifecycle.assertCanDispose(); prepare.assertCanDispose();
    if (ctx.agents.list().some((agent) => agent.status !== 'idle')) throw sourceError('INTEGRATION_REQUIRES_IDLE_AGENTS');
  }
  async function dispose() {
    if (closed) return;
    assertCanDispose(); // Preflight every participant before releasing any mask.
    lifecycle.dispose(); prepare.dispose(); stopOutcomes?.(); selector.dispose(); restrictions.dispose();
    closed = true; mounted = false; controlTicket++;
    await store.close();
  }
  async function mount() {
    profile();
    if (mounted) throw sourceError('INTEGRATION_ALREADY_MOUNTED');
    if (ctx.agents.list().some((agent) => agent.status !== 'idle')) throw sourceError('INTEGRATION_REQUIRES_IDLE_AGENTS');
    try {
      restrictions.mount(ctx); selector.mount(ctx); prepare.mount(ctx);
      stopOutcomes = ctx.on('tools/result', (exec, result) => {
        if (exec.signal?.aborted) return; // Cancellation is not evidence of a broken source.
        if (restrictions.sessionSnapshot(exec.agent)?.mode !== 'smart' || !prepare.getPreparedNames(exec.agent).includes(exec.name)) return;
        try {
          const source = [...published().index.values()].find((entry) => entry.publicName === exec.name);
          if (source) selector.recordOutcomeNow(exec.agent, { sourceId: source.sourceId,
            success: result.isError === false && !exec.signal?.aborted });
          restrictions.refresh();
        } catch (error) {
          outcomeError = error.code ?? 'SOURCE_OUTCOME_FAILED'; restrictions.refresh();
          try { onBlocked?.({ sessionId: exec.agent.id, code: outcomeError }); } catch {}
        }
      });
      if (typeof stopOutcomes !== 'function') throw sourceError('EVENT_DISPOSER_REQUIRED');
      await lifecycle.mount(ctx); mounted = true;
      return dispose;
    } catch (error) { await Promise.resolve(); await dispose(); throw error; }
  }

  return {
    mount, dispose, assertCanDispose, publishViews, invalidateViews, refreshControl, recordView,
    status(agent) { return { enabled: !closed, mounted, viewRevision: views.revision, viewError,
      lifecycle: lifecycle.status(agent), restriction: restrictions.status(agent), resources: prepare.resourceStatus(agent) }; },
    readSnapshot: (id) => store.readSnapshot(id),
    retry: (agent) => lifecycle.retry(agent),
    candidates: (agent) => selector.candidates(agent),
    async setDefaultMode({ mode, expectedRevision } = {}) {
      profile();
      if (!['smart', 'compat'].includes(mode)) throw sourceError('INVALID_INTEGRATION_MODE');
      const enabledAt = now();
      if (!Number.isSafeInteger(enabledAt) || enabledAt < 0) throw sourceError('INVALID_INTEGRATION_CLOCK');
      const policy = await store.setDefaultPolicy({ mode, accountRef: scope.accountRef, groupId: scope.groupId,
        policyVersion, ...(mode === 'smart' ? { enabledAt } : {}) }, { expectedRevision });
      await refreshControl(); return policy;
    },
    prepare: (agent, args, exec) => prepare.prepare(agent, args, exec),
    release: (agent, args, exec) => prepare.release(agent, args, exec),
    collect: (agent) => prepare.collect(agent),
  };
}
