import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createSmartModeIntegration, SMART_INTEGRATION_HOST_CONTRACT } from '../../lib/smart-mode-integration.js';
import { SmartModeStore } from '../../lib/smart-mode-store.js';
import { registerTools } from '../../lib/tools.js';
import { sourceFixture, relationInput } from './source-selection.mjs';
import { enterpriseFixture } from './smart-mode-enterprise.mjs';
import { readOnlyReviewFor } from './read-only-review.mjs';
import { estimateSmartToolTokens } from '../../lib/smart-mode-resources.js';

const anchor = process.env.DSH_HOST_INTEGRATION_ANCHOR;
export let host;
if (anchor) {
  const require = createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh-agent-loop'));
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  host = Object.assign({}, ...await Promise.all(['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-token-meter', '@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction',
  ].map(load)));
  host.jsonl = await load('@deepseek-ai/dsh-session-persistence-jsonl');
}
export const tick = () => new Promise((resolve) => setImmediate(resolve));
export const bounded = (promise) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('isolated profile timed out')), 12000); timer.unref();
})]);
const profileClosers = new Map();

export async function temporaryProfile(t) {
  const parent = resolve(tmpdir());
  const path = await fs.mkdtemp(join(parent, 'qmcp-p107-'));
  profileClosers.set(path, []);
  await fs.writeFile(join(path, 'validation-profile.json'), JSON.stringify({ version: 1, id: randomUUID(),
    purpose: 'QMCP-4963 isolated offline Host validation', providerCredentials: false }));
  t.after(async () => {
    for (const close of [...profileClosers.get(path)].reverse()) await close();
    profileClosers.delete(path);
    const target = resolve(path);
    assert.equal(dirname(target), parent); assert.ok(basename(target).startsWith('qmcp-p107-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  return path;
}

/** Real Host JSONL backend; never loads a DSH config or a remote adapter. */
export async function profileHarness(t, profileDir, options = {}) {
  if (options.data && (options.relation || options.syntheticOutcomes)) throw new Error('External metadata cannot use synthetic approvals or execution');
  const data = options.data ?? sourceFixture({ full: options.full });
  const outside = enterpriseFixture({ full: options.full }).outsideNames;
  const sources = [...data.index.values()], handles = [], requests = [], errors = [], events = [];
  const trustedIds = new Set(), intents = new Map(), scripts = [];
  let at = Date.now(), integration, closed = false, registrationStops = new Map(), bodyCalls = 0;
  const reviews = options.reviews ?? (options.data ? [] : sources.map((source) => readOnlyReviewFor(data.scope, source, { validFrom: 0, expiresAt: at + 86400000 })));
  if (options.relation) {
    const store = await SmartModeStore.open({ profileDir,
      approveSourceRelation: (value) => value.accountRef === 'synthetic-grant-a' });
    const relation = { ...relationInput(data.relations[0]), validFrom: 0, expiresAt: at + 86400000 };
    await store.setSourceRelation(relation, { expectedRevision: 0 }); await store.close();
  }
  class OfflineAdapter extends host.LlmAdapter {
    providerInfo(id) { return { id, name: 'Synthetic offline provider' }; }
    async resolveModel(provider, id) { return { provider, id, name: id, contextWindow: 1000000,
      inputModalities: ['text'], ...(id === 'addition-only' ? { toolUpdate: 'addition-only' } : {}) }; }
    async *stream(input) {
      requests.push(input);
      await options.beforeReply?.(input);
      const blocks = input.purpose === 'compaction' ? [{ type: 'text', text: 'Synthetic compact summary.' }]
        : scripts.shift() ?? [{ type: 'text', text: 'OK' }];
      for (const [index, block] of blocks.entries()) {
        yield { type: 'block-start', index, blockType: block.type };
        if (block.type === 'tool-call') yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
        else yield { type: 'text-delta', index, text: block.text };
        yield { type: 'block-end', index, block };
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }; // Synthetic, never an actual usage claim.
      yield { type: 'finish', reason: { kind: blocks.some((block) => block.type === 'tool-call') ? 'tool-calls' : 'stop' } };
    }
  }
  const root = new host.Context();
  root.on('agent/error', ({ error }) => errors.push(error));
  root.on('session/event', (session, event) => events.push({ id: session.id, event }));
  root.plugin(host.jsonl, { root: join(profileDir, 'sessions'), compression: 'none' });
  for (const service of [host.SessionStore, host.SessionProjectionRegistry, host.AgentRegistry, host.LlmRuntime]) root.plugin(service);
  root.plugin(host.SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
  root.plugin(host.ToolRuntime); root.plugin(await import(pathToFileURL(createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh-agent-loop')).resolve('@deepseek-ai/dsh-tool-executor-native')).href));
  root.plugin(host.AgentLoop, { agents: [], maxParallelToolCalls: 2 });
  root.plugin(host.TokenMeter);
  root.plugin(host.BasicCompactionEngine, { auto: false, retainTokens: 0, headroomTokens: 1000, maxTokens: 200 });
  const ctx = await bounded(new Promise((done) => root.plugin({
    inject: ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'tools', 'llm', 'systemPrompt', 'tokenMeter', 'compaction'], apply: done,
  })));
  ctx.llm.registerAdapter(['offline-validation'], new OfflineAdapter());
  const managementStop = registerTools(ctx, { sessionTools: async () => ({ ok: true, message: 'synthetic legacy entry' }) });
  const businessDefinition = (source) => ({ name: source.publicName, description: source.description,
    parameters: data.rows.find((row) => row.connectionKey === source.connectionKey && row.definition.name === source.rawName).definition.inputSchema,
    output: { schema: { type: 'object' }, render: () => [] },
    async execute(args, exec) {
      bodyCalls++;
      if (!options.syntheticOutcomes) throw new Error('P1-07 must not execute a business tool');
      if (options.syntheticBody) return options.syntheticBody(args, exec);
      if (args.fail) throw new Error('Synthetic local fixture failure');
      return { ok: true };
    },
  });
  for (const source of sources) registrationStops.set(source.publicName, ctx.tools.register(businessDefinition(source)));
  for (const name of outside) ctx.tools.register({ name, description: 'Outside target group',
    parameters: { type: 'object', properties: {} }, output: { schema: { type: 'object' }, render: () => [] },
    async execute() { bodyCalls++; throw new Error('P1-07 must not execute a business tool'); },
  });
  const native = ctx.tools.selectExecutor();
  const mount = async () => {
    integration = await createSmartModeIntegration(ctx, { enabled: true,
      hostContract: SMART_INTEGRATION_HOST_CONTRACT, profileDir, getHostProfileDir: () => profileDir,
      scope: data.scope, getRecords: () => data.records, isRecordUsable: () => true,
      getConnectorDescriptors: options.getConnectorDescriptors,
      isRecordVisible: () => true, isToolAllowed: (name) => !denied.has(name),
      classifyInput: (message) => trustedIds.has(message.id) ? 'interactive' : 'background',
      getUserSourceIntent: options.getUserSourceIntent ?? ((agent) => intents.get(agent)),
      isNativeExecutor: (agent) => ctx.tools.selectExecutor(agent) === native,
      projectToolSchema: (definition) => JSON.parse(JSON.stringify(host.projectToolSchema(definition, true))),
      initialViews: { rawSources: data.rows, readOnlyReviews: reviews },
      storeOptions: options.storeOptions, now: () => at,
    });
    await integration.mount(); return integration;
  };
  const denied = new Set();
  const agentOptions = { provider: 'offline-validation', model: options.model ?? 'no-update', maxTokens: 50 };
  const create = async (id, more = {}) => { const handle = await ctx.agents.create({ sessionId: id, meta: { cwd: profileDir }, agentOptions, ...more }); handles.push(handle); return handle; };
  const resume = async (id) => { const handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions }); handles.push(handle); return handle; };
  const input = (text = 'Synthetic validation: only reply OK.', trusted = true) => {
    const message = host.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
    if (trusted) trustedIds.add(message.id); return message;
  };
  const drive = async (agent, message = input()) => { agent.followup(message); await bounded(agent.whenIdle()); await tick(); };
  const close = async () => {
    if (closed) return; closed = true;
    for (const handle of handles.splice(0).reverse()) await handle.dispose();
    await tick(); await integration?.dispose();
    await ctx.sessionPersistence.flush();
    const evidenceDir = process.env.DSH_SMART_ACCEPTANCE_EVIDENCE_DIR;
    if (evidenceDir) {
      await fs.mkdir(evidenceDir, { recursive: true });
      const files = await fs.readdir(join(profileDir, 'sessions'), { recursive: true }).catch((error) => {
        if (error.code === 'ENOENT') return []; throw error;
      });
      await fs.writeFile(join(evidenceDir, `${basename(profileDir)}-${randomUUID()}.json`), JSON.stringify({
        profile: basename(profileDir), backend: 'Host JSONL compression=none', node: process.versions.node,
        sessionArtifacts: files.filter((name) => name.endsWith('.jsonl')).length,
        syntheticBusinessCalls: bodyCalls, realBusinessCalls: 0, realModelRequests: 0, configLoaded: false,
        requests: requests.map((request) => {
          const scoped = request.tools?.filter((tool) => sources.some((source) => source.publicName === tool.name)
            || ['mcp_connector_discover', 'mcp_connector_session_tools'].includes(tool.name)) ?? [];
          return { model: request.model, purpose: request.purpose ?? 'conversation',
          toolCount: request.tools?.length ?? 0,
          scopedToolCount: scoped.length, scopedProjectedTokens: estimateSmartToolTokens(scoped),
          deferredScopedTools: scoped.filter((tool) => tool.deferLoading === true).length,
          developerMessages: request.messages?.filter((message) => message.role === 'developer').length ?? 0,
          toolsJsonChars: JSON.stringify(request.tools ?? []).length,
          requestJsonChars: JSON.stringify({ tools: request.tools, messages: request.messages }).length,
        }; }),
      }, null, 2), { flag: 'wx' });
    }
    managementStop(); await root.fiber.dispose();
    assert.equal(bodyCalls, options.syntheticOutcomes ? options.expectedSyntheticCalls ?? 3 : 0);
  };
  profileClosers.get(profileDir)?.push(close);
  t.after(close);
  try { if (options.mount !== false) await mount(); } catch (error) { await close(); throw error; }
  return { ...data, sources, outside, ctx, requests, events, errors, reviews, intents, denied, profileDir,
    create, resume, input, drive, close, mount,
    get integration() { return integration; }, get at() { return at; }, set at(value) { at = value; },
    queue(calls) { scripts.push(calls.map((call) => ({ type: 'tool-call', id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args ?? {}) }))); },
    replaceRegistration(source) { registrationStops.get(source.publicName)(); registrationStops.set(source.publicName, ctx.tools.register(businessDefinition(source))); },
    async persisted(id) { await ctx.sessionPersistence.flush(); const handle = await ctx.sessionPersistence.open(id, 'read');
      try { return await handle.read(); } finally { await handle.close(); } },
  };
}
