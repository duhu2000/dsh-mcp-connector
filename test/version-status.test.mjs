import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_LATEST_URL,
  compareVersions,
  createVersionStatusService,
  isVersionNewer,
  readHostProfileInfo,
  readHostProfileName,
} from '../lib/version-status.js';

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return value; } };
}

test('profile comes only from the optional launcher context and is safe as a CLI argument', () => {
  for (const name of ['desktop', 'web', 'team-dev_2.1', 'Desktop']) {
    const ctx = { get(key) {
      assert.equal(key, 'profileContext');
      return { name, dir: 'private-directory', home: 'private-home' };
    } };
    assert.equal(readHostProfileName(ctx), name);
  }
  for (const name of [undefined, null, 42, {}, '', ' web', 'web ', '.', '..', 'node_modules',
    '--help', 'a/b', 'a\\b', 'web;echo secret', 'web&whoami', 'web\n', 'web\r', 'web\0',
    '$(whoami)', '`whoami`', '%DSH_HOME%', '自定义']) {
    assert.equal(readHostProfileName({ get: () => ({ name }) }), null, String(name));
  }
  assert.equal(readHostProfileName({}), null);
  assert.equal(readHostProfileName({ get: () => undefined }), null);
  assert.equal(readHostProfileName({ get() { throw new Error('unavailable service'); } }), null);
  assert.equal(readHostProfileName({ profileContext: { name: 'desktop' } }), null, 'no guessed fallback');
});

test('profile diagnostics distinguish missing, failed, invalid and unsupported names without leaking host data', () => {
  for (const name of ['desktop', 'web', 'team-dev_2.1']) {
    let reads = 0;
    const info = readHostProfileInfo({ get(key) {
      assert.equal(key, 'profileContext');
      reads += 1;
      return { name, dir: 'private-directory', home: 'private-home', env: { secret: 'private-env' } };
    } });
    assert.deepEqual(info, { detectedName: name, status: 'ready' });
    assert.equal(reads, 1);
  }
  for (const ctx of [{}, { get: null }, { get: () => undefined }, { get: () => null },
    { profileContext: { name: 'web' } }]) {
    assert.deepEqual(readHostProfileInfo(ctx), { detectedName: null, status: 'unavailable' });
  }
  for (const name of [undefined, null, 42, {}, '']) {
    assert.deepEqual(readHostProfileInfo({ get: () => ({ name }) }), {
      detectedName: name === '' ? '' : null, status: 'invalid-value',
    });
  }
  for (const name of ['node_modules', ' web', 'web ', 'web\n', 'web\t', 'a/b', 'web;whoami', '自定义']) {
    assert.deepEqual(readHostProfileInfo({ get: () => ({ name }) }), { detectedName: name, status: 'unsupported-name' });
  }
  for (const ctx of [
    { get() { throw new Error('private-context-error'); } },
    { get: () => ({ get name() { throw new Error('private-name-error'); } }) },
  ]) {
    assert.deepEqual(readHostProfileInfo(ctx), { detectedName: null, status: 'read-error' });
  }
});

test('语义版本比较支持 v 前缀、预发布版和构建元数据', () => {
  assert.ok(compareVersions('v0.2.24', '0.2.23') > 0);
  assert.ok(compareVersions('0.2.23', '0.2.23-rc.1') > 0);
  assert.ok(compareVersions('0.2.23-rc.2', '0.2.23-rc.1') > 0);
  assert.equal(compareVersions('0.2.23+build.2', '0.2.23+build.1'), 0);
  assert.equal(isVersionNewer('invalid', '0.2.23'), false);
});

test('npm latest 决定可升级版本，GitHub Release 提供补充信息', async () => {
  let calls = 0;
  const service = createVersionStatusService({
    installedVersion: '0.2.23',
    fetchImpl: async (url) => {
      calls += 1;
      if (url === NPM_LATEST_URL) return jsonResponse({ version: '0.2.24' });
      if (url === GITHUB_LATEST_RELEASE_URL) {
        return jsonResponse({
          tag_name: 'v0.2.24',
          html_url: 'https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.24',
          published_at: '2026-08-26T00:00:00Z',
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  const status = await service.check();
  assert.equal(status.installedVersion, '0.2.23');
  assert.equal(status.latestVersion, '0.2.24');
  assert.equal(status.updateAvailable, true);
  assert.equal(status.releasePending, false);
  assert.equal(status.status, 'ok');
  assert.equal(status.release.version, '0.2.24');

  assert.equal(await service.check(), status, '缓存期内应复用同一结果');
  assert.equal(calls, 2);
  await service.check({ force: true });
  assert.equal(calls, 4, '强制检查应跳过缓存');
  service.dispose();
});

test('状态接口立即返回本机版本，外部检查在后台完成', async () => {
  let releaseFetch;
  const gate = new Promise((resolve) => { releaseFetch = resolve; });
  const service = createVersionStatusService({
    installedVersion: '0.2.23',
    fetchImpl: async (url) => {
      await gate;
      return url === NPM_LATEST_URL
        ? jsonResponse({ version: '0.2.24' })
        : jsonResponse({ tag_name: 'v0.2.24' });
    },
  });
  const immediate = service.status();
  assert.equal(immediate.installedVersion, '0.2.23');
  assert.equal(immediate.checking, true);
  assert.equal(immediate.latestVersion, null);
  releaseFetch();
  const completed = await service.check();
  assert.equal(completed.updateAvailable, true);
  assert.equal(service.status().checking, false);
});

test('GitHub 版本领先 npm 时只显示同步中，不允许升级', async () => {
  const service = createVersionStatusService({
    installedVersion: '0.2.23',
    fetchImpl: async (url) => url === NPM_LATEST_URL
      ? jsonResponse({ version: '0.2.23' })
      : jsonResponse({ tag_name: 'v0.2.24', html_url: 'https://example.test/v0.2.24' }),
  });
  const status = await service.check();
  assert.equal(status.updateAvailable, false);
  assert.equal(status.releasePending, true);
  assert.equal(status.latestVersion, '0.2.23');
});

test('npm 可用但 GitHub 受限时仍按六小时缓存，避免频繁重试 GitHub API', async () => {
  const checkedAt = Date.parse('2026-08-26T00:00:00Z');
  const service = createVersionStatusService({
    installedVersion: '0.2.23',
    now: () => checkedAt,
    cacheTtlMs: 6 * 60 * 60 * 1000,
    failureTtlMs: 5 * 60 * 1000,
    fetchImpl: async (url) => {
      if (url === NPM_LATEST_URL) return jsonResponse({ version: '0.2.24' });
      throw new Error('rate limited');
    },
  });
  const status = await service.check();
  assert.equal(status.status, 'partial');
  assert.equal(status.updateAvailable, true);
  assert.equal(Date.parse(status.nextCheckAt) - checkedAt, 6 * 60 * 60 * 1000);
});

test('版本源均不可用时仍返回本地安装版本', async () => {
  const warnings = [];
  const service = createVersionStatusService({
    installedVersion: '0.2.23',
    fetchImpl: async () => { throw new Error('offline'); },
    logger: { warn(message) { warnings.push(message); } },
  });
  const status = await service.check();
  assert.equal(status.installedVersion, '0.2.23');
  assert.equal(status.latestVersion, null);
  assert.equal(status.updateAvailable, false);
  assert.equal(status.status, 'unavailable');
  assert.equal(warnings.length, 1);
});
