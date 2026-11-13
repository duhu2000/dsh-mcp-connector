import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createSmartModeIntegration } from '../lib/smart-mode-integration.js';
import { SMART_INTEGRATION_HOST_CONTRACT } from '../lib/smart-mode-integration.js';
import { relationInput } from '../scripts/fixtures/source-selection.mjs';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { indexRawToolSources } from '../lib/source-relations.js';
import { readOnlyReviewFor } from '../scripts/fixtures/read-only-review.mjs';
import { estimateSmartToolTokens } from '../lib/smart-mode-resources.js';
import { SmartModeStore } from '../lib/smart-mode-store.js';
import { host, profileHarness, temporaryProfile, tick, bounded } from '../scripts/fixtures/smart-mode-profile.mjs';

const contract = (name, fn) => test(`isolated profile integration: ${name}`, { skip: !host, timeout: 30000 }, fn);
const management = ['mcp_connector_discover', 'mcp_connector_session_tools'];
const capability = (h) => `source:${h.sources[0].sourceId}`;
const visible = (h, agent) => h.ctx.tools.schemas(agent).map((tool) => tool.name);
const loaded = (h, agent) => h.integration.status(agent).restriction.preparedCount;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('disabled integration performs no Host or filesystem access', async () => {
  const integration = await createSmartModeIntegration(new Proxy({}, { get() { assert.fail('disabled Host access'); } }));
  await integration.mount(); await integration.dispose(); assert.deepEqual(integration.status(), { enabled: false });
});

test('integration refuses unknown Host contracts and a different explicit profile before writing smart storage', async (t) => {
  await assert.rejects(createSmartModeIntegration({}, { enabled: true, hostContract: 'unknown' }), { code: 'UNVERIFIED_INTEGRATION_HOST' });
  const selected = await temporaryProfile(t), target = await temporaryProfile(t);
  const callback = () => true;
  await assert.rejects(createSmartModeIntegration({}, { enabled: true, hostContract: SMART_INTEGRATION_HOST_CONTRACT,
    profileDir: target, getHostProfileDir: () => selected, scope: sourceFixture().scope,
    getRecords: () => [], isRecordUsable: callback, isRecordVisible: callback, isToolAllowed: callback,
    classifyInput: callback, isNativeExecutor: callback, projectToolSchema: callback,
  }), { code: 'INTEGRATION_PROFILE_MISMATCH' });
  await assert.rejects(fs.stat(join(target, 'storages')), { code: 'ENOENT' });
});

contract('partial lifecycle subscription failure rolls back every layer before later native sessions', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { mount: false });
  let listeners = 0;
  const ctx = new Proxy(h.ctx, { get(target, key) {
    if (key !== 'on') return Reflect.get(target, key, target);
    return (type, callback) => {
      if (type === 'agent/inbox/claimed') throw new Error('synthetic lifecycle subscription failure');
      const stop = target.on(type, callback); listeners++;
      let active = true;
      return () => { if (active) { active = false; stop(); listeners--; } };
    };
  } });
  const native = h.ctx.tools.selectExecutor();
  const integration = await createSmartModeIntegration(ctx, { enabled: true,
    hostContract: SMART_INTEGRATION_HOST_CONTRACT, profileDir: path, getHostProfileDir: () => path,
    scope: h.scope, getRecords: () => h.records, isRecordUsable: () => true,
    isRecordVisible: () => true, isToolAllowed: () => true, classifyInput: () => 'background',
    isNativeExecutor: (agent) => h.ctx.tools.selectExecutor(agent) === native,
    projectToolSchema: (definition) => JSON.parse(JSON.stringify(host.projectToolSchema(definition, true))),
    initialViews: { rawSources: h.rows, readOnlyReviews: h.reviews },
  });
  t.after(() => integration.dispose());
  await assert.rejects(integration.mount(), /synthetic lifecycle subscription failure/);
  assert.equal(listeners, 0);
  assert.equal(integration.status().mounted, false);
  const { agent } = await h.create('after-failed-mount'); await h.drive(agent);
  assert.ok(h.sources.every((source) => visible(h, agent).includes(source.publicName)));
  assert.equal(visible(h, agent).filter((name) => name.startsWith('mcp_connector_')).length, 25);
  assert.ok(!visible(h, agent).includes('mcp_connector_discover'));
  assert.deepEqual(h.errors, []);
});

