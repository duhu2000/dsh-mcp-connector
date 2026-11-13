import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { SmartModeStore } from './smart-mode-store.js';
import { normalizeSmartEnterpriseScope } from './smart-mode-bindings.js';
import { sourceDecisionHash, sourceError } from './source-relations.js';
import { createTranslator } from './i18n/index.js';
import { EN_DICTIONARY } from './i18n/locales/en.js';

const ref = z.string().min(1).max(512), hash = z.string().regex(/^[a-f0-9]{64}$/);
const session = z.strictObject({ sessionId: ref });
const schemas = {
  state: z.strictObject({}), search: session.extend({ query: ref }), inspect: session.extend({ sourceId: hash }),
  previewMode: z.strictObject({ mode: z.enum(['smart', 'compat']), expectedRevision: z.number().int().nonnegative() }),
  previewSource: session.extend({ capabilityId: ref, kind: z.enum(['source', 'compare']), sourceIds: z.array(hash).min(1).max(8) }),
  previewReview: session.extend({ sourceId: hash, evidenceHash: hash, enabled: z.boolean(),
    validForMs: z.number().int().min(60000).max(30 * 86400000), expectedRevision: z.number().int().nonnegative() }),
  commit: z.strictObject({ previewId: ref }), create: z.strictObject({}), resume: session,
  clear: session, compact: session, layer: z.strictObject({ enabled: z.boolean() }),
};
const permission = (method) => ['state', 'search', 'inspect', 'commit'].includes(method) ? 'read'
  : method === 'previewReview' ? 'review' : 'manage';

/** Human control plane only. No model tools, credentials, remote business calls
 * or source-equivalence approvals. Principal comes from the Host HTTP adapter.
 */
