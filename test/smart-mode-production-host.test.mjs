import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { SmartModeStore } from '../lib/smart-mode-store.js';
import { host } from '../scripts/fixtures/smart-mode-profile.mjs';
import { productionHarness } from '../scripts/fixtures/smart-mode-production.mjs';
import { signedEvidenceFixture } from '../scripts/fixtures/read-only-evidence.mjs';

const contract = (name, fn) => test(`normal plugin startup: ${name}`, { skip: !host, timeout: 60000 }, fn);
const ok = (value) => { assert.equal(value.ok, true, JSON.stringify(value)); return value.result; };
async function search(f, sessionId, count) {
  return f.waitFor(async () => {
    const response = await f.rpc('search', { sessionId, query: 'fixture' });
    return response.ok && response.result.total === count ? response.result : undefined;
  });
}

contract('actual Host services expose authenticated controls without enabling a default; one confirmation activates new sessions', async (t) => {
  const f = await productionHarness(t);
  let state = ok(await f.rpc('state'));
  assert.equal(state.defaultMode, 'compat'); assert.equal(state.mounted, false);
  assert.deepEqual(state.workspaces, [{ id: 'workspace-a', title: 'Synthetic project' }]);
  const old = ok(await f.rpc('create')); await f.prompt(old.sessionId);
  const nativeNames = () => f.h.ctx.tools.schemas(f.h.ctx.agents.get(old.sessionId)).map((tool) => tool.name);
  assert.equal(nativeNames().filter((name) => name.startsWith('mcp_connector_')).length, 25);
  assert.ok(f.h.sources.every((source) => nativeNames().includes(source.publicName)));
  await f.enable();
  const fresh = ok(await f.rpc('create')); await f.prompt(fresh.sessionId);
  state = ok(await f.rpc('state'));
  assert.equal(state.sessions.find((row) => row.sessionId === old.sessionId).mode, 'compat');
  assert.equal(state.sessions.find((row) => row.sessionId === fresh.sessionId).mode, 'smart');
  const agent = f.h.ctx.agents.get(fresh.sessionId), names = f.h.ctx.tools.schemas(agent).map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => name.startsWith('mcp_connector_')).sort(), ['mcp_connector_discover', 'mcp_connector_session_tools']);
  assert.ok(f.h.sources.every((source) => !names.includes(source.publicName)));
  const search = await f.waitFor(async () => {
    const value = await f.rpc('search', { sessionId: fresh.sessionId, query: 'fixture' });
    return value.ok && value.result.total === 4 ? value.result : undefined;
  });
  const item = search.items[0];
  const inspected = ok(await f.rpc('inspect', { sessionId: fresh.sessionId, sourceId: item.sourceId }));
  assert.equal(inspected.definition.inputSchema.properties.query.default, 'fixture');
  assert.deepEqual(inspected.definition.inputSchema.properties.query.examples, ['synthetic']);
  const result = await f.h.ctx.tools.get('mcp_connector_discover', agent).execute({ action: 'prepare', capabilityIds: [item.capabilityId] },
    { agent, signal: new AbortController().signal });
  assert.equal(result.message, 'READ_ONLY_REVIEW_REQUIRED');
  const review = ok(await f.rpc('previewReview', { sessionId: fresh.sessionId, sourceId: item.sourceId,
    evidenceHash: 'e'.repeat(64), enabled: true, validForMs: 60000, expectedRevision: 0 }));
  assert.equal((await f.rpc('commit', { previewId: review.previewId })).code, 'READ_ONLY_APPROVAL_REQUIRED');
  assert.ok(f.metadataCalls > 0); assert.deepEqual(f.h.errors, []);
});

