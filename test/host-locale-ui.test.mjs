import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function section(start, end) {
  const a = script.indexOf(start), b = script.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return script.slice(a, b);
}

function panel({ search = '', saved, host = 'zh-CN', explicit = false, blocked = false } = {}) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { classes: new Set(), innerHTML: '', scrollLeft: 17 });
    const item = nodes.get(selector);
    item.classList = { contains: value => item.classes.has(value) };
    return item;
  };
  const events = new Map(), writes = [], renders = [], notices = [], microtasks = [];
  const parent = {};
  const context = vm.createContext({
    URLSearchParams, window: {
      parent, location: { search, origin: 'http://localhost' },
      __MCP_CONNECTOR_LOCALE__: host, __MCP_CONNECTOR_LOCALE_EXPLICIT__: explicit,
      localStorage: { getItem() { if (blocked) throw Error('blocked'); return saved; }, setItem: (...args) => writes.push(args) },
      addEventListener: (event, listener) => events.set(event, listener),
    },
    document: { documentElement: { lang: 'zh-CN', getAttribute: () => 'zh-CN' } },
    $: node, t: value => value, DEFAULT_LOCALE: 'zh-CN', LANGUAGE_STORAGE_KEY: 'mcp-connector.ui-language',
    WORKSPACE_CONTEXT_RESULT_TYPE: 'mcp-connector:workspace-context', PROMPT_RESULT_TYPE: 'mcp-connector:start-session-result',
    queueMicrotask: fn => microtasks.push(fn), showToast: text => notices.push(text),
    applyStaticLocale: () => renders.push('static'), syncLanguageButtons() {}, syncTabs() {}, syncMarketNav() {},
    loadMarket: options => renders.push(['market', options]), loadInstalled: options => renders.push(['installed', options]),
    loadToolExplorer: () => renders.push('tools'), view: 'market', main: { scrollTop: 90 }, pendingViewScroll: null,
    relocalizeView: () => renders.push('loaded-view'),
  });
  vm.runInContext(section('  function normalizeLocale(', '  /** `{name}`'), context);
  vm.runInContext('let ACTIVE_LOCALE = detectLocale();', context);
  vm.runInContext(section('  let pendingHostLocale =', '  function syncLanguageButtons('), context);
  vm.runInContext(section("  window.addEventListener('message',", '  function requestWorkspaceContext('), context);
  const run = text => vm.runInContext(text, context);
  return { node, run, context, writes, renders, notices,
    receive(locale, extras = {}) { events.get('message')({ origin: 'http://localhost', source: parent, data: { type: 'mcp-connector:host-locale', locale }, ...extras }); },
    flush() { while (microtasks.length) microtasks.shift()(); },
  };
}

test('iframe receives same-origin parent locale, switches both directions without navigation or preference writes', () => {
  const p = panel({ search: '?locale=en' });
  assert.equal(p.run('ACTIVE_LOCALE'), 'en');
  p.receive('zh-CN', { origin: 'https://untrusted.example' }); p.flush();
  p.receive('zh-CN', { source: {} }); p.flush();
  assert.equal(p.run('ACTIVE_LOCALE'), 'en');
  p.receive('zh-Hans'); p.flush();
  assert.equal(p.context.document.documentElement.lang, 'zh-CN');
  assert.equal(p.context.t.locale, 'zh-CN');
  assert.equal(p.renders.at(-1), 'loaded-view');
  p.receive('en-US'); p.flush();
  assert.equal(p.context.document.documentElement.lang, 'en');
  assert.equal(p.context.main.scrollTop, 90);
  assert.deepEqual(p.writes, []);
});

test('iframe defers locale during editors/details/confirmation and coalesces the latest Host selection', () => {
  for (const [selector, className] of [['#modalMask', 'show'], ['#confirmMask', 'show'], ['#detail-overlay', 'active']]) {
    const p = panel();
    const editor = p.node(selector); editor.classes.add(className); editor.value = 'unsaved JSON';
    p.receive('en'); p.flush();
    assert.equal(p.run('ACTIVE_LOCALE'), 'zh-CN');
    assert.equal(editor.value, 'unsaved JSON');
    assert.equal(p.notices.length, 1);
    assert.deepEqual(p.renders, []);
    p.receive('zh'); p.flush();
    editor.classes.delete(className); p.run('flushHostLocale()'); p.flush();
    assert.deepEqual(p.renders, [], 'switching back cancels the pending change');
    editor.classes.add(className); p.receive('en'); p.flush();
    editor.classes.delete(className); p.run('flushHostLocale()'); p.flush();
    assert.equal(p.run('ACTIVE_LOCALE'), 'en');
    assert.equal(editor.value, 'unsaved JSON');
  }
});

