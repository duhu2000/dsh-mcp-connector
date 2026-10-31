import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_TEMPLATE_FORMAT,
  createCatalogReferenceTemplate,
  createCustomHttpTemplate,
  mount,
} from '../ui/connection-template-sharing.js';

const TRUSTED_CATALOG = [{
  connectorId: 'public-demo',
  serverKey: 'main',
  name: '公开目录示例',
  serverName: 'public-demo',
}];

class FakeElement {
  constructor(ownerDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.dataset = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
  }
  append(...items) {
    for (const item of items) {
      item.parentNode = this;
      this.children.push(item);
    }
  }
  replaceChildren(...items) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...items);
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) {
    if (this.listeners.get(name) === handler) this.listeners.delete(name);
  }
  dispatch(name) { return this.listeners.get(name)?.(); }
  click() { return this.disabled ? undefined : this.dispatch('click'); }
}

function fixture() {
  const document = { createElement(tagName) { return new FakeElement(document, tagName); } };
  return new FakeElement(document);
}

function byRole(root, role) {
  if (root.dataset?.role === role) return root;
  for (const child of root.children ?? []) {
    const found = byRole(child, role);
    if (found) return found;
  }
  return null;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('纯函数生成受信任目录引用和全重填自定义模板', () => {
  const catalog = createCatalogReferenceTemplate(TRUSTED_CATALOG, {
    connectorId: 'public-demo',
    serverKey: 'main',
    generatedAt: 0,
  });
  assert.equal(catalog.format, SAFE_TEMPLATE_FORMAT);
  assert.deepEqual(catalog.connections, []);
  assert.equal(catalog.catalogConnections[0].action, 'connect-from-catalog');
  assert.doesNotMatch(JSON.stringify(catalog), /https?:|authorization|token/i);

  const custom = createCustomHttpTemplate({ authMode: 'api-key', generatedAt: 0 });
  assert.equal(custom.connections[0].url, '<REDACTED:REENTER>');
  assert.equal(custom.connections[0].apiKeyValue, '<REDACTED:REENTER>');
  assert.equal(custom.connections[0].name, '自定义 MCP 连接');
  assert.equal(custom.connections[0].serverName, 'custom-mcp');
  assert.throws(
    () => createCustomHttpTemplate({ authMode: 'api-key', apiKeyHeader: 'X-Tenant-Secret' }),
    /只能选择通用公开名称/,
  );
});

test('伪造公开 descriptor 或不在白名单的租户标识不会进入模板', () => {
  assert.throws(
    () => createCatalogReferenceTemplate(TRUSTED_CATALOG, {
      connectorId: 'tenant-secret-abc',
      serverKey: 'main',
      name: 'Customer Alpha secret',
      serverName: 'tenant-secret',
      url: 'https://tenant-secret.example/mcp',
    }),
    /不在已审计的公开目录白名单/,
  );
});

test('用户必须先生成预览，再显式复制、下载或带入安全 JSON', async () => {
  const container = fixture();
  const copied = [];
  const downloaded = [];
  const drafts = [];
  const messages = [];
  const dispose = mount(container, {
    now: () => 0,
    async copyText(text) { copied.push(text); },
    async downloadText(...args) { downloaded.push(args); },
    async openDraft(text) { drafts.push(text); },
    showMessage(...args) { messages.push(args); },
  });
  assert.equal(typeof dispose, 'function');
  assert.equal(copied.length, 0);
  assert.equal(drafts.length, 0);

  const root = container.children[0];
  await byRole(root, 'preview').click();
  const output = byRole(root, 'output').textContent;
  assert.match(output, /<REDACTED:REENTER>/);
  assert.doesNotMatch(output, /https?:|Customer|tenant/i);
  await byRole(root, 'copy').click();
  await byRole(root, 'download').click();
  await byRole(root, 'draft').click();
  assert.deepEqual(copied, [output]);
  assert.deepEqual(downloaded, [[output, 'mcp-connection-template.json']]);
  assert.deepEqual(drafts, [output]);
  assert.equal(messages.every(([, type]) => type === 'success'), true);

  dispose();
  assert.equal(container.children.length, 0);
});

test('目录模式只能从宿主注入的已审计白名单选择', async () => {
  const container = fixture();
  const dispose = mount(container, {
    now: () => 0,
    catalogReferences: TRUSTED_CATALOG,
    async copyText() {},
    async downloadText() {},
    async openDraft() {},
  });
  const root = container.children[0];
  const mode = byRole(root, 'mode');
  mode.value = 'catalog';
  mode.dispatch('change');
  await byRole(root, 'preview').click();
  const value = JSON.parse(byRole(root, 'output').textContent);
  assert.deepEqual(value.source, { kind: 'catalog', connectorId: 'public-demo', serverKey: 'main' });
  assert.deepEqual(value.connections, []);
  assert.equal(value.catalogConnections[0].action, 'connect-from-catalog');
  dispose();
});

test('重复点击不重复执行，卸载后异步结果不再通知或恢复 UI', async () => {
  const container = fixture();
  const pending = deferred();
  const calls = [];
  const messages = [];
  const dispose = mount(container, {
    now: () => 0,
    copyText(text) { calls.push(text); return pending.promise; },
    async downloadText() {},
    async openDraft() {},
    showMessage(...args) { messages.push(args); },
  });
  const root = container.children[0];
  await byRole(root, 'preview').click();
  const copy = byRole(root, 'copy');
  const first = copy.click();
  const second = copy.click();
  assert.equal(calls.length, 1);
  assert.equal(second, undefined);
  const beforeDisposeMessages = messages.length;
  dispose();
  pending.resolve();
  await first;
  assert.equal(messages.length, beforeDisposeMessages);
  assert.equal(container.children.length, 0);
});

test('模块不读取真实连接、storage、网络或业务结果', () => {
  const source = mount.toString();
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|authorization|bearerToken|apiKeyValue/);
});
