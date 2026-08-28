import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadClient({
  clientDocument,
  reactApi = {},
  reactDomApi = { createPortal() {} },
  jsxRuntime = { jsx() {}, jsxs() {} },
  windowExtras = {},
  sourceTransform = (source) => source,
} = {}) {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let plugin;
  const document = clientDocument ?? {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { append() {} },
  };
  const window = {
    ...windowExtras,
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((id) => {
          if (id === 'react/jsx-runtime') return jsxRuntime;
          if (id === 'react') return reactApi;
          if (id === 'react-dom') return reactDomApi;
          if (id === '@deepseek-ai/dsh-client-runtime/client') {
            return { defineStore: (definition) => definition };
          }
          if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button() {} };
          throw new Error(`unexpected client import: ${id}`);
        });
      },
    },
  };
  Function('window', 'document', sourceTransform(source))(window, document);
  return plugin;
}

function clientContext({ workspaceId = 'workspace-1' } = {}) {
  const registrations = new Map();
  const calls = [];
  const shell = {
    setDraft(prompt) {
      calls.push(['setDraft', prompt]);
    },
  };
  const ctx = {
    effect(start) {
      start();
    },
    slots: {
      inject(_name, register) {
        register();
      },
      register(options, component) {
        registrations.set(options.name, { options, component });
        return () => {};
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: workspaceId == null ? [] : [{ workspaceId, sessionIds: ['session-current'] }],
          recentWorkspaceId: workspaceId ?? undefined,
        }),
      },
      async connectWorkspace(id) {
        calls.push(['connectWorkspace', id]);
        return 'session-new';
      },
    },
    sessions: {
      list: { getSnapshot: () => ({ current: workspaceId == null ? undefined : 'session-current' }) },
      open(id) {
        calls.push(['open', id]);
      },
    },
    get(service) {
      if (service === 'conversation') return { input: { shell: () => shell } };
      return undefined;
    },
  };
  return { ctx, registrations, calls };
}

test('客户端声明新会话所需服务', async () => {
  const plugin = await loadClient();
  assert.deepEqual(plugin.inject, ['slots', 'sessions', 'workspaces', 'conversation']);
});

test('侧栏入口使用公开插槽托管，并具备工作区上方 Portal 与底部降级', async () => {
  let hookState = null;
  let topMount = null;
  let portal = null;
  const workspaceSlot = { parentElement: null };
  const parent = {
    querySelector(selector) {
      return selector === '[data-mcp-connector-top-mount="true"]' ? topMount : null;
    },
    insertBefore(node, before) {
      topMount = node;
      node.nextSibling = before;
    },
  };
  workspaceSlot.parentElement = parent;
  const clientDocument = {
    querySelector(selector) {
      return selector === '[data-slot="sidebar.workspaces"]' ? workspaceSlot : null;
    },
    createElement(tag) {
      return { tag, dataset: {}, nextSibling: null, remove() {} };
    },
    head: { append() {} },
    body: {},
  };
  class MutationObserverStub {
    observe() {}
    disconnect() {}
  }
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const plugin = await loadClient({
    clientDocument,
    jsxRuntime,
    reactApi: {
      useState(initial) {
        if (hookState === null) hookState = initial;
        return [hookState, (value) => {
          hookState = typeof value === 'function' ? value(hookState) : value;
        }];
      },
      useEffect(start) { start(); },
    },
    reactDomApi: {
      createPortal(node, target) {
        portal = { node, target };
        return portal;
      },
    },
    windowExtras: { MutationObserver: MutationObserverStub },
  });
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const entry = registrations.get('sidebar.footer.action');
  assert.ok(entry, '应使用公开 footer list slot 托管入口生命周期');

  const props = {
    wide: true,
    useStore: (select) => select({ open: false }),
    actions: { open() {} },
  };
  const fallback = entry.component(props);
  assert.equal(fallback.props['aria-label'], 'MCP连接器', '首次定位前应保留 footer 降级入口');
  assert.equal(topMount.dataset.mcpConnectorTopMount, 'true');
  assert.equal(topMount.nextSibling, workspaceSlot, '挂载点应紧邻工作区 slot 之前');

  entry.component(props);
  assert.equal(portal.target, topMount, '定位成功后应 Portal 到顶部挂载点');
  assert.equal(portal.node.props.className, 'mcpConnectorTopEntry');

  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /hHd-Xa_/, '不得依赖 DSH 构建生成的 CSS 类名');
});

