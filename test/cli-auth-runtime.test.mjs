import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runDwsAuthProcess, resolveDwsAuthRuntime } from '../lib/cli-auth-runtime.js';

function fixture() {
  const child = new EventEmitter();
  child.pid = 34567;
  child.stdout = new EventEmitter();
  const calls = [];
  return { child, calls, options: {
    platform: 'darwin', graceMs: 5,
    spawnImpl: (...args) => { calls.push(args); return child; },
    killGroup: (pid, sig) => { calls.push({ pid, sig }); },
  } };
}

test('固定登录参数不使用 shell，不采集授权 URL 或原始输出', async () => {
  const f = fixture();
  const result = runDwsAuthProcess('/fixture/dws', 'login', f.options);
  assert.deepEqual(f.calls[0][1], ['auth', 'login', '--format', 'json']);
  assert.equal(f.calls[0][2].shell, false);
  assert.deepEqual(f.calls[0][2].stdio, ['ignore', 'ignore', 'ignore']);
  f.child.emit('close', 0);
  assert.deepEqual(await result, { exitCode: 0 });
});

test('状态输出只允许两个状态字段，不返回 Token 和身份', async () => {
  const f = fixture();
  const result = runDwsAuthProcess('/fixture/dws', 'status', f.options);
  f.child.stdout.emit('data', Buffer.from('{"success":true,"authenticated":false,"token":"secret","name":"private"}'));
  f.child.emit('close', 0);
  assert.deepEqual(await result, { success: true, authenticated: false });
});

test('取消只终止自身进程组，等待 close 再结束', async () => {
  const f = fixture();
  const controller = new AbortController();
  const result = runDwsAuthProcess('/fixture/dws', 'login', { ...f.options, signal: controller.signal });
  const rejected = assert.rejects(result, /CLI_AUTH_CANCELLED/);
  controller.abort();
  assert.deepEqual(f.calls[1], { pid: -34567, sig: 'SIGTERM' });
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.deepEqual(f.calls[2], { pid: -34567, sig: 'SIGKILL' });
  f.child.emit('close', null);
  await rejected;
});

test('预取消、未知平台、操作和相对路径均安全拒绝', async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runDwsAuthProcess('/fixture/dws', 'login', { ...f.options, signal: controller.signal }), /CANCELLED/);
  await assert.rejects(runDwsAuthProcess('/fixture/dws', 'login', { ...f.options, platform: 'win32' }), /PLATFORM/);
  await assert.rejects(runDwsAuthProcess('/fixture/dws', 'logout', f.options), /OPERATION/);
  await assert.rejects(runDwsAuthProcess('dws', 'login', f.options), /EXECUTABLE/);
  await assert.rejects(resolveDwsAuthRuntime('relative'), /PACKAGE_REQUIRED/);
  assert.equal(f.calls.length, 0);
});

test('启动错误不泄露原始错误或凭据', async () => {
  const f = fixture();
  const result = runDwsAuthProcess('/fixture/dws', 'login', f.options);
  f.child.emit('error', new Error('Bearer secret'));
  await assert.rejects(result, { message: 'CLI_AUTH_START_FAILED' });
});

test('同步启动异常和超大状态输出安全失败', async () => {
  const f = fixture();
  await assert.rejects(runDwsAuthProcess('/fixture/dws', 'login', {
    ...f.options, spawnImpl: () => { throw new Error('secret'); },
  }), { message: 'CLI_AUTH_START_FAILED' });
  const result = runDwsAuthProcess('/fixture/dws', 'status', f.options);
  const rejected = assert.rejects(result, /CLI_AUTH_OUTPUT_LIMIT/);
  f.child.stdout.emit('data', Buffer.alloc(65537));
  f.child.emit('close', null);
  await rejected;
});
