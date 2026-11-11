import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const html = (await readFile(new URL('../ui/index.html', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const declaration = (name) => html.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }`, 'm'))[0];
const method = (name) => html.match(new RegExp(`^    (?:async )?${name}\\([^]*?^    },`, 'm'))[0];
const enterprise = { pluginId: 'qcc-mcp-oauth', packageName: 'qcc-dsh-mcp-oauth', kind: 'plugin', serverNames: ['qcc-company'], entryIds: [] };
const legal = { pluginId: 'qcc-legal-mcp-oauth', packageName: 'qcc-dsh-mcp-legal-oauth', kind: 'residual',
  serverNames: ['qcc-case'], legacyServerNames: ['legal-case'], entryIds: ['mcp-qcc-legal-case'] };

function panel(respond) {
  const calls = [];
  const state = { title: '', content: '', copied: '', toast: '' };
  const nodes = new Map();
  const context = vm.createContext({
    window: {}, event: { stopPropagation() {} },
    t: (key) => key,
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, { style: {}, classList: { contains: () => true } });
      return nodes.get(id);
    },
    openModal(title, content) { Object.assign(state, { title, content }); },
    closeDetail() {}, showToast(msg) { state.toast = msg; },
    navigator: { clipboard: { async writeText(text) { state.copied = text; } } },
    call: async (name, args) => { calls.push(name); return respond(name, args); },
    workspaceParams: () => ({}), detailTryLabel: (v) => v,
    setDetailOpen() {}, renderPromptPage() {}, syncGovernanceBar() {},
    updateToolsSummary() {}, renderTools() {}, recordLocalConversion() {},
    markCommunityCtaEligible() {}, completeCatalogConnection() {},
    marketItems: {}, installedItems: [],
  });
  const helpers = ['esc', 'jsString', 'isImageIcon', 'connectionLabels', 'actionHtml', 'rowHtml', 'showLegacyDisableGuide', 'refreshOpenToolDetail'];
  const handlers = ['reauthorize', 'showDetail', 'showConnectionTools', 'scanLegacy', 'copyLegacyPluginIds'];
  const run = (source) => vm.runInContext(source, context);
  run(`
    let legacyGuidePluginIds = [], detailConnector, detailFailureState, detailNeedsReconfigure,
      detailReconnectKey, detailPrompts, promptPage, detailToolServers, detailGovernance, toolRenderLimit;
    let detailLoadId = 0;
    ${helpers.map(declaration).join('\n')}
    window.__mcp = { ${handlers.map(method).join('\n')} };
  `);
  async function click(markup, label) {
    const button = [...markup.matchAll(/<button\b([^>]*?)>([^<]*)<\/button>/g)].find((match) => match[2] === label);
    assert.ok(button, `Missing button: ${label}`);
    const handler = button[1].match(/onclick="([^"]+)"/)[1].replaceAll('&quot;', '"');
    await run(handler);
  }
  return { context, run, click, state, calls, nodes };
}

test('old migrations can reopen the guide from the market error, installed row and a repeat scan', async () => {
  const p = panel(() => ({ ok: true, detail: { pendingCount: 0, pendingLegacyDisable: {
    restartRequired: true, conflicts: [enterprise, legal], persistent: false,
  } } }));
  p.context.marketItems.company = { id: 'company', authMode: 'oauth2-pkce', connected: ['record'], connectionComplete: false, connectionState: 'unavailable', diagnostic: { legacyConflict: enterprise } };
  p.context.installedItems.push({ key: 'record', connectorId: 'company', authMode: 'oauth', diagnostic: { legacyConflict: legal } });
  await p.click(p.run('actionHtml(marketItems.company)'), 'connectionError');
  assert.match(p.state.content, /插件 → 已安装/);
  assert.match(p.state.content, /qcc-dsh-mcp-oauth/);
  assert.match(p.state.content, /「断开」会撤销授权/);
  assert.doesNotMatch(p.state.content, /已复制旧授权/);
  await p.click(p.run('rowHtml(installedItems[0])'), '查看处理步骤');
  assert.match(p.state.content, /DSH 管理员/);
  assert.match(p.state.content, /旧服务名称 <code>legal-case<\/code>/);
  await p.click(p.state.content, '复制条目 ID');
  assert.equal(p.state.copied, 'mcp-qcc-legal-case');
  await p.run('window.__mcp.scanLegacy()');
  assert.match(p.state.content, /qcc-dsh-mcp-oauth/);
  assert.match(p.state.content, /qcc-dsh-mcp-legal-oauth/);
  assert.match(p.state.content, /内存授权/);
  await p.click(p.state.content, '复制插件 ID');
  assert.equal(p.state.copied, 'qcc-mcp-oauth');
  assert.deepEqual(p.calls, ['migrationPreview']);
});

test('a disabled legacy owner shows only the remaining restart and verification steps', async () => {
  const p = panel();
  p.context.marketItems.legal = { id: 'legal', diagnostic: { legacyConflict: { ...legal, kind: 'restart', entryIds: [] } } };
  await p.click(p.run('actionHtml(marketItems.legal)'), 'connectionError');
  assert.match(p.state.content, /旧插件已停用，以下服务正在等待 DSH 重启/);
  assert.match(p.state.content, /完整|完全退出/);
  assert.doesNotMatch(p.state.content, /关闭开关|按 ID 停用|复制条目 ID/);
});

test('live and cached tool success cannot replace a legacy conflict with a connected state', async () => {
  const p = panel((name) => name === 'governance' ? { ok: false } : { ok: true, detail: {
    connectionState: 'unavailable', diagnostic: { legacyConflict: { ...enterprise, reauthRequired: true } },
    discoveryDiagnostic: { code: 'ok' }, servers: [{ ok: true, tools: [{ name: 'sample' }] }],
  } });
  p.context.marketItems.company = { id: 'company', connected: ['record'], authMode: 'oauth2-pkce', connectionState: 'unavailable' };
  await p.run('window.__mcp.showDetail("company")');
  assert.equal(p.state.title, '处理企查查旧插件冲突');
  assert.match(p.state.content, /旧授权已失效/);
  assert.notEqual(p.nodes.get('#detail-try-btn').textContent, 'try');
  p.state.title = '';
  await p.run('refreshOpenToolDetail()');
  assert.equal(p.state.title, '处理企查查旧插件冲突');
});

test('expired migrated OAuth credentials can be authorized from a disabled row without a populated market', async () => {
  const p = panel(() => ({ ok: true, message: 'authorized' }));
  p.context.installedItems.push({ key: 'record', connectorId: 'company', authMode: 'oauth', enabled: false, connectionState: 'reauth' });
  await p.click(p.run('rowHtml(installedItems[0])'), 'reauthorize');
  assert.deepEqual(p.calls, ['connect']);
  p.context.marketItems.company = { id: 'company', authMode: 'oauth2-pkce', connectionState: 'reauth', connectionComplete: false, connected: ['record'] };
  await p.click(p.run('actionHtml(marketItems.company)'), 'reauthorize');
  await p.run('window.__mcp.showDetail("company")');
  assert.deepEqual(p.calls, ['connect', 'connect']);
  assert.equal(p.nodes.get('#tools-summary').textContent, '授权已失效');
});