contract('real JSONL profile keeps historical and pre-enablement blank sessions compatible beside a new smart session', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { mount: false });
  const old = await h.create('historical'); await h.drive(old.agent);
  const blank = await h.ctx.sessionPersistence.create({ id: 'old-blank', version: host.SESSION_FORMAT_VERSION,
    createdAt: 1, cwd: path, isSeeded: false }); await blank.flush(); await blank.close();
  await h.mount(); await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const previous = await h.resume('old-blank'); await h.drive(previous.agent);
  const fresh = await h.create('new-smart'); await h.drive(fresh.agent);
  assert.equal(h.integration.status(old.agent).lifecycle.mode, 'compat');
  assert.equal(h.integration.status(previous.agent).lifecycle.mode, 'compat');
  assert.equal(h.integration.status(fresh.agent).lifecycle.mode, 'smart');
  assert.ok(h.sources.every((source) => !visible(h, fresh.agent).includes(source.publicName)));
  assert.deepEqual(visible(h, fresh.agent).filter((name) => name.startsWith('mcp_connector_')).sort(), management);
  assert.ok(h.outside.every((name) => visible(h, fresh.agent).includes(name)));
  const persisted = await h.persisted(fresh.agent.id); assert.ok(persisted.events.some((event) => event.type === 'request/header'));
  assert.equal((await h.integration.readSnapshot(previous.agent.id)).mode, 'compat'); assert.deepEqual(h.errors, []);
});

contract('full 356-source profile uses candidate observations without approvals and prepares only one read-only source', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { full: true });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('full-group'); await h.drive(agent);
  assert.equal(h.sources.length, 356); assert.equal((await h.integration.candidates(agent)).length, 170);
  h.queue([{ name: 'mcp_connector_discover', args: { action: 'prepare', capabilityIds: [capability(h)] } }]);
  await h.drive(agent);
  assert.equal(loaded(h, agent), 1);
  const scoped = h.requests.at(-1).tools.filter((tool) => management.includes(tool.name) || h.sources.some((source) => source.publicName === tool.name));
  assert.equal(scoped.length, 3); assert.equal(estimateSmartToolTokens(scoped), h.integration.status(agent).resources.estimatedTokens);
  assert.ok(estimateSmartToolTokens(scoped) <= 5000); assert.deepEqual(h.errors, []);
});

contract('fork and subagent persist parent mode while new defaults and ephemeral prepared state remain isolated', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path);
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const parent = await h.create('parent'); await h.drive(parent.agent);
  assert.equal((await h.integration.prepare(parent.agent, { capabilityIds: [capability(h)] })).ok, true);
  await h.integration.setDefaultMode({ mode: 'compat', expectedRevision: 1 });
  const events = parent.agent.session.snapshotEvents();
  const fork = await h.create('fork', { seed: host.buildForkSeed(events, events.length - 1), inheritedEventCount: events.length,
    meta: { cwd: path, isSeeded: true, parentSession: parent.agent.id } });
  const child = await h.create('subagent', { parentAgent: parent.agent, meta: { cwd: path, origin: 'subagent', parentSession: parent.agent.id } });
  for (const handle of [fork, child]) {
    await h.drive(handle.agent); assert.equal(h.integration.status(handle.agent).lifecycle.mode, 'smart');
    assert.equal(loaded(h, handle.agent), 0); assert.equal((await h.integration.readSnapshot(handle.agent.id)).selection, 'parent');
  }
  const fresh = await h.create('new-compat'); await h.drive(fresh.agent);
  assert.equal(h.integration.status(fresh.agent).lifecycle.mode, 'compat');
  assert.equal(loaded(h, parent.agent), 1); assert.deepEqual(h.errors, []);
});

