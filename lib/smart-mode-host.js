import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSmartSessionActions, SMART_SESSION_CONTROL_HOST_CONTRACT } from './smart-mode-control.js';
import { sourceError } from './source-relations.js';

// The complete Native/Session/Connection contract was verified on this release.
// Unknown versions do not get an optimistic compatibility claim.
export const SMART_PRODUCTION_HOST_VERSION = '0.2.2-rc.1';

export async function loadSmartModeHost(ctx) {
  const profile = ctx.profileContext;
  const connection = ctx.connection, tools = ctx.tools, workspacesRegistry = ctx.workspaceRegistry;
  const sessionController = ctx.sessionController, persistence = ctx.sessionPersistence;
  if (!profile || !isAbsolute(profile.dir)) throw sourceError('SMART_HOST_PROFILE_REQUIRED');
  const anchor = profile.installAnchor ?? join(profile.dir, 'package.json');
  if (!isAbsolute(anchor)) throw sourceError('SMART_HOST_PROFILE_REQUIRED');
  const require = createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh-agent-loop'));
  for (const name of ['dsh-agent-loop', 'dsh-tools', 'dsh-tool-executor-native', 'dsh-client-connection', 'dsh-api-session-controller']) {
    if (require(`@deepseek-ai/${name}/package.json`).version !== SMART_PRODUCTION_HOST_VERSION) throw sourceError('SMART_HOST_VERSION_UNVERIFIED');
  }
  const load = (name) => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
  const [{ projectToolSchema }, { NativeToolExecutor }, { createUserMessage }] = await Promise.all([
    load('dsh-tools'), load('dsh-tool-executor-native'), load('dsh-llm'),
  ]);
  if (typeof ctx.connection?.admit !== 'function' || typeof ctx.tools?.selectExecutor !== 'function'
      || !(ctx.tools.selectExecutor() instanceof NativeToolExecutor)
      || ['create', 'resolveAgent', 'list'].some((key) => typeof ctx.sessionController?.[key] !== 'function')) {
    throw sourceError('SMART_HOST_CAPABILITY_UNAVAILABLE');
  }
  const workspaces = () => workspacesRegistry.list().map(({ id, title }) => ({ id: String(id), title: String(title ?? id) }));
  return {
    getHostProfileDir: () => profile.dir,
    isNativeExecutor: (agent) => tools.selectExecutor(agent) instanceof NativeToolExecutor,
    projectToolSchema: (definition) => JSON.parse(JSON.stringify(projectToolSchema(definition, false))),
    // In the pinned SessionController, source/rpcId/principal are constructed by
    // Host prompt admission, never accepted as fields of a prompt wire body.
    // A bare `kind:user`, a non-owner RPC or background/subagent input is not proof.
    classifyInput(message, agent) {
      const source = message?.source;
      if (['runtime-context', 'skill-catalog', 'time-context'].includes(source?.kind)) return 'context';
      return source?.kind === 'user' && typeof source.rpcId === 'string' && source.rpcId.length > 0
        && source.principal === undefined && !agent.session?.header?.origin ? 'interactive' : 'background';
    },
    authorizeRequest(request, scope) {
      const admission = connection.admit(request), peer = admission?.peer;
      if (!peer || peer !== connection.browserPeer || peer.signal?.aborted || peer.principal?.kind !== 'owner') return undefined;
      return { id: String(peer.id), accountRef: scope?.accountRef ?? 'unavailable', groupId: scope?.groupId ?? 'unavailable',
        permissions: ['read', 'manage', 'review'] };
    },
    sessionActions: createSmartSessionActions(ctx, { hostContract: SMART_SESSION_CONTROL_HOST_CONTRACT,
      createUserMessage, flush: () => persistence.flush(), workspaces,
      list: async () => (await sessionController.list({}, new AbortController().signal)).items
        .map((item) => ({ sessionId: item.sessionId, title: item.title ?? item.sessionId })),
      async create({ workspaceId } = {}) {
        const choices = workspaces();
        const selected = workspaceId ?? (choices.length === 1 ? choices[0].id : undefined);
        if (!selected || !choices.some((workspace) => workspace.id === selected)) throw sourceError('CONTROL_WORKSPACE_REQUIRED');
        return sessionController.create({ workspaceId: selected });
      },
      async resume({ sessionId }) {
        const result = await sessionController.resolveAgent(sessionId);
        if (!result?.agent) throw sourceError('CONTROL_AGENT_NOT_FOUND');
        return { sessionId: result.agent.id };
      },
    }),
  };
}
