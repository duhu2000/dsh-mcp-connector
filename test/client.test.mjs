import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadClient({
  clientDocument,
  reactApi = {},
  reactDomApi = { createPortal() {} },
  jsxRuntime = { jsx() {}, jsxs() {} },
  windowExtras = {},
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
  Function('window', 'document', source)(window, document);
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
