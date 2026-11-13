import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createSmartModeControl, createSmartSessionActions, SMART_SESSION_CONTROL_HOST_CONTRACT } from '../../lib/smart-mode-control.js';
import { mountSmartModeControlRoutes } from '../../lib/smart-mode-control-web.js';
import { host, profileHarness, temporaryProfile } from './smart-mode-profile.mjs';

/** Fully offline, real Host + JSONL, only literal synthetic review authority. */
export async function controlHarness(t, options = {}) {
  const profileDir = options.profileDir ?? await temporaryProfile(t);
  let h = await profileHarness(t, profileDir, { ...options, reviews: [], humanCommands: true });
  const known = new Map(), live = new Map();
  const principal = { id: 'synthetic-human', accountRef: h.scope.accountRef, groupId: h.scope.groupId, permissions: ['read', 'manage', 'review'] };
  const remember = (handle) => { known.set(handle.agent.id, { sessionId: handle.agent.id }); live.set(handle.agent.id, handle); return handle; };
  const create = async () => { const handle = remember(await h.create(`control-${randomUUID()}`));
    await h.drive(handle.agent, h.input(options.syntheticInitialText ?? 'Synthetic validation: only reply OK.')); return { sessionId: handle.agent.id }; };
  const actions = createSmartSessionActions(h.ctx, { hostContract: SMART_SESSION_CONTROL_HOST_CONTRACT,
    createUserMessage: host.createUserMessage, flush: () => h.ctx.sessionPersistence.flush(),
    list: () => [...known.values()], create,
    resume: async ({ sessionId }) => {
      if (!known.has(sessionId)) throw Object.assign(new Error(), { code: 'CONTROL_AGENT_NOT_FOUND' });
      await live.get(sessionId)?.dispose(); const handle = remember(await h.resume(sessionId));
      return { sessionId: handle.agent.id };
    },
  });
  const control = await createSmartModeControl({ enabled: true, profileDir, scope: h.scope, getIntegration: () => h.integration,
    getAgents: () => h.ctx.agents.list(), now: () => h.at, sessionActions: actions, locale: options.locale,
    verifyReadOnlyReview: options.verifyReadOnlyReview ?? ((review, actor) => review.accountRef === 'synthetic-grant-a'
      && actor.id === 'synthetic-human' && review.review.evidenceHash === 'e'.repeat(64)),
    setLayerEnabled: async (enabled) => {
      if (enabled && !h.integration.status().mounted) await h.mount();
      else if (!enabled && h.integration.status().mounted) await h.integration.dispose();
    },
  });
  const routes = new Map();
  const stop = mountSmartModeControlRoutes({ webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } }, control,
    { enabled: true, authorizeRequest: options.authorizeRequest ?? (() => principal), now: () => h.at });
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.writeHead(302, { location: '/mcp-connector/smart-control/' }); res.end(); return; }
    const route = [...routes.values()].find((route) => path === route.path || path.startsWith(`${route.path}/`));
    if (!route) { res.writeHead(404); res.end(); return; }
    Promise.resolve(route.handler(req, res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/mcp-connector/smart-control/`;
  let closed = false;
  async function close() { if (closed) return; closed = true; stop(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await control.close(); await h.close(); }
  t.after(close);
  const page = await (await fetch(url)).text();
  const nonce = page.match(/name="control-nonce" content="([a-f0-9]+)"/)?.[1];
  async function rpc(method, params = {}, headers = {}) {
    const response = await fetch(`${url}api`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-mcp-control-nonce': nonce, ...headers }, body: JSON.stringify({ method, params }) });
    return { status: response.status, ...(await response.json()) };
  }
  return { h, control, principal, actions, remember, known, live, profileDir, origin, url, nonce, rpc, close,
    async restart() {
      for (const handle of live.values()) await handle.dispose(); live.clear();
      await h.close(); h = await profileHarness(t, profileDir, { reviews: [], humanCommands: true });
      return h;
    },
    get current() { return h; },
  };
}
