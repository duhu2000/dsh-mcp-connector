import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../lib/i18n/index.js';
const t = createTranslator('zh-CN');

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('  function firstUseReadiness('), html.indexOf('  function firstUseNavigate('));
const readiness = new Function('t', `${source}; return firstUseReadiness;`)(t);
const status = { ok: true, detail: { items: [{ key: 'qcc' }] } };
const match = { connectionKey: 'qcc', serverName: 'qcc-company', name: 'get_company_profile', observedAt: 1000 };
const tools = (...items) => ({ ok: true, detail: { items } });

test('first use distinguishes failure, no connection, missing and ambiguous tools', () => {
  assert.match(readiness({ ok: false }, tools()).message, /读取状态失败/);
  assert.match(readiness(status, { ok: false }).message, /读取状态失败/);
  assert.match(readiness({ ok: true, detail: { items: [] } }, tools(match)).message, /没有连接/);
  for (const candidate of [[], [{ ...match, serverName: 'other' }], [{ ...match, name: 'get_company_profile_extra' }]]) {
    assert.equal(readiness(status, tools(...candidate)).ready, false);
    assert.match(readiness(status, tools(...candidate)).message, /未发现/);
  }
  assert.match(readiness(status, tools(match, { ...match, connectionKey: 'other' })).message, /多个同名/);
});

test('cached tool evidence never labels authorization or business successful', () => {
  const result = readiness(status, tools({ ...match, stale: true }));
  assert.equal(result.ready, true); // permits drafting, not execution
  assert.match(result.message, /缓存已过期/);
  assert.match(result.message, /不是授权、当前可用性或业务成功的证明/);
});

function fixture(statusResult, toolsResult) {
  const nodes = new Map();
  const calls = [];
  const drafts = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { disabled: true, checked: false, textContent: '' });
    return nodes.get(id);
  };
  const win = { parent: {}, __mcp: { sendPrompt: (text) => drafts.push(text) } };
  const start = html.indexOf('  async function openFirstUse(');
  const end = html.indexOf('  function normalizeWorkspaceOptions(', start);
  const make = new Function('$', 'call', 'openModal', 'viewStateKey', 'workspaceParams', 'firstUseReadiness', 'firstUseNavigate', 'esc', 'window', 't', `
    let firstUseSequence = 0, promptRequestId = null, currentWorkspace = { workspaceId: 'test' };
    const FIRST_USE_PROMPT = 'fixture draft';
    const openSharingExperience = () => {};
    const openSafeTemplate = () => {};
    ${html.slice(start, end)}
    return { openFirstUse, invalidate: () => firstUseSequence++, noWorkspace: () => currentWorkspace = null };
  `);
  const api = make($, async (method, params) => {
    calls.push({ method, params });
    return method === 'status' ? statusResult : toolsResult;
  }, () => {}, () => 'workspace:test', () => ({ workspaceId: 'test' }), readiness, () => {}, String, win, t);
  return { ...api, $, calls, drafts, win };
}

test('opening guide only reads scoped status/cache; draft requires explicit consent and click', async () => {
  const f = fixture(status, tools(match));
  await f.openFirstUse();
  assert.deepEqual(f.calls.map((c) => c.method), ['status', 'toolExplorer']);
  assert.ok(f.calls.every((c) => c.params.workspaceId === 'test'));
  assert.equal(f.drafts.length, 0);
  f.$('#first-use-launch').onclick();
  assert.equal(f.drafts.length, 0);
  f.$('#first-use-consent').checked = true;
  f.$('#first-use-consent').onchange();
  assert.equal(f.$('#first-use-launch').disabled, false);
  f.$('#first-use-launch').onclick();
  assert.deepEqual(f.drafts, ['fixture draft']);
});

test('failure and no-match states cannot hand off drafts even if checkbox is changed', async () => {
  for (const response of [{ ok: false }, tools()]) {
    const f = fixture(status, response);
    await f.openFirstUse();
    assert.equal(f.$('#first-use-consent').disabled, true);
    f.$('#first-use-consent').checked = true;
    f.$('#first-use-launch').onclick();
    assert.equal(f.drafts.length, 0);
  }
});

test('standalone or missing Host workspace displays failure without sending', async () => {
  for (const standalone of [true, false]) {
    const f = fixture(status, tools(match));
    await f.openFirstUse();
    if (standalone) f.win.parent = f.win;
    else f.noWorkspace();
    f.$('#first-use-consent').checked = true;
    f.$('#first-use-launch').onclick();
    assert.match(f.$('#first-use-result').textContent, /未创建会话、未发送任务/);
    assert.equal(f.drafts.length, 0);
  }
});

test('closed guide ignores asynchronous status completion', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const f = fixture(pending, tools(match));
  const loading = f.openFirstUse();
  f.invalidate();
  resolve(status);
  await loading;
  assert.equal(f.$('#first-use-consent').onchange, undefined);
});

test('first use preserves existing Host draft-only boundary and safe task wording', () => {
  assert.match(html, /id="first-use" type="button">首次使用/);
  assert.match(html, /不明确时停止并询问我/);
  assert.match(html, /不自动扩大查询或连续重试/);
  const host = client.slice(client.indexOf('async function startPromptSession('), client.indexOf('/** 市场主体：'));
  assert.match(host, /setDraft\(promptText\)/);
  assert.doesNotMatch(host, /\.send\(|tools\/call/);
});
