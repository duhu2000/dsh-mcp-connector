import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import { createSmartModeControl } from '../lib/smart-mode-control.js';
import { SmartModeStore } from '../lib/smart-mode-store.js';
import { host, temporaryProfile } from '../scripts/fixtures/smart-mode-profile.mjs';
import { controlHarness } from '../scripts/fixtures/smart-mode-control.mjs';

const contract = (name, fn) => test(`human control: ${name}`, { skip: !host, timeout: 30000 }, fn);
async function ok(promise) { const value = await promise; assert.equal(value.ok, true, JSON.stringify(value)); return value.result; }
async function mode(f, mode, revision) { const p = await ok(f.rpc('previewMode', { mode, expectedRevision: revision })); return ok(f.rpc('commit', { previewId: p.previewId })); }
async function smart(f) { await mode(f, 'smart', 0); return ok(f.rpc('create')); }
async function review(f, id, extra = {}) {
  const source = f.current.sources[0];
  const p = await ok(f.rpc('previewReview', { sessionId: id, sourceId: source.sourceId, evidenceHash: 'e'.repeat(64),
    enabled: true, validForMs: 3600000, expectedRevision: 0, ...extra }));
  return { preview: p, source };
}

test('disabled human control performs no Host or disk access', async () => {
  const value = await createSmartModeControl();
  await assert.rejects(value.dispatch('state', {}, {}), { code: 'CONTROL_DISABLED' }); await value.close();
});

contract('mode preview is principal-bound, single-use, revision checked and keeps historical sessions compatible', async (t) => {
  const f = await controlHarness(t), old = await ok(f.rpc('create'));
  const p = await ok(f.rpc('previewMode', { mode: 'smart', expectedRevision: 0 }));
  await assert.rejects(f.control.dispatch('commit', { previewId: p.previewId }, { ...f.principal, id: 'different-human' }), { code: 'CONTROL_PREVIEW_EXPIRED' });
  await ok(f.rpc('commit', { previewId: p.previewId }));
  assert.equal((await f.rpc('commit', { previewId: p.previewId })).code, 'CONTROL_PREVIEW_EXPIRED');
  const created = await ok(f.rpc('create')), state = await ok(f.rpc('state'));
  assert.equal(state.sessions.find((row) => row.sessionId === old.sessionId).mode, 'compat');
  assert.equal(state.sessions.find((row) => row.sessionId === created.sessionId).mode, 'smart');
  const stale = await ok(f.rpc('previewMode', { mode: 'compat', expectedRevision: 0 }));
  assert.equal((await f.rpc('commit', { previewId: stale.previewId })).code, 'POLICY_REVISION_CONFLICT');
});

contract('independent readonly approval persists, enables preparation and a revocation masks it immediately', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f);
  const { preview, source } = await review(f, sessionId), agent = f.live.get(sessionId).agent;
  assert.equal((await f.current.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] })).message, 'READ_ONLY_REVIEW_REQUIRED');
  await ok(f.rpc('commit', { previewId: preview.previewId }));
  assert.equal((await f.current.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] })).ok, true);
  assert.ok(agent.ctx.tools.get(source.publicName, agent));
  const revoked = await review(f, sessionId, { enabled: false, expectedRevision: 1 });
  await ok(f.rpc('commit', { previewId: revoked.preview.previewId }));
  assert.equal(agent.ctx.tools.get(source.publicName, agent), undefined);
  const inspected = await ok(f.rpc('inspect', { sessionId, sourceId: source.sourceId }));
  assert.equal(inspected.persistedReview.revision, 2); assert.equal(inspected.persistedReview.review.enabled, false);
  assert.match(inspected.persistedReview.review.review.reviewerHash, /^[a-f0-9]{64}$/);
});

contract('readonly self-claims, stale definitions and expired previews cannot produce approval', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f);
  const denied = await review(f, sessionId, { evidenceHash: 'a'.repeat(64) });
  assert.equal((await f.rpc('commit', { previewId: denied.preview.previewId })).code, 'READ_ONLY_APPROVAL_REQUIRED');
  const stale = await review(f, sessionId);
  f.current.rows[0].definition._registration_tool = 'changed-synthetic-registration';
  f.current.integration.publishViews({ rawSources: f.current.rows }, { expectedRevision: f.current.integration.status().viewRevision });
  assert.equal((await f.rpc('commit', { previewId: stale.preview.previewId })).code, 'CONTROL_PREVIEW_STALE');
  const expired = await review(f, sessionId); f.current.at += 60001;
  assert.equal((await f.rpc('commit', { previewId: expired.preview.previewId })).code, 'CONTROL_PREVIEW_EXPIRED');
});

