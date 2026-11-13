/** Offline browser regression only. Never loaded or packed by the plugin. */
import { test } from 'node:test';
import { access } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { productionHarness } from './smart-mode-production.mjs';

test('temporary normal-startup control page', { skip: !process.env.DSH_SMART_UI_QA, timeout: 300000 }, async (t) => {
  const f = await productionHarness(t, { multipleWorkspaces: true });
  // Temporary fixture-only bootstrap: exchange the ephemeral synthetic Host
  // login token without printing or storing a cookie/token URL in evidence.
  f.services.webServer.register({ kind: 'exact', path: '/qa-bootstrap', handler(req, res) {
    res.writeHead(302, { location: f.services.connection.authenticatedUrl(f.origin) }); res.end();
  } });
  console.log(`UI_QA_ORIGIN=${f.origin}`);
  if (!process.env.DSH_SMART_UI_STOP_FILE) throw new Error('Explicit UI QA stop file required');
  for (;;) {
    try { await access(process.env.DSH_SMART_UI_STOP_FILE); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await setTimeout(200, undefined, { signal: t.signal });
  }
  console.log(`UI_QA_DONE=${JSON.stringify({ realBusinessCalls: 0, realModelCalls: 0, hostErrors: f.h.errors.length })}`);
});
