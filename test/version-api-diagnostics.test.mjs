import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../lib/i18n/index.js';

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const start = source.indexOf('\t\tfunction versionApiFailureMessage(');
const end = source.indexOf('\n\t\t/**', start);
assert.ok(start >= 0 && end > start);
function checkWith(fetch) {
  return new Function('window', 't', `${source.slice(start, end)}; return fetchVersionStatus;`)({ fetch }, createTranslator('zh-CN'));
}

for (const status of [401, 403, 404, 502]) {
  test(`版本诊断优先识别 HTTP ${status}，不解析或泄露代理错误正文`, async () => {
    let parsed = false;
    const check = checkWith(async () => ({ ok: false, status, json() { parsed = true; throw new Error('private-token'); } }));
    await assert.rejects(check(), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    });
    assert.equal(parsed, false);
  });
}

test('HTML、空 JSON、错误结构返回固定诊断而非响应内容', async () => {
  for (const body of [null, {}, { ok: true, detail: null }, { ok: true, detail: [] }, { ok: false, message: 'private-token' }, 'html']) {
    const check = checkWith(async () => ({ ok: true, status: 200, async json() {
      if (body === 'html') throw new SyntaxError('private-token');
      return body;
    } }));
    await assert.rejects(check(), (error) => {
      assert.match(error.message, /响应格式不正确/);
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    });
  }
});

test('正常版本检查保持同源 POST 与强制刷新参数', async () => {
  const detail = { installedVersion: '0.2.77', sources: { npm: { ok: true } } };
  const check = checkWith(async (url, options) => {
    assert.equal(url, '/mcp-connector/api');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { method: 'versionStatus', params: { force: true } });
    return { ok: true, json: async () => ({ ok: true, detail }) };
  });
  assert.equal(await check(true), detail);
});