test('示例 Prompt 写入新会话草稿后再导航', async () => {
  const plugin = await loadClient();
  const { ctx, registrations, calls } = clientContext();
  plugin.apply(ctx);
  const overlay = registrations.get('shell.overlay');
  assert.ok(overlay, '应注册连接器弹框');
  const props = overlay.options.inject();
  await props.startPromptSession('查询企查查的对外投资布局');
  assert.deepEqual(calls, [
    ['connectWorkspace', 'workspace-1'],
    ['setDraft', '查询企查查的对外投资布局'],
    ['open', 'session-new'],
  ]);
});

test('没有工作空间时给出明确错误，不静默失败', async () => {
  const plugin = await loadClient();
  const { ctx, registrations } = clientContext({ workspaceId: null });
  plugin.apply(ctx);
  const props = registrations.get('shell.overlay').options.inject();
  await assert.rejects(() => props.startPromptSession('示例'), /请先选择一个工作空间/);
});

test('市场弹框具备主题与键盘可访问性样式', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /aria-modal/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /mcpConnectorMarketClose:focus-visible/);
});

test('市场标题展示安装版本，并通过 Provider 适配层一键更新', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(source, /method: "versionStatus"/);
  assert.match(source, /VERSION_CHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1e3/);
  assert.match(source, /VERSION_CHECK_RETRY_MS = 5 \* 60 \* 1e3/);
  assert.match(source, /Date\.parse\(status\.nextCheckAt/);
  assert.match(source, /mcpConnectorVersion/);
	assert.match(source, /UPDATE_PROVIDER_ADAPTERS = Object\.freeze/);
	assert.match(source, /createHttpUpdateProviderAdapter/);
	assert.match(source, /discoverUpdateProvider/);
	assert.match(source, /sameOriginProviderEndpoint/);
	assert.match(source, /url\.origin !== window\.location\.origin/);
	assert.match(source, /schema: "dsh-market\/update-api\/v1"/);
	assert.match(source, /capabilitiesUrl: "\/dsh-market\/api\/v1\/capabilities"/);
	assert.match(source, /provider\.start\(capabilities, PLUGIN_PACKAGE_NAME/);
	assert.match(source, /provider\.operation\(capabilities, operationId\)/);
	assert.match(source, /provider\.rollback\(capabilities, updateOperation\.operationId\)/);
	assert.match(source, /completedUpdateIntegrityFailure\(operation, expectedUpdateVersion\)/);
	assert.match(source, /provider\.rollback\(capabilities, operationId\)/);
	assert.match(source, /DOWNGRADE_DETECTED/);
	assert.match(source, /RESOLVED_VERSION_MISMATCH/);
	assert.match(source, /provider\.restart\(capabilities\)/);
  assert.match(source, /一键更新到 v/);
  assert.match(source, /正在更新/);
  assert.match(source, /failure\?\.retryable/);
	assert.match(source, /capabilities\?\.restart\?\.supported === true/);
  assert.match(source, /请重启 DSH Desktop/);
  assert.match(source, /window\.location\.reload\(\)/);
	assert.doesNotMatch(source, /"\/dsh-market\/update"/, '不得调用 Market 未版本化的私有更新接口');
	assert.doesNotMatch(source, /const MARKET_(?:UPDATES|OPERATIONS|ROLLBACK|RESTART)_URL/, 'UI 不应硬编码 Provider 操作端点');
  assert.match(source, /查看 v.*更新方式/);
  assert.match(source, /\[data-slot="sidebar\.settings"\]/);
  assert.match(source, /\^\(\\u63d2\\u4ef6\\u5e02\\u573a\|Plugin Market\|Plugin Marketplace\)\$/);
  assert.match(source, /window\.open\(NPM_PACKAGE_URL, "_blank", "noopener,noreferrer"\)/);
  assert.doesNotMatch(source, /registry\.npmjs\.org/, '客户端不应跨域请求版本源');
});

test('DSH Desktop 设置中没有插件市场时回退到 npm 更新说明', async () => {
  let settingsClicks = 0;
  const opened = [];
  const settingsTrigger = { click() { settingsClicks += 1; } };
  const plugin = await loadClient({
    clientDocument: {
      querySelector(selector) {
        if (selector !== '[data-slot="sidebar.settings"]') return null;
        return { querySelector: () => settingsTrigger };
      },
      querySelectorAll: () => [],
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { append() {} },
    },
    windowExtras: {
      setTimeout(callback) { callback(); return 1; },
      requestAnimationFrame(callback) { callback(); return 1; },
      open(...args) { opened.push(args); },
    },
    sourceTransform(source) {
      return source.replace(
        '\t\texports.apply = apply;',
        '\t\texports.__testOpenDshPluginMarket = openDshPluginMarket;\n\t\texports.apply = apply;',
      );
    },
  });
  let closes = 0;
  plugin.__testOpenDshPluginMarket({ close() { closes += 1; } });
  assert.equal(closes, 1);
  assert.equal(settingsClicks, 1);
  assert.deepEqual(opened, [[
    'https://www.npmjs.com/package/dsh-mcp-connector', '_blank', 'noopener,noreferrer',
  ]]);
});

test('客户端独立拒绝 Provider 降级、错误目标和无效成功结果', async () => {
  const plugin = await loadClient({
    sourceTransform(source) {
      return source.replace(
        '\t\texports.apply = apply;',
        '\t\texports.__testCompletedUpdateIntegrityFailure = completedUpdateIntegrityFailure;\n\t\texports.apply = apply;',
      );
    },
  });
  const verify = plugin.__testCompletedUpdateIntegrityFailure;
  assert.equal(typeof verify, 'function');
  assert.equal(verify({ state: 'running' }, '0.2.25'), null);
  assert.equal(verify({
    state: 'succeeded', beforeVersion: '0.2.24', installedVersion: '0.2.25',
  }, '0.2.25'), null);
  assert.deepEqual(verify({
    state: 'succeeded', beforeVersion: '0.2.24', installedVersion: '0.2.23',
  }, '0.2.25'), {
    code: 'DOWNGRADE_DETECTED',
    message: '更新服务将插件从 v0.2.24 降级到 v0.2.23',
    retryable: false,
  });
  assert.deepEqual(verify({
    state: 'succeeded', beforeVersion: '0.2.24', installedVersion: '0.2.26',
  }, '0.2.25'), {
    code: 'RESOLVED_VERSION_MISMATCH',
    message: '预期安装 v0.2.25，更新服务实际安装了 v0.2.26',
    retryable: true,
  });
  assert.equal(verify({
    state: 'succeeded', beforeVersion: '1.0.0-beta.2', installedVersion: '1.0.0-beta.1',
  }, '1.0.0-beta.3').code, 'DOWNGRADE_DETECTED');
  assert.equal(verify({ state: 'succeeded', beforeVersion: '0.2.24' }, '0.2.25').code, 'INVALID_UPDATE_RESULT');
});

test('能力探测通过后渲染一键更新，并使用 Provider 广告的同源端点', async () => {
  const requests = [];
  const effects = [];
  const state = [];
  let stateCursor = 0;
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const reactApi = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
    useRef(initial) { return { current: initial }; },
    useEffect(start) { effects.push(start); },
  };
  const fetch = async (url, options = {}) => {
    requests.push([String(url), options.method ?? 'GET', options.body]);
    if (url === '/mcp-connector/api') {
      return new Response(JSON.stringify({
        ok: true,
        detail: {
          installedVersion: '0.2.24',
          latestVersion: '0.2.25',
          updateAvailable: true,
          checking: false,
          nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }), { status: 200 });
    }
	if (url === '/dsh-market/api/v1/capabilities') {
		return new Response(JSON.stringify({
			schema: 'dsh-market/update-api/v1',
			apiVersion: 1,
			runtime: 'web',
			features: { update: true, progress: true, rollback: true, restart: true },
			restart: { supported: true, managedBy: 'market' },
			endpoints: {
				updates: '/test-update-provider/v1/updates',
				operations: '/test-update-provider/v1/operations',
				rollback: '/test-update-provider/v1/rollback',
				restart: '/test-update-provider/v1/restart',
			},
		}), { status: 200 });
	}
	if (String(url).startsWith('/test-update-provider/v1/updates?')) {
      return new Response(JSON.stringify({
        schema: 'dsh-market/update-api/v1',
        package: {
          name: 'dsh-mcp-connector',
          installedVersion: '0.2.24',
          latestVersion: '0.2.25',
          updateAvailable: true,
        },
      }), { status: 200 });
    }
	if (url === '/test-update-provider/v1/updates' && options.method === 'POST') {
      return new Response(JSON.stringify({
        schema: 'dsh-market/update-api/v1',
        operation: {
          operationId: 'boot-update-1',
          state: 'running',
          progress: { percent: 25 },
          outcome: { rollback: { available: false, state: 'unavailable' } },
        },
      }), { status: 202 });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const plugin = await loadClient({
    jsxRuntime,
    reactApi,
    windowExtras: {
      fetch,
      location: { origin: 'http://127.0.0.1:3080', reload() {} },
      addEventListener() {},
      removeEventListener() {},
      setTimeout() { return 1; },
      clearTimeout() {},
      requestAnimationFrame(callback) { callback(); },
      open() {},
    },
  });
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const component = registrations.get('shell.overlay').component;
  const props = {
    wide: true,
    useStore: (select) => select({ open: true, detailOpen: false }),
    actions: { close() {}, detailOpened() {}, detailClosed() {} },
    startPromptSession() {},
  };
  const render = () => {
    stateCursor = 0;
    return component(props);
  };
  const descendants = (root) => {
    const result = [];
    const visit = (node) => {
      if (node == null || node === false || typeof node !== 'object') return;
      result.push(node);
      const children = node.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) visit(child);
    };
    visit(root);
    return result;
  };

  render();
  for (const start of effects.splice(0)) start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  effects.length = 0;
  let tree = render();
  const update = descendants(tree).find((node) => node.type === 'button'
    && node.props?.children === '一键更新到 v0.2.25');
  assert.ok(update, '探测到 v1 后应在当前页面提供一键更新');
  update.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));

  effects.length = 0;
  tree = render();
  assert.ok(descendants(tree).some((node) => node.props?.children === '正在更新 25%'));
	const mutation = requests.find(([url, method]) => url === '/test-update-provider/v1/updates' && method === 'POST');
  assert.ok(mutation, '点击后应调用 Provider 广告的更新入口');
  assert.deepEqual(JSON.parse(mutation[2]), { packageName: 'dsh-mcp-connector' });
});