contract('human source choice is separate from loading, checks permission again, and clears across restore', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f), source = f.current.sources[0];
  const params = { sessionId, capabilityId: `source:${source.sourceId}`, kind: 'source', sourceIds: [source.sourceId] };
  let p = await ok(f.rpc('previewSource', params));
  f.current.denied.add(source.publicName); await f.current.integration.refreshControl();
  assert.equal((await f.rpc('commit', { previewId: p.previewId })).ok, false);
  f.current.denied.clear(); await f.current.integration.refreshControl();
  p = await ok(f.rpc('previewSource', params)); await ok(f.rpc('commit', { previewId: p.previewId }));
  assert.equal(f.current.integration.status(f.live.get(sessionId).agent).restriction.preparedCount, 0);
  await ok(f.rpc('resume', { sessionId }));
  assert.equal(f.current.integration.status(f.live.get(sessionId).agent).restriction.preparedCount, 0);
  const forged = await f.rpc('previewSource', { ...params, principal: f.principal });
  assert.equal(forged.code, 'CONTROL_INVALID_ARGUMENTS');
});

contract('actual HTTP clear and native compact command retain locked modes, release loading, and survive JSONL restore', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f);
  const { preview, source } = await review(f, sessionId); await ok(f.rpc('commit', { previewId: preview.previewId }));
  let agent = f.live.get(sessionId).agent;
  await f.current.drive(agent, f.current.input('Synthetic old context. '.repeat(700)));
  await f.current.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] });
  await ok(f.rpc('compact', { sessionId }));
  assert.ok((await f.current.persisted(sessionId)).events.some((event) => event.type === 'command/run'));
  assert.ok((await f.current.persisted(sessionId)).events.some((event) => event.type === 'compaction/end'));
  assert.equal(f.current.integration.status(agent).restriction.preparedCount, 1);
  await ok(f.rpc('clear', { sessionId }));
  assert.equal(f.current.integration.status(agent).restriction.preparedCount, 0);
  assert.equal(agent.session.deriveMessages().some((message) => JSON.stringify(message).includes('Synthetic old context.')), false);
  assert.equal(f.current.integration.status(agent).lifecycle.mode, 'smart');
  await ok(f.rpc('resume', { sessionId })); agent = f.live.get(sessionId).agent;
  assert.equal(f.current.integration.status(agent).lifecycle.mode, 'smart');
  assert.equal(agent.session.deriveMessages().some((message) => JSON.stringify(message).includes('Synthetic old context.')), false);
});

contract('whole layer stop/start restores native tools and persisted reviews with no surviving loading', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f), { preview, source } = await review(f, sessionId);
  await ok(f.rpc('commit', { previewId: preview.previewId }));
  const agent = f.live.get(sessionId).agent;
  await f.current.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] });
  await ok(f.rpc('layer', { enabled: false }));
  assert.ok(agent.ctx.tools.get(f.current.sources[1].publicName, agent));
  await ok(f.rpc('layer', { enabled: true }));
  assert.equal(f.current.integration.status(agent).restriction.preparedCount, 0);
  assert.equal((await f.current.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] })).ok, true);
});

contract('HTTP trust, CSRF, principal permissions and profile identity cannot be supplied in a model-shaped body', async (t) => {
  const f = await controlHarness(t);
  assert.equal((await f.rpc('state', {}, { origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await f.rpc('state', {}, { 'x-mcp-control-nonce': 'forged' })).status, 403);
  await assert.rejects(f.control.dispatch('previewMode', { mode: 'smart', expectedRevision: 0 }, { ...f.principal, permissions: ['read'] }), { code: 'CONTROL_FORBIDDEN' });
  await assert.rejects(f.control.dispatch('state', {}, { ...f.principal, accountRef: 'other-account' }), { code: 'CONTROL_FORBIDDEN' });
  const other = await temporaryProfile(t);
  await assert.rejects(createSmartModeControl({ enabled: true, profileDir: other, scope: f.current.scope,
    getIntegration: () => f.current.integration, getAgents: () => [], setLayerEnabled: () => {} }), { code: 'CONTROL_PROFILE_MISMATCH' });
  await assert.rejects(fs.stat(join(other, 'storages')), { code: 'ENOENT' });
});

contract('corrupt durable readonly evidence blocks inference instead of preserving an earlier approval', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f), { preview, source } = await review(f, sessionId);
  await ok(f.rpc('commit', { previewId: preview.previewId }));
  const store = await SmartModeStore.open({ profileDir: f.profileDir });
  const file = join(store.readOnlyReviewDir(f.current.scope.accountRef, f.current.scope.groupId, source.sourceId, source.definitionFingerprint), '0000000000000001.json');
  await fs.writeFile(file, 'corrupt'); await store.close();
  await assert.rejects(f.current.integration.refreshControl(), { code: 'MALFORMED_STORE_RECORD' });
  assert.equal((await f.current.integration.prepare(f.live.get(sessionId).agent, { capabilityIds: [`source:${source.sourceId}`] })).message, 'MALFORMED_STORE_RECORD');
});

