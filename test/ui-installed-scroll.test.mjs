import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 回归守护：issue #135 问题 2 —— 启停连接后 SSE 触发 scheduleStatusRefresh() → loadInstalled()
// 会整体重写 main.innerHTML，滚动容器 main（overflow-y:auto）被压回顶部。
// 本文件同时做两件事：① 源码结构断言（三个 return 出口都必须还原滚动位置）；
// ② 用替身 main/call 真执行 loadInstalled，断言 preserveScroll 语义与默认语义。
const normalizeLineEndings = (source) => source.replace(/\r\n?/g, '\n');
const uiSource = normalizeLineEndings(await readFile(new URL('../ui/index.html', import.meta.url), 'utf8'));

const RESTORE_LINE = 'if (preserveScroll) main.scrollTop = previousScrollTop;';

function loadInstalledSource() {
  const start = uiSource.indexOf('  async function loadInstalled(');
  assert.notEqual(start, -1, 'ui/index.html 必须仍定义 loadInstalled');
  const end = uiSource.indexOf('\n  function rowHtml(', start);
  assert.notEqual(end, -1, '必须能定位 loadInstalled 的函数边界（rowHtml 之前）');
  return uiSource.slice(start, end);
}

// 浏览器行为替身：`main` 是滚动容器，innerHTML 被换成「加载中…」这类矮内容时浏览器会把
// scrollTop 夹回 0；之后只有显式赋值才能恢复。这样替身才能暴露"没有还原"这个 bug。
function createMain(initialScrollTop) {
  let scrollTop = initialScrollTop;
  let html = '';
  return {
    get scrollTop() { return scrollTop; },
    set scrollTop(value) { scrollTop = Math.max(0, value); },
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      if (value.includes('加载中')) scrollTop = 0;
    },
  };
}

function createLoadInstalled({ main, status, migration = { ok: true, detail: {} } }) {
  const calls = [];
  const tabs = [];
  const call = async (method) => {
    calls.push(method);
    return method === 'status' ? status : migration;
  };
  const make = new Function(
    'syncMarketNav', 'main', 'call', 'workspaceParams', 'esc', 'updateAvailableWorkspaces', 'installedItems',
    'scopeRevision', 'scopeRollbackRevision', 'setTabCount', 'markCommunityCtaEligible', 'matchesSearch',
    'searchQuery', 'rowHtml', 'communityCtaHtml',
    `${loadInstalledSource()}; return loadInstalled;`,
  );
  const loadInstalled = make(
    () => {}, main, call, () => ({}), (value) => String(value ?? ''), () => {}, [],
    0, null, (tab, count) => tabs.push({ tab, count }), () => {}, () => true, '',
    () => '<div class="row">row</div>', () => '',
  );
  return { loadInstalled, calls, tabs };
}

const installedStatus = (items) => ({ ok: true, detail: { items, scope: { revision: 1 } } });

test('loadInstalled 声明 preserveScroll，并在改动 DOM 之前捕获滚动位置', () => {
  const source = loadInstalledSource();
  assert.match(source, /async function loadInstalled\(\{ preserveScroll = false \} = \{\}\)/);
  const capture = source.indexOf('const previousScrollTop = preserveScroll ? main.scrollTop : 0;');
  const firstDomWrite = source.indexOf('main.innerHTML =');
  assert.notEqual(capture, -1, '必须捕获 previousScrollTop');
  assert.notEqual(firstDomWrite, -1, 'loadInstalled 仍会重写 main.innerHTML');
  assert.ok(capture < firstDomWrite, '捕获必须发生在任何 DOM 写入之前');
});

test('loadInstalled 的三个 return 出口都还原滚动位置', () => {
  const source = loadInstalledSource();
  const restores = source.match(/if \(preserveScroll\) main\.scrollTop = previousScrollTop;/g) ?? [];
  assert.equal(restores.length, 3, '错误出口、空列表出口、正常出口各一次还原');

  const lines = source.replace(/\s+$/, '').split('\n');
  const explicitReturns = lines.map((line, index) => [line.trim(), index]).filter(([line]) => line === 'return;');
  assert.equal(explicitReturns.length, 2, '错误出口与空列表出口是唯一的两个显式 return');
  for (const [, index] of explicitReturns) {
    assert.equal(lines[index - 1]?.trim(), RESTORE_LINE, `第 ${index + 1} 行 return 之前必须还原滚动位置`);
  }

  assert.equal(lines.at(-1)?.trim(), '}', '抽取到的源码应以 loadInstalled 的收尾大括号结束');
  const tail = lines.slice(0, -1).filter((line) => line.trim() !== '');
  assert.equal(tail.at(-1)?.trim(), RESTORE_LINE, '正常出口（函数末尾）必须是还原滚动位置');
});

test('scheduleStatusRefresh 保留滚动，其余调用点保持默认归零', () => {
  assert.match(uiSource, /else await loadInstalled\(\{ preserveScroll: true \}\);/);
  const preservedCalls = uiSource.match(/loadInstalled\(\{ preserveScroll: true \}\)/g) ?? [];
  assert.equal(preservedCalls.length, 1, '只有 SSE 状态刷新走 preserveScroll');
  const bareAwaitCalls = uiSource.match(/await loadInstalled\(\);/g) ?? [];
  assert.equal(bareAwaitCalls.length, 4, '编辑配置 / 重命名 / 迁移两处仍不保留滚动');
  assert.match(uiSource, /function refresh\(\) \{ return view === 'tools' \? loadToolExplorer\(\) : view === 'market' \? loadMarket\(\) : loadInstalled\(\); \}/);
});

test('preserveScroll: true 时三个出口都把滚动位置还原', async () => {
  const cases = [
    ['错误出口', { ok: false, message: 'boom' }],
    ['空列表出口', installedStatus([])],
    ['正常出口', installedStatus([{ key: 'a', name: 'a' }])],
  ];
  for (const [label, status] of cases) {
    const main = createMain(137);
    const { loadInstalled } = createLoadInstalled({ main, status });
    await loadInstalled({ preserveScroll: true });
    assert.equal(main.scrollTop, 137, `${label} 应还原滚动位置`);
  }
});

test('默认调用（切 tab / refresh()）不还原，依旧被内容重写带回顶部', async () => {
  const main = createMain(137);
  const { loadInstalled } = createLoadInstalled({ main, status: installedStatus([{ key: 'a', name: 'a' }]) });
  await loadInstalled();
  assert.equal(main.scrollTop, 0, '未显式要求保留时必须维持原有归零行为');
});
