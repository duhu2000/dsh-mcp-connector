/**
 * P1-01 only: an opt-in lifecycle seam, not a production smart-mode switch.
 * Storage, scope selection and restrictions are supplied by later phases.
 * No tools, connection records, credentials or message bodies are persisted here.
 */
export const SMART_MODE_HOST_CONTRACT = 'dsh-react-loop-claimed-before-resolve-v1';
import { normalizeSmartModeSnapshot } from './smart-mode-schema.js';
export { SMART_MODE_SNAPSHOT_VERSION } from './smart-mode-schema.js';

function failure(code) {
  return Object.assign(new Error(`Smart mode lifecycle: ${code}`), { code });
}

function snapshotFor(value, sessionId) {
  return normalizeSmartModeSnapshot(value, sessionId);
}

function legacy(sessionId) {
  return snapshotFor({ version: 1, sessionId, mode: 'compat', policyVersion: 'legacy', selection: 'legacy' }, sessionId);
}

async function waitForCommit(promise, signal) {
  if (signal.aborted) return false;
  let abort;
  const canceled = new Promise((resolve) => { abort = () => resolve(false); });
  signal.addEventListener('abort', abort, { once: true });
  try { return await Promise.race([Promise.resolve(promise).then(() => true), canceled]); }
  finally { signal.removeEventListener('abort', abort); }
}

const contextSources = new Set(['runtime-context', 'skill-catalog', 'time-context']);

export function isUnstartedRootSession(agent, source) {
  const header = agent.session?.header;
  if (!['startup', 'resume'].includes(source) || header?.isSeeded !== false
      || header.parentSession || header.origin) return false;
  const events = agent.session.snapshotEvents();
  if (!Array.isArray(events)) throw failure('INVALID_SESSION_EVENTS');
  return !events.some((event) => {
    if (event.type === 'user/message') {
      const message = event.data?.message ?? event.data;
      return !contextSources.has(message?.source?.kind);
    }
    return event.type.startsWith('assistant/') || ['tool/call', 'tool/result'].includes(event.type);
  });
}

/**
 * All callbacks are trusted Host integration, never model arguments.
 * readSnapshot/writeSnapshot must be bound to ONE profile. P1-02 owns durable
 * uniqueness/transactions. installMode must synchronously return its own disposer
 * (including an explicit no-op for compat); a failed install must be atomic.
 * classifyInput returns interactive/context/background/unknown; absent proof must
 * never return interactive. selectDefault is synchronous and returns a policy
 * { mode, policyVersion, accountRef, groupId }, or undefined (compat).
 */