test('Provider 广告跨源端点时拒绝一键更新并安全降级', async () => {
  const requests = [];
  const effects = [];
  const state = [];
  let stateCursor = 0;
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const reactApi = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
    useRef(initial) { return { current: initial }; },
    useEffect(start) { effects.push(start); },
  };
  const fetch = async (url) => {
    requests.push(String(url));
    if (url === '/mcp-connector/api') {
      return new Response(JSON.stringify({
        ok: true,
        detail: {
          installedVersion: '0.2.24',
          latestVersion: '0.2.25',
          updateAvailable: true,
          checking: false,
          nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }), { status: 200 });
    }
    if (url === '/dsh-market/api/v1/capabilities') {
      return new Response(JSON.stringify({
        schema: 'dsh-market/update-api/v1',
        apiVersion: 1,
        features: { update: true },
        restart: { supported: false, managedBy: 'operator' },
        endpoints: {
          updates: 'https://evil.example/updates',
          operations: '/safe-looking/operations',
        },
      }), { status: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const plugin = await loadClient({
    jsxRuntime,
    reactApi,
    windowExtras: {
      fetch,
      location: { origin: 'http://127.0.0.1:3080', reload() {} },
      addEventListener() {},
      removeEventListener() {},
      setTimeout() { return 1; },
      clearTimeout() {},
      requestAnimationFrame(callback) { callback(); },
      open() {},
    },
  });
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const component = registrations.get('shell.overlay').component;
  const props = {
    wide: true,
    useStore: (select) => select({ open: true, detailOpen: false }),
    actions: { close() {}, detailOpened() {}, detailClosed() {} },
    startPromptSession() {},
  };
  const render = () => {
    stateCursor = 0;
    return component(props);
  };
  const descendants = (root) => {
    const result = [];
    const visit = (node) => {
      if (node == null || node === false || typeof node !== 'object') return;
      result.push(node);
      const children = node.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) visit(child);
    };
    visit(root);
    return result;
  };

  render();
  for (const start of effects.splice(0)) start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  effects.length = 0;
  const tree = render();
  assert.ok(descendants(tree).some((node) => node.type === 'button'
    && node.props?.children === '查看 v0.2.25 更新方式'));
  assert.equal(requests.some((url) => url.startsWith('https://evil.example/')), false);
});