contract('clearing refuses pending preparation in the same Agent without blocking a different session', async (t) => {
  const h = await profileHarness(t, await temporaryProfile(t));
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const first = await h.create('clear-pending'), second = await h.create('clear-independent');
  await h.drive(first.agent); await h.drive(second.agent);
  assert.equal((await h.integration.prepare(second.agent, { capabilityIds: [capability(h)] })).ok, true);
  const pending = h.integration.prepare(first.agent, { capabilityIds: [capability(h)] });
  try {
    await assert.rejects(h.integration.clearSessionLoading(first.agent), { code: 'CONTROL_REQUIRES_IDLE_AGENT' });
    await h.integration.clearSessionLoading(second.agent);
    assert.equal(loaded(h, second.agent), 0);
  } finally { assert.equal((await pending).ok, true); }
  assert.equal(loaded(h, first.agent), 1);
  await h.integration.clearSessionLoading(first.agent);
  await tick();
  assert.equal(loaded(h, first.agent), 0);
  assert.equal(h.integration.status(first.agent).resources.retainedCount, 0);
  assert.deepEqual(h.errors, []);
});

contract('fresh Host context restores actual JSONL history and locked mode without old preparation or timers', async (t) => {
  const path = await temporaryProfile(t), first = await profileHarness(t, path);
  await first.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const live = await first.create('restored'); await first.drive(live.agent);
  await first.integration.prepare(live.agent, { capabilityIds: [capability(first)] });
  const saved = await first.integration.readSnapshot(live.agent.id); await first.close();
  const second = await profileHarness(t, path);
  await second.integration.setDefaultMode({ mode: 'compat', expectedRevision: 1 });
  const resumed = await second.resume('restored'); await second.drive(resumed.agent);
  assert.deepEqual(await second.integration.readSnapshot(resumed.agent.id), saved);
  const current = second.integration.status(resumed.agent);
  assert.equal(current.lifecycle.mode, 'smart'); assert.equal(current.resources.retainedCount, 0);
  assert.equal(current.resources.inFlight, 0); assert.equal(current.resources.activeSteps, 0);
  assert.ok((await second.persisted(resumed.agent.id)).events.filter((event) => event.type === 'assistant/message').length >= 2);
});

contract('real BasicCompaction checkpoints durable history without changing mode, source permissions or resource accounting', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path);
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('compact');
  await h.drive(agent, h.input('Synthetic material. '.repeat(600))); await h.drive(agent, h.input('Another synthetic paragraph. '.repeat(300)));
  await h.integration.prepare(agent, { capabilityIds: [capability(h)] });
  const before = await h.integration.readSnapshot(agent.id), generation = agent.session.surface.replaceGeneration;
  const result = await h.ctx.compaction.compactNow(agent, new AbortController().signal);
  assert.ok(result); assert.ok(agent.session.surface.replaceGeneration > generation);
  assert.deepEqual(await h.integration.readSnapshot(agent.id), before); assert.equal(loaded(h, agent), 1);
  const persisted = await h.persisted(agent.id);
  assert.ok(persisted.events.some((event) => event.type === 'compaction/start'));
  assert.ok(persisted.events.some((event) => event.type === 'compaction/end'));
  await h.drive(agent); assert.equal(h.integration.status(agent).resources.errorCode, null); assert.deepEqual(h.errors, []);
});

contract('clear replaces the conversation surface durably, preserves the system head and retains locked mode through restore', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path);
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const live = await h.create('clear'); await h.drive(live.agent, h.input('A synthetic old secret phrase.'));
  const session = live.agent.session, allNodes = [...session.surface.nodes];
  const nodes = session.eventAt(allNodes[0]).type === 'system/message' ? allNodes.slice(1) : allNodes;
  const message = host.createUserMessage({ content: [{ type: 'text', text: 'Synthetic history cleared.' }], source: { kind: 'runtime-context' } });
  session.append('user/message', message, { surfaceOp: { op: 'replace', startSeq: nodes[0], endSeq: nodes.at(-1) }, sourceEventSeqs: nodes });
  assert.equal(session.deriveMessages().some((item) => JSON.stringify(item).includes('old secret phrase')), false);
  await h.ctx.sessionPersistence.flush(); await live.dispose();
  const resumed = await h.resume('clear'); await h.drive(resumed.agent);
  assert.equal(h.integration.status(resumed.agent).lifecycle.mode, 'smart'); assert.equal(loaded(h, resumed.agent), 0);
  assert.equal(resumed.agent.session.deriveMessages().some((item) => JSON.stringify(item).includes('old secret phrase')), false);
});

