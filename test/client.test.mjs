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
          throw new Error(`unexpected client import: ${id}`);
        });
      },
    },
  };
  Function('window', 'document', sourceTransform(source))(window, document);
  return plugin;
}

function clientContext({ workspaceId = 'workspace-1', settingsScope, workspaceNavigation = 'legacy' } = {}) {
  const registrations = new Map();
  const calls = [];
  const shell = {
    setDraft(prompt) {
      calls.push(['setDraft', prompt]);
    },
  };
  const workspaces = {
    list: {
      getSnapshot: () => ({
        items: workspaceId == null ? [] : [{ workspaceId, sessionIds: ['session-current'] }],
        recentWorkspaceId: workspaceId ?? undefined,
      }),
    },
  };
  if (workspaceNavigation === 'legacy' || workspaceNavigation === 'both') {
    workspaces.connectWorkspace = async (id) => {
      calls.push(['connectWorkspace', id]);
      return 'session-new';
    };
  }
  const sessions = {
    list: { getSnapshot: () => ({ current: workspaceId == null ? undefined : 'session-current' }) },
    open(id) {
      calls.push(['open', id]);
    },
  };
  if (workspaceNavigation === 'sessions') {
    sessions.create = async (options) => {
      calls.push(['create', options]);
      return 'session-new';
    };
  }
  const uiWorkspace = workspaceNavigation === 'ui' || workspaceNavigation === 'both'
    ? {
        async connectWorkspace(id) {
          calls.push(['uiConnectWorkspace', id]);
          return 'session-new';
        },
      }
    : undefined;
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
    workspaces,
    sessions,
    get(service) {
      if (service === 'uiWorkspace') return uiWorkspace;
      if (service === 'conversation') return { input: { shell: () => shell } };
      return undefined;
    },
  };
  ctx.inject = (services, callback) => {
    if (services.includes('settingsScope') && settingsScope !== undefined) {
      callback({ ...ctx, settingsScope });
    }
  };
  return { ctx, registrations, calls };
}

