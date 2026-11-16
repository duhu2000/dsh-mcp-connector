import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { host } from '../scripts/fixtures/smart-mode-profile.mjs';
import { productionHarness } from '../scripts/fixtures/smart-mode-production.mjs';
import { signedEvidenceFixture } from '../scripts/fixtures/read-only-evidence.mjs';

const contract = (name, fn) => test(`production evidence: ${name}`, { skip: !host, timeout: 60000 }, fn);
const ok = (response) => { assert.equal(response.ok, true, JSON.stringify(response)); return response.result; };
async function setup(t) {
  const f = await productionHarness(t); await f.enable();
  const a = ok(await f.rpc('create')); await f.prompt(a.sessionId);
  const agent = f.h.ctx.agents.get(a.sessionId);
  const result = await f.waitFor(async () => {
    const value = await f.rpc('search', { sessionId: a.sessionId, query: 'fixture' });
    return value.ok && value.result.total === 4 ? value.result : undefined;
  });
  const item = result.items[0], inspected = ok(await f.rpc('inspect', { sessionId: a.sessionId, sourceId: item.sourceId }));
  const signed = await signedEvidenceFixture(f.path, f.h.scope, [inspected.source]);
  const prepare = () => f.h.ctx.tools.get('mcp_connector_discover', agent).execute({ action: 'prepare', capabilityIds: [item.capabilityId] },
    { agent, signal: new AbortController().signal });
  return { ...f, sessionId: a.sessionId, agent, item, inspected, signed, prepare };
}
async function denied(f) {
  // Dispatch is an authoritative synchronous recheck even if the OS file
  // notification has not reached the idle lookup mask yet.
  const result = await f.h.ctx.tools.execute({ agent: f.agent, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: 'synthetic-denied', name: f.item.publicName, arguments: '{}' }] });
  assert.equal(result.results[0].result.isError, true);
  assert.ok(!f.h.ctx.tools.schemas(f.agent).some((tool) => tool.name === f.item.publicName));
  assert.equal(f.h.ctx.tools.get(f.item.publicName, f.agent), undefined);
}

contract('normal apply automatically consumes a signed delivery without per-tool approval and isolates loading', async (t) => {
  const f = await setup(t);
  assert.equal((await f.prepare()).message, 'READ_ONLY_REVIEW_REQUIRED');
  await f.signed.deliver();
  assert.equal(ok(await f.rpc('state')).readOnlyEvidence.status, 'verified');
  assert.equal((await f.prepare()).ok, true);
  const other = ok(await f.rpc('create')); await f.prompt(other.sessionId);
  assert.ok(f.h.ctx.tools.get(f.item.publicName, f.agent));
  assert.equal(f.h.ctx.tools.get(f.item.publicName, f.h.ctx.agents.get(other.sessionId)), undefined);
  const view = ok(await f.rpc('inspect', { sessionId: f.sessionId, sourceId: f.item.sourceId }));
  assert.equal(view.persistedReview, null); assert.equal(view.verifiedReadOnlyReview.enabled, true);
  // Signed readonly evidence confers no equivalence approval: raw duplicates
  // remain separate entries, and the explicit source/permission rules persist.
  assert.equal(ok(await f.rpc('search', { sessionId: f.sessionId, query: 'fixture' })).total, 4);
  assert.deepEqual(f.h.errors, []);
});