contract('whole integration rollback restores exact legacy definitions, preserves external deny and can remount saved modes', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { mount: false });
  const { agent } = await h.create('rollback'); const legacy = h.ctx.tools.schemas(agent);
  await h.mount(); await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const smart = await h.create('smart-rollback'); await h.drive(smart.agent);
  await h.integration.prepare(smart.agent, { capabilityIds: [capability(h)] });
  const stopExternal = smart.agent.ctx.tools.restrict({ deny: [h.outside[0]] });
  const saved = await h.integration.readSnapshot(smart.agent.id);
  await h.integration.dispose();
  assert.deepEqual(h.ctx.tools.schemas(agent), legacy);
  assert.equal(visible(h, smart.agent).includes(h.outside[0]), false);
  assert.equal(visible(h, smart.agent).filter((name) => name.startsWith('mcp_connector_')).length, 25);
  assert.ok(h.sources.every((source) => visible(h, smart.agent).includes(source.publicName)));
  await h.mount(); assert.deepEqual(await h.integration.readSnapshot(smart.agent.id), saved);
  assert.equal(loaded(h, smart.agent), 0); assert.equal(h.integration.status(smart.agent).lifecycle.mode, 'smart');
  stopExternal();
});

contract('rollback preflight refuses a running Host before removing any local entry or guard', async (t) => {
  const gate = deferred(), entered = deferred();
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { beforeReply: async () => { entered.resolve(); await gate.promise; } });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('running-rollback'); const driving = h.drive(agent); await entered.promise;
  const before = visible(h, agent);
  await assert.rejects(h.integration.dispose(), { code: 'DISPOSE_REQUIRES_IDLE_AGENTS' });
  assert.deepEqual(visible(h, agent), before); assert.equal(h.integration.status(agent).mounted, true);
  gate.resolve(); await driving; await tick(); await h.integration.dispose();
  assert.equal(visible(h, agent).filter((name) => name.startsWith('mcp_connector_')).length, 25);
});

contract('rollback preflight refuses an asynchronous prepare transaction even while the Agent is idle', async (t) => {
  const gate = deferred(), entered = deferred(); let pending = false;
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { getUserSourceIntent: () => {
    if (!pending) return undefined;
    entered.resolve(); return gate.promise.then(() => undefined);
  } });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('pending-rollback'); await h.drive(agent); pending = true;
  const preparing = h.integration.prepare(agent, { capabilityIds: [capability(h)] }); await entered.promise;
  const before = visible(h, agent);
  await assert.rejects(h.integration.dispose(), { code: 'PREPARE_DISPOSE_REQUIRES_SETTLED_OPERATIONS' });
  assert.deepEqual(visible(h, agent), before); assert.equal(h.integration.status(agent).mounted, true);
  pending = false; gate.resolve(); assert.equal((await preparing).ok, true);
  await h.integration.dispose(); assert.equal(visible(h, agent).filter((name) => name.startsWith('mcp_connector_')).length, 25);
});

contract('a late mount failure unwinds every component and leaves original Host definitions available', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { mount: false });
  const { agent } = await h.create('mount-failure'); const before = h.ctx.tools.schemas(agent);
  const store = await SmartModeStore.open({ profileDir: path });
  await store.writeSnapshot(h.snapshot(agent.id));
  const file = store.snapshotPath(agent.id), value = JSON.parse(await fs.readFile(file, 'utf8')); value.version = 99;
  await fs.writeFile(file, JSON.stringify(value)); await store.close();
  await assert.rejects(h.mount(), { code: 'UNSUPPORTED_STORE_VERSION' });
  assert.deepEqual(h.ctx.tools.schemas(agent), before); assert.equal(h.integration.status(agent).enabled, false);
  await h.drive(agent); assert.ok(h.requests.at(-1).tools.some((tool) => tool.name === h.sources[0].publicName));
});

