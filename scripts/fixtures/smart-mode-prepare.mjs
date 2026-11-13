import assert from 'node:assert/strict';
import { registerTools } from '../../lib/tools.js';
import { createSmartModeRestrictionController, SMART_RESTRICTION_HOST_CONTRACT } from '../../lib/smart-mode-restrictions.js';
import { createSourceSelector } from '../../lib/source-selection.js';
import { createSmartModePrepareController } from '../../lib/smart-mode-prepare.js';
import { sourceFixture } from './source-selection.mjs';
import { readOnlyReviewFor } from './read-only-review.mjs';
export function fixture(options = {}) {
  const data = sourceFixture(options);
  const globals = new Map(), guards = new Set(), listeners = new Map(), denied = new Set(), manual = new Set();
  const intents = new Map(), agents = [], hidden = new Set();
  const reviews = [...data.index.values()].map((source) => readOnlyReviewFor(data.scope, source));
  let at = 1000, prepare, controller, failRestrict = 0, registrations = 0, legacyCalls = 0, businessCalls = 0;
  const emit = (type, ...args) => { for (const fn of listeners.get(type) ?? []) fn(...args); };
  const view = (agent) => {
    const visible = new Map([...globals].filter(([name]) => !agent || [...agent.masks].every((mask) => !mask.has(name))));
    if (agent) for (const [name, def] of agent.locals) visible.set(name, def);
    return { visible, knownNames: new Set([...globals.keys(), ...agent?.locals.keys() ?? []]), restrictableNames: new Set(globals.keys()) };
  };
  const ctx = { tools: { view, get: (name, agent) => view(agent).visible.get(name),
    guard(fn) { guards.add(fn); return () => guards.delete(fn); },
    register(def) { registrations++; globals.set(def.name, def); emit('tools/change'); return () => { globals.delete(def.name); emit('tools/change'); }; },
  }, on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  } };
  registerTools(ctx, { sessionTools: async () => { legacyCalls++; return { ok: true, message: 'legacy' }; } });
  for (const source of data.index.values()) ctx.tools.register({ name: source.publicName,
    parameters: { type: 'object', properties: {} }, execute() { businessCalls++; assert.fail('business must not execute'); } });
  ctx.tools.register({ name: 'outside_fixture' });
  controller = createSmartModeRestrictionController(ctx, {
    enabled: true, hostContract: SMART_RESTRICTION_HOST_CONTRACT, scope: data.scope,
    getRecords: () => data.records, getPreparedNames: (agent) => prepare?.getPreparedNames(agent) ?? [],
    isRecordUsable: () => true, isRecordVisible: (record) => !hidden.has(record.key),
    isToolAllowed: (name) => !denied.has(name), isManuallyActive: (name) => manual.has(name),
    sourceSearch: (agent, args) => selector.search(agent, args), prepareTools: (agent, args, exec) => prepare.prepare(agent, args, exec),
    releaseTools: options.resources?.enabled ? (agent, args, exec) => prepare.release(agent, args, exec) : undefined,
    assertPreparedReady: (agent) => prepare?.assertResourceReady(agent),
    getResourceStatus: options.resources?.enabled ? (agent) => prepare.resourceStatus(agent) : undefined,
    t: options.t,
  });
  controller.mount(ctx);
  const selector = createSourceSelector({ enabled: true, scope: data.scope,
    getSessionSnapshot: controller.sessionSnapshot,
    getRawSources: options.getRawSources ?? (() => data.rows), getRelations: options.getRelations ?? (() => data.relations),
    inspectSource: controller.inspectSource, getUserSourceIntent: (agent) => intents.get(agent), now: () => at,
  });
  selector.mount(ctx);
  prepare = createSmartModePrepareController({ enabled: true, scope: data.scope, restrictions: controller, selector,
    getReadOnlyReviews: options.getReadOnlyReviews ? () => options.getReadOnlyReviews(reviews) : () => reviews, now: () => at,
    resources: options.resources, timers: options.timers,
    isNativeExecutor: options.isNativeExecutor ?? (() => true),
    getBudgetSchemas: options.getBudgetSchemas ?? ((agent, names) => names.map((name) => {
      const def = agent.locals.get(name) ?? globals.get(name);
      return { name, description: def?.description ?? '', parameters: def?.parameters ?? {} };
    })),
  });
  prepare.mount(ctx);
  const make = (id, mode = 'smart') => {
    const agent = { id, session: { id }, status: 'idle', locals: new Map(), masks: new Set() };
    agent.ctx = { tools: { get: ctx.tools.get,
      register(def) { agent.locals.set(def.name, def); emit('tools/change'); return () => { agent.locals.delete(def.name); emit('tools/change'); }; },
      restrict({ deny }) {
        if (failRestrict) { failRestrict--; throw new Error('synthetic restrict failure'); }
        assert.ok(deny.every((name) => globals.has(name)));
        const mask = new Set(deny); agent.masks.add(mask); emit('tools/change');
        return () => { agent.masks.delete(mask); emit('tools/change'); };
      },
    } };
    const stop = controller.installMode(agent, data.snapshot(id, mode)); agents.push(agent);
    return { agent, stop };
  };
  return { ...data, reviews, selector, controller, prepare, ctx, globals, agents, denied, hidden, manual, intents, make, emit,
    get at() { return at; }, set at(value) { at = value; },
    failRestrict(count = 1) { failRestrict = count; },
    names: (agent) => [...view(agent).visible.keys()].sort(),
    guard: (agent, name) => [...guards].map((fn) => fn({ agent, name })).find((value) => value !== undefined),
    counts: () => ({ registrations, legacyCalls, businessCalls }),
    async run(exec, body = async () => ({ isError: false, content: [] })) {
      exec = { token: {}, callId: `call-${Math.random()}`, signal: new AbortController().signal, ...exec };
      const denial = [...guards].map((fn) => fn(exec)).find((value) => value !== undefined);
      if (denial) return { isError: true, content: [{ type: 'text', text: denial }] };
      const wrappers = [...listeners.get('tools/execute') ?? []];
      const invoke = async (i) => i === wrappers.length ? body(exec) : wrappers[i](exec, () => invoke(i + 1));
      let result;
      try { result = await invoke(0); } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.code ?? error.message }] }; }
      emit('tools/result', exec, result);
      return result;
    },
    capabilityId: `relation:${data.relations[0].id}`,
    sources: [...data.index.values()],
    intent(agent, sources, kind = 'source') {
      intents.set(agent, { sessionId: agent.id, accountRef: data.scope.accountRef, groupId: data.scope.groupId,
        capabilityId: `relation:${data.relations[0].id}`, kind,
        sources: sources.map(({ sourceId, definitionFingerprint }) => ({ sourceId, definitionFingerprint })),
        expiresAt: 9000, evidenceHash: 'a'.repeat(64) });
    },
  };
}