export function createSmartModeLifecycleAdapter({
  enabled = false, hostContract, readSnapshot, writeSnapshot, installMode,
  classifyInput, selectDefault, onBlocked = () => {},
} = {}) {
  const states = new Map(); // Agent INSTANCE, not merely SessionId.
  const writesBySession = new Map();
  let mounted = false;
  let closed = false;
  let stops = [];

  function report(state, code) {
    state.error = failure(code);
    state.phase = 'blocked';
    // Diagnostics cannot throw into the synchronous claimed notification.
    try { onBlocked({ sessionId: state.agent.id, code }); } catch {}
  }

  function status(agent) {
    const state = states.get(agent);
    return state ? Object.freeze({
      phase: state.phase, mode: state.snapshot?.mode,
      committed: state.committed, errorCode: state.error?.code,
    }) : Object.freeze({ phase: enabled ? 'unattached' : 'disabled', committed: false });
  }

  function rememberQueued(state) {
    for (const [target, messages] of [['next-step', state.agent.inbox.nextStep], ['next-turn', state.agent.inbox.nextTurn]]) {
      for (const message of messages) state.targets.set(message.id, target);
    }
  }

  function restoreClaimed(state) {
    const inbox = state.agent.inbox;
    const queued = new Set([...inbox.nextStep, ...inbox.nextTurn].map((m) => m.id));
    for (const target of ['next-step', 'next-turn']) {
      const batch = [...state.claimed.values()].filter((entry) => entry.target === target);
      for (const { message } of batch.reverse()) {
        if (!queued.has(message.id)) {
          inbox.prepend(target, message); // Durable splice; does not wake the driver.
          queued.add(message.id);
        }
      }
    }
    state.claimed.clear();
  }

  function releaseClaimed(state) {
    for (const id of state.claimed.keys()) state.targets.delete(id);
    state.claimed.clear();
  }

  function persist(state) {
    state.phase = 'persisting';
    state.error = undefined;
    const pending = Promise.resolve().then(() => writeSnapshot(state.snapshot)).then(() => {
      if (states.get(state.agent) !== state || closed) return;
      state.committed = true;
      state.phase = 'ready';
    }, () => {
      if (states.get(state.agent) === state && !closed) report(state, 'SNAPSHOT_WRITE_FAILED');
    });
    state.pending = pending;
    writesBySession.set(state.agent.id, pending);
    pending.then(() => {
      if (writesBySession.get(state.agent.id) === pending) writesBySession.delete(state.agent.id);
    });
    return state.pending;
  }

  function choose(state, snapshot, committed = false) {
    state.snapshot = snapshot;
    const stop = installMode(state.agent, snapshot);
    if (typeof stop !== 'function') throw failure('INSTALL_MUST_BE_SYNCHRONOUS');
    state.stopMask = stop;
    state.committed = committed;
    if (committed) state.phase = 'ready';
    else persist(state);
  }

  async function initialize(agent, source) {
    if (states.has(agent)) return states.get(agent).initialized;
    if (agent.id !== agent.session?.id || typeof agent.inbox?.prepend !== 'function'
        || typeof agent.session?.snapshotEvents !== 'function') throw failure('UNSUPPORTED_AGENT');
    const state = { agent, phase: 'initializing', committed: false, claimed: new Map(), targets: new Map() };
    states.set(agent, state);
    rememberQueued(state);
    state.initialized = (async () => {
      try {
        // Cancellation may end the loop before its storage write settles. A
        // replacement Agent must observe that write before reading its policy.
        await writesBySession.get(agent.id);
        const saved = await readSnapshot(agent.id);
        if (states.get(agent) !== state || closed) return;
        if (saved !== undefined) {
          choose(state, snapshotFor(saved, agent.id), true);
        } else if (agent.session.header.parentSession) {
          const parentId = agent.session.header.parentSession;
          const parent = [...states.values()].find((s) => s.agent.id === parentId);
          if (parent) {
            await parent.initialized;
            await parent.pending;
          }
          if (parent && !parent.committed) throw failure('PARENT_MODE_UNRESOLVED');
          const inherited = parent ? parent.snapshot : await readSnapshot(parentId);
          if (!inherited) throw failure('PARENT_MODE_UNRESOLVED');
          const policy = snapshotFor(inherited, parentId);
          choose(state, snapshotFor({ ...policy, sessionId: agent.id, selection: 'parent' }, agent.id));
        } else if (isUnstartedRootSession(agent, source)) {
          state.phase = 'awaiting-input';
        } else {
          choose(state, legacy(agent.id));
        }
        await state.pending;
        if (state.error) throw state.error;
      } catch (error) {
        report(state, error.code ?? 'INITIALIZATION_FAILED');
        throw state.error;
      }
    })();
    return state.initialized;
  }

  function claimed({ agent, message }) {
    const state = states.get(agent);
    if (!state) return;
    if (!state.claimed.has(message.id)) state.claimed.set(message.id, {
      message, target: state.targets.get(message.id) ?? 'next-step',
    });
    if (state.phase !== 'awaiting-input') return;
    try {
      const source = classifyInput(message, agent);
      if (source === 'context') return;
      const policy = source === 'interactive' ? selectDefault(agent) : undefined;
      const snapshot = policy ? snapshotFor({
        ...policy, version: 1, sessionId: agent.id,
        selection: policy.mode === 'smart' ? 'smart-auto' : 'legacy',
      }, agent.id) : legacy(agent.id);
      choose(state, snapshot); // MUST finish installing before tools.resolve().
    } catch (error) { report(state, error.code ?? 'MODE_SELECTION_FAILED'); }
  }

  async function preStep({ agent, signal }, next) {
    const state = states.get(agent);
    // A mounted enabled adapter must never admit an uninitialized Agent.
    if (!state) throw failure('UNATTACHED_AGENT');
    if (!await waitForCommit(state.initialized, signal)
        || !await waitForCommit(state.pending, signal)) return { kind: 'reject' };
    if (closed || state.phase !== 'ready' || !state.committed) {
      restoreClaimed(state);
      return { kind: 'reject' };
    }
    const decision = await next();
    // Other Host middleware owns its rejection semantics. Only this adapter's
    // failed gate (or an assembly error before it) restores the claimed input.
    releaseClaimed(state);
    return decision;
  }

  function forget(agent) {
    const state = states.get(agent);
    if (!state) return;
    states.delete(agent); // Late write completion cannot revive the old instance.
    state.stopMask?.();
    state.claimed.clear();
    state.targets.clear();
  }

  async function mount(agentCtx) {
    if (!enabled) return () => {};
    if (mounted || closed) throw failure('ALREADY_MOUNTED');
    if (hostContract !== SMART_MODE_HOST_CONTRACT) throw failure('UNVERIFIED_HOST_CONTRACT');
    for (const callback of [readSnapshot, writeSnapshot, installMode, classifyInput, selectDefault]) {
      if (typeof callback !== 'function') throw failure('MISSING_INTEGRATION_CALLBACK');
    }
    const existing = agentCtx.agents.list();
    if (existing.some((agent) => agent.status !== 'idle')) throw failure('REMOUNT_REQUIRES_IDLE_AGENTS');
    mounted = true;
    stops = [
      agentCtx.on('agent/created', ({ agent, source }) => initialize(agent, source)),
      agentCtx.on('agent/inbox/inserted', ({ agent }) => {
        const state = states.get(agent);
        if (state) rememberQueued(state);
      }),
      agentCtx.on('agent/inbox/claimed', claimed),
      agentCtx.on('agent/pre-step', preStep),
      agentCtx.on('agent/disposed', ({ agent }) => forget(agent)),
      agentCtx.on('session/event', (session, event) => {
        // Cordis may deliver a traceable Session facade; object identity differs
        // from agent.session. Registry guarantees one live Agent per SessionId.
        const state = [...states.values()].find((s) => s.agent.id === session.id);
        if (state && event.type === 'turn/end' && event.data.reason?.kind === 'aborted') releaseClaimed(state);
        if (state && state.claimed.size && event.type === 'turn/end'
            && ['error', 'blocked'].includes(event.data.reason?.kind)) {
          // Session observers cannot reenter append(). Restore durable inbox
          // splices after publication unwinds, before a later queued driver.
          queueMicrotask(() => {
            if (states.get(state.agent) !== state) return;
            try { restoreClaimed(state); } catch { report(state, 'INPUT_RESTORE_FAILED'); }
          });
        }
      }),
    ];
    // Do not swallow a failed bootstrap or release restrictions on failure.
    // Callers must keep input paused until this promise resolves.
    for (const agent of existing) await initialize(agent, 'resume');
    return dispose;
  }

  async function retry(agent) {
    const state = states.get(agent);
    if (!state || state.error?.code !== 'SNAPSHOT_WRITE_FAILED' || agent.status !== 'idle') {
      throw failure('NOT_RETRYABLE');
    }
    await persist(state); // Retry identical selection; never re-read a new default.
    return status(agent); // Does not wake inference or duplicate queued input.
  }

  function dispose() {
    if ([...states.keys()].some((agent) => agent.status !== 'idle')) throw failure('DISPOSE_REQUIRES_IDLE_AGENTS');
    if (writesBySession.size) throw failure('DISPOSE_REQUIRES_SETTLED_WRITES');
    closed = true;
    stops.splice(0).reverse().forEach((stop) => stop());
    for (const agent of states.keys()) forget(agent);
  }

  return { mount, status, retry, dispose };
}
