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

function clientContext({
  workspaceId = 'workspace-1',
  workspaceItems,
  recentWorkspaceId = workspaceId ?? undefined,
  settingsScope,
  workspaceNavigation = 'legacy',
  nativeSidebar = false,
  layout,
  locale,
} = {}) {
  const registrations = new Map();
  const registrationOrder = [];
  const injectors = new Map();
  const declaredSlots = new Set([
    'shell.overlay',
    'sidebar.footer.action',
    'settings.plugin.item',
    ...(nativeSidebar ? ['main', 'sidebar.panellist'] : []),
  ]);
  const calls = [];
  const shell = {
    setDraft(prompt) {
      calls.push(['setDraft', prompt]);
    },
  };
  const workspaces = {
    list: {
      getSnapshot: () => ({
        items: workspaceItems ?? (workspaceId == null ? [] : [{ workspaceId, sessionIds: ['session-current'] }]),
        recentWorkspaceId,
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
    // Cordis 官方「不要求 inject」的服务读取入口。`locale` 未写进 inject 列表，
    // 直接读 ctx.locale 会抛 `cannot get property "locale" without inject`。
    reflect: {
      get(service) {
        if (service === 'locale' && locale !== undefined) return { getLocale: () => ({ active: locale }) };
        return undefined;
      },
    },
    effect(start) {
      start();
    },
    slots: {
      inject(name, register) {
        const record = { register, cleanup: undefined };
        let records = injectors.get(name);
        if (records === undefined) injectors.set(name, records = new Set());
        records.add(record);
        if (declaredSlots.has(name)) record.cleanup = register();
        return () => {
          if (typeof record.cleanup === 'function') record.cleanup();
          records.delete(record);
        };
      },
      register(options, component) {
        const registration = { options, component };
        registrations.set(options.name, registration);
        registrationOrder.push(options.name);
        return () => {
          if (registrations.get(options.name) === registration) registrations.delete(options.name);
        };
      },
    },
    workspaces,
    sessions,
    get(service) {
      if (service === 'uiWorkspace') return uiWorkspace;
      if (service === 'conversation') return { input: { shell: () => shell } };
      if (service === 'layout') return layout;
      return undefined;
    },
  };
  if (layout !== undefined) ctx.layout = layout;
  ctx.inject = (services, callback) => {
    if (services.includes('settingsScope') && settingsScope !== undefined) {
      callback({ ...ctx, settingsScope });
    }
  };
  const slotControls = {
    declare(name) {
      if (declaredSlots.has(name)) return;
      declaredSlots.add(name);
      for (const record of injectors.get(name) ?? []) record.cleanup = record.register();
    },
    remove(name) {
      if (!declaredSlots.delete(name)) return;
      for (const record of injectors.get(name) ?? []) {
        if (typeof record.cleanup === 'function') record.cleanup();
        record.cleanup = undefined;
      }
    },
  };
  return { ctx, registrations, registrationOrder, calls, slotControls };
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
    // 与真实 settingsScope 同形：一次原子变更，全部成功或全部不生效。
    async mutate(ops) {
      writes.push(['mutate', ops]);
      if (state.failNextMutate) {
        state.failNextMutate = false;
        throw new Error('simulated persistence failure');
      }
      const nextUser = { ...snapshot.user };
      const nextValue = { ...snapshot.value };
      for (const op of ops) {
        const [field] = op.path;
        if (op.op === "unset") {
          delete nextUser[field];
          nextValue[field] = snapshot.base?.[field];
          if (nextValue[field] === undefined) delete nextValue[field];
        } else {
          nextUser[field] = op.value;
          nextValue[field] = op.value;
        }
      }
      snapshot = { ...snapshot, status: "ready", value: nextValue, user: nextUser };
      for (const listener of listeners) listener();
    },
    publish(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
  const state = {
    failNextMutate: false,
    failNextWrite() { this.failNextMutate = true; },
  };
  return { scope, writes, state };
}

/**
 * 只暴露单字段 set/unset 的 settingsScope，复现 @deepseek-ai/dsh-client-ui-settings@0.1.2-rc.1。
 * 没有 mutate —— 直接调 mutate 会抛 "settingsScope.mutate is not a function"。
 */
function mutableLegacySettingsScope(initial) {
  let snapshot = initial;
  const listeners = new Set();
  const writes = [];
  const state = { failOn: null };
  const write = (field) => {
    if (state.failOn === field) {
      state.failOn = null;
      throw new Error(`simulated failure on ${field}`);
    }
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async set(field, value) {
      writes.push(['set', field, value]);
      write(field);
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
      write(field);
      const { [field]: _removed, ...user } = snapshot.user ?? {};
      const nextValue = { ...snapshot.value };
      if (snapshot.base?.[field] === undefined) delete nextValue[field];
      else nextValue[field] = snapshot.base[field];
      snapshot = { ...snapshot, status: 'ready', value: nextValue, user };
      for (const listener of listeners) listener();
    },
  };
  return { scope, writes, state };
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

test('partial optional settings services do not block the connector UI', async () => {
  const plugin = await loadClient();
  for (const settingsScope of [null, {}, { bind: false },
    { bind: () => undefined }, { bind: () => ({}) },
    { bind: () => ({ getSnapshot() {} }) },
    { bind: () => ({ subscribe() {} }) }]) {
    const { ctx, registrations } = clientContext({ settingsScope });
    assert.doesNotThrow(() => plugin.apply(ctx));
    const overlay = registrations.get('shell.overlay');
    assert.ok(overlay, 'connector overlay must remain available');
    assert.equal(overlay.options.store.create().getSnapshot().sidebarVisible, true);
    assert.equal(registrations.has('settings.plugin.item'), false);
  }
});

test('independent settings section works without a Plugins page and survives slot remount', async () => {
  const plugin = await loadClient({
    jsxRuntime: { jsx: (type, props) => ({ type, props }) },
  });
  const settings = mutableSettingsScope({
    status: 'ready', value: { entryLocation: 'settings' },
    writable: true, user: { entryLocation: 'settings' },
  });
  const { ctx, registrations, slotControls } = clientContext({
    settingsScope: { bind: () => settings.scope },
  });
  slotControls.remove('settings.plugin.item');
  plugin.apply(ctx);
  assert.equal(registrations.has('settings.plugin.item'), false);
  assert.equal(registrations.has('settings.section'), false);
  slotControls.declare('settings.section');
  const section = registrations.get('settings.section');
  assert.equal(section.options.id, 'mcp-connector');
  assert.equal(section.options.label, 'MCP连接器');
  assert.equal(section.options.inject().settingsScope, settings.scope);
  assert.equal(section.options.store, registrations.get('shell.overlay').options.store);
  const store = section.options.store.create();
  assert.equal(store.getSnapshot().sidebarVisible, false);
  store.actions.open();
  assert.equal(store.getSnapshot().open, true, 'hidden sidebar must not prevent opening');
  slotControls.remove('settings.section');
  assert.equal(registrations.has('settings.section'), false);
  slotControls.declare('settings.section');
  assert.ok(registrations.has('settings.section'));
  slotControls.declare('settings.plugin.item');
  const rendered = section.component({ settingsScope: settings.scope, actions: store.actions });
  assert.equal(rendered.type, 'ul');
  assert.equal(rendered.props.children.type, registrations.get('settings.plugin.item').component);
});

test('设置 scope 控制侧边栏可见性并注册同一弹框的快捷入口', async () => {
  const plugin = await loadClient();
  const settings = mutableSettingsScope({
    status: 'ready',
    value: { entryLocation: 'settings' },
    base: { entryLocation: 'sidebar' },
    user: { entryLocation: 'settings' },
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
  assert.deepEqual(bindSpec.decode({ entryLocation: 'settings' }), { entryLocation: 'settings' });
  assert.equal(bindSpec.decode({}), undefined);
  const overlay = registrations.get('shell.overlay');
  const settingsCard = registrations.get('settings.plugin.item');
  assert.ok(settingsCard, '应在原生插件配置页注册 MCP连接器卡片');
  assert.equal(settingsCard.options.key, 'mcp-connector');
  assert.equal(settingsCard.options.store, overlay.options.store, '快捷按钮必须复用现有弹框 Store');

  const store = overlay.options.store.create();
  assert.equal(store.getSnapshot().sidebarVisible, false, '仅设置档应隐藏侧栏图标');
  settings.scope.publish({
    ...settings.scope.getSnapshot(),
    value: { entryLocation: 'both' },
    user: { entryLocation: 'both' },
    revision: 2,
  });
  assert.equal(store.getSnapshot().sidebarVisible, true, '两边显示档应恢复侧栏图标');
  settings.scope.publish({ status: 'unavailable', writable: false, mode: 'memory' });
  assert.equal(store.getSnapshot().sidebarVisible, true, '不可用时应 fail-open');
});

test('设置卡片可隐藏入口、恢复默认并直接打开现有弹框', async () => {
  const settings = mutableSettingsScope({
    status: 'ready',
    value: { entryLocation: 'both' },
    base: { entryLocation: 'both' },
    user: { entryLocation: 'both' },
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
  const registration = registrations.get('settings.plugin.item');
  let opens = 0;
  const tree = registration.component({
    ...registration.options.inject(),
    actions: { open() { opens += 1; } },
  });
  const descendants = [];
  const visit = (node) => {
    if (node == null || typeof node !== 'object') return;
    descendants.push(node);
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child);
  };
  visit(tree);

  const segments = descendants.filter((node) => node.type === 'button' && node.props?.role === 'radio');
  const reset = descendants.find((node) => node.type === 'button' && node.props?.children === '恢复默认');
  const open = descendants.find((node) => node.type === 'button' && node.props?.children === '打开 MCP连接器');
  assert.equal(segments.length, 3, '应渲染三个入口位置档位');
  assert.ok(reset);
  assert.ok(open, 'both 档应提供设置页快捷打开按钮');

  const sidebarOnly = segments.find((node) => node.props?.children === '仅侧边栏');
  assert.ok(sidebarOnly, '应有三档中的「仅侧边栏」');
  sidebarOnly.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(settings.writes[0], ['set', 'entryLocation', 'sidebar']);

  reset.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  // 恢复默认现在是一次原子 mutate：同时清掉新字段与旧的布尔覆盖。
  assert.equal(settings.writes[1][0], 'mutate');
  const cleared = settings.writes[1][1]
    .filter((op) => op.op === 'unset')
    .map((op) => op.path[0])
    .sort();
  assert.deepEqual(cleared, ['entryLocation', 'showSidebarEntry']);

  open.props.onClick();
  assert.equal(opens, 1);
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
  assert.equal(fallback.props['data-placement'], 'footer', '降级入口只应样式化自身，不能接管宿主槽位');
  assert.equal(fallback.props.children[0].props.className, 'mcpConnectorLauncherIcon');
  assert.equal(fallback.props.children[0].props['aria-hidden'], true);
  assert.equal(fallback.props.children[1].props.className, 'mcpConnectorLauncherLabel');
  assert.equal(fallback.props.children[1].props.children, 'MCP连接器');
  assert.equal(topMount.dataset.mcpConnectorTopMount, 'true');
  assert.equal(topMount.nextSibling, workspaceSlot, '挂载点应紧邻工作区 slot 之前');

  entry.component(props);
  assert.equal(portal.target, topMount, '定位成功后应 Portal 到顶部挂载点');
  assert.equal(portal.node.props.className, 'mcpConnectorTopEntry');
  assert.equal(portal.node.props.children.props['data-placement'], 'top');
  entry.component({ ...props, wide: false });
  const collapsed = portal.node.props.children;
  assert.equal(collapsed.props['aria-label'], 'MCP连接器');
  assert.equal(collapsed.props.children[1], null, '折叠侧栏仅显示图标但保留可访问名称');

  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /hHd-Xa_/, '不得依赖 DSH 构建生成的 CSS 类名');
});

test('DSH 0.2 优先注册 main 与原生 panellist，不创建 footer 降级入口', async () => {
  const plugin = await loadClient({
    jsxRuntime: {
      jsx(type, props) { return { type, props }; },
      jsxs(type, props) { return { type, props }; },
    },
  });
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: null }) },
    selectPanel() {},
  };
  const { ctx, registrations, registrationOrder } = clientContext({ nativeSidebar: true, layout });
  plugin.apply(ctx);

  const main = registrations.get('main');
  const entry = registrations.get('sidebar.panellist');
  const overlay = registrations.get('shell.overlay');
  assert.ok(main, '应注册原生 main 面板');
  assert.ok(entry, '应注册原生 panellist 行');
  assert.equal(registrations.has('sidebar.footer.action'), false, '新宿主不应注册 footer 降级入口');
  assert.ok(registrationOrder.indexOf('main') < registrationOrder.indexOf('sidebar.panellist'), 'main 必须先于可点击的行注册');
  assert.equal(entry.options.id, 'mcp-connector');
  assert.equal(entry.options.order, 40);
  // label 现在传函数：槽位每次投影重新读取，语言晚于 apply 就绪也能跟上。
  assert.equal(typeof entry.options.label, 'function', 'label 应为 thunk 以跟随语言变化');
  assert.equal(entry.options.label(), 'MCP连接器', '中文（默认语言）下解析结果不变');
  assert.equal(main.options.key, 'mcp-connector');
  assert.equal(main.options.store, overlay.options.store, '原生面板与设置弹框应共用市场 Store');
  assert.equal(main.options.inject().presentation, 'panel');

  const icon = entry.component({ size: 18, active: true });
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.width, 18);
  assert.equal(icon.props.height, 18);
  assert.equal(icon.props.stroke, 'currentColor');
  assert.equal(icon.props['aria-hidden'], 'true');
});

test('原生 main 直接渲染共享市场主体，不创建模态 Portal', async () => {
  let portals = 0;
  const selections = [];
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };
  const plugin = await loadClient({
    jsxRuntime,
    reactApi: {
      useState(initial) { return [initial, () => {}]; },
      useRef(initial) { return { current: initial }; },
      useEffect() {},
    },
    reactDomApi: {
      createPortal() { portals += 1; },
    },
    windowExtras: { location: { origin: 'http://127.0.0.1:3080' } },
  });
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: 'mcp-connector' }) },
    selectPanel(id) { selections.push(id); },
  };
  const { ctx, registrations } = clientContext({ nativeSidebar: true, layout });
  plugin.apply(ctx);
  const main = registrations.get('main');
  const tree = main.component({
    ...main.options.inject(),
    useStore: (select) => select({ open: false, detailOpen: false }),
    actions: { close() {}, detailOpened() {}, detailClosed() {} },
  });

  assert.equal(portals, 0);
  assert.equal(tree.props.role, 'region');
  assert.equal(tree.props['aria-modal'], undefined);
  assert.equal(tree.props['aria-labelledby'], 'mcp-connector-native-title');
  assert.equal(tree.props.style.width, '100%');
  assert.equal(tree.props.style.height, '100%');
  const header = tree.props.children[0];
  const close = header.props.children[1];
  assert.equal(close.props['aria-label'], '返回会话');
  close.props.onClick();
  assert.deepEqual(selections, [null]);
});