export async function createSmartModeControl({ enabled = false, profileDir, scope: inputScope,
  getIntegration, getAgents, sessionActions = {}, setLayerEnabled,
  verifyReadOnlyReview = async () => false, now = () => Date.now(), storeOptions = {}, locale,
  t = createTranslator(locale, { en: EN_DICTIONARY }),
} = {}) {
  if (!enabled) return { dispatch: async () => { throw sourceError('CONTROL_DISABLED'); }, close: async () => {} };
  const scope = normalizeSmartEnterpriseScope(inputScope);
  if ([getIntegration, getAgents, setLayerEnabled, verifyReadOnlyReview].some((fn) => typeof fn !== 'function')) throw sourceError('MISSING_CONTROL_CALLBACK');
  const integrationProfile = getIntegration()?.profileDir;
  if (!integrationProfile || await realpath(profileDir) !== await realpath(integrationProfile)) throw sourceError('CONTROL_PROFILE_MISMATCH');
  let reviewer, closed = false, tail = Promise.resolve();
  const previews = new Map();
  const store = await SmartModeStore.open({ ...storeOptions, profileDir,
    approveReadOnlyReview: (review) => reviewer ? verifyReadOnlyReview(review, reviewer) : false });
  function authorize(principal, action) {
    if (getIntegration()?.profileDir !== integrationProfile) throw sourceError('CONTROL_PROFILE_CHANGED');
    if (closed || !principal?.id || principal.accountRef !== scope.accountRef || principal.groupId !== scope.groupId
        || !Array.isArray(principal.permissions) || !principal.permissions.includes(action)) throw sourceError('CONTROL_FORBIDDEN');
  }
  function integration() {
    const value = getIntegration();
    if (!value?.status().mounted) throw sourceError('CONTROL_LAYER_DISABLED');
    return value;
  }
  function agentFor(id) {
    const matches = getAgents().filter((agent) => agent.id === id && agent.session?.id === id);
    if (matches.length !== 1) throw sourceError('CONTROL_AGENT_NOT_FOUND');
    const snapshot = integration().sessionSnapshot(matches[0]);
    if (!snapshot || (snapshot.mode === 'smart' && (snapshot.accountRef !== scope.accountRef || snapshot.groupId !== scope.groupId))) throw sourceError('CONTROL_SESSION_SCOPE_MISMATCH');
    return matches[0];
  }
  function idle(agent) {
    const state = integration().status(agent);
    if (agent.status !== 'idle' || state.resources.inFlight || state.resources.activeSteps) throw sourceError('CONTROL_REQUIRES_IDLE_AGENT');
  }
  function stage(principal, kind, data, summary) {
    for (const [id, entry] of previews) if (entry.expiresAt <= now()) previews.delete(id);
    if (previews.size >= 128) throw sourceError('CONTROL_PREVIEW_LIMIT');
    const previewId = randomUUID();
    previews.set(previewId, { principalId: principal.id, kind, data, expiresAt: now() + 60000 });
    return { previewId, kind, summary, expiresAt: now() + 60000 };
  }
  async function state() {
    const policy = await store.refreshDefaultPolicy(scope.accountRef, scope.groupId);
    const current = getIntegration(), mounted = current?.status().mounted === true;
    const sessions = [];
    for (const entry of await sessionActions.list?.() ?? getAgents().map((agent) => ({ sessionId: agent.id }))) {
      const agent = getAgents().find((value) => value.id === entry.sessionId);
      const snapshot = await store.readSnapshot(entry.sessionId);
      if (snapshot?.mode === 'smart' && (snapshot.accountRef !== scope.accountRef || snapshot.groupId !== scope.groupId)) continue;
      sessions.push({ sessionId: entry.sessionId, title: String(entry.title ?? entry.sessionId), active: Boolean(agent),
        mode: snapshot?.mode ?? 'pending', preparedCount: agent && mounted ? current.status(agent).restriction.preparedCount ?? 0 : 0 });
    }
    return { mounted, defaultMode: policy?.mode ?? 'compat', policyRevision: policy?.revision ?? 0,
      scopeLabel: t('企查查企业数据 · 六个服务'), sessions };
  }
  async function execute(method, args, principal) {
    if (method === 'state') return state();
    if (method === 'search') return integration().searchSources(agentFor(args.sessionId), { query: args.query, limit: 100 });
    if (method === 'inspect') {
      const value = integration().inspectSource(agentFor(args.sessionId), args.sourceId);
      const saved = await store.readReadOnlyReview(scope.accountRef, scope.groupId, args.sourceId, value.source.definitionFingerprint);
      return { ...value, persistedReview: saved ?? null };
    }
    if (method === 'previewMode') return stage(principal, 'mode', args,
      { mode: args.mode, scope: t('当前账号企业数据六个服务，仅影响新会话'), expectedRevision: args.expectedRevision });
    if (method === 'previewSource') {
      const agent = agentFor(args.sessionId), current = integration(); idle(agent);
      const sources = args.sourceIds.map((id) => current.inspectSource(agent, id).source);
      const intent = { sessionId: agent.id, accountRef: scope.accountRef, groupId: scope.groupId,
        capabilityId: args.capabilityId, kind: args.kind,
        sources: sources.map(({ sourceId, definitionFingerprint }) => ({ sourceId, definitionFingerprint })),
        evidenceHash: sourceDecisionHash({ principal: principal.id, nonce: randomUUID(), sessionId: agent.id, at: now() }), expiresAt: now() + 600000 };
      await current.validateSourceIntent(agent, intent);
      return stage(principal, 'source', { agent, intent, current }, { sessionId: agent.id, sources: sources.map((source) => source.publicName) });
    }
    if (method === 'previewReview') {
      const agent = agentFor(args.sessionId), current = integration(), value = current.inspectSource(agent, args.sourceId);
      const review = { version: 1, accountRef: scope.accountRef, groupId: scope.groupId, sourceId: args.sourceId,
        definitionFingerprint: value.source.definitionFingerprint, enabled: args.enabled,
        validFrom: now(), expiresAt: now() + args.validForMs,
        review: { effect: 'read-only', evidenceHash: args.evidenceHash, reviewedAt: now(),
          reviewerHash: sourceDecisionHash([principal.id, scope.accountRef, scope.groupId]) } };
      return stage(principal, 'review', { agent, current, value, review, expectedRevision: args.expectedRevision },
        { publicName: value.source.publicName, definitionFingerprint: review.definitionFingerprint, enabled: review.enabled });
    }
    if (method === 'commit') {
      const entry = previews.get(args.previewId);
      if (!entry || entry.principalId !== principal.id || entry.expiresAt <= now()) throw sourceError('CONTROL_PREVIEW_EXPIRED');
      authorize(principal, entry.kind === 'review' ? 'review' : 'manage');
      previews.delete(args.previewId); // Single use, including unsuccessful commits.
      const data = entry.data;
      if (entry.kind === 'mode') {
        const saved = await store.setDefaultPolicy({ accountRef: scope.accountRef, groupId: scope.groupId,
          mode: data.mode, policyVersion: 'smart-enterprise-v1', ...(data.mode === 'smart' ? { enabledAt: now() } : {}) }, { expectedRevision: data.expectedRevision });
        if (getIntegration()?.status().mounted) await getIntegration().refreshControl();
        return { revision: saved.revision, mode: saved.mode };
      }
      if (agentFor(data.agent.id) !== data.agent || integration() !== data.current) throw sourceError('CONTROL_PREVIEW_STALE');
      if (entry.kind === 'source') {
        idle(data.agent);
        await data.current.publishSourceIntent(data.agent, data.intent);
        return { sessionId: data.agent.id, selected: data.intent.sources.map((source) => source.sourceId) };
      }
      const live = data.current.inspectSource(data.agent, data.review.sourceId);
      if (data.review.enabled) idle(data.agent); // Revocation must also work while an Agent is busy.
      if (live.source.definitionFingerprint !== data.review.definitionFingerprint || live.viewRevision !== data.value.viewRevision) throw sourceError('CONTROL_PREVIEW_STALE');
      reviewer = principal;
      try {
        const saved = await store.setReadOnlyReview(data.review, { expectedRevision: data.expectedRevision });
        await data.current.refreshControl(); return saved;
      } finally { reviewer = undefined; }
    }
    if (method === 'layer') {
      if (typeof setLayerEnabled !== 'function') throw sourceError('CONTROL_LAYER_UNAVAILABLE');
      if (!args.enabled && getIntegration()?.status().mounted) getIntegration().assertCanDispose();
      await setLayerEnabled(args.enabled); previews.clear(); return state();
    }
    const callback = sessionActions[method];
    if (typeof callback !== 'function') throw sourceError('CONTROL_SESSION_ACTION_UNAVAILABLE');
    if (['create', 'resume'].includes(method)) {
      if (method === 'resume') {
        const snapshot = await store.readSnapshot(args.sessionId);
        if (snapshot?.mode === 'smart' && (snapshot.accountRef !== scope.accountRef || snapshot.groupId !== scope.groupId)) throw sourceError('CONTROL_SESSION_SCOPE_MISMATCH');
      }
      previews.clear(); return callback(args);
    }
    const agent = agentFor(args.sessionId); idle(agent);
    if (method === 'clear') await integration().clearSessionLoading(agent);
    const result = await callback(agent); previews.clear(); return result;
  }
  return {
    async dispatch(method, input, principal) {
      if (!Object.hasOwn(schemas, method)) throw sourceError('CONTROL_UNKNOWN_METHOD');
      const parsed = schemas[method].safeParse(input);
      if (!parsed.success) throw sourceError('CONTROL_INVALID_ARGUMENTS');
      authorize(principal, permission(method));
      if (['state', 'search', 'inspect'].includes(method)) return execute(method, parsed.data, principal);
      const operation = tail.then(() => { authorize(principal, permission(method)); return execute(method, parsed.data, principal); });
      tail = operation.catch(() => {}); return operation;
    },
    async close() { closed = true; await tail; previews.clear(); await store.close(); },
  };
}

