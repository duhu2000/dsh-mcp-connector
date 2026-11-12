import { z } from 'zod';
import { canonicalSourceJson, sourceError } from './source-relations.js';

export const SMART_RESOURCE_HOST_CONTRACT = 'dsh-native-token-result-step-v1';
const MANAGEMENT = ['mcp_connector_discover', 'mcp_connector_session_tools'];
const policySchema = z.strictObject({
  enabled: z.literal(true), hostContract: z.literal(SMART_RESOURCE_HOST_CONTRACT),
  maxTokens: z.number().int().min(1).max(5000).default(5000),
  ttlMs: z.number().int().min(1).max(86400000).default(600000),
  ttlMode: z.enum(['fixed', 'sliding']).default('sliding'),
  eviction: z.enum(['reject', 'lru']).default('lru'),
  maxPrepared: z.number().int().min(1).max(32).default(32),
});

/** Same canonical tools-array heuristic as DSH token-meter; not a tokenizer. */
export function estimateSmartToolTokens(tools) {
  if (!Array.isArray(tools)) throw sourceError('INVALID_BUDGET_SCHEMAS');
  canonicalSourceJson(tools); // Reject getters, toJSON and lossy/non-JSON values.
  return tools.length ? Math.ceil(JSON.stringify(tools).length / 4) + 4 : 0;
}