test('原生入口隐藏时先退回会话并注销行，重新开启后恢复', async () => {
  const settings = mutableSettingsScope({
    status: 'ready',
    value: { entryLocation: 'both' },
    base: { entryLocation: 'both' },
    user: { entryLocation: 'both' },
    writable: true,
    mode: 'host',
    revision: 1,
  });
  let activePanelId = 'mcp-connector';
  const selections = [];
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId }) },
    selectPanel(id) {
      selections.push(id);
      activePanelId = id;
    },
  };
  const plugin = await loadClient();
  const { ctx, registrations } = clientContext({
    nativeSidebar: true,
    layout,
    settingsScope: { bind: () => settings.scope },
  });
  plugin.apply(ctx);
  assert.ok(registrations.has('sidebar.panellist'));

  settings.scope.publish({
    ...settings.scope.getSnapshot(),
    value: { entryLocation: 'settings' },
    user: { entryLocation: 'settings' },
    revision: 2,
  });
  assert.deepEqual(selections, [null], '隐藏当前面板前应退回会话');
  assert.equal(registrations.has('sidebar.panellist'), false);
  assert.ok(registrations.has('main'), 'main 页面保留，避免席位生命周期抖动');

  settings.scope.publish({
    ...settings.scope.getSnapshot(),
    value: { entryLocation: 'sidebar' },
    user: { entryLocation: 'sidebar' },
    revision: 3,
  });
  assert.ok(registrations.has('sidebar.panellist'), '重新开启后应恢复原生行');
  assert.equal(registrations.has('sidebar.footer.action'), false);
});

