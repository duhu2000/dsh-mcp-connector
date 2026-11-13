import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const html = (await readFile(new URL('../ui/index.html', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
function section(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return html.slice(from, to);
}

function declaration(name) {
  const match = html.match(new RegExp('^  function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, name);
  return match[0];
}

function fixture() {
  const tools = Array.from({ length: 186 }, (_, i) => ({
    name: i === 0 ? 'sanctions_lookup' : 'lookup_' + i, description: i === 1 ? '已弃用' : '企业工商数据',
    publicName: 'company_lookup_' + i,
  }));
  const company = { serverKey: 'company', serverName: 'qcc-company', ok: true, tools };
  let start = 0;
  const categories = [['risk', 38], ['ipr', 18], ['operation', 36], ['history', 34], ['executive', 44]];
  return [company, ...categories.map(([serverKey, count]) => {
    const subset = tools.slice(start, start + count);
    start += count;
    return { serverKey, serverName: 'qcc-' + serverKey, ok: true, tools: subset.map(tool => ({
      ...tool, publicName: serverKey + '_' + tool.name,
      description: tool.name === 'sanctions_lookup' ? '风险入口独有说明' : tool.description,
    })) };
  })];
}

// Exercise the shipped renderers and event handlers with only the DOM nodes they touch.
function panel(servers = fixture()) {
  const nodes = new Map(), calls = [];
  function $(id) {
    assert.ok(html.includes('id="' + id.slice(1) + '"'), id);
    if (!nodes.has(id)) nodes.set(id, {
      value: '', innerHTML: '', textContent: '', hidden: false,
      querySelectorAll() { return []; },
      addEventListener(type, callback) { this[type] = callback; },
    });
    return nodes.get(id);
  }
  const ctx = vm.createContext({
    $, servers, closeDetail() {}, workspaceParams: () => ({}), showToolParameters() {},
    call: async (method, args) => { calls.push({ method, ...args }); return { ok: true }; },
  });
  vm.runInContext([
    section('  let detailConnector =', '  const MARKET_SECTION_PREVIEW_LIMIT'),
    declaration('interpolate'), 'const t = interpolate;', declaration('esc'),
    section('  function resetDetailTools()', '  function openModal('),
    section('  async function openToolDetail(', '  function schemaSummary('),
    section("  $('#detail-close').addEventListener(", "  $('#detail-try-btn').addEventListener("),
    'detailConnector = { id: "qcc-company", connected: servers.map(s => s.serverName) };',
    'detailToolServers = servers; renderTools();',
  ].join('\n'), ctx);
  const list = $('#detail-tools');
  const names = () => [...list.innerHTML.matchAll(/<div class="tool-name">([^<]*)<\/div>/g)].map(m => m[1]);
  const search = (query) => { const input = $('#tools-search'); input.value = query; input.input({ target: input }); };
  const chooseEntry = (value) => { const select = $('#tools-entry'); select.value = value; select.change({ target: select }); };
  // Delegate an action using the data attributes that actually reached that row's control.
  function dispatch(type, selector, attribute, value) {
    const control = list.innerHTML.match(new RegExp('<(?:select|button)\\b[^>]*\\b' + attribute + '[^>]*>'))?.[0];
    assert.ok(control, 'missing control ' + selector);
    const dataset = Object.fromEntries([...control.matchAll(/\bdata-([\w-]+)(?:="([^"]*)")?/g)]
      .map(([, key, data]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), data ?? '']));
    const target = { value, dataset, closest: (s) => s === selector ? target : null };
    list[type]({ target });
  }
  return { $, list, names, search, chooseEntry, dispatch, calls };
}

test('全量入口和五个分类入口按同一份工具清单计数、搜索和分页', () => {
  const p = panel();
  assert.equal(p.$('#tools-summary').textContent, '186 个工具 · 6 个服务入口');
  assert.match(p.$('#tools-search').placeholder, /186/);
  assert.equal(p.$('#tools-entry-hint').hidden, false);
  assert.match(p.$('#tools-entry-hint').textContent, /186/);
  assert.equal(p.names().length, 50);
  assert.match(p.list.innerHTML, /剩余 136/);
  for (const shown of [100, 150, 186]) {
    p.dispatch('click', '#tools-more', 'id="tools-more"');
    assert.equal(p.names().length, shown);
  }
  assert.equal(new Set(p.names()).size, 186);
  assert.doesNotMatch(p.list.innerHTML, /id="tools-more"/);
  assert.equal(p.names().at(-1), 'lookup_1');
  assert.match(p.list.innerHTML, /class="tool-deprecated"/);

  p.search('风险入口独有说明');
  assert.deepEqual(p.names(), ['sanctions_lookup']);
  assert.match(p.$('#tools-summary').textContent, /匹配 1 个工具/);
  p.search('');
  assert.equal(p.names().length, 50);
  p.chooseEntry('qcc-risk');
  assert.equal(p.names().length, 38);
  assert.doesNotMatch(p.list.innerHTML, /id="tools-more"/);
  assert.match(p.list.innerHTML, /data-policy-scope="server"[^>]*data-server-name="qcc-risk"/);
  p.chooseEntry('');
  assert.equal(p.names().length, 50);
});

test('切换同名工具的入口后，读取参数与治理预览都使用选中的服务', () => {
  const p = panel();
  p.search('sanctions_lookup');
  assert.deepEqual(p.names(), ['sanctions_lookup']);
  p.dispatch('change', 'select[data-tool-source]', 'data-tool-source', 'qcc-risk');
  assert.match(p.list.innerHTML, /风险入口独有说明/);
  p.dispatch('click', 'button[data-tool-detail]', 'data-tool-detail');
  p.dispatch('change', 'select[data-policy-scope]', 'data-policy-scope="tool"', 'deny');
  assert.deepEqual(p.calls.map(({ method, serverName, toolName }) => ({ method, serverName, toolName })), [
    { method: 'toolDetail', serverName: 'qcc-risk', toolName: 'sanctions_lookup' },
    { method: 'previewPolicy', serverName: 'qcc-risk', toolName: 'sanctions_lookup' },
  ]);
  assert.equal(p.calls[1].publicName, 'risk_sanctions_lookup');
});

test('分类入口新增全量入口里没有的工具时，计数、搜索和说明随数据更新', () => {
  const servers = fixture();
  servers[1].tools.push({ name: 'risk_only', description: '风险专项' });
  const p = panel(servers);
  assert.equal(p.$('#tools-summary').textContent, '187 个工具 · 6 个服务入口');
  assert.equal(p.$('#tools-entry-hint').hidden, true);
  p.search('risk_only');
  assert.deepEqual(p.names(), ['risk_only']);
});