contract('old default records without an activation timestamp cannot auto-enable even a new empty session', async (t) => {
  const path = await temporaryProfile(t), store = await SmartModeStore.open({ profileDir: path });
  const scope = sourceFixture().scope;
  await store.setDefaultPolicy({ accountRef: scope.accountRef, groupId: scope.groupId, mode: 'smart', policyVersion: 'old-policy' }, { expectedRevision: 0 });
  await store.close();
  const h = await profileHarness(t, path); const { agent } = await h.create('no-activation-boundary'); await h.drive(agent);
  assert.equal(h.integration.status(agent).lifecycle.mode, 'compat');
});

contract('synthetic approved relations integrate aliases and independent revocation without approving actual sources', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { relation: true });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('relation'), capabilityId = `relation:${h.relations[0].id}`; await h.drive(agent);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true); assert.equal(loaded(h, agent), 1);
  h.queue([{ name: 'mcp_connector_discover', args: { action: 'search', query: h.sources[1].publicName } }]); await h.drive(agent);
  const result = h.events.filter((item) => item.id === agent.id && item.event.type === 'tool/result').at(-1).event;
  const rendered = JSON.stringify(result.data.message.content);
  assert.ok(rendered.includes(h.sources[0].publicName)); assert.ok(rendered.includes(h.sources[1].publicName));
  const store = await SmartModeStore.open({ profileDir: path });
  const current = await store.readSourceRelation(h.scope.accountRef, h.scope.groupId, h.relations[0].id);
  await store.setSourceRelation({ ...relationInput(current), enabled: false }, { expectedRevision: current.revision }); await store.close();
  await h.integration.refreshControl(); assert.equal(loaded(h, agent), 0);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).message, 'RELATION_DISABLED');
});

contract('final local fixture outcomes update successful source preference and latch failure before another selection', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { relation: true, syntheticOutcomes: true });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('outcomes'); await h.drive(agent);
  const capabilityId = `relation:${h.relations[0].id}`;
  const intent = (source, evidence) => ({ sessionId: agent.id, accountRef: h.scope.accountRef, groupId: h.scope.groupId,
    capabilityId, kind: 'source', sources: [{ sourceId: source.sourceId, definitionFingerprint: source.definitionFingerprint }],
    evidenceHash: evidence.repeat(64), expiresAt: h.at + 86400000 });
  const call = async (source, args = {}) => (await h.ctx.tools.execute({ agent, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: `outcome-${Math.random()}`, name: source.publicName, arguments: JSON.stringify(args) }] })).results[0].result;
  h.intents.set(agent, intent(h.sources[1], 'a'));
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
  assert.equal((await call(h.sources[1])).isError, false); h.intents.delete(agent);
  const reused = await h.integration.prepare(agent, { capabilityIds: [capabilityId] });
  assert.deepEqual(reused.detail.prepared, [h.sources[1].publicName]);
  assert.equal((await call(h.sources[1], { fail: true })).isError, true);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).message, 'SOURCE_SWITCH_REQUIRES_CONFIRMATION');
  h.intents.set(agent, intent(h.sources[0], 'b'));
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
  assert.equal((await call(h.sources[0])).isError, false); h.intents.delete(agent);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
});

contract('canceling a local fixture invocation does not turn cancellation into a source-switch confirmation requirement', async (t) => {
  const gate = deferred(), entered = deferred();
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { syntheticOutcomes: true, expectedSyntheticCalls: 1,
    syntheticBody: async () => { entered.resolve(); await gate.promise; return { ok: true }; },
  });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('cancel-outcome'); await h.drive(agent);
  await h.integration.prepare(agent, { capabilityIds: [capability(h)] });
  const cancellation = new AbortController();
  const calling = h.ctx.tools.execute({ agent, signal: cancellation.signal,
    calls: [{ type: 'tool-call', id: 'canceled-local', name: h.sources[0].publicName, arguments: '{}' }] });
  await bounded(entered.promise); cancellation.abort(); gate.resolve();
  assert.equal((await calling).results[0].result.isError, true);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capability(h)] })).ok, true);
});