test('原生席位延迟到达时原子替换 footer 降级入口', async () => {
  const plugin = await loadClient();
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: null }) },
    selectPanel() {},
  };
  const { ctx, registrations, slotControls } = clientContext({ layout });
  plugin.apply(ctx);
  assert.ok(registrations.has('sidebar.footer.action'), '旧宿主起始使用降级入口');

  slotControls.declare('main');
  assert.ok(registrations.has('sidebar.footer.action'), '仅 main 到达时不能提前移除可用入口');
  slotControls.declare('sidebar.panellist');
  assert.equal(registrations.has('sidebar.footer.action'), false);
  assert.ok(registrations.has('sidebar.panellist'));

  slotControls.remove('sidebar.panellist');
  assert.equal(registrations.has('sidebar.panellist'), false);
  assert.ok(registrations.has('sidebar.footer.action'), '原生席位移除后应恢复降级入口');
});

test('侧栏入口与面板标题图标同为单色线性 SVG，源码中不存在任何 emoji', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  // 字面量 emoji 与转义写法都要拦截：\u{1F9E9} 这类转义不会被字面量 grep 命中。
  assert.doesNotMatch(source, /🧩/, '不得再使用彩色 emoji 作图标');
  assert.doesNotMatch(source, /\\u\{1F[0-9A-Fa-f]{3}\}/, '不得用 \\u{...} 转义 emoji 作图标');
  assert.doesNotMatch(source, /[\u{1F000}-\u{1FAFF}]/u, '客户端源码不得直接出现 emoji 字符');

  const icon = (className, span = 900) => {
    const marker = source.indexOf(`className: "${className}"`);
    assert.ok(marker > -1, `应保留 ${className} 图标容器`);
    const block = source.slice(marker, marker + span);
    assert.match(block, /viewBox: "0 0 16 16"/, `${className} 应与宿主图标一致使用 16×16 viewBox`);
    assert.match(block, /fill: "none"/, `${className} 应为描边绘制`);
    assert.match(block, /stroke: "currentColor"/, `${className} 应继承文字颜色，随明暗主题适配`);
    assert.match(block, /strokeLinejoin: "round"|strokeLinecap: "round"/, `${className} 应使用圆角端点`);
    return block;
  };
  icon('mcpConnectorLauncherIcon');
  icon('mcpConnectorMarketIcon');

  const sidebarCss = source.split('const sidebarCss = `')[1].split('`;')[0];
  const overlayCss = source.split('const overlayCss = `')[1].split('`;')[0];
  assert.match(sidebarCss, /\.mcpConnectorLauncherIcon > svg \{[\s\S]*?width: 18px;[\s\S]*?height: 18px;/, '入口图标尺寸应由样式定义');
  assert.match(overlayCss, /\.mcpConnectorMarketIcon > svg \{[\s\S]*?width: 18px;[\s\S]*?height: 18px;/, '面板标题图标尺寸应由样式定义');
  assert.doesNotMatch(sidebarCss, /font-size: 18px/, 'emoji 字号样式应移除');
  assert.doesNotMatch(source, /style: \{ fontSize: 22 \}/, '面板标题的 emoji 字号内联样式应移除');
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

test('侧栏样式不改写宿主 footer 槽位或其它插件的 flex 布局（#124）', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const css = source.split('const sidebarCss = `')[1].split('`;')[0];
  const rule = (selector) => css.slice(css.indexOf(selector + ' {')).split('}')[0];
  assert.doesNotMatch(css, /\[data-slot=["']sidebar\.footer\.action["']\]/, '不得覆盖宿主 display: contents 锚点');
  assert.doesNotMatch(css, /sidebar\.footer\.action[\s\S]*?>\s*\*/, '不得重置同槽位第三方插件子项');
  const fallbackRule = rule('.mcpConnectorLauncher[data-placement="footer"]');
  assert.match(fallbackRule, /flex: 1 1 0/);
  assert.match(fallbackRule, /max-width: 100%/);
  assert.doesNotMatch(fallbackRule, /!important/);
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
  assert.deepEqual(props.workspaceOptions(), [{
    workspaceId: 'workspace-scope',
    title: 'workspace-scope',
  }]);
});

test('没有当前会话时仍向市场提供全部 Workspace 供用户显式选择', async () => {
  const plugin = await loadClient();
  const { ctx, registrations } = clientContext({
    workspaceId: null,
    recentWorkspaceId: undefined,
    workspaceItems: [
      { workspaceId: 'workspace-a', title: '项目 A', sessionIds: [] },
      { workspaceId: 'workspace-b', title: '项目 B', sessionIds: [] },
    ],
  });
  plugin.apply(ctx);
  const props = registrations.get('shell.overlay').options.inject();
  assert.equal(props.workspaceContext(), null);
  assert.deepEqual(props.workspaceOptions(), [
    { workspaceId: 'workspace-a', title: '项目 A' },
    { workspaceId: 'workspace-b', title: '项目 B' },
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
    // 数组按组件里 useState 的出现顺序排列。manualCommandVisible 插在
    // manualCommandCopied 与 versionCheckRequest 之间，因此下游 ordinal 顺延一位。
    const state = [
      { installedVersion: '0.2.54', latestVersion: '0.2.54', updateAvailable: false, checkedAt: '2026-09-22T00:00:00Z' },
      'ready', { provider: { label: '市场' } },
      { installedVersion: '0.2.54', latestVersion: '0.2.56', updateAvailable: true },
      null, null, null, false, false, false, false, false, 0, false, failed,
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
            if (index === 12) refresh = value(refresh);
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
  assert.match(source, /t\(\"v\{version\} 已安装，重启后生效\", \{ version: activationPendingVersion \}\)/);
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

test('用户选了英文时，侧边栏文案为英文', async () => {
  // 端到端回归：locale 服务存在且 active=en 时，客户端必须真正显示英文。
  // 旧实现的 ctx.locale 读取会抛错并被 try/catch 吞掉 → activeLocale 永远是中文，
  // 用户在 DSH 里选了 English，侧边栏仍显示「MCP连接器」。
  const plugin = await loadClient({
    jsxRuntime: { jsx(type, props) { return { type, props }; }, jsxs(type, props) { return { type, props }; } },
  });

  const english = clientContext({
    nativeSidebar: true,
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) }, selectPanel() {} },
    locale: 'en',
  });
  plugin.apply(english.ctx);
  const enEntry = english.registrations.get('sidebar.panellist');
  assert.ok(enEntry, '英文用户应注册侧边栏入口');
  assert.equal(enEntry.options.label(), 'MCP Connector', '英文用户应看到英文侧边栏文案');

  // 中文用户保持原样（逐字不变）。
  const chinese = clientContext({
    nativeSidebar: true,
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) }, selectPanel() {} },
    locale: 'zh',
  });
  plugin.apply(chinese.ctx);
  assert.equal(chinese.registrations.get('sidebar.panellist').options.label(), 'MCP连接器');

  // 宿主没有 locale 服务时也必须照常加载并回退中文（§6.6 可选依赖）。
  const bare = clientContext({
    nativeSidebar: true,
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) }, selectPanel() {} },
  });
  plugin.apply(bare.ctx);
  assert.equal(bare.registrations.get('sidebar.panellist').options.label(), 'MCP连接器');
});

test('legacy showSidebarEntry:false keeps the sidebar hidden after upgrade', async () => {
  // 升级场景：设置文档里只有旧的布尔开关，没有 entryLocation。
  // 若只认新字段，这里会回退到 sidebar 并让侧栏重新出现。
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
  const { ctx, registrations } = clientContext({
    settingsScope: { bind: () => settings.scope },
  });
  plugin.apply(ctx);

  const store = registrations.get('shell.overlay').options.store.create();
  assert.equal(store.getSnapshot().sidebarVisible, false, '旧偏好隐藏时侧栏必须保持隐藏');

  // 切到新字段后行为仍由新字段主导。
  settings.scope.publish({
    ...settings.scope.getSnapshot(),
    value: { showSidebarEntry: false, entryLocation: 'both' },
    user: { showSidebarEntry: false, entryLocation: 'both' },
    revision: 2,
  });
  assert.equal(store.getSnapshot().sidebarVisible, true, '显式选择 both 后应显示侧栏');
});

test('legacy showSidebarEntry:true keeps the sidebar visible after upgrade', async () => {
  const plugin = await loadClient();
  const settings = mutableSettingsScope({
    status: 'ready',
    value: { showSidebarEntry: true },
    base: { showSidebarEntry: true },
    user: { showSidebarEntry: true },
    writable: true,
    mode: 'host',
    revision: 1,
  });
  const { ctx, registrations } = clientContext({
    settingsScope: { bind: () => settings.scope },
  });
  plugin.apply(ctx);

  const store = registrations.get('shell.overlay').options.store.create();
  assert.equal(store.getSnapshot().sidebarVisible, true, '旧偏好显示时侧栏应保留');
});

test('placement helpers keep the three placements distinct', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

  const grab = (name) => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced ${name}`);
  };

  const factory = new Function([
    'const ENTRY_LOCATIONS = Object.freeze(["both", "sidebar", "settings"]);',
    'const DEFAULT_ENTRY_LOCATION = "both";',
    'const ENTRY_LOCATION_FIELD = "entryLocation";',
    'const SHOW_SIDEBAR_ENTRY_FIELD = "showSidebarEntry";',
    grab('normalizeEntryLocation'),
    grab('entryLocationFromLegacyFlag'),
    grab('readLegacyFlag'),
    grab('readEntryLocation'),
    grab('resolveEntryLocation'),
    grab('resolveSidebarVisible'),
    grab('resolveSettingsQuickOpen'),
    'return { resolveEntryLocation, resolveSidebarVisible, resolveSettingsQuickOpen };',
  ].join('\n'));
  const helpers = factory();

  const layers = (value, base, user) => ({ status: 'ready', value, base, user });

  // ── 三档本身的差异 ──
  const both = layers({ entryLocation: 'both' }, { entryLocation: 'both' }, {});
  assert.equal(helpers.resolveSidebarVisible(both), true, 'both 档侧栏可见');
  assert.equal(helpers.resolveSettingsQuickOpen('both'), true, 'both 档设置页可快捷打开');

  const sidebarOnly = layers({ entryLocation: 'sidebar' }, { entryLocation: 'sidebar' }, {});
  assert.equal(helpers.resolveSidebarVisible(sidebarOnly), true, 'sidebar 档侧栏可见');
  assert.equal(helpers.resolveSettingsQuickOpen('sidebar'), false, 'sidebar 档设置页不得提供快捷入口');

  const settingsOnly = layers({ entryLocation: 'settings' }, { entryLocation: 'settings' }, {});
  assert.equal(helpers.resolveSidebarVisible(settingsOnly), false, 'settings 档侧栏隐藏');
  assert.equal(helpers.resolveSettingsQuickOpen('settings'), true, 'settings 档必须能从设置页打开');

  // both 与 sidebar 侧栏一致，但设置页入口不同 —— 这是维护者要求的差异。
  assert.equal(helpers.resolveSidebarVisible(both), helpers.resolveSidebarVisible(sidebarOnly));
  assert.notEqual(helpers.resolveSettingsQuickOpen('both'), helpers.resolveSettingsQuickOpen('sidebar'));
});

test('layered resolution keeps legacy user overrides winning over synthesized base', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const grab = (name) => {
    const start = source.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
    }
    throw new Error(`unbalanced ${name}`);
  };
  const factory = new Function([
    'const ENTRY_LOCATIONS = Object.freeze(["both", "sidebar", "settings"]);',
    'const DEFAULT_ENTRY_LOCATION = "both";',
    'const ENTRY_LOCATION_FIELD = "entryLocation";',
    'const SHOW_SIDEBAR_ENTRY_FIELD = "showSidebarEntry";',
    grab('normalizeEntryLocation'),
    grab('entryLocationFromLegacyFlag'),
    grab('readLegacyFlag'),
    grab('readEntryLocation'),
    grab('resolveEntryLocation'),
    'return { resolveEntryLocation };',
  ].join('\n'));
  const { resolveEntryLocation } = factory();

  // 维护者复现 (1)：config true + 用户旧覆盖 false → 侧栏必须保持隐藏。
  // base 已被合成为 both，但用户显式选过 false，旧覆盖优先。
  assert.equal(
    resolveEntryLocation({
      status: 'ready',
      value: { showSidebarEntry: false, entryLocation: 'both' },
      base: { showSidebarEntry: true, entryLocation: 'both' },
      user: { showSidebarEntry: false },
    }),
    'settings',
    '用户旧覆盖 false 必须压过基线合成的 both',
  );

  // 维护者复现 (2)：config false + 用户旧覆盖 true → 侧栏必须可见。
  assert.equal(
    resolveEntryLocation({
      status: 'ready',
      value: { showSidebarEntry: true, entryLocation: 'settings' },
      base: { showSidebarEntry: false, entryLocation: 'settings' },
      user: { showSidebarEntry: true },
    }),
    'both',
    '用户旧覆盖 true 必须压过基线合成的 settings',
  );

  // 用户显式选了新字段 → 新字段优先，旧布尔不再参与。
  assert.equal(
    resolveEntryLocation({
      status: 'ready',
      value: { entryLocation: 'sidebar' },
      base: { entryLocation: 'both' },
      user: { entryLocation: 'sidebar', showSidebarEntry: false },
    }),
    'sidebar',
    '用户显式新选择优先级最高',
  );

  // 只有基线信息（新装/未覆盖）→ 用基线档位。
  assert.equal(
    resolveEntryLocation({ status: 'ready', value: { entryLocation: 'sidebar' }, base: { entryLocation: 'sidebar' }, user: {} }),
    'sidebar',
  );

  // 基线只有旧布尔 → 翻译成等价档位（true→both，false→settings）。
  assert.equal(
    resolveEntryLocation({ status: 'ready', value: { showSidebarEntry: true }, base: { showSidebarEntry: true }, user: {} }),
    'both',
  );
  assert.equal(
    resolveEntryLocation({ status: 'ready', value: { showSidebarEntry: false }, base: { showSidebarEntry: false }, user: {} }),
    'settings',
  );

  // 全新安装（三层都没有该字段）→ 默认 both。
  assert.equal(
    resolveEntryLocation({ status: 'ready', value: {}, base: {}, user: {} }),
    'both',
    '全新安装默认 both，与旧 showSidebarEntry=true 行为一致',
  );

  // 设置不可用 → fail-open。
  assert.equal(resolveEntryLocation({ status: 'loading' }), 'both', '未就绪时 fail-open');
});
test('ready snapshot with only the legacy boolean keeps the sidebar hidden', async () => {
  // 维护者复现：{ status:"ready", value:{ showSidebarEntry:false } } 且无 user/base。
  // 旧实现的 value 兜底只找 entryLocation，找不到就回退 both，侧栏错误显示。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const grab = (name) => {
    const start = source.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
    }
    throw new Error(`unbalanced ${name}`);
  };
  const helpers = new Function([
    'const ENTRY_LOCATIONS = Object.freeze(["both", "sidebar", "settings"]);',
    'const DEFAULT_ENTRY_LOCATION = "both";',
    'const ENTRY_LOCATION_FIELD = "entryLocation";',
    'const SHOW_SIDEBAR_ENTRY_FIELD = "showSidebarEntry";',
    grab('normalizeEntryLocation'),
    grab('entryLocationFromLegacyFlag'),
    grab('readLegacyFlag'),
    grab('readEntryLocation'),
    grab('resolveEntryLocation'),
    grab('resolveSidebarVisible'),
    grab('resolveSettingsQuickOpen'),
    'return { resolveEntryLocation, resolveSidebarVisible, resolveSettingsQuickOpen };',
  ].join('\n'))();

  // 只有 value 里的旧 false，没有任何分层信息。
  const legacyHidden = { status: 'ready', value: { showSidebarEntry: false } };
  assert.equal(helpers.resolveEntryLocation(legacyHidden), 'settings', '旧 false 应翻译成 settings');
  assert.equal(helpers.resolveSidebarVisible(legacyHidden), false, '侧栏必须保持隐藏');
  assert.equal(helpers.resolveSettingsQuickOpen('settings'), true, '设置页仍要能打开');

  // 旧 true → both，两个入口都在。
  const legacyVisible = { status: 'ready', value: { showSidebarEntry: true } };
  assert.equal(helpers.resolveEntryLocation(legacyVisible), 'both');
  assert.equal(helpers.resolveSidebarVisible(legacyVisible), true);

  // 完全空的 ready 快照才用默认档位。
  assert.equal(helpers.resolveEntryLocation({ status: 'ready', value: {} }), 'both');
  // 不可用快照仍 fail-open。
  assert.equal(helpers.resolveEntryLocation({ status: 'loading' }), 'both');
});

test('Restore defaults clears both preference keys in one atomic write', async () => {
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };

  const settings = mutableSettingsScope({
    status: 'ready',
    value: { entryLocation: 'sidebar', showSidebarEntry: false },
    base: { entryLocation: 'both', showSidebarEntry: true },
    user: { entryLocation: 'sidebar', showSidebarEntry: false },
    writable: true,
    mode: 'host',
    revision: 1,
  });
  let openCalls = 0;

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
      // 每次渲染都让第一个 useState（卡片 open 开关）返回 true，
      // 保证多次渲染后卡片始终是展开态；其余状态用初始值。
      useState(initial, init) {
        openCalls += 1;
        if (openCalls % 3 === 1) return [true, () => {}];
        return [typeof init === "function" ? init() : initial, () => {}];
      },
    },
  });
  const { ctx, registrations } = clientContext({
    settingsScope: { bind: () => settings.scope },
  });
  plugin.apply(ctx);

  const registration = registrations.get('settings.plugin.item');
  // 卡片默认折叠，先展开再取内部控件。
  const renderExpanded = () => {
    const props = { ...registration.options.inject(), actions: { open() {} } };
    const root = registration.component(props);
    const flat = [];
    const visit = (node) => {
      if (node == null || typeof node !== "object") return;
      flat.push(node);
      const children = node.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) visit(child);
      return flat;
    };
    visit(root);
    return flat;
  };

  const expanded = renderExpanded();
  const reset = expanded.find((node) => node.type === "button" && node.props?.children === "恢复默认");
  assert.ok(reset, "展开后应有「恢复默认」按钮");

  await reset.props.onClick();

  // 必须是一次原子写，而不是两次 unset。
  const mutations = settings.writes.filter(([kind]) => kind === "mutate");
  assert.equal(mutations.length, 1, "应只发生一次 mutate");
  const ops = mutations[0][1];
  assert.equal(ops.length, 2, "一次 mutate 里应清两个键");
  const cleared = ops.filter((op) => op.op === "unset").map((op) => op.path[0]).sort();
  assert.deepEqual(cleared, ["entryLocation", "showSidebarEntry"], "两个键都要清");

  // 成功后两个覆盖都消失，回到部署基线 both。
  const after = settings.scope.getSnapshot();
  assert.equal(Object.hasOwn(after.user ?? {}, "entryLocation"), false);
  assert.equal(Object.hasOwn(after.user ?? {}, "showSidebarEntry"), false);

  const flatAfter = renderExpanded();
  const seg = flatAfter.filter((node) => node.type === "button" && node.props?.role === "radio");
  assert.equal(seg.length, 3);
});

test('Restore defaults leaves both keys untouched when the atomic write fails', async () => {
  const jsxRuntime = {
    jsx(type, props) { return { type, props }; },
    jsxs(type, props) { return { type, props }; },
  };

  const settings = mutableSettingsScope({
    status: 'ready',
    value: { entryLocation: 'sidebar', showSidebarEntry: false },
    base: { entryLocation: 'both', showSidebarEntry: true },
    user: { entryLocation: 'sidebar', showSidebarEntry: false },
    writable: true,
    mode: 'host',
    revision: 1,
  });
  let openCalls = 0;

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
      // 每次渲染都让第一个 useState（卡片 open 开关）返回 true，
      // 保证多次渲染后卡片始终是展开态；其余状态用初始值。
      useState(initial, init) {
        openCalls += 1;
        if (openCalls % 3 === 1) return [true, () => {}];
        return [typeof init === "function" ? init() : initial, () => {}];
      },
    },
  });
  const { ctx, registrations } = clientContext({
    settingsScope: { bind: () => settings.scope },
  });
  plugin.apply(ctx);

  const registration = registrations.get('settings.plugin.item');
  const flat = [];
  const visit = (node) => {
    if (node == null || typeof node !== "object") return;
    flat.push(node);
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child);
    return flat;
  };
  const render = () => {
    flat.length = 0;
    visit(registration.component({ ...registration.options.inject(), actions: { open() {} } }));
    return flat;
  };

  // 让下一次原子写失败。
  settings.state.failNextWrite();
  const reset = render().find((n) => n.type === "button" && n.props?.children === "恢复默认");
  await reset.props.onClick();

  // 两个键都还在 —— 不能出现「清掉一个、另一个残留」的半成品状态。
  const after = settings.scope.getSnapshot();
  assert.equal(after.user?.entryLocation, "sidebar", "失败时 entryLocation 保持不变");
  assert.equal(after.user?.showSidebarEntry, false, "失败时 showSidebarEntry 保持不变");
});

/**
 * 渲染设置卡片并返回可搜索的节点平面表。
 * 用 useState 让第一个状态（卡片 open 开关）恒为 true，避免依赖点击展开。
 */
async function renderSettingsCard(settings) {
  let openCalls = 0;
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
      useState(initial, init) {
        openCalls += 1;
        if (openCalls % 3 === 1) return [true, () => {}];
        return [typeof init === "function" ? init() : initial, () => {}];
      },
    },
  });
  const { ctx, registrations } = clientContext({
    settingsScope: { bind: () => settings.scope },
  });
  plugin.apply(ctx);

  const registration = registrations.get('settings.plugin.item');
  const flat = [];
  const visit = (node) => {
    if (node == null || typeof node !== "object") return;
    flat.push(node);
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child);
    return flat;
  };
  visit(registration.component({ ...registration.options.inject(), actions: { open() {} } }));
  return flat;
}

test('legacy scope without mutate resets a legacy-only override', async () => {
  // 复现 @deepseek-ai/dsh-client-ui-settings@0.1.2-rc.1：只有 set/unset。
  const settings = mutableLegacySettingsScope({
    status: 'ready',
    value: { showSidebarEntry: false },
    base: { showSidebarEntry: true },
    user: { showSidebarEntry: false },
    writable: true,
    mode: 'host',
    revision: 1,
  });

  const nodes = await renderSettingsCard(settings);
  const reset = nodes.find((n) => n.type === "button" && n.props?.children === "恢复默认");
  assert.ok(reset, "应有「恢复默认」按钮");

  await reset.props.onClick();

  // 只有 showSidebarEntry 一个覆盖：必须恰好写一次，且不能顺手多清 entryLocation。
  assert.deepEqual(settings.writes, [["unset", "showSidebarEntry"]], "只清实际存在的那个键");

  // 覆盖清空，解析回到部署基线（base.showSidebarEntry=true → both）。
  const after = settings.scope.getSnapshot();
  assert.equal(Object.hasOwn(after.user ?? {}, "showSidebarEntry"), false, "旧布尔覆盖应被清掉");
});

test('legacy scope without mutate clears both keys and restores the deployment base', async () => {
  const settings = mutableLegacySettingsScope({
    status: 'ready',
    value: { entryLocation: 'sidebar', showSidebarEntry: false },
    base: { entryLocation: 'both', showSidebarEntry: true },
    user: { entryLocation: 'sidebar', showSidebarEntry: false },
    writable: true,
    mode: 'host',
    revision: 1,
  });

  const nodes = await renderSettingsCard(settings);
  const reset = nodes.find((n) => n.type === "button" && n.props?.children === "恢复默认");
  await reset.props.onClick();

  const unsettled = settings.writes.filter(([k]) => k === "unset").map(([, f]) => f);
  assert.deepEqual(
    [...unsettled].sort(),
    ["entryLocation", "showSidebarEntry"],
    "两个键都要清",
  );

  // 顺序：先清旧布尔，再清新字段 —— 避免中间态让旧值重新生效。
  assert.equal(unsettled[0], "showSidebarEntry", "应先清 showSidebarEntry");
  assert.equal(unsettled[1], "entryLocation", "再清 entryLocation");

  const after = settings.scope.getSnapshot();
  assert.equal(Object.hasOwn(after.user ?? {}, "entryLocation"), false);
  assert.equal(Object.hasOwn(after.user ?? {}, "showSidebarEntry"), false);
});

test('legacy scope keeps the original placement when a reset write fails', async () => {
  const settings = mutableLegacySettingsScope({
    status: 'ready',
    value: { entryLocation: 'sidebar', showSidebarEntry: false },
    base: { entryLocation: 'both', showSidebarEntry: true },
    user: { entryLocation: 'sidebar', showSidebarEntry: false },
    writable: true,
    mode: 'host',
    revision: 1,
  });

  const nodes = await renderSettingsCard(settings);
  const reset = nodes.find((n) => n.type === "button" && n.props?.children === "恢复默认");

  // 让第一次 unset（showSidebarEntry）失败。
  settings.state.failOn = "showSidebarEntry";
  await reset.props.onClick();

  // 失败发生在第一笔，用户文档应原样保留。
  const after = settings.scope.getSnapshot();
  assert.equal(after.user?.entryLocation, "sidebar", "失败时 entryLocation 不变");
  assert.equal(after.user?.showSidebarEntry, false, "失败时 showSidebarEntry 不变");
});
