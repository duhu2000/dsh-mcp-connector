import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, realpath, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEntryConfig } from '../lib/mcp-provision.js';
import { normalizeLocalOverrides } from '../lib/local-overrides.js';

// Opt-in: resolve only the selected Host's code; never load its profile/config/storage.
// An explicitly selected but unusable Host must fail, not silently skip.
const anchor = process.env.DSH_HOST_INTEGRATION_ANCHOR;
let host;
if (anchor) {
  const require = createRequire(anchor);
  host = {
    bridge: await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-mcp-client')).href),
    ...await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href),
  };
}
const fixture = fileURLToPath(new URL('../fixtures/local-overrides-server.cjs', import.meta.url));

async function openBridge(record, startupRequestTimeoutMs) {
  const ctx = new host.Context();
  const definitions = new Map();
  // Registration sink only; transport, protocol, tool bridge and lifecycle are real Host code.
  ctx.provide('tools', { register(definition) {
    assert.equal(definitions.has(definition.name), false);
    definitions.set(definition.name, definition);
    return () => definitions.delete(definition.name);
  } });
  try {
    const config = buildEntryConfig(record, new Map(), { failOnStartupError: true, startupRequestTimeoutMs });
    await host.bridge.apply(ctx, host.bridge.Config({ ...config, toolCallTimeoutMs: 3000, reconnect: { enabled: false } }));
    return { ctx, definitions };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}

test('installed DSH bridge: first-start failure, corrected args/env/cwd, guarded restart and reset', { skip: !host, timeout: 25000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp overlay space '));
  const record = { connectorId: 'local-fixture', transport: 'stdio', serverName: 'overlay_fixture', command: process.execPath, args: [fixture] };
  const argsAppend = ['--accept-local-overlay', 'literal value with spaces', 'a&b', '中文参数'];
  try {
    await assert.rejects(openBridge(record), /initial connection or tool synchronization failed/);
    const localOverrides = normalizeLocalOverrides(record, { argsAppend, env: { MCP_OVERLAY_FIXTURE: 'synthetic-value' }, cwd: dir });
    for (const startupRequestTimeoutMs of [undefined, 3000]) {
      const live = await openBridge({ ...record, localOverrides }, startupRequestTimeoutMs);
      let pid;
      try {
        assert.deepEqual([...live.definitions.keys()], ['mcp__overlay_fixture__inspect_process']);
        const result = await live.definitions.get('mcp__overlay_fixture__inspect_process').execute({}, { signal: new AbortController().signal });
        const actual = JSON.parse(result.content[0].text);
        pid = actual.pid;
        assert.deepEqual(actual.args, argsAppend);
        assert.equal(actual.cwd, await realpath(dir));
        assert.equal(actual.value, 'synthetic-value');
        assert.deepEqual(record.args, [fixture], 'catalog defaults remain untouched');
      } finally {
        await live.ctx.fiber.dispose();
      }
      assert.equal(live.definitions.size, 0, 'disposal unregisters the real bridge tools');
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'owned fixture process is gone');
    }
    await assert.rejects(openBridge({ ...record, localOverrides: undefined }), /initial connection or tool synchronization failed/);
  } finally {
    // Only remove the exact empty directory created by this test; never recurse into Host storage.
    await rmdir(dir);
  }
});