contract('rollback refuses a canceled but still pending snapshot write before releasing its smart mask', async (t) => {
  const gate = deferred(), entered = deferred(); let pause = false;
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { storeOptions: { io: { ...fs,
    async link(from, to) {
      if (pause && String(to).includes('sessions')) { entered.resolve(); await gate.promise; }
      return fs.link(from, to);
    },
  } } });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('pending-snapshot'); pause = true;
  const driving = h.drive(agent); await bounded(entered.promise);
  agent.cancel({ kind: 'user' }); await bounded(driving);
  await assert.rejects(h.integration.dispose(), { code: 'DISPOSE_REQUIRES_SETTLED_WRITES' });
  assert.equal(h.integration.status(agent).mounted, true);
  assert.deepEqual(visible(h, agent).filter((name) => name.startsWith('mcp_connector_')).sort(), management);
  pause = false; gate.resolve(); await tick(); await tick();
  // Complete the same write transaction before whole-stack teardown.
  for (let i = 0; i < 2000 && !h.integration.status(agent).lifecycle.committed; i++) await new Promise((done) => setTimeout(done, 5));
  assert.equal(h.integration.status(agent).lifecycle.committed, true);
  await h.integration.dispose();
});

contract('a slow control refresh cannot overwrite a newer independently disabled source relation', async (t) => {
  const gate = deferred(), entered = deferred(); let hold = false;
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { relation: true, storeOptions: { io: { ...fs,
    async readFile(file, ...args) {
      const value = await fs.readFile(file, ...args);
      if (hold && String(file).includes('source_relations') && String(file).endsWith('0000000000000001.json')) {
        hold = false; entered.resolve(); await gate.promise;
      }
      return value;
    },
  } } });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('refresh-order'); await h.drive(agent);
  const capabilityId = `relation:${h.relations[0].id}`;
  hold = true; const oldRefresh = h.integration.refreshControl(); await entered.promise;
  const store = await SmartModeStore.open({ profileDir: path });
  const current = await store.readSourceRelation(h.scope.accountRef, h.scope.groupId, h.relations[0].id);
  await store.setSourceRelation({ ...relationInput(current), enabled: false }, { expectedRevision: current.revision }); await store.close();
  assert.equal(await h.integration.refreshControl(), true); gate.resolve(); assert.equal(await oldRefresh, false);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).message, 'RELATION_DISABLED');
});

contract('control corruption invalidates the published relationship view instead of freezing a previously loaded approval', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { relation: true });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('control-corrupt'); await h.drive(agent);
  const capabilityId = `relation:${h.relations[0].id}`;
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
  const store = new SmartModeStore({ profileDir: path });
  const file = join(store.relationDir(h.scope.accountRef, h.scope.groupId, h.relations[0].id), '0000000000000001.json');
  const original = await fs.readFile(file, 'utf8'), broken = JSON.parse(original); broken.version = 99;
  await fs.writeFile(file, JSON.stringify(broken));
  await assert.rejects(h.integration.refreshControl(), { code: 'UNSUPPORTED_STORE_VERSION' });
  assert.equal(loaded(h, agent), 0); const before = h.requests.length;
  await h.drive(agent); assert.equal(h.requests.length, before); assert.ok(agent.inbox.nextTurn.length > 0);
  await fs.writeFile(file, original); await h.integration.refreshControl();
  assert.equal(loaded(h, agent), 0, 'a restored file does not revive an invalidated load');
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
});