export const SMART_SESSION_CONTROL_HOST_CONTRACT = 'dsh-native-session-surface-v1';
/** Native surface clear + the installed human /compact command. No fake RPCs. */
export function createSmartSessionActions(ctx, { hostContract, createUserMessage, flush,
  list, create, resume, t = createTranslator() } = {}) {
  if (hostContract !== SMART_SESSION_CONTROL_HOST_CONTRACT || [createUserMessage, flush].some((fn) => typeof fn !== 'function')) throw sourceError('UNVERIFIED_SESSION_CONTROL_HOST');
  const idle = (agent) => { if (agent.status !== 'idle' || agent.id !== agent.session?.id) throw sourceError('CONTROL_REQUIRES_IDLE_AGENT'); };
  return { list, create, resume,
    async clear(agent) {
      idle(agent);
      const nodes = [...agent.session.surface.nodes];
      if (nodes.length && agent.session.eventAt(nodes[0]).type === 'system/message') nodes.shift();
      if (nodes.length) agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: t('上下文已清空。') }], source: { kind: 'runtime-context' },
      }), { surfaceOp: { op: 'replace', startSeq: nodes[0], endSeq: nodes.at(-1) }, sourceEventSeqs: nodes });
      await flush(); return { cleared: true, historyDeleted: false };
    },
    async compact(agent) {
      idle(agent);
      if (typeof ctx.commands?.execute !== 'function') throw sourceError('NATIVE_COMPACT_COMMAND_UNAVAILABLE');
      const result = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal);
      if (!result || result.result?.kind !== 'success') throw sourceError('NATIVE_COMPACT_FAILED');
      await flush(); return { compacted: result.result.sourceEventSeq !== undefined };
    },
  };
}