test('iframe keeps explicit URL, browser and plugin choices, including unavailable storage', () => {
  for (const options of [
    { search: '?uiLocale=zh-CN&locale=en', blocked: true },
    { saved: 'zh-CN', search: '?locale=en' },
    { host: 'zh-CN', explicit: true, search: '?locale=en' },
    { host: 'en', explicit: true, search: '?locale=zh-CN' },
  ]) {
    const p = panel(options), initial = p.run('ACTIVE_LOCALE');
    p.receive(initial === 'en' ? 'zh' : 'en'); p.flush();
    assert.equal(p.run('ACTIVE_LOCALE'), initial);
    assert.deepEqual(p.renders, []);
    assert.deepEqual(p.writes, []);
  }
});

test('rapid Host switches preserve loaded list scroll without requests or loading placeholders', async () => {
  for (const view of ['market', 'installed']) {
    const p = panel(), calls = [];
    let scrollTop = 600, content = '';
    Object.assign(p.context, {
      view, marketCategory: '', searchQuery: '', marketItems: {}, installedItems: [],
      scopeRevision: 0, scopeRollbackRevision: null, initialHealthCheckStarted: true,
      workspaceParams: () => ({}), updateAvailableWorkspaces() {}, setTabCount() {},
      markCommunityCtaEligible() {}, matchesSearch: () => true, matchesMarketFilters: () => true,
      groupedMarketHtml: () => `<div class="grid">${p.context.t.locale}</div>`,
      rowHtml: () => `<div class="row">${p.context.t.locale}</div>`, communityCtaHtml: () => '',
      firstUseBannerHtml: () => '', installedEmptyHtml: () => '', esc: String,
      viewStateKey: () => view, saveViewState() {}, viewRenderSequence: 0, viewStateLoading: false,
      call: async method => { calls.push(method); return { ok: true, detail: { items: [{ id: 'fixture' }] } }; },
      main: {
        get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = value; },
        get innerHTML() { return content; },
        set innerHTML(value) { content = value; if (value.includes('加载中')) scrollTop = 0; },
      },
    });
    vm.runInContext(section('  function beginViewRender(', '  async function call('), p.context);
    vm.runInContext(section(`  async function ${view === 'market' ? 'loadMarket' : 'loadInstalled'}(`,
      view === 'market' ? '  function connectionLabels(' : '  function rowHtml('), p.context);
    await p.run(view === 'market' ? 'loadMarket({ checkHealth: false })' : 'loadInstalled()');
    p.context.main.scrollTop = 600;
    const initialCalls = calls.length;
    for (const locale of ['en', 'zh-CN', 'en', 'zh-CN']) {
      p.receive(locale); p.flush();
      assert.equal(p.context.main.scrollTop, 600, view);
      assert.match(content, new RegExp(locale));
      assert.equal(calls.length, initialCalls, 'language-only rendering must not refetch');
    }
    let complete;
    p.context.call = method => { calls.push(method); return new Promise(resolve => { (complete ??= []).push(resolve); }); };
    const loading = p.run(view === 'market' ? 'loadMarket({ checkHealth: false, preserveScroll: true })' : 'loadInstalled({ preserveScroll: true })');
    assert.equal(p.context.main.scrollTop, 0, 'ordinary refresh simulates browser clamping');
    const pendingCalls = calls.length;
    p.receive('en'); p.flush(); p.receive('zh-CN'); p.flush(); p.receive('en'); p.flush();
    assert.equal(calls.length, pendingCalls, 'in-flight refresh must not be superseded by locale');
    complete.forEach(resolve => resolve({ ok: true, detail: { items: [{ id: 'fixture' }] } }));
    await loading;
    assert.equal(p.context.main.scrollTop, 600);
    assert.match(content, /en/);
    assert.deepEqual(p.writes, []);
  }
});

test('dialog-to-dialog handoff does not translate or replace the new editor', () => {
  const p = panel();
  p.node('#modalMask').classes.add('show'); p.receive('en'); p.flush();
  p.node('#modalMask').classes.delete('show'); p.run('flushHostLocale()');
  p.node('#confirmMask').classes.add('show'); p.flush();
  assert.equal(p.run('ACTIVE_LOCALE'), 'zh-CN');
  p.node('#confirmMask').classes.delete('show'); p.run('flushHostLocale()'); p.flush();
  assert.equal(p.run('ACTIVE_LOCALE'), 'en');
});
