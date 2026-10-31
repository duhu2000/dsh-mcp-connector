import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHostGovernanceController } from '../lib/governance.js';
import { createHostScopeController } from '../lib/connection-scopes.js';
import { createSessionToolInjectionController } from '../lib/session-injection.js';

// Read installed Host code only. No profile, storage, network, model or DSH UI.
// Opt-in is explicit; a selected but incompatible Host fails instead of skipping.
const anchor = process.env.DSH_HOST_INTEGRATION_ANCHOR;
let host;
if (anchor) {
  const require = createRequire(anchor);
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  host = {
    ...await load('@deepseek-ai/cordis'),
    ...await load('@deepseek-ai/dsh-tools'),
    ...await load('@deepseek-ai/dsh-scope'),
  };
}

for (const delivery of ['native', 'microtask', 'immediate']) {
  test(`installed Host visibility lifecycle: ${delivery} tools/change`, {
    skip: !host, timeout: 20000,
  }, async (t) => {
    const root = new host.Context();
    // Prompt assembly is out of scope; registry, schema cloning, restrictions,
    // scope ownership and the native event emitter are the real Host runtime.
    root.provide('systemPrompt', { tools() {} });
    root.plugin(host.ToolRuntime);
    try {
      await new Promise((resolve, reject) => root.plugin({
        inject: ['tools'],
        async apply(ctx) {
          const scopes = [];
          const controllers = [];
          let stopEvents;
          let failure;
          try {
            const agents = [];
            const records = [{ key: 'a', connectorId: 'acme', serverName: 'acme', injectionMode: 'always' }];
            let rules = [];
            let bindings = [];
            let reads = 0;
            let schemaReads = 0;
            let events = 0;
            let pending = 0;
            const stats = {};
            const register = (name) => ctx.tools.register({
              name, description: 'Isolated visibility regression fixture',
              parameters: { type: 'object', properties: {
                query: { type: 'string' },
                options: { type: 'object', properties: { limit: { type: 'integer' } } },
              } },
              output: { schema: { type: 'object' }, render: () => [] },
              execute: async () => ({}),
            });
            for (let i = 0; i < 161; i += 1) {
              register(i < 25 ? `mcp_connector_fixture_${i}` : `mcp__acme__fixture_${i}`);
            }
            // Each scope has the same public ownership semantics as an Agent,
            // but does not run a model or instantiate the Desktop UI.
            for (let i = 0; i < 12; i += 1) {
              const agent = { id: String(i), workspaceId: 'outside' };
              const scope = host.createScope(ctx, agent);
              scopes.push(scope);
              agent.ctx = scope.ctx;
              agents.push(agent);
            }
            stopEvents = ctx.on('tools/change', () => { events += 1; });
            const instrumented = { tools: {
              schemas() {
                schemaReads += 1;
                assert.ok(schemaReads < 10000, 'bounded sentinel: schema event storm');
                return ctx.tools.schemas();
              },
              ...(typeof ctx.tools.definitions === 'function' ? {
                definitions() { reads += 1; return ctx.tools.definitions(); },
              } : {}),
              ...(typeof ctx.tools.view === 'function' ? {
                view() { reads += 1; return ctx.tools.view(); },
              } : {}),
              guard: (fn) => ctx.tools.guard(fn),
              restrict: (...args) => ctx.tools.restrict(...args),
            } };
            const agentCtx = {
              agents: { list: () => agents },
              on(event, fn) {
                let active = true;
                const off = ctx.on(event, (...args) => {
                  if (event !== 'tools/change' || delivery === 'native') return fn(...args);
                  pending += 1;
                  const schedule = delivery === 'microtask' ? queueMicrotask : setImmediate;
                  schedule(() => {
                    pending -= 1;
                    if (active) fn(...args);
                  });
                });
                return () => { active = false; off(); };
              },
            };
            const settle = async () => {
              for (let i = 0; i < 50 && pending; i += 1) {
                await new Promise((done) => setImmediate(done));
              }
              assert.equal(pending, 0, 'notifications must reach quiescence');
              const before = reads;
              await new Promise((done) => setImmediate(done));
              assert.equal(reads, before, 'no hidden background rescan');
            };
            const common = { getRecords: () => records, workspaceIdForAgent: (agent) => agent.workspaceId };
            controllers.push(
              createHostGovernanceController(instrumented, { ...common, getRules: () => rules }),
              createHostScopeController(instrumented, { ...common, getBindings: () => bindings }),
              createSessionToolInjectionController(instrumented, common),
            );
            controllers.forEach((controller) => controller.mountAgents(agentCtx));
            await settle();
            assert.equal(reads, 0);
            stats.defaultReads = reads;

            // Reading schemas alone must not emit tools/change on this Host.
            const beforeEvents = events;
            ctx.tools.schemas();
            await settle();
            assert.equal(events, beforeEvents);

            rules = [{ scope: 'connection', connectorId: 'acme', effect: 'deny' }];
            bindings = [{ connectionKey: 'a', global: false, projects: ['inside'] }];
            records[0].injectionMode = 'session';
            controllers.forEach((controller) => controller.refresh());
            await settle();
            stats.restrictedReads = reads;
            for (const agent of agents) {
              assert.equal(agent.ctx.tools.get('mcp__acme__fixture_25', agent), undefined);
              assert.equal(agent.ctx.tools.schemas(agent).length, 25);
            }
            const removeNew = register('mcp__acme__new_tool');
            await settle();
            for (const agent of agents) {
              assert.equal(agent.ctx.tools.get('mcp__acme__new_tool', agent), undefined);
            }
            removeNew();
            await settle();
            rules = [];
            bindings = [];
            records[0].injectionMode = 'always';
            controllers.forEach((controller) => controller.refresh());
            await settle();
            for (const agent of agents) assert.equal(agent.ctx.tools.schemas(agent).length, 161);
            stats.totalReads = reads;
            stats.schemaReads = schemaReads;
            stats.events = events;
            assert.equal(schemaReads, 0, 'visibility controllers must never deep-clone schemas');
            t.diagnostic(JSON.stringify({ delivery, agents: agents.length, tools: 161, ...stats }));
          } catch (error) {
            failure = error;
          } finally {
            try {
              controllers.forEach((controller) => controller.dispose());
              stopEvents?.();
              for (const scope of scopes) await scope.dispose();
            } catch (error) { failure ??= error; }
          }
          if (failure) reject(failure);
          else resolve();
        },
      }));
    } finally { await root.fiber.dispose(); }
  });
}
