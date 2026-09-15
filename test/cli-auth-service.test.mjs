import test from 'node:test';
import assert from 'node:assert/strict';
import { createCliAuthService } from '../lib/cli-auth-service.js';

test('页面授权默认不可用，调用者不能用请求提供运行路径', async () => {
  let resolved = false;
  const service = createCliAuthService({ adaptersFactory: async () => { resolved = true; } });
  assert.equal((await service.status()).detail.available, false);
  assert.equal((await service.start({ confirmed: true, packageDir: '/untrusted' })).ok, false);
  assert.equal(resolved, false);
  await service.dispose();
});

test('发起必须明确确认，状态检查不登录，卸载取消进行中任务', async () => {
  let launched = 0;
  let aborted = false;
  const service = createCliAuthService({ packageDir: '/configured', adaptersFactory: async (path) => {
    assert.equal(path, '/configured');
    return {
      launch: ({ signal }) => new Promise((resolve) => {
        launched++;
        signal.addEventListener('abort', () => { aborted = true; resolve({ exitCode: 1 }); }, { once: true });
      }), verify: async () => ({ success: true, authenticated: true }),
    };
  } });
  assert.equal((await service.status()).detail.available, true);
  assert.equal(launched, 0);
  assert.equal((await service.start({})).ok, false);
  assert.equal((await service.start({ confirmed: true })).ok, true);
  assert.equal((await service.start({ confirmed: true })).ok, false);
  await service.dispose();
  assert.equal(aborted, true);
  assert.equal((await service.status()).detail.available, false);
});

test('安装路径错误不泄露真实路径或原始异常', async () => {
  const service = createCliAuthService({ packageDir: '/private/path', adaptersFactory: async () => { throw new Error('private secret'); } });
  const result = await service.status();
  assert.equal(result.detail.available, false);
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  await service.dispose();
});
