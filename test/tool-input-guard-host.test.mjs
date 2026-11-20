import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createToolInputGuard } from '../lib/tool-input-guard.js';
import { nestedArgumentsSchema as schema } from '../fixtures/nested-arguments.mjs';

// Real installed ToolRuntime + MCP bridge; only an ephemeral loopback server.
// Never load a DSH profile, credentials, model, or production connection.
let host;
if (process.env.DSH_HOST_INTEGRATION_ANCHOR) {
  const require = createRequire(process.env.DSH_HOST_INTEGRATION_ANCHOR);
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  host = { ...await load('@deepseek-ai/cordis'), ...await load('@deepseek-ai/dsh-tools'),
    bridge: await load('@deepseek-ai/dsh-mcp-client') };
}

test('real Host → Streamable HTTP: invalid args blocked, nested args unchanged on wire', { skip: !host, timeout: 20000 }, async (t) => {
  const calls = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (request.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'nested-fixture', version: '1' } };
    else if (request.method === 'tools/list') result = { tools: [{ name: 'getCompanyProfile', description: 'Synthetic nested object fixture', inputSchema: schema }] };
    else if (request.method === 'tools/call') {
      calls.push(request.params.arguments);
      result = { content: [{ type: 'text', text: JSON.stringify({ synthetic: true, received: request.params.arguments }) }] };
    } else { res.writeHead(400).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const root = new host.Context();
  root.provide('systemPrompt', { tools() {} });
  root.plugin(host.ToolRuntime);
  try {
    await new Promise((resolve, reject) => root.plugin({ inject: ['tools'], async apply(ctx) {
      let guard;
      try {
        await host.bridge.apply(ctx, host.bridge.Config({ transport: 'streamable-http', serverName: 'nested_fixture',
          url: `http://127.0.0.1:${server.address().port}/mcp`, failOnStartupError: true,
          toolCallTimeoutMs: 3000, reconnect: { enabled: false } }));
        const name = 'mcp__nested_fixture__getCompanyProfile';
        assert.deepEqual(ctx.tools.get(name).parameters, schema, 'Schema preserved by the real bridge');
        let sequence = 0;
        const run = async (args) => {
          const callId = `fixture-${++sequence}`;
          // 0.1 Host takes a single execution; 0.2 Host takes calls[]. Both
          // paths use the real dispatcher and return one normalized result.
          const result = await ctx.tools.execute({ name, callId, arguments: args,
            calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
            signal: new AbortController().signal });
          return result.results?.[0]?.result ?? result;
        };
        // Baseline proves the missing Host input check without billing anything.
        await run({ param: true, stockCode: true });
        assert.deepEqual(calls, [{ param: true, stockCode: true }]);
        guard = createToolInputGuard(ctx, { isManagedTool: (n) => n === name });
        for (const param of [true, false]) {
          const denied = await run({ param, stockCode: param });
          assert.equal(denied.isError, true);
          assert.match(JSON.stringify(denied), /MCP_INPUT_SHAPE_INVALID/);
        }
        assert.equal(calls.length, 1, 'invalid inputs cause zero additional HTTP business requests');
        const valid = { param: { stockCode: 'SH601519' } };
        const success = await run(valid);
        assert.equal(success.isError, false);
        assert.deepEqual(calls[1], valid);
        const optional = { param: { stockCode: 'SH601519', getF10Information: false, getF10BusiinfoData: { typeStyle: 1 } } };
        assert.equal((await run(optional)).isError, false);
        assert.deepEqual(calls[2], optional, 'false flags and nested selectors must not be coerced');
        const stopDeny = ctx.tools.guard(() => 'Existing policy denied');
        assert.equal((await run(valid)).isError, true);
        assert.equal(calls.length, 3, 'input validation cannot bypass policy denial');
        stopDeny();
        guard.dispose(); guard = undefined;
        await run({ param: false });
        assert.equal(calls.length, 4, 'disposal removes only our guard');
        t.diagnostic('Synthetic wire calls: baseline 1; guarded invalid 0; valid nested 2; denied 0; disposal 1. Real DZH calls: 0.');
        resolve();
      } catch (error) { reject(error); }
      finally { guard?.dispose(); }
    } }));
  } finally {
    await root.fiber.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