contract('snapshot disk failure blocks real requests, preserves input and retries the same isolated transaction', async (t) => {
  let failing = false;
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { storeOptions: { io: { ...fs,
    async link(from, to) { if (failing && String(to).includes('sessions')) throw Object.assign(new Error('Synthetic disk failure'), { code: 'ENOSPC' }); return fs.link(from, to); },
  } } });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('disk-failure'), input = h.input(); failing = true;
  await h.drive(agent, input); assert.equal(h.requests.length, 0);
  assert.deepEqual(agent.inbox.nextTurn.map((item) => item.id), [input.id]);
  failing = false; await h.integration.retry(agent); await h.drive(agent);
  assert.equal((await h.integration.readSnapshot(agent.id)).mode, 'smart');
  const rows = (await h.persisted(agent.id)).events.filter((event) => event.type === 'user/message' && event.data.id === input.id);
  assert.equal(rows.length, 1);
});

contract('published raw definitions are detached, versioned and tied to current Host registration identity', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path);
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create('views'); await h.drive(agent);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capability(h)] })).ok, true);
  h.rows[0].definition.description = 'changed outside the published copy';
  assert.equal(loaded(h, agent), 1);
  h.replaceRegistration(h.sources[0]);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capability(h)] })).message, 'RAW_VIEW_STALE');
  assert.throws(() => h.integration.publishViews({ rawSources: h.rows }, { expectedRevision: 0 }), { code: 'VIEW_REVISION_CONFLICT' });
  h.integration.publishViews({ rawSources: h.rows }, { expectedRevision: 1 });
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capability(h)] })).message, 'READ_ONLY_REVIEW_REQUIRED');
});

contract('unknown stored snapshot is refused without a request or automatic compatibility widening', async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path);
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const live = await h.create('corrupt'); await h.drive(live.agent); await live.dispose();
  const store = new SmartModeStore({ profileDir: path });
  const file = store.snapshotPath('corrupt'); const value = JSON.parse(await fs.readFile(file, 'utf8')); value.version = 99;
  await fs.writeFile(file, JSON.stringify(value));
  const before = h.requests.length;
  await assert.rejects(h.resume('corrupt'), { code: 'UNSUPPORTED_STORE_VERSION' }); assert.equal(h.requests.length, before);
  assert.equal(h.ctx.agents.get('corrupt'), undefined);
});

for (const model of ['no-update', 'addition-only']) contract(`${model} model capability keeps current scoped schemas within budget across prepare and release`, async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { model });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create(`route-${model}`); await h.drive(agent);
  await h.integration.prepare(agent, { capabilityIds: [capability(h)] }); await h.drive(agent);
  await h.integration.release(agent, { publicNames: [h.sources[0].publicName] }); await h.drive(agent);
  assert.ok(h.integration.status(agent).resources.estimatedTokens <= 5000);
  const header = agent.session.requestHeader();
  assert.ok(!header.tools?.some((tool) => tool.name === h.sources[0].publicName));
  assert.deepEqual(h.errors, []);
});

for (const model of ['no-update', 'addition-only']) contract(`${model} definition changes require a new full-fingerprint review and reach the next adapter request`, async (t) => {
  const path = await temporaryProfile(t), h = await profileHarness(t, path, { model });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const { agent } = await h.create(`definition-${model}`); await h.drive(agent);
  await h.integration.prepare(agent, { capabilityIds: [capability(h)] }); await h.drive(agent);
  h.rows[0].definition.inputSchema.properties.revision = { type: 'integer' };
  h.replaceRegistration(h.sources[0]);
  h.integration.publishViews({ rawSources: h.rows }, { expectedRevision: 1 });
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capability(h)] })).message, 'READ_ONLY_REVIEW_REQUIRED');
  const sources = [...indexRawToolSources(h.scope, h.rows).values()];
  const reviews = sources.map((source) => readOnlyReviewFor(h.scope, source, { validFrom: 0, expiresAt: h.at + 86400000 }));
  h.integration.publishViews({ readOnlyReviews: reviews }, { expectedRevision: 2 });
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [capability(h)] })).ok, true);
  await h.drive(agent);
  const projected = h.requests.at(-1).tools.find((tool) => tool.name === h.sources[0].publicName);
  assert.deepEqual(projected.parameters.properties.revision, { type: 'integer' });
  assert.deepEqual(h.errors, []);
});
