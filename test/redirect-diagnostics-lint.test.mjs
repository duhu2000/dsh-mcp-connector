/**
 * 重定向失败在诊断面板中的呈现，以及 lint 覆盖门禁。
 *
 * 两件事放在一起，因为都是「PR 声称修好、但只做了一半」的同类问题：
 *   1. `classifyConnectionError` 把跨源拒绝归成 `kind: 'redirect'`，
 *      但诊断面板若没有对应映射，仍会退化成 network 的「网络与传输」
 *      +「检查网络和 MCP URL 后重试」——和真正的网络故障无法区分。
 *   2. `package.json` 的 lint 列表是手工维护的，新增文件很容易被漏掉，
 *      而漏掉意味着该文件不再接受任何语法检查。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { REDIRECT_ERROR_CODES } from '../lib/credentialed-fetch.js';
import { buildHealthSummary, failureAction, stageLabel } from '../lib/diagnostics.js';
import { createTranslator, DEFAULT_LOCALE } from '../lib/i18n/index.js';
import { EN_DICTIONARY } from '../lib/i18n/locales/en.js';
import { classifyConnectionError, validateConnectionRecord } from '../lib/mcp-validation.js';

const t = createTranslator(DEFAULT_LOCALE);
const record = { key: 'demo-main', connectorId: 'demo', serverKey: 'main', serverName: 'demo', enabled: true };

/** 取单条失败结果对应的诊断。 */
function diagnosticFor(kind, overrides = {}, translate = t) {
  return buildHealthSummary({
    connectorId: 'demo',
    records: [record],
    results: [{ ok: false, kind, serverKey: 'main', serverName: 'demo', ...overrides }],
    checkedAt: 1,
    t: translate,
  }).diagnostic;
}

test('重定向拒绝归到配置阶段，而不是网络与传输', () => {
  const redirect = diagnosticFor('redirect');
  assert.equal(redirect.code, 'redirect');
  assert.equal(redirect.stage, 'configuration');
  assert.equal(redirect.stageLabel, t('配置'));
  assert.notEqual(redirect.stage, 'transport', '重定向不能落到「网络与传输」阶段');
});

test('重定向的建议动作不能等同于 network', () => {
  const redirect = diagnosticFor('redirect');
  const network = diagnosticFor('network');
  assert.notEqual(redirect.action, network.action, '两者建议动作相同会导致用户去排查网络');
  assert.match(redirect.action, /服务方公布的可信 MCP 端点/);
  assert.notEqual(failureAction(t, 'redirect'), failureAction(t, 'network'));
});

test('按重定向错误代码给出中英文建议，覆盖连接校验和工具发现', () => {
  const en = createTranslator('en', { en: EN_DICTIONARY });
  const cases = [
    [REDIRECT_ERROR_CODES.CROSS_ORIGIN, /协议、主机和端口/, /scheme, host, and port/],
    [REDIRECT_ERROR_CODES.TOO_MANY, /检查重定向链/, /check the redirect chain/],
    [REDIRECT_ERROR_CODES.INVALID, /修正 Location 响应头/, /correct the Location response header/],
  ];

  for (const [code, actionZh, actionEn] of cases) {
    const cause = Object.assign(new Error('redirect rejected'), { code });
    const classified = classifyConnectionError(new Error('request failed', { cause }));
    assert.equal(classified.kind, 'redirect');
    assert.equal(classified.code, code);
    for (const stage of [undefined, 'tool-discovery']) {
      const diagnostic = diagnosticFor(classified.kind, { ...classified, stage });
      assert.equal(diagnostic.code, code);
      assert.equal(diagnostic.stage, stage ?? 'configuration');
      assert.match(diagnostic.action, actionZh);
      assert.match(diagnostic.action, /可信 MCP 端点/);
      assert.match(diagnosticFor(classified.kind, { ...classified, stage }, en).action, actionEn);
    }
  }
  assert.equal(diagnosticFor('redirect', { stage: 'tool-discovery' }).action, failureAction(t, 'redirect'));
  assert.equal(diagnosticFor('network', { stage: 'tool-discovery' }).action, failureAction(t, 'tool-list'));
});

test('连接校验结果保留缺少 Location 的重定向错误代码', async () => {
  const result = await validateConnectionRecord({ ...record, url: 'https://mcp.example.com/mcp' }, {
    fetchImpl: async () => new Response(null, { status: 302 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'redirect');
  assert.equal(result.code, REDIRECT_ERROR_CODES.INVALID);
});

test('未识别的失败代码仍回退到 network 建议', () => {
  // 防止上面对 redirect 的收紧误伤通用回退路径。
  const unknown = diagnosticFor('something-new');
  assert.equal(unknown.stage, 'transport');
  assert.equal(unknown.action, failureAction(t, 'network'));
});

test('既有失败代码的诊断未被本次改动影响', () => {
  // 抽查几条，确认新增 redirect 键没有打乱其它映射。
  assert.equal(diagnosticFor('auth').stage, 'authentication');
  assert.equal(diagnosticFor('dns').stage, 'transport');
  assert.equal(diagnosticFor('timeout').stage, 'transport');
  assert.equal(diagnosticFor('protocol').stage, 'mcp-initialize');
  assert.equal(stageLabel(t, 'configuration'), t('配置'));
});

// ---------------------------------------------------------------- lint 覆盖

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const linted = new Set([...String(packageJson.scripts?.lint ?? '').matchAll(/node --check (\S+)/g)].map((m) => m[1]));

test('新增的携凭据跳转模块必须进 lint 列表', () => {
  assert.ok(linted.has('lib/credentialed-fetch.js'),
    'lib/credentialed-fetch.js 不在 lint 列表，语法错误将无法在 CI 发现');
});

test('本次改动涉及的核心文件都在 lint 列表', () => {
  for (const file of ['lib/mcp-http.js', 'lib/mcp-validation.js', 'lib/util.js', 'lib/diagnostics.js']) {
    assert.ok(linted.has(file), `${file} 不在 lint 列表中`);
  }
});

test('lint 列表引用的文件都真实存在', async () => {
  const missing = [];
  for (const file of linted) {
    try {
      await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    } catch {
      missing.push(file);
    }
  }
  assert.deepEqual(missing, [], `lint 列表引用了不存在的文件：${missing.join(', ')}`);
});

test('lib 目录下的新增文件不会被静默漏掉', async () => {
  const files = (await readdir(new URL('../lib', import.meta.url)))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `lib/${name}`);
  // 本 PR 之前既有的遗漏，另行清理，不在此处扩大范围。
  const historicalGaps = new Set([
    'lib/connection-statistics.js',
    'lib/custom-oauth.js',
    'lib/host-tool-names.js',
    'lib/legacy-plugin-conflict.js',
    'lib/local-overrides.js',
    'lib/tool-input-guard.js',
  ]);
  const unexpected = files.filter((file) => !linted.has(file) && !historicalGaps.has(file));
  assert.deepEqual(unexpected, [], `以下文件未进 lint 列表：${unexpected.join(', ')}`);
});