contract('busy rollback/clear are refused but readonly revocation still closes future dispatch', async (t) => {
  let hold = false, entered, release;
  const started = new Promise((resolve) => { entered = resolve; }), gate = new Promise((resolve) => { release = resolve; });
  const f = await controlHarness(t, { beforeReply: async () => { if (hold) { entered(); await gate; } } });
  const { sessionId } = await smart(f), approved = await review(f, sessionId);
  await ok(f.rpc('commit', { previewId: approved.preview.previewId }));
  const agent = f.live.get(sessionId).agent;
  await f.current.integration.prepare(agent, { capabilityIds: [`source:${approved.source.sourceId}`] });
  const revoked = await review(f, sessionId, { enabled: false, expectedRevision: 1 });
  hold = true; const driving = f.current.drive(agent); await started;
  try {
    assert.equal((await f.rpc('layer', { enabled: false })).ok, false);
    assert.equal(f.current.integration.status().mounted, true);
    assert.equal((await f.rpc('clear', { sessionId })).code, 'CONTROL_REQUIRES_IDLE_AGENT');
    await ok(f.rpc('commit', { previewId: revoked.preview.previewId }));
    assert.equal(agent.ctx.tools.get(approved.source.publicName, agent), undefined);
  } finally { release(); await driving; }
});

contract('a browser nonce cannot be replayed by another authenticated principal', async (t) => {
  const f = await controlHarness(t);
  f.principal.id = 'different-human';
  assert.equal((await f.rpc('state')).code, 'CONTROL_CSRF_REJECTED');
  f.principal.id = 'synthetic-human';
  f.current.at += 1800001;
  assert.equal((await f.rpc('state')).code, 'CONTROL_CSRF_REJECTED');
});

contract('a fresh Host reopens readonly evidence but restores no prepared definitions or transient intents', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f), approval = await review(f, sessionId);
  await ok(f.rpc('commit', { previewId: approval.preview.previewId }));
  const agent = f.live.get(sessionId).agent;
  await f.current.integration.prepare(agent, { capabilityIds: [`source:${approval.source.sourceId}`] });
  const reopened = await f.restart();
  await ok(f.rpc('resume', { sessionId }));
  const resumed = f.live.get(sessionId).agent;
  assert.equal(reopened.integration.status(resumed).restriction.preparedCount, 0);
  assert.equal(reopened.integration.status(resumed).lifecycle.mode, 'smart');
  assert.equal((await reopened.integration.prepare(resumed, { capabilityIds: [`source:${approval.source.sourceId}`] })).ok, true);
});

contract('only explicit human compare over a separately approved synthetic relation selects two sources', async (t) => {
  const f = await controlHarness(t, { relation: true }), { sessionId } = await smart(f);
  const pair = f.current.relations[0].members.map((member) => member.sourceId);
  const p = await ok(f.rpc('previewSource', { sessionId, capabilityId: `relation:${f.current.relations[0].id}`, kind: 'compare', sourceIds: pair }));
  const saved = await ok(f.rpc('commit', { previewId: p.previewId }));
  assert.equal(saved.selected.length, 2);
  assert.equal(f.current.integration.status(f.live.get(sessionId).agent).restriction.preparedCount, 0);
  const invalid = await f.rpc('previewSource', { sessionId, capabilityId: `source:${pair[0]}`, kind: 'compare', sourceIds: pair });
  assert.equal(invalid.ok, false);
});

contract('English labels and the shared browser dictionary are served only through the authenticated control route', async (t) => {
  const f = await controlHarness(t, { locale: 'en' });
  const state = await ok(f.rpc('state'));
  assert.equal(state.scopeLabel, 'Qichacha enterprise data · six services');
  const response = await fetch(`${f.url}smart-mode-en.js`);
  assert.equal(response.status, 200); assert.match(await response.text(), /Smart tool management/);
  assert.equal((await fetch(`${f.url}unknown.js`)).status, 404);
});

contract('review authority does not imply mode authority; same-origin access without a Host principal is denied', async (t) => {
  const f = await controlHarness(t), { sessionId } = await smart(f);
  f.principal.permissions = ['read', 'review'];
  const p = await review(f, sessionId);
  await ok(f.rpc('commit', { previewId: p.preview.previewId }));
  assert.equal((await f.rpc('previewMode', { mode: 'compat', expectedRevision: 1 })).code, 'CONTROL_FORBIDDEN');
  const unauthenticated = await controlHarness(t, { authorizeRequest: () => undefined });
  assert.equal((await fetch(unauthenticated.url)).status, 403);
});