contract('human self-claims cannot install trust; manual withdrawal overrides signed evidence and enable is independently checked', async (t) => {
  const f = await setup(t), args = { sessionId: f.sessionId, sourceId: f.item.sourceId, evidenceHash: 'c'.repeat(64),
    enabled: true, validForMs: 3600000, expectedRevision: 0 };
  const untrusted = ok(await f.rpc('previewReview', args));
  assert.equal((await f.rpc('commit', { previewId: untrusted.previewId })).code, 'READ_ONLY_APPROVAL_REQUIRED');
  for (const method of ['installTrust', 'importEvidence', 'signEvidence']) assert.equal((await f.rpc(method)).code, 'CONTROL_UNKNOWN_METHOD');
  await f.signed.deliver(); assert.equal((await f.prepare()).ok, true);
  const revoked = ok(await f.rpc('previewReview', { ...args, enabled: false }));
  ok(await f.rpc('commit', { previewId: revoked.previewId })); await denied(f);
  const approved = ok(await f.rpc('previewReview', { ...args, expectedRevision: 1 }));
  ok(await f.rpc('commit', { previewId: approved.previewId })); assert.equal((await f.prepare()).ok, true);
  const stale = ok(await f.rpc('previewReview', { ...args, expectedRevision: 2 }));
  await f.signed.deliver({ ...f.signed.payload, revision: 2, reviews: [] });
  assert.equal((await f.rpc('commit', { previewId: stale.previewId })).code, 'READ_ONLY_APPROVAL_REQUIRED');
  await denied(f); assert.deepEqual(f.h.errors, []);
});

for (const change of ['withdraw', 'delete', 'tamper', 'key-removal']) contract(`${change} invalidates schema/lookup/dispatch on next use without reloading the layer`, async (t) => {
  const f = await setup(t); await f.signed.deliver(); assert.equal((await f.prepare()).ok, true);
  if (change === 'withdraw') await f.signed.deliver({ ...f.signed.payload, revision: 2, reviews: [] });
  if (change === 'delete') await fs.unlink(join(f.signed.directory, 'bundle.json'));
  if (change === 'tamper') {
    const bundle = f.signed.bundle(); bundle.payload.reviews[0].review.evidenceHash = 'f'.repeat(64); await f.signed.write('bundle.json', bundle);
  }
  if (change === 'key-removal') await f.signed.write('trust.json', { ...f.signed.trust, keys: [] });
  await f.waitFor(() => !f.h.ctx.tools.get(f.item.publicName, f.agent));
  await denied(f); assert.equal((await f.prepare()).message, 'READ_ONLY_REVIEW_REQUIRED'); assert.deepEqual(f.h.errors, []);
});

contract('restart restores the trusted revision floor and local withdrawal, never old preparation or a replayed approval', async (t) => {
  const f = await setup(t); await f.signed.deliver(); assert.equal((await f.prepare()).ok, true);
  await f.signed.deliver({ ...f.signed.payload, revision: 2, reviews: [] }); await denied(f);
  await f.h.close(); await f.signed.deliver();
  const restored = await productionHarness(t, { profileDir: f.path });
  assert.equal(ok(await restored.rpc('state')).readOnlyEvidence.code, 'READ_ONLY_EVIDENCE_ROLLBACK');
  ok(await restored.rpc('resume', { sessionId: f.sessionId })); await restored.prompt(f.sessionId);
  await restored.waitFor(async () => {
    const value = await restored.rpc('search', { sessionId: f.sessionId, query: 'fixture' });
    return value.ok && value.result.total === 4;
  });
  const agent = restored.h.ctx.agents.get(f.sessionId);
  assert.equal(restored.h.ctx.tools.get(f.item.publicName, agent), undefined);
  assert.equal((await restored.h.ctx.tools.get('mcp_connector_discover', agent).execute({ action: 'prepare', capabilityIds: [f.item.capabilityId] },
    { agent, signal: new AbortController().signal })).message, 'READ_ONLY_REVIEW_REQUIRED');
  assert.deepEqual(restored.h.errors, []);
});

contract('an idle prepared tool expires without a new file event and cannot dispatch', async (t) => {
  const f = await setup(t), payload = structuredClone(f.signed.payload);
  payload.reviews[0].expiresAt = Date.now() + 2600;
  await f.signed.deliver(payload); assert.equal((await f.prepare()).ok, true);
  // Allow the monitor to attach and consume initial delivery notifications;
  // the later expiry must be detected without any further filesystem change.
  await setTimeout(1300); assert.ok(f.h.ctx.tools.get(f.item.publicName, f.agent));
  await f.waitFor(() => !f.h.ctx.tools.get(f.item.publicName, f.agent));
  await denied(f); assert.equal((await f.prepare()).message, 'READ_ONLY_REVIEW_REQUIRED');
  assert.deepEqual(f.h.errors, []);
});