contract('real signed browser cookie is required and normal workspace placement is retained', async (t) => {
  const f = await productionHarness(t, { multipleWorkspaces: true });
  assert.equal((await f.rpc('state', {}, { cookie: '' })).status, 403);
  assert.equal((await f.rpc('state', {}, { cookie: 'fake=owner', 'x-principal': 'owner' })).status, 403);
  assert.equal((await f.rpc('state', {}, { origin: 'https://foreign.invalid' })).status, 403);
  // API operator admission is a real signed Host cookie, but is not the
  // browser-owner surface authorized to manage this control page.
  assert.equal((await f.rpc('state', {}, { cookie: await f.operatorCookie() })).status, 403);
  assert.equal((await f.rpc('create')).code, 'CONTROL_WORKSPACE_REQUIRED');
  const created = ok(await f.rpc('create', { workspaceId: 'workspace-b' }));
  assert.equal(f.h.ctx.agents.get(created.sessionId).session.header.cwd, f.workspaceRows[1].path);
  assert.ok(f.workspaceRows[1].sessionIds.includes(created.sessionId));
  await f.prompt(created.sessionId);
  await f.enable();
  const forged = ok(await f.rpc('create', { workspaceId: 'workspace-a' }));
  await f.h.drive(f.h.ctx.agents.get(forged.sessionId), host.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic background.' }] }));
  const store = await SmartModeStore.open({ profileDir: f.path });
  try { assert.equal((await store.readSnapshot(forged.sessionId)).mode, 'compat'); } finally { await store.close(); }
  assert.deepEqual(f.h.errors, []);
});

contract('a real disk write failure rolls back newly mounted restrictions before retry', async (t) => {
  const f = await productionHarness(t), created = ok(await f.rpc('create'));
  await f.prompt(created.sessionId);
  const state = ok(await f.rpc('state'));
  const preview = ok(await f.rpc('previewMode', { mode: 'smart', expectedRevision: state.policyRevision }));
  const defaults = join(f.path, 'storages', 'mcp_connector_smart_v1', 'defaults');
  await fs.writeFile(defaults, 'synthetic write-failure fixture', { flag: 'wx' });
  try {
    assert.equal((await f.rpc('commit', { previewId: preview.previewId })).ok, false);
    const after = ok(await f.rpc('state'));
    assert.equal(after.mounted, false); assert.equal(after.defaultMode, 'compat'); assert.equal(after.policyRevision, 0);
    const names = f.h.ctx.tools.schemas(f.h.ctx.agents.get(created.sessionId)).map((row) => row.name);
    assert.equal(names.filter((name) => name.startsWith('mcp_connector_')).length, 25);
    assert.ok(f.h.sources.every((source) => names.includes(source.publicName)));
  } finally { await fs.unlink(defaults); }
  await f.enable(); assert.equal(ok(await f.rpc('state')).mounted, true);
  assert.deepEqual(f.h.errors, []);
});

contract('normal governance and workspace scopes remain authoritative; disabled members cannot stall permitted sources', async (t) => {
  const f = await productionHarness(t, { multipleWorkspaces: true });
  await f.enable();
  const a = ok(await f.rpc('create', { workspaceId: 'workspace-a' })); await f.prompt(a.sessionId);
  const b = ok(await f.rpc('create', { workspaceId: 'workspace-b' })); await f.prompt(b.sessionId);
  const initial = await search(f, a.sessionId, 4), company = initial.items.find((row) => row.serverName === 'qcc-company');
  assert.ok(company);
  const manualKey = f.h.scope.connections[2].connectionKey;
  assert.equal((await f.legacy('setInjectionMode', { key: manualKey, mode: 'session' })).ok, true);
  const manual = (await search(f, a.sessionId, 4)).items.find((row) => row.serverName === 'qcc-ipr');
  assert.equal(manual.manual, true); assert.equal(manual.available, false);
  assert.equal((await search(f, b.sessionId, 4)).items.find((row) => row.sourceId === manual.sourceId).available, false);
  const manualAgent = f.h.ctx.agents.get(a.sessionId);
  const manualPrepare = await f.h.ctx.tools.get('mcp_connector_discover', manualAgent).execute({ action: 'prepare', capabilityIds: [manual.capabilityId] },
    { agent: manualAgent, signal: new AbortController().signal });
  assert.equal(manualPrepare.message, 'MANUAL_ACTIVATION_REQUIRED');
  assert.equal((await f.legacy('setInjectionMode', { key: manualKey, mode: 'always' })).ok, true);
  await search(f, a.sessionId, 4);
  const scopeInput = { key: f.h.scope.connections[0].connectionKey, targetScope: 'project', targetWorkspaceId: 'workspace-a' };
  const preview = await f.legacy('previewConnectionScope', scopeInput); assert.equal(preview.ok, true, JSON.stringify(preview));
  const scoped = await f.legacy('applyConnectionScope', { ...scopeInput, expectedRevision: preview.detail.baseRevision });
  assert.equal(scoped.ok, true, JSON.stringify(scoped));
  assert.equal((await search(f, a.sessionId, 4)).total, 4);
  assert.equal((await search(f, b.sessionId, 3)).total, 3);
  const denied = await f.legacy('applyPolicy', { scope: 'server', connectorId: 'qcc-company', serverName: 'qcc-risk', effect: 'deny', expectedRevision: 0 });
  assert.equal(denied.ok, true, JSON.stringify(denied));
  assert.equal((await search(f, a.sessionId, 2)).total, 2);
  const disabled = await f.legacy('setEnabled', { key: f.h.scope.connections[0].connectionKey, enabled: false });
  assert.equal(disabled.ok, true, JSON.stringify(disabled));
  assert.equal((await search(f, a.sessionId, 1)).total, 1);
  ok(await f.rpc('layer', { enabled: false }));
  const legacyNames = f.h.ctx.tools.schemas(f.h.ctx.agents.get(a.sessionId)).map((row) => row.name);
  assert.equal(legacyNames.filter((name) => name.startsWith('mcp_connector_')).length, 25);
  assert.ok(!legacyNames.includes(company.publicName));
  assert.ok(!legacyNames.some((name) => name.startsWith('mcp__qcc-risk__')));
  assert.deepEqual(f.h.errors, []);
});

contract('synthetic fingerprint approval enables prepare only in its session; rollback and cold restart discard loading', async (t) => {
  const f = await productionHarness(t); await f.enable();
  const a = ok(await f.rpc('create')); await f.prompt(a.sessionId);
  const b = ok(await f.rpc('create')); await f.prompt(b.sessionId);
  const item = (await search(f, a.sessionId, 4)).items[0];
  const inspected = ok(await f.rpc('inspect', { sessionId: a.sessionId, sourceId: item.sourceId }));
  const store = await SmartModeStore.open({ profileDir: f.path, approveReadOnlyReview: async (review) => review.accountRef === 'synthetic-grant-a' });
  try {
    await store.setReadOnlyReview({ version: 1, accountRef: f.h.scope.accountRef, groupId: f.h.scope.groupId,
      sourceId: item.sourceId, definitionFingerprint: inspected.source.definitionFingerprint, enabled: true,
      validFrom: Date.now() - 1000, expiresAt: Date.now() + 3600000,
      review: { effect: 'read-only', evidenceHash: 'a'.repeat(64), reviewedAt: Date.now(), reviewerHash: 'b'.repeat(64) } }, { expectedRevision: 0 });
  } finally { await store.close(); }
  // A historical local approval alone must not bypass the new production gate.
  ok(await f.rpc('layer', { enabled: false })); ok(await f.rpc('layer', { enabled: true }));
  const beforeEvidence = await f.h.ctx.tools.get('mcp_connector_discover', f.h.ctx.agents.get(a.sessionId)).execute(
    { action: 'prepare', capabilityIds: [item.capabilityId] }, { agent: f.h.ctx.agents.get(a.sessionId), signal: new AbortController().signal });
  assert.equal(beforeEvidence.message, 'READ_ONLY_REVIEW_REQUIRED');
  const signed = await signedEvidenceFixture(f.path, f.h.scope, [inspected.source]); await signed.deliver();
  ok(await f.rpc('layer', { enabled: false })); ok(await f.rpc('layer', { enabled: true }));
  await search(f, a.sessionId, 4);
  const agent = f.h.ctx.agents.get(a.sessionId), other = f.h.ctx.agents.get(b.sessionId);
  const prepared = await f.h.ctx.tools.get('mcp_connector_discover', agent).execute({ action: 'prepare', capabilityIds: [item.capabilityId] },
    { agent, signal: new AbortController().signal });
  assert.notEqual(prepared.message, 'READ_ONLY_REVIEW_REQUIRED');
  assert.ok(f.h.ctx.tools.get(item.publicName, agent), JSON.stringify(prepared));
  assert.equal(f.h.ctx.tools.get(item.publicName, other), undefined);
  const changedRow = f.h.rows.find((row) => row.connectionKey === inspected.source.connectionKey && row.definition.name === inspected.source.rawName);
  changedRow.definition.outputSchema.description = 'Synthetic changed output contract';
  f.h.replaceRegistration(f.h.sources.find((source) => source.publicName === item.publicName));
  await search(f, a.sessionId, 4);
  const changed = ok(await f.rpc('inspect', { sessionId: a.sessionId, sourceId: item.sourceId }));
  assert.notEqual(changed.source.definitionFingerprint, inspected.source.definitionFingerprint);
  assert.equal(f.h.ctx.tools.get(item.publicName, agent), undefined);
  const rejected = await f.h.ctx.tools.get('mcp_connector_discover', agent).execute({ action: 'prepare', capabilityIds: [item.capabilityId] },
    { agent, signal: new AbortController().signal });
  assert.equal(rejected.message, 'READ_ONLY_REVIEW_REQUIRED');
  ok(await f.rpc('layer', { enabled: false }));
  assert.equal(ok(await f.rpc('state')).defaultMode, 'smart');
  assert.equal(f.h.ctx.tools.schemas(agent).filter((row) => row.name.startsWith('mcp_connector_')).length, 25);
  ok(await f.rpc('layer', { enabled: true }));
  assert.equal(f.h.ctx.tools.get(item.publicName, agent), undefined);
  await f.h.close();
  const restored = await productionHarness(t, { profileDir: f.path });
  assert.equal(ok(await restored.rpc('state')).mounted, true);
  const resolved = await restored.services.sessionController.resolveAgent(a.sessionId);
  assert.ok(resolved.agent, String(resolved.error));
  ok(await restored.rpc('resume', { sessionId: a.sessionId })); await restored.prompt(a.sessionId);
  assert.equal(ok(await restored.rpc('state')).sessions.find((row) => row.sessionId === a.sessionId).mode, 'smart');
  assert.equal(restored.h.ctx.tools.get(item.publicName, restored.h.ctx.agents.get(a.sessionId)), undefined);
  assert.deepEqual(restored.h.errors, []);
});

contract('a busy legacy Agent blocks initial activation without persisting the smart default', async (t) => {
  let enter, release, hold = false;
  const started = new Promise((resolve) => { enter = resolve; }), gate = new Promise((resolve) => { release = resolve; });
  const f = await productionHarness(t, { beforeReply: async () => { if (hold) { enter(); await gate; } } });
  const created = ok(await f.rpc('create')); await f.prompt(created.sessionId);
  const preview = ok(await f.rpc('previewMode', { mode: 'smart', expectedRevision: 0 }));
  hold = true; const pending = f.prompt(created.sessionId); await started;
  try {
    assert.equal((await f.rpc('commit', { previewId: preview.previewId })).code, 'INTEGRATION_REQUIRES_IDLE_AGENTS');
    const state = ok(await f.rpc('state'));
    assert.equal(state.mounted, false); assert.equal(state.defaultMode, 'compat'); assert.equal(state.policyRevision, 0);
  } finally { hold = false; release(); await pending; }
  await f.enable(); assert.equal(ok(await f.rpc('state')).mounted, true);
  assert.deepEqual(f.h.errors, []);
});