/** Internal coordinator. State publication and the queue belong to prepare. */
export function createPreparedResourceManager({
  policy: input, scope, getBudgetSchemas, isNativeExecutor, now, states, validEntries,
  publish, enqueue, timers = { setTimeout, clearTimeout },
}) {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw sourceError('INVALID_RESOURCE_POLICY');
  const policy = Object.freeze(parsed.data);
  if (typeof getBudgetSchemas !== 'function' || typeof isNativeExecutor !== 'function'
      || typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') throw sourceError('MISSING_RESOURCE_CALLBACK');
  let stops = [], mounted = false;

  function init(state) {
    state.resources ??= { records: new Map(), steps: new Map(), calls: new Map(), tokens: new Map(),
      lastClock: 0, lastSeq: -1, lastEvent: '', observing: false, error: null,
      maintenanceError: null, timer: undefined, queued: false };
    return state.resources;
  }

  function clock(state) {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw sourceError('INVALID_RESOURCE_CLOCK');
    const r = init(state);
    return r.lastClock = Math.max(r.lastClock, at);
  }

  function native(agent) {
    if (!mounted) throw sourceError('RESOURCE_NOT_MOUNTED');
    const answer = isNativeExecutor(agent);
    if (answer?.then) { Promise.resolve(answer).catch(() => {}); throw sourceError('ASYNC_RESOURCE_EXECUTOR'); }
    if (answer !== true) throw sourceError('UNVERIFIED_RESOURCE_EXECUTOR');
  }

  function pinned(state, name) {
    const r = init(state);
    return [...r.steps.values()].some((step) => step.pins.has(name))
      || [...r.tokens.values()].some((call) => call.name === name);
  }

  function visible(state, entries, records = init(state).records) {
    const at = clock(state);
    return new Map([...entries].filter(([name, entry]) => {
      const record = records.get(name);
      return record?.entry === entry && ((!record.pending && at < record.expiresAt) || pinned(state, name));
    }));
  }

  function budget(agent, names) {
    native(agent);
    const requested = [...new Set([...MANAGEMENT, ...names])];
    const tools = getBudgetSchemas(agent, requested);
    if (tools?.then) { Promise.resolve(tools).catch(() => {}); throw sourceError('ASYNC_BUDGET_SCHEMAS'); }
    const estimate = estimateSmartToolTokens(tools);
    if (tools.length !== requested.length
        || new Set(tools.map((tool) => tool?.name)).size !== requested.length
        || tools.some((tool) => !requested.includes(tool?.name)
          || Object.keys(tool).some((key) => !['name', 'description', 'parameters', 'deferLoading'].includes(key))
          || !Object.hasOwn(tool, 'parameters'))) throw sourceError('INVALID_BUDGET_SCHEMAS');
    return estimate;
  }

  function assertProtocol(state) {
    if (init(state).error) throw sourceError(state.resources.error);
  }

  function assertReady(agent) {
    const state = states.get(agent);
    if (state) assertProtocol(state);
    const names = state ? [...visible(state, validEntries(agent, state)).keys()] : [];
    if (budget(agent, names) > policy.maxTokens) throw sourceError('SMART_RESOURCE_BUDGET_EXCEEDED');
  }

  function plan(agent, state, proposed, added = [], recordView = init(state).records) {
    assertProtocol(state);
    native(agent);
    const at = clock(state), protectedNames = new Set(added);
    const entries = new Map(proposed), records = new Map(), evicted = [];
    const valid = validEntries(agent, { ...state, entries });
    for (const [name, entry] of entries) {
      const prior = recordView.get(name);
      if (prior?.entry !== entry && pinned(state, name)) throw sourceError('RESOURCE_ENTRY_IN_FLIGHT');
      const record = prior?.entry === entry ? prior
        : { entry, preparedAt: at, lastUsedAt: at, expiresAt: at + policy.ttlMs, pending: null };
      if (protectedNames.has(name) && record.pending === 'release') throw sourceError('RESOURCE_RELEASE_PENDING');
      if (!protectedNames.has(name) && !pinned(state, name)
          && (!valid.has(name) || record.pending || at >= record.expiresAt)) {
        entries.delete(name); evicted.push(name);
      } else records.set(name, record);
    }
    const cost = () => budget(agent, [...visible(state, new Map([...valid].filter(([name]) => entries.has(name))), records).keys()]);
    const base = budget(agent, []);
    if (base > policy.maxTokens) throw sourceError('SMART_RESOURCE_BASE_BUDGET');
    const victims = [...entries.keys()].filter((name) => !protectedNames.has(name) && !pinned(state, name))
      .sort((a, b) => records.get(a).lastUsedAt - records.get(b).lastUsedAt || a.localeCompare(b));
    let tokens = cost();
    while (tokens > policy.maxTokens || entries.size > policy.maxPrepared) {
      const name = policy.eviction === 'lru' ? victims.shift() : undefined;
      if (name === undefined) throw sourceError('SMART_RESOURCE_CAPACITY');
      entries.delete(name); records.delete(name); evicted.push(name); tokens = cost();
    }
    return { entries, records, evicted, estimatedTokens: tokens };
  }

  function reuse(state, name, entry, equalEntry) {
    const previous = state.entries.get(name), record = init(state).records.get(name);
    if (!previous) return entry;
    if (record?.pending === 'release') throw sourceError('RESOURCE_RELEASE_PENDING');
    if (equalEntry(previous, entry) && record?.entry === previous
        && (clock(state) < record.expiresAt || pinned(state, name))) return previous;
    if (pinned(state, name)) throw sourceError('RESOURCE_ENTRY_IN_FLIGHT');
    return entry;
  }

  function schedule(agent, state) {
    const r = init(state);
    if (r.timer !== undefined) timers.clearTimeout(r.timer);
    r.timer = undefined;
    if (states.get(agent) !== state || !mounted) return;
    const at = clock(state);
    const deadlines = [...r.records.values()].filter((record) => !record.pending && record.expiresAt > at).map((record) => record.expiresAt);
    if (!deadlines.length) return;
    try {
      r.timer = timers.setTimeout(() => { r.timer = undefined; requestCollect(agent, state); }, Math.min(...deadlines) - at);
    } catch { r.maintenanceError = 'RESOURCE_TIMER_FAILED'; throw sourceError('RESOURCE_TIMER_FAILED'); }
    r.timer?.unref?.();
  }

  function collect(agent) {
    const state = states.get(agent);
    if (!state) return Promise.resolve({ ok: true, message: 'SMART_RESOURCE_EMPTY' });
    return enqueue(agent, state, () => {
      const draft = plan(agent, state, state.entries);
      publish(agent, state, draft.entries, [], draft);
      state.resources.maintenanceError = null;
      return { ok: true, message: 'SMART_RESOURCE_COLLECTED', detail: { released: draft.evicted, businessExecuted: false } };
    });
  }

  function requestCollect(agent, state) {
    const r = init(state);
    if (r.queued || states.get(agent) !== state) return;
    r.queued = true;
    // Session observers cannot reenter publication. Queue and share prepare's
    // transaction tail; no detached mutation can overwrite a later prepare.
    queueMicrotask(() => {
      if (states.get(agent) !== state) return;
      collect(agent).then(() => { r.maintenanceError = null; }, (error) => {
        r.maintenanceError = error.code ?? 'RESOURCE_COLLECTION_FAILED';
      }).finally(() => {
        r.queued = false;
        try { schedule(agent, state); } catch {} // Reported; synchronous expiry/guards still apply.
      });
    });
  }

  async function release(agent, args, execution = {}) {
    const schema = z.strictObject({ publicNames: z.array(z.string().min(1)).min(1).max(32) })
      .refine((value) => new Set(value.publicNames).size === value.publicNames.length);
    const parsed = schema.safeParse(args);
    if (!parsed.success || parsed.data.publicNames.some((name) => !scope.connections.some((source) => name.startsWith(`mcp__${source.serverName}__`)))) {
      throw sourceError('INVALID_RESOURCE_RELEASE');
    }
    const state = states.get(agent);
    if (!state) { native(agent); return { ok: true, message: 'SMART_RESOURCE_EMPTY', detail: { released: [], pending: [] } }; }
    return enqueue(agent, state, () => {
      if (execution.signal?.aborted) throw sourceError('PREPARE_CANCELED');
      assertProtocol(state);
      const proposed = new Map(state.entries), records = new Map(init(state).records), released = [], pending = [];
      for (const name of parsed.data.publicNames) {
        if (!proposed.has(name)) continue;
        if (pinned(state, name)) {
          records.set(name, { ...records.get(name), pending: 'release' }); pending.push(name);
        } else { proposed.delete(name); records.delete(name); released.push(name); }
      }
      const draft = plan(agent, state, proposed, [], records);
      publish(agent, state, draft.entries, [], draft);
      return { ok: true, message: 'SMART_RESOURCE_RELEASED', detail: { released: [...new Set([...released, ...draft.evicted])], pending,
        nextInferenceBoundary: true, businessExecuted: false } };
    });
  }

  function fail(state, code) { init(state).error ??= code; }
  function observe(session, event) {
    const matches = [...states].filter(([agent]) => agent.id === session?.id);
    if (matches.length !== 1) {
      for (const [, state] of matches) fail(state, 'AMBIGUOUS_RESOURCE_SESSION');
      return;
    }
    const [agent, state] = matches[0], r = init(state), data = event?.data;
    if (!['step/start', 'assistant/message', 'step/end', 'turn/end', 'tool/call', 'tool/result'].includes(event?.type)) return;
    // First prepare can happen inside a step that began before this empty
    // state existed. Its new tools were not admitted to that old step.
    if (!r.observing && event.type !== 'step/start') return;
    try {
      const callId = event.type === 'tool/result' ? data?.message?.toolCallId : data?.callId;
      const signature = JSON.stringify([event.type, data?.turn, data?.step, callId, data?.name,
        event.type === 'assistant/message' ? data?.message?.id : undefined]);
      if (!Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq < r.lastSeq
          || (event.seq === r.lastSeq && signature !== r.lastEvent)) throw sourceError('RESOURCE_EVENT_ORDER');
      if (event.seq === r.lastSeq) return;
      r.lastSeq = event.seq; r.lastEvent = signature;
      const key = `${data?.turn}:${data?.step}`;
      if (event.type === 'step/start') {
        if (!Number.isSafeInteger(data?.turn) || !Number.isSafeInteger(data?.step) || r.steps.size) throw sourceError('RESOURCE_STEP_ORDER');
        r.observing = true;
        r.steps.set(key, { pins: visible(state, validEntries(agent, state)), planned: null });
      } else if (event.type === 'assistant/message') {
        const step = r.steps.get(key);
        if (!step || step.planned || data?.message?.role !== 'assistant' || !Array.isArray(data.message.content)) throw sourceError('RESOURCE_ASSISTANT_ORDER');
        if (data.interrupted === true) return; // Interrupted output never authorizes dispatch.
        const planned = new Map();
        for (const block of data.message.content) if (block.type === 'tool-call') {
          if (typeof block.id !== 'string' || typeof block.name !== 'string' || planned.has(block.id)) throw sourceError('RESOURCE_ASSISTANT_CALLS');
          planned.set(block.id, block.name);
        }
        step.planned = planned;
        const referenced = new Set(planned.values());
        // The complete model batch is now known. Keep every referenced sibling
        // (including not-yet-started calls), while freeing unrelated LRU victims.
        step.pins = new Map([...step.pins].filter(([name]) => referenced.has(name)));
        requestCollect(agent, state);
      } else if (event.type === 'tool/call') {
        if (!r.steps.has(key) || typeof callId !== 'string' || r.calls.has(callId)) throw sourceError('RESOURCE_CALL_ORDER');
        if (r.steps.get(key).planned && r.steps.get(key).planned.get(callId) !== data.name) throw sourceError('RESOURCE_UNPLANNED_CALL');
        r.calls.set(callId, { key, name: data.name });
      } else if (event.type === 'tool/result') {
        if (r.calls.get(callId)?.key !== key) throw sourceError('RESOURCE_RESULT_ORDER');
        r.calls.delete(callId);
      } else if (event.type === 'step/end') {
        if (!r.steps.has(key) || [...r.calls.values()].some((call) => call.key === key)
            || [...r.tokens.values()].some((call) => call.key === key)) throw sourceError('RESOURCE_STEP_NOT_DRAINED');
        r.steps.delete(key); requestCollect(agent, state);
      } else {
        if (r.steps.size || r.calls.size) throw sourceError('RESOURCE_TURN_NOT_DRAINED');
        requestCollect(agent, state);
      }
    } catch (error) { fail(state, error.code ?? 'RESOURCE_EVENT_FAILED'); }
  }

  async function execute(exec, next) {
    const state = states.get(exec.agent);
    if (!state || !state.entries.has(exec.name)) return next();
    assertReady(exec.agent);
    const r = init(state), record = r.records.get(exec.name), entry = state.entries.get(exec.name);
    const call = r.calls.get(exec.callId);
    const admitted = call && r.steps.get(call.key)?.pins.get(exec.name) === entry;
    if (exec.signal?.aborted || exec.parent !== undefined || !exec.token || r.tokens.has(exec.token)
        || !visible(state, validEntries(exec.agent, state)).has(exec.name)
        || ((record.pending || clock(state) >= record.expiresAt) && !admitted)) throw sourceError('RESOURCE_DISPATCH_DENIED');
    r.tokens.set(exec.token, { name: exec.name, entry, key: call?.key, signal: exec.signal, settled: false });
    try { return await next(); }
    finally { if (r.tokens.has(exec.token)) r.tokens.get(exec.token).settled = true; }
  }

  function result(exec, outcome) {
    const state = states.get(exec.agent);
    if (!state) return;
    const r = init(state), call = r.tokens.get(exec.token);
    if (!call) return;
    if (!call.settled || call.name !== exec.name) { fail(state, 'RESOURCE_RESULT_BEFORE_SETTLED'); return; }
    r.tokens.delete(exec.token);
    try {
      const record = r.records.get(call.name);
      if (outcome?.isError === false && !call.signal?.aborted && record?.entry === call.entry
          && record.pending !== 'release' && validEntries(exec.agent, state).has(call.name)) {
        const at = clock(state);
        record.lastUsedAt = at;
        if (policy.ttlMode === 'sliding') record.expiresAt = at + policy.ttlMs;
      }
    } catch { fail(state, 'RESOURCE_SUCCESS_VALIDATION_FAILED'); }
    requestCollect(exec.agent, state);
  }

  function mount(ctx) {
    if (mounted) throw sourceError('RESOURCE_ALREADY_MOUNTED');
    const acquired = [];
    try {
      for (const [type, callback] of [['session/event', observe], ['tools/execute', execute], ['tools/result', result]]) {
        const stop = ctx.on(type, callback);
        if (typeof stop !== 'function') throw sourceError('EVENT_DISPOSER_REQUIRED');
        acquired.push(stop);
      }
    } catch (error) { acquired.reverse().forEach((stop) => stop()); throw error; }
    stops = acquired; mounted = true;
  }

  function forget(state) {
    const r = init(state);
    if (r.timer !== undefined) timers.clearTimeout(r.timer);
    r.timer = undefined;
  }

  function status(agent) {
    const state = states.get(agent);
    const r = state ? init(state) : undefined;
    try {
      const entries = state ? visible(state, validEntries(agent, state)) : new Map();
      return { enabled: true, estimatedTokens: budget(agent, [...entries.keys()]), maxTokens: policy.maxTokens,
        ttlMode: policy.ttlMode, ttlMs: policy.ttlMs, retainedCount: state?.entries.size ?? 0,
        inFlight: r?.tokens.size ?? 0, activeSteps: r?.steps.size ?? 0,
        pendingRelease: [...r?.records.values() ?? []].filter((record) => record.pending === 'release').length,
        entries: [...r?.records ?? []].map(([publicName, record]) => ({ publicName, expiresAt: record.expiresAt,
          lastUsedAt: record.lastUsedAt, pendingRelease: record.pending === 'release', loaded: entries.has(publicName) })),
        errorCode: r?.error ?? null, maintenanceError: r?.maintenanceError ?? null };
    } catch (error) { return { enabled: true, errorCode: error.code ?? 'RESOURCE_STATUS_FAILED' }; }
  }

  function dispose() {
    if ([...states.values()].some((state) => init(state).tokens.size || state.resources.steps.size)) throw sourceError('RESOURCE_DISPOSE_REQUIRES_DRAIN');
    for (const state of states.values()) forget(state);
    stops.splice(0).reverse().forEach((stop) => stop()); mounted = false;
  }

  return { init, visible, plan, reuse, pinned, assertReady, release, collect, schedule, status, mount, forget, dispose,
    checkAgent(agent, state) { assertProtocol(state); native(agent); },
  };
}
