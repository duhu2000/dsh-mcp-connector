import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../lib/stdio-startup-guard.js', import.meta.url));
const waitFor = async (file, timeoutMs = 10_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(file)) return true;
    await new Promise((done) => setTimeout(done, 25));
  }
  return false;
};

test('stdio 守卫剥离加载器类环境变量后再启动第三方 server', { timeout: 20_000 }, async () => {
  // 守卫只在收到首个 JSON-RPC 行时才启动真实 server；stdout 是协议通道，
  // 因此让"第三方 server"把环境变量写到临时文件，再回一条 initialize 结果。
  const dir = mkdtempSync(join(tmpdir(), 'mc-env-'));
  const dump = join(dir, 'env.json');
  const script = [
    `require('node:fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));`,
    "let buf = '';",
    "process.stdin.on('data', (chunk) => {",
    "  buf += chunk;",
    "  let end;",
    "  while ((end = buf.indexOf(String.fromCharCode(10))) >= 0) {",
    "    const line = buf.slice(0, end).trim(); buf = buf.slice(end + 1);",
    "    if (!line) continue;",
    "    const request = JSON.parse(line);",
    "    if (request.id === undefined) continue;",
    "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'env-probe', version: '1' } } }) + String.fromCharCode(10));",
    "  }",
    "});",
  ].join(' ');
  const child = spawn(process.execPath, [guard, '--timeout-ms', '3000', '--', process.execPath, '-e', script], {
    env: {
      ...process.env,
      LD_PRELOAD: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      PYTHONPATH: '/tmp/evil',
      PERL5LIB: '/tmp/evil',
      FORWARDED_MARKER: 'keep-me',
    },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    assert.equal(await waitFor(dump), true, '第三方 server 应已启动并写入环境变量');
    const seen = JSON.parse(readFileSync(dump, 'utf8'));
    assert.equal(seen.FORWARDED_MARKER, 'keep-me', '普通变量必须继续透传');
    assert.equal(seen.LD_PRELOAD, undefined);
    assert.equal(seen.DYLD_INSERT_LIBRARIES, undefined);
    assert.equal(seen.PYTHONPATH, undefined);
    assert.equal(seen.PERL5LIB, undefined);
  } finally {
    child.kill();
  }
});
