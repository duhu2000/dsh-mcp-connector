/** Offline browser regression only. Never loaded or packed by the plugin. */
import { test } from 'node:test';
import { access } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { productionHarness } from './smart-mode-production.mjs';
import assert from 'node:assert/strict';
import { signedEvidenceFixture } from './read-only-evidence.mjs';

test('temporary normal-startup control page', { skip: !process.env.DSH_SMART_UI_QA, timeout: 1800000 }, async (t) => {
  if (!process.env.DSH_SMART_UI_STOP_FILE) throw new Error('Explicit UI QA stop file required');
  const f = await productionHarness(t, { multipleWorkspaces: true });
  if (process.env.DSH_SMART_UI_SEEDED === '1') {
    const ok = (value) => { assert.equal(value.ok, true, JSON.stringify(value)); return value.result; };
    const create = async () => { const value = ok(await f.rpc('create', { workspaceId: 'workspace-a' })); await f.prompt(value.sessionId); return value.sessionId; };
    const compat = await create();
    await f.enable();
    const prepared = await create(), isolated = await create();
    const search = await f.waitFor(async () => { const value = await f.rpc('search', { sessionId: prepared, query: 'fixture' });
      return value.ok && value.result.total === 4 ? value.result : undefined; });
    const sources = await Promise.all(search.items.map(async (item) => ok(await f.rpc('inspect', { sessionId: prepared, sourceId: item.sourceId })).source));
    const signed = await signedEvidenceFixture(f.path, f.h.scope, sources); await signed.deliver();
    const agent = f.h.ctx.agents.get(prepared);
    const result = await f.h.ctx.tools.get('mcp_connector_discover', agent).execute({ action: 'prepare', capabilityIds: [search.items[0].capabilityId] },
      { agent, signal: new AbortController().signal });
    assert.equal(result.ok, true, JSON.stringify(result));
    console.log(`UI_QA_SESSIONS=${JSON.stringify({ compat, prepared, isolated, syntheticEvidenceOnly: true })}`);
  }
  // Temporary fixture-only bootstrap: exchange the ephemeral synthetic Host
  // login token without printing or storing a cookie/token URL in evidence.
  f.services.webServer.register({ kind: 'exact', path: '/qa-bootstrap', handler(req, res) {
    res.writeHead(302, { location: f.services.connection.authenticatedUrl(f.origin) }); res.end();
  } });
  console.log(`UI_QA_ORIGIN=${f.origin}`);
  console.log(`UI_QA_OPEN=${f.origin}/qa-bootstrap`);
  console.log(`UI_QA_CONTROL=${f.url}`);
  console.log(`UI_QA_PROFILE=${f.path}`);
  for (;;) {
    try { await access(process.env.DSH_SMART_UI_STOP_FILE); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await setTimeout(200, undefined, { signal: t.signal });
  }
  assert.deepEqual(f.h.errors, []);
  await f.h.close();
  console.log(`UI_QA_DONE=${JSON.stringify({ realBusinessCalls: 0, realModelCalls: 0, hostErrors: f.h.errors.length })}`);
});
