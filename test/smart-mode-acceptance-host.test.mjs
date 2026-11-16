import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionHarness } from '../scripts/fixtures/smart-mode-production.mjs';
import { host } from '../scripts/fixtures/smart-mode-profile.mjs';
import { signedEvidenceFixture } from '../scripts/fixtures/read-only-evidence.mjs';

const contract = (name, fn) => test(`independent acceptance: ${name}`, { skip: !host, timeout: 60000 }, fn);
const ok = (response) => { assert.equal(response.ok, true, JSON.stringify(response)); return response.result; };
async function setup(t) {
  const f = await productionHarness(t, { multipleWorkspaces: true }); await f.enable();
  const create = async (workspaceId) => { const row = ok(await f.rpc('create', { workspaceId }));
    await f.prompt(row.sessionId); return f.h.ctx.agents.get(row.sessionId); };
  const a = await create('workspace-a'), b = await create('workspace-b');
  const search = await f.waitFor(async () => { const value = await f.rpc('search', { sessionId: a.id, query: 'fixture' });
    return value.ok && value.result.total === 4 ? value.result : undefined; });
  const item = search.items.find((item) => item.serverName === 'qcc-company'); assert.ok(item);
  const source = ok(await f.rpc('inspect', { sessionId: a.id, sourceId: item.sourceId })).source;
  const signed = await signedEvidenceFixture(f.path, f.h.scope, [source]); await signed.deliver();
  const prepare = (agent) => f.h.ctx.tools.get('mcp_connector_discover', agent).execute(
    { action: 'prepare', capabilityIds: [item.capabilityId] }, { agent, signal: new AbortController().signal });
  const visible = (agent) => f.h.ctx.tools.get(item.publicName, agent) !== undefined;
  const deny = async (agent) => {
    const result = await f.h.ctx.tools.execute({ agent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: 'independent-denial', name: item.publicName, arguments: '{}' }] });
    assert.equal(result.results[0].result.isError, true); assert.equal(visible(agent), false);
    assert.ok(!f.h.ctx.tools.schemas(agent).some((tool) => tool.name === item.publicName));
  };
  return { ...f, a, b, item, source, signed, prepare, visible, deny };
}

contract('release and clear never unload a sibling session that prepared the same tool', async (t) => {
  const f = await setup(t); for (const result of await Promise.all([f.prepare(f.a), f.prepare(f.b)])) ok(result);
  assert.ok(f.visible(f.a)); assert.ok(f.visible(f.b));
  const definition = f.h.ctx.tools.get('mcp_connector_discover', f.a);
  await assert.rejects(definition.execute({ action: 'release', publicNames: [f.item.publicName] }, { agent: f.b }), /AGENT_MISMATCH/);
  ok(await definition.execute({ action: 'release', publicNames: [f.item.publicName] }, { agent: f.a }));
  assert.equal(f.visible(f.a), false); assert.equal(f.visible(f.b), true);
  ok(await f.prepare(f.a)); ok(await f.rpc('clear', { sessionId: f.a.id }));
  await f.deny(f.a); assert.equal(f.visible(f.b), true); assert.deepEqual(f.h.errors, []);
});

contract('Workspace restriction after both prepares rejects only the excluded session at schema/lookup/dispatch', async (t) => {
  const f = await setup(t); ok(await f.prepare(f.a)); ok(await f.prepare(f.b));
  const input = { key: f.source.connectionKey, targetScope: 'project', targetWorkspaceId: 'workspace-a' };
  const preview = await f.legacy('previewConnectionScope', input); assert.equal(preview.ok, true);
  assert.equal((await f.legacy('applyConnectionScope', { ...input, expectedRevision: preview.detail.baseRevision })).ok, true);
  await f.deny(f.b); assert.equal(f.visible(f.a), true);
  assert.equal((await f.prepare(f.b)).ok, false); assert.deepEqual(f.h.errors, []);
});

contract('signed withdrawal invalidates both prepared sessions and layer rollback preserves governance denial', async (t) => {
  const f = await setup(t); ok(await f.prepare(f.a)); ok(await f.prepare(f.b));
  await f.signed.deliver({ ...f.signed.payload, revision: 2, reviews: [] });
  await f.deny(f.a); await f.deny(f.b); assert.equal((await f.prepare(f.a)).ok, false);
  const denied = await f.legacy('applyPolicy', { scope: 'server', connectorId: 'qcc-company', serverName: 'qcc-company', effect: 'deny', expectedRevision: 0 });
  assert.equal(denied.ok, true);
  ok(await f.rpc('layer', { enabled: false }));
  assert.equal(f.visible(f.a), false); assert.equal(f.visible(f.b), false);
  assert.equal(f.h.ctx.tools.schemas(f.a).filter((tool) => tool.name.startsWith('mcp_connector_')).length, 25);
  ok(await f.rpc('layer', { enabled: true })); assert.equal(f.visible(f.a), false);
  assert.equal((await f.prepare(f.a)).ok, false); assert.deepEqual(f.h.errors, []);
});

contract('staged source intent cannot be retargeted, replayed or used to load another session', async (t) => {
  const f = await setup(t);
  const staged = ok(await f.rpc('previewSource', { sessionId: f.a.id, capabilityId: f.item.capabilityId,
    kind: 'source', sourceIds: [f.source.sourceId] }));
  assert.equal((await f.rpc('commit', { previewId: staged.previewId, sessionId: f.b.id })).code, 'CONTROL_INVALID_ARGUMENTS');
  ok(await f.rpc('commit', { previewId: staged.previewId }));
  assert.equal((await f.rpc('commit', { previewId: staged.previewId })).code, 'CONTROL_PREVIEW_EXPIRED');
  assert.equal(f.visible(f.a), false); assert.equal(f.visible(f.b), false);
  ok(await f.prepare(f.a)); assert.equal(f.visible(f.b), false); assert.deepEqual(f.h.errors, []);
});
