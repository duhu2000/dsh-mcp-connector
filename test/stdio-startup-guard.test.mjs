import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildEntryConfig } from '../lib/mcp-provision.js';

const guard = fileURLToPath(new URL('../lib/stdio-startup-guard.js', import.meta.url));
const fixture = String.raw`
const fs = require('node:fs');
const mode = process.argv[1];
const marker = process.argv[2];
if (marker) fs.writeFileSync(marker, JSON.stringify({ pid: process.pid }));
if (mode === 'tree') {
  const descendant = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, descendant: descendant.pid }));
}
let listed = false;
const write = message => process.stdout.write(JSON.stringify(message) + String.fromCharCode(10));
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if ((mode === 'hang-init' || mode === 'tree') && message.method === 'initialize') return;
  if (mode === 'hang-discover' && message.method === 'server/discover') return;
  if (message.method === 'server/discover') return write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'use initialize' } });
  if (message.method === 'initialize') return write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } });
  if (message.method === 'tools/list') {
    if (mode === 'hang-list' || (mode === 'hang-page' && listed)) return;
    if (mode === 'slow-later' && listed) return setTimeout(() => write({ jsonrpc: '2.0', id: message.id, result: { tools: [] } }), 450);
    listed = true;
    return write({ jsonrpc: '2.0', id: message.id, result: { tools: [], ...(mode === 'hang-page' ? { nextCursor: 'page-2' } : {}) } });
  }
  if (message.method === 'tools/call') return write({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'pong' }] } });
  if (Object.hasOwn(message, 'id')) write({ jsonrpc: '2.0', id: message.id, result: { echo: message.params } });
});
`;

function launch(mode = 'normal', { legacy = false, timeout = 250, marker = '', command = process.execPath } = {}) {
  const child = spawn(process.execPath, [guard, '--timeout-ms', String(timeout), ...(legacy ? ['--legacy'] : []), '--', command, '-e', fixture, mode, marker], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const replies = [];
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    const waiter = waiting.shift();
    if (waiter) waiter(message); else replies.push(message);
  });
  const exit = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  child.stdin.on('error', () => {});
  return {
    child, exit, stderr: () => stderr,
    send(method, id = 1, params = {}) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); },
    async reply() { return replies.length ? replies.shift() : new Promise(resolve => waiting.push(resolve)); },
    async cleanup() { child.stdin.end(); await exit; },
  };
}

async function within(promise, ms = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('test wait budget exceeded')), ms); })]); }
  finally { clearTimeout(timer); }
}

for (const [mode, method] of [['hang-discover', 'server/discover'], ['hang-init', 'initialize'], ['hang-list', 'tools/list']]) {
  test(`bounds ${method} and closes the owned transport`, { timeout: 7000 }, async () => {
    const c = launch(mode);
    try {
      c.send(method);
      assert.equal((await within(c.exit)).code, 1);
      assert.match(c.stderr(), new RegExp(`${method} exceeded 250ms`));
      assert.doesNotMatch(c.stderr(), /synthetic-secret/);
    } finally { await c.cleanup(); }
  });
}

test('transparent mode forwards discovery and unknown extension messages', { timeout: 7000 }, async () => {
  const c = launch();
  try {
    c.send('server/discover', 'probe');
    assert.equal((await within(c.reply())).error.code, -32601);
    c.send('extension/echo', 'custom', { synthetic: true });
    assert.deepEqual((await within(c.reply())).result.echo, { synthetic: true });
  } finally { await c.cleanup(); }
});

test('explicit legacy probes never launch the real server', { timeout: 7000 }, async () => {
  const c = launch('normal', { legacy: true, command: 'definitely-missing-mcp-fixture-executable' });
  try {
    c.send('server/discover', 'probe');
    assert.equal((await within(c.reply())).error.code, -32601);
    assert.equal(c.stderr(), '');
  } finally { await c.cleanup(); }
});

test('initial tool discovery completes and later tool lists retain the Host deadline', { timeout: 7000 }, async () => {
  const c = launch('slow-later');
  try {
    c.send('initialize'); await within(c.reply());
    c.send('tools/list', 2); await within(c.reply());
    c.send('tools/list', 3);
    assert.deepEqual((await within(c.reply())).result.tools, []);
    assert.equal(c.stderr(), '');
  } finally { await c.cleanup(); }
});

test('startup discovery guard remains active across pagination', { timeout: 7000 }, async () => {
  const c = launch('hang-page');
  try {
    c.send('tools/list'); assert.equal((await within(c.reply())).result.nextCursor, 'page-2');
    c.send('tools/list', 2, { cursor: 'page-2' });
    assert.equal((await within(c.exit)).code, 1);
  } finally { await c.cleanup(); }
});

test('missing executable fails without logging the command or credentials', { timeout: 7000 }, async () => {
  const c = launch('normal', { command: 'synthetic-secret-missing-mcp-fixture' });
  try {
    c.send('initialize');
    assert.equal((await within(c.exit)).code, 1);
    assert.match(c.stderr(), /Server launch failed/);
    assert.doesNotMatch(c.stderr(), /synthetic-secret/);
  } finally { await c.cleanup(); }
});

test('timeout reaps both the server and its owned descendant', { timeout: 7000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-startup-test-'));
  const marker = join(dir, 'pids.json');
  const c = launch('tree', { marker, timeout: 500 });
  try {
    c.send('initialize');
    await within(c.exit);
    assert.ok(existsSync(marker));
    const pids = JSON.parse(readFileSync(marker, 'utf8'));
    assert.ok(pids.descendant);
    for (const pid of Object.values(pids)) {
      const running = () => {
        try { process.kill(pid, 0); } catch { return false; }
        // A killed grandchild may await the OS init reaper on Linux; a zombie
        // is not a running descendant and cannot retain this transport.
        if (process.platform === 'linux') {
          try { if (/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false; } catch { return false; }
        }
        return true;
      };
      const deadline = Date.now() + 1500;
      while (running() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(running(), false, `owned child ${pid} must not remain running`);
    }
  } finally {
    await c.cleanup();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/'));
    rmSync(dir, { recursive: true, force: true });
  }
});

let sdk;
try {
  const require = createRequire(process.env.DSH_MCP_CLIENT_TEST_ANCHOR || import.meta.url);
  sdk = { ...require('@modelcontextprotocol/client'), ...require('@modelcontextprotocol/client/stdio') };
} catch { /* Portable wire tests above always run; SDK integration is opt-in. */ }

for (const mode of ['normal', 'hang-init', 'hang-list']) {
  test(`installed Host SDK consumes a guarded provisioned entry: ${mode}`, { skip: !sdk, timeout: 8000 }, async () => {
    const entry = buildEntryConfig({ transport: 'stdio', serverName: 'fixture', command: process.execPath, args: ['-e', fixture, mode], cwd: process.cwd() }, new Map(), { startupRequestTimeoutMs: 600 });
    const client = new sdk.Client({ name: 'startup-regression', version: '1' }, { capabilities: {}, versionNegotiation: { mode: 'auto', probe: { timeoutMs: 200 } } });
    const transport = new sdk.StdioClientTransport({ ...entry, stderr: 'ignore' });
    const attempt = async () => { await client.connect(transport); return client.listTools(); };
    try {
      if (mode === 'normal') assert.deepEqual((await within(attempt())).tools, []);
      else await assert.rejects(within(attempt()), /closed/i);
    } finally { await client.close(); }
  });
}