function mutableSettingsScope(initial) {
  let snapshot = initial;
  const listeners = new Set();
  const writes = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async set(field, value) {
      writes.push(['set', field, value]);
      snapshot = {
        ...snapshot,
        status: 'ready',
        value: { ...snapshot.value, [field]: value },
        user: { ...snapshot.user, [field]: value },
      };
      for (const listener of listeners) listener();
    },
    async unset(field) {
      writes.push(['unset', field]);
      const { [field]: _removed, ...user } = snapshot.user ?? {};
      snapshot = {
        ...snapshot,
        status: 'ready',
        value: { ...snapshot.value, [field]: snapshot.base?.[field] ?? true },
        user,
      };
      for (const listener of listeners) listener();
    },
    publish(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
  return { scope, writes };
}

test('客户端声明新会话所需服务', async () => {
  const plugin = await loadClient();
  assert.deepEqual(plugin.inject, ['slots', 'sessions', 'workspaces', 'conversation']);
});

test('客户端入口不依赖 Host 版本特有的 Store、Runtime 或 UI Primitives 模块', async () => {
  await assert.doesNotReject(() => loadClient());
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /require\("@deepseek-ai\/dsh-client-(?:store|runtime|ui-primitives|ui-settings)/);
});

test('内置弹框 Store 实现标准快照、订阅与动作 contract', async () => {
  const plugin = await loadClient();
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const handle = registrations.get('shell.overlay').options.store;
  const instance = handle.create();
  let changes = 0;
  const unsubscribe = instance.subscribe(() => { changes += 1; });

  assert.deepEqual(instance.getSnapshot(), { open: false, detailOpen: false, sidebarVisible: true });
  instance.actions.open();
  instance.actions.detailOpened();
  assert.deepEqual(instance.getSnapshot(), { open: true, detailOpen: true, sidebarVisible: true });
  instance.actions.close();
  assert.deepEqual(instance.getSnapshot(), { open: false, detailOpen: false, sidebarVisible: true });
  assert.equal(changes, 3);
  unsubscribe();
  instance.actions.open();
  assert.equal(changes, 3);
  assert.doesNotThrow(() => instance.clearPersisted());
});

test('设置 scope 控制侧边栏可见性并注册同一弹框的快捷入口', async () => {
  const plugin = await loadClient();
  const settings = mutableSettingsScope({
    status: 'ready',
    value: { showSidebarEntry: false },
    base: { showSidebarEntry: true },
    user: { showSidebarEntry: false },
    writable: true,
    mode: 'host',
    revision: 1,
  });
  let bindSpec;
  const { ctx, registrations } = clientContext({
    settingsScope: {
      bind(spec) {
        bindSpec = spec;
        return settings.scope;
      },
    },
  });

  plugin.apply(ctx);

  assert.equal(bindSpec.namespace, 'mcp-connector');
  assert.deepEqual(bindSpec.decode({ showSidebarEntry: false }), { showSidebarEntry: false });
  assert.equal(bindSpec.decode({}), undefined);
  const overlay = registrations.get('shell.overlay');
  const bundleCard = registrations.get('plugins.bundle.config');
  const settingsCard = registrations.get('settings.plugin.item');
  assert.ok(bundleCard, '新版应在插件详情页注册 MCP连接器设置卡片');
  assert.equal(bundleCard.options.key, 'dsh-mcp-connector', '详情插槽按插件包名匹配');
  assert.ok(settingsCard, '旧版宿主仍需旧设置插槽，保持向后兼容');
  assert.equal(settingsCard.options.key, 'mcp-connector', '旧插槽按 settings 命名空间匹配');
  assert.equal(bundleCard.options.store, overlay.options.store, '快捷按钮必须复用现有弹框 Store');
  assert.equal(settingsCard.options.store, overlay.options.store, '快捷按钮必须复用现有弹框 Store');

  const store = overlay.options.store.create();
  assert.equal(store.getSnapshot().sidebarVisible, false);
  settings.scope.publish({
    ...settings.scope.getSnapshot(),
    value: { showSidebarEntry: true },
    user: { showSidebarEntry: true },
    revision: 2,
  });
  assert.equal(store.getSnapshot().sidebarVisible, true);
  settings.scope.publish({ status: 'unavailable', writable: false, mode: 'memory' });
  assert.equal(store.getSnapshot().sidebarVisible, true, '不可用时应 fail-open');
});

test('设置卡片可隐藏入口、恢复默认并直接打开现有弹框', async () => {
  const settings = mutableSettingsScope({
    status: 'ready',
    value: { showSidebarEntry: true },
    base: { showSidebarEntry: true },
    user: { showSidebarEntry: true },
    writable: true,
    mode: 'host',
    revision: 1,
  });
  let stateCursor = 0;
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const plugin = await loadClient({
    jsxRuntime,
    clientDocument: {
      documentElement: { lang: 'zh-CN' },
      querySelector: () => null,
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { append() {} },
    },
    reactApi: {
      useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
      useState(initial) {
        const current = stateCursor === 0 ? true : initial;
        stateCursor += 1;
        return [current, () => {}];
      },
    },
  });
  const { ctx, registrations } = clientContext({ settingsScope: { bind: () => settings.scope } });
  plugin.apply(ctx);
  const registration = registrations.get('plugins.bundle.config');
  let opens = 0;
  const actions = { open() { opens += 1; } };
  const inject = registration.options.inject();
  const tree = registration.component({ ...inject, actions, view: 'page' });
  assert.equal(tree.type, 'div');
  const descendants = [];
  const visit = (node) => {
    if (node == null || typeof node !== 'object') return;
    descendants.push(node);
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child);
  };
  visit(tree);

  const toggle = descendants.find((node) => node.type === 'input' && node.props?.role === 'switch');
  const reset = descendants.find((node) => node.type === 'button' && node.props?.children === '恢复默认');
  const open = descendants.find((node) => node.type === 'button' && node.props?.children === '打开 MCP连接器');
  assert.ok(toggle);
  assert.ok(reset);
  assert.ok(open);

  toggle.props.onChange({ target: { checked: false } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(settings.writes[0], ['set', 'showSidebarEntry', false]);

  reset.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(settings.writes[1], ['unset', 'showSidebarEntry']);

  open.props.onClick();
  assert.equal(opens, 1);

  assert.equal(
    registration.component({ ...inject, actions, view: 'summary' }),
    null,
    '详情摘要只取一行文本，不渲染整张卡片',
  );
});

test('隐藏状态不创建侧边栏 Portal 或观察器', async () => {
  let observers = 0;
  const plugin = await loadClient({
    jsxRuntime: {
      jsx(type, props) { return { type, props }; },
      jsxs(type, props) { return { type, props }; },
    },
    reactApi: {
      useState(initial) { return [initial, () => {}]; },
      useEffect(start) { start(); },
    },
    windowExtras: {
      MutationObserver: class {
        constructor() { observers += 1; }
        observe() {}
        disconnect() {}
      },
    },
  });
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const entry = registrations.get('sidebar.footer.action');
  const rendered = entry.component({
    wide: true,
    useStore: (select) => select({ open: false, sidebarVisible: false }),
    actions: { open() {} },
  });
  assert.equal(rendered, null);
  assert.equal(observers, 0);
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
  assert.equal(fallback.props.children[0].props.className, 'mcpConnectorLauncherIcon');
  assert.equal(fallback.props.children[0].props['aria-hidden'], true);
  assert.equal(fallback.props.children[1].props.className, 'mcpConnectorLauncherLabel');
  assert.equal(fallback.props.children[1].props.children, 'MCP连接器');
  assert.equal(topMount.dataset.mcpConnectorTopMount, 'true');
  assert.equal(topMount.nextSibling, workspaceSlot, '挂载点应紧邻工作区 slot 之前');

  entry.component(props);
  assert.equal(portal.target, topMount, '定位成功后应 Portal 到顶部挂载点');
  assert.equal(portal.node.props.className, 'mcpConnectorTopEntry');
  entry.component({ ...props, wide: false });
  const collapsed = portal.node.props.children;
  assert.equal(collapsed.props['aria-label'], 'MCP连接器');
  assert.equal(collapsed.props.children[1], null, '折叠侧栏仅显示图标但保留可访问名称');

  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /hHd-Xa_/, '不得依赖 DSH 构建生成的 CSS 类名');
});

test('侧栏入口悬停不描边，键盘焦点仍可见，布局不使用负边距或文本空格对齐（#86）', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const css = source.split('const sidebarCss = `')[1].split('`;')[0];
  const rule = (selector) => css.slice(css.indexOf(selector + ' {')).split('}')[0];
  assert.match(rule('.mcpConnectorLauncher:hover'), /outline: none/);
  assert.doesNotMatch(rule('.mcpConnectorLauncher:hover'), /outline: 2px/);
  assert.match(rule('.mcpConnectorLauncher:focus-visible'), /outline: 2px solid currentColor/);
  assert.match(rule('.mcpConnectorLauncher:focus-visible'), /outline-offset: -2px/);
  assert.match(rule('.mcpConnectorLauncher'), /padding: 0 var\(--dsh-sidebar-inline-padding, 12px\)/);
  assert.match(rule('.mcpConnectorLauncher'), /gap: 8px/);
  assert.doesNotMatch(css, /calc\(100% \+|margin: 4px -2px/);
  assert.match(rule('.mcpConnectorLauncherIcon'), /flex: 0 0 20px/);
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

test('DSH 0.1.2 仅提供 uiWorkspace 时可创建 Prompt 会话', async () => {
  const plugin = await loadClient();
  const { ctx, registrations, calls } = clientContext({ workspaceNavigation: 'ui' });
  plugin.apply(ctx);
  const props = registrations.get('shell.overlay').options.inject();
  await props.startPromptSession('查询 SHOPLINE 商品创建接口');
  assert.deepEqual(calls, [
    ['uiConnectWorkspace', 'workspace-1'],
    ['setDraft', '查询 SHOPLINE 商品创建接口'],
    ['open', 'session-new'],
  ]);
});

test('工作区导航桥均不可用时使用 sessions.create 安全降级', async () => {
  const plugin = await loadClient();
  const { ctx, registrations, calls } = clientContext({ workspaceNavigation: 'sessions' });
  plugin.apply(ctx);
  const props = registrations.get('shell.overlay').options.inject();
  await props.startPromptSession('查询 SHOPLINE GraphQL Schema');
  assert.deepEqual(calls, [
    ['create', { workspaceId: 'workspace-1' }],
    ['setDraft', '查询 SHOPLINE GraphQL Schema'],
    ['open', 'session-new'],
  ]);
});

test('所有会话创建能力均不可用时返回可操作错误', async () => {
  const plugin = await loadClient();
  const { ctx, registrations } = clientContext({ workspaceNavigation: 'none' });
  plugin.apply(ctx);
  const props = registrations.get('shell.overlay').options.inject();
  await assert.rejects(
    () => props.startPromptSession('示例'),
    /没有可用的工作区会话创建能力/,
  );
});

test('市场 iframe 可读取当前 Workspace 作为项目连接作用域', async () => {
  const plugin = await loadClient();
  const { ctx, registrations } = clientContext({ workspaceId: 'workspace-scope' });
  plugin.apply(ctx);
  const props = registrations.get('shell.overlay').options.inject();
  assert.deepEqual(props.workspaceContext(), {
    workspaceId: 'workspace-scope',
    title: 'workspace-scope',
  });
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
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /mcpConnectorMarketClose:focus-visible/);
  assert.match(source, /const opener = document\.activeElement/);
  assert.match(source, /opener\?\.focus\?\.\(\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /addEventListener\("keydown", onKeyDown, true\)/);
});

test('从设置快捷打开时弹框 Portal 到 body 并高于 DSH 设置层', async () => {
  const body = {};
  let portal;
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const plugin = await loadClient({
    clientDocument: {
      body,
      querySelector: () => null,
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { append() {} },
    },
    jsxRuntime,
    reactApi: {
      useState(initial) { return [initial, () => {}]; },
      useRef(initial) { return { current: initial }; },
      useEffect() {},
    },
    reactDomApi: {
      createPortal(node, target) {
        portal = { node, target };
        return portal;
      },
    },
    windowExtras: { location: { origin: 'http://127.0.0.1:3080' } },
  });
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const component = registrations.get('shell.overlay').component;
  const rendered = component({
    wide: true,
    useStore: (select) => select({ open: true, detailOpen: false }),
    actions: { close() {}, detailOpened() {}, detailClosed() {} },
    startPromptSession() {},
  });

  assert.equal(rendered, portal);
  assert.equal(portal.target, body, '必须逃出 shell.overlay 的 z-index:20 堆叠上下文');
  assert.ok(portal.node.props.style.zIndex > 1000, '必须高于 DSH Settings 的 z-index:1000');
});

test('版本检查支持强制刷新且不会被旧缓存隐藏 Provider 更新', async () => {
  for (const failed of [false, true]) {
    const state = [
      { installedVersion: '0.2.54', latestVersion: '0.2.54', updateAvailable: false, checkedAt: '2026-09-22T00:00:00Z' },
      'ready', { provider: { label: '市场' } },
      { installedVersion: '0.2.54', latestVersion: '0.2.56', updateAvailable: true },
      null, null, null, false, false, false, false, 0, false, failed,
    ];
    let cursor = 0;
    let refresh = 0;
    const plugin = await loadClient({
      windowExtras: { location: { origin: 'http://127.0.0.1:3080' } },
      jsxRuntime: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      reactApi: {
        useState(initial) {
          const index = cursor++;
          return [index in state ? state[index] : initial, (value) => {
            if (index === 11) refresh = value(refresh);
          }];
        },
        useRef: (current) => ({ current }), useEffect() {},
      },
    });
    const { ctx, registrations } = clientContext();
    plugin.apply(ctx);
    const tree = registrations.get('shell.overlay').component({
      wide: true, useStore: (select) => select({ open: true, detailOpen: false }),
      actions: { close() {}, detailOpened() {}, detailClosed() {} }, startPromptSession() {},
    });
    const nodes = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      nodes.push(node);
      const children = node.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) visit(child);
    }
    visit(tree);
    assert.ok(nodes.some((node) => node.props?.children === '一键更新到 v0.2.56'));
    const button = nodes.find((node) => node.props?.children === '检查更新');
    assert.equal(button.props.disabled, false);
    assert.match(button.props.title, /上次检查/);
    button.props.onClick();
    assert.equal(refresh, 1);
    assert.equal(nodes.some((node) => node.props?.children === '暂时无法确认 npm 最新版本，请重试'), failed);
  }
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(source, /params: \{ force \}/);
  assert.match(source, /check\(true\)/);
  assert.equal(source.match(/\[open, versionCheckRequest\]/g).length, 2, '手动刷新同步重查版本和 Provider');
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
  assert.match(source, /新版本处于发布安全等待期（约 24 小时）/);
  assert.match(source, /立即更新（跳过等待）/);
  assert.match(source, /manualUpgradeCommand/);
  assert.match(source, /--config\.minimumReleaseAge=0/);
  assert.match(source, /复制升级命令/);
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

test('更新失败文案区分发布安全等待和镜像同步', async () => {
  const plugin = await loadClient({
    sourceTransform(source) {
      return source.replace(
        '\t\texports.apply = apply;',
        '\t\texports.__testUpdateFailureLabel = updateFailureLabel;\n\t\texports.apply = apply;',
      );
    },
  });
  const label = plugin.__testUpdateFailureLabel;
  assert.equal(label({ code: 'RELEASE_TOO_FRESH' }), '新版本处于发布安全等待期（约 24 小时）');
  assert.equal(label({ code: 'MIRROR_SYNC_PENDING' }), '镜像尚未同步完整安装包');
  assert.equal(label({ code: 'UNKNOWN', message: '镜像返回的安装包尚不可用' }), '镜像返回的安装包尚不可用');
});

test('磁盘版本高于运行版本时识别为等待重启，不重复提示安装', async () => {
  const plugin = await loadClient({
    sourceTransform(source) {
      return source.replace(
        '\t\texports.apply = apply;',
        '\t\texports.__testPendingActivationVersion = pendingActivationVersion;\n\t\texports.apply = apply;',
      );
    },
  });
  const pending = plugin.__testPendingActivationVersion;
  assert.equal(pending(
    { installedVersion: '0.2.30', latestVersion: '0.2.31', updateAvailable: true },
    { installedVersion: '0.2.31', latestVersion: '0.2.31', updateAvailable: false },
  ), '0.2.31');
  assert.equal(pending(
    { installedVersion: '0.2.31' },
    { installedVersion: '0.2.31', latestVersion: '0.2.31', updateAvailable: false },
  ), null);
  assert.equal(pending(
    { installedVersion: '0.2.30' },
    { installedVersion: '0.2.31', latestVersion: '0.2.32', updateAvailable: true },
  ), null, '仍有更高版本时应继续展示一键更新');
  assert.equal(pending(
    { installedVersion: 'invalid' },
    { installedVersion: '0.2.31', updateAvailable: false },
  ), null);

  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(source, /v\$\{activationPendingVersion\} 已安装，重启后生效/);
  assert.match(source, /pendingActivationVersion\(versionStatus, providerUpdateCheck\)/);
});

test('已安装的新版本在旧进程中渲染重启提示而非升级命令', async () => {
  const state = [
    { installedVersion: '0.2.30', latestVersion: '0.2.31', updateAvailable: true },
    'ready',
    {
      provider: { id: 'market-v1', label: 'DSH 插件市场' },
      capabilities: {
        runtime: 'web',
        restart: { supported: false, managedBy: 'operator' },
      },
    },
    { installedVersion: '0.2.31', latestVersion: '0.2.31', updateAvailable: false },
    null,
    null,
    null,
    false,
    false,
    false,
    false,
  ];
  let stateCursor = 0;
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const plugin = await loadClient({
    jsxRuntime,
    windowExtras: { location: { origin: 'http://127.0.0.1:3080' } },
    reactApi: {
      useState(initial) {
        const index = stateCursor++;
        return [index in state ? state[index] : initial, () => {}];
      },
      useRef(initial) { return { current: initial }; },
      useEffect() {},
    },
  });
  const { ctx, registrations } = clientContext();
  plugin.apply(ctx);
  const component = registrations.get('shell.overlay').component;
  const tree = component({
    wide: true,
    useStore: (select) => select({ open: true, detailOpen: false }),
    actions: { close() {}, detailOpened() {}, detailClosed() {} },
    startPromptSession() {},
  });
  const descendants = [];
  const visit = (node) => {
    if (node == null || node === false || typeof node !== 'object') return;
    descendants.push(node);
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child);
  };
  visit(tree);
  assert.ok(descendants.some((node) => node.props?.children === 'v0.2.31 已安装，重启后生效'));
  assert.ok(descendants.some((node) => node.props?.children === '请重启 DSH'));
  assert.equal(descendants.some((node) => node.type === 'code'), false);
  assert.equal(descendants.some((node) => node.props?.children === '复制升级命令'), false);
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
  const copied = [];
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
      navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
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
  const command = 'dsh plugin --profile web add --config.minimumReleaseAge=0 dsh-mcp-connector@0.2.25';
  assert.ok(descendants(tree).some((node) => node.type === 'code'
    && node.props?.children === command));
  const copyButton = descendants(tree).find((node) => node.type === 'button'
    && node.props?.children === '复制升级命令');
  assert.ok(copyButton, '无可信 Provider 时应提供升级命令复制按钮');
  copyButton.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, [command]);

  effects.length = 0;
  tree = render();
  assert.ok(descendants(tree).some((node) => node.type === 'button'
    && node.props?.children === '已复制'));
  assert.equal(requests.some((url) => url.startsWith('https://evil.example/')), false);
});
