import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  SHARING_AUTHOR_ASSETS,
  SHARING_CASE_TEMPLATES,
  SharingExperienceError,
  createSharingCopyPayload,
  createSharingExperience,
  createSharingExperienceFromTemplate,
  editSharingExperience,
  mount,
  renderSharingExperiencePreview,
} from '../ui/sharing-experience.js';

function getErrorCode(callback) {
  try {
    callback();
  } catch (error) {
    assert.ok(error instanceof SharingExperienceError);
    return error.code;
  }
  assert.fail('expected SharingExperienceError');
}

test('three public templates start with explicit untested statuses and bounded evidence claims', () => {
  assert.deepEqual(Object.keys(SHARING_CASE_TEMPLATES), ['companyProfile', 'jsonMigration', 'toolRecovery']);
  for (const templateId of Object.keys(SHARING_CASE_TEMPLATES)) {
    const draft = createSharingExperienceFromTemplate(templateId, { dsh: '0.2.1-rc.2', plugin: '0.2.81', host: 'Desktop' });
    assert.ok(draft.steps.length >= 3);
    assert.ok(draft.steps.every((step) => step.status === 'untested'));
    assert.ok(draft.limitations.length > 0);
    assert.match(renderSharingExperiencePreview(draft), /\[未测试\]/);
  }
  assert.match(SHARING_CASE_TEMPLATES.jsonMigration.limitations[0], /真实.*端到端证据/);
  assert.match(SHARING_CASE_TEMPLATES.toolRecovery.limitations[0], /尚无.*真实连接/);
});

test('only explicit edits change a stage status and the source draft stays immutable', () => {
  const original = createSharingExperienceFromTemplate('companyProfile', { plugin: '0.2.81' });
  const steps = original.steps.map((step, index) => ({
    ...step,
    status: index === 0 ? 'success' : step.status,
  }));
  const updated = editSharingExperience(original, { steps });
  assert.equal(original.steps[0].status, 'untested');
  assert.equal(updated.steps[0].status, 'success');
  assert.ok(updated.steps.slice(1).every((step) => step.status === 'untested'));
  assert.ok(Object.isFrozen(original));
  assert.ok(Object.isFrozen(original.steps));
});

test('unknown connection, cache, conversation and business-result signals are rejected', () => {
  const base = SHARING_CASE_TEMPLATES.companyProfile;
  for (const [field, value] of [
    ['connected', true],
    ['toolCache', true],
    ['clipboardCopied', true],
    ['messages', [{ role: 'user', content: 'private' }]],
    ['businessResponse', { company: 'private' }],
    ['toolOutput', 'private'],
  ]) {
    assert.equal(getErrorCode(() => createSharingExperience({ ...base, [field]: value })), 'UNSUPPORTED_FIELD');
  }
});

test('credentials, OAuth callbacks, file URLs and local user paths cannot enter a draft', () => {
  const unsafe = [
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'api_key=abcdefghijklmnop',
    'https://localhost/callback?code=secret-code-value&state=abc',
    'file:///Users/alice/private.json',
    '/Users/alice/.dsh/config.json',
    '/home/alice/.config/dsh.json',
    'C:\\Users\\alice\\AppData\\dsh.json',
  ];
  for (const value of unsafe) {
    assert.equal(getErrorCode(() => createSharingExperience({
      ...SHARING_CASE_TEMPLATES.companyProfile,
      limitations: [value],
    })), 'SENSITIVE_TEXT');
  }
});

test('rendering is deterministic, escapes Markdown, validates versions, and never claims copy is business success', () => {
  const draft = createSharingExperience({
    task: '检查 <连接> #1',
    versions: { dsh: '0.2.1-rc.2', plugin: 'v0.2.81', host: 'Desktop' },
    steps: [
      { name: '配置 *导入*', status: 'success' },
      { name: '业务调用', status: 'untested' },
    ],
    limitations: ['没有真实业务结果'],
  });
  const first = renderSharingExperiencePreview(draft);
  const second = renderSharingExperiencePreview(draft);
  assert.equal(first, second);
  assert.match(first, /检查 \\<连接\\> \\#1/);
  assert.match(first, /\[成功\] 配置 \\\*导入\\\*/);
  assert.match(first, /\[未测试\] 业务调用/);
  const payload = createSharingCopyPayload(draft);
  assert.equal(payload.copied, false);
  assert.equal(payload.businessOutcome, 'unchanged');
  assert.match(payload.text, /复制草稿不代表连接或业务调用成功/);
  assert.equal(getErrorCode(() => createSharingExperience({
    ...draft,
    versions: { ...draft.versions, plugin: 'latest' },
  })), 'INVALID_VERSION');
});

test('author assets distinguish historical real evidence, procedure-only evidence and Mock UI', () => {
  assert.deepEqual(SHARING_AUTHOR_ASSETS.map((item) => item.id), [
    'one-success-case',
    'json-migration',
    'tool-recovery',
    'storefront-screenshots',
  ]);
  assert.equal(SHARING_AUTHOR_ASSETS[0].provenance, 'historical-real-readonly-summary');
  assert.equal(SHARING_AUTHOR_ASSETS.at(-1).provenance, 'credential-free-mock');
  assert.match(SHARING_AUTHOR_ASSETS.at(-1).note, /不得作为真实业务成功证据/);
});

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
      if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && (child.selected || !this.value)) {
        this.value = child.value;
      }
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  async dispatch(type) {
    for (const listener of this.listeners.get(type) || []) await listener({ type, target: this });
  }

  querySelector(selector) {
    const match = selector.match(/^\[data-([a-z-]+)="([^"]+)"\]$/);
    if (!match) return null;
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = match[2];
    return this.walk().find((element) => String(element.dataset[key]) === value) || null;
  }

  walk() {
    return [this, ...this.children.flatMap((child) => child.walk())];
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

test('mount calls openDraft only after the explicit user click and dispose removes the module', async () => {
  const document = new FakeDocument();
  const root = new FakeElement('div', document);
  const opened = [];
  const messages = [];
  const dispose = mount(root, {
    openDraft: async (text) => opened.push(text),
    showMessage: (text, type) => messages.push({ text, type }),
  });
  assert.equal(typeof dispose, 'function');
  assert.equal(opened.length, 0);

  const elements = root.walk();
  const preview = elements.find((element) => element.textContent === '生成预览');
  const copy = elements.find((element) => element.textContent === '复制到会话草稿');
  assert.ok(preview);
  assert.ok(copy);
  await preview.dispatch('click');
  assert.equal(opened.length, 0);
  await copy.dispatch('click');
  assert.equal(opened.length, 1);
  assert.match(opened[0], /\[未测试\]/);
  assert.match(messages.at(-1).text, /尚未发送/);
  assert.match(messages.at(-1).text, /不代表.*业务调用成功/);

  dispose();
  assert.equal(root.children.length, 0);
});

test('invalid versions keep the template selector and rendered content on the active template', async () => {
  const document = new FakeDocument();
  const root = new FakeElement('div', document);
  const messages = [];
  mount(root, {
    openDraft: async () => {},
    showMessage: (text, type) => messages.push({ text, type }),
  });

  const elements = root.walk();
  const template = elements.find((element) => (
    element.tagName === 'SELECT'
    && element.children.some((child) => child.value === 'jsonMigration')
  ));
  const inputs = elements.filter((element) => element.tagName === 'INPUT');
  const task = inputs[0];
  const pluginVersion = inputs[2];
  const preview = elements.find((element) => element.className === 'sharing-experience-preview');
  const initialPreview = preview.textContent;

  pluginVersion.value = 'latest';
  template.value = 'jsonMigration';
  await template.dispatch('change');

  assert.equal(template.value, 'companyProfile');
  assert.equal(task.value, SHARING_CASE_TEMPLATES.companyProfile.task);
  assert.equal(preview.textContent, initialPreview);
  assert.equal(messages.at(-1).type, 'error');
  assert.match(messages.at(-1).text, /语义版本/);
  assert.match(messages.at(-1).text, /模板未切换，请纠正后重试/);

  pluginVersion.value = '0.2.81';
  template.value = 'jsonMigration';
  await template.dispatch('change');

  assert.equal(template.value, 'jsonMigration');
  assert.equal(task.value, SHARING_CASE_TEMPLATES.jsonMigration.task);
  assert.notEqual(preview.textContent, initialPreview);
});

test('module source has no network, storage, telemetry, clipboard or connection access', async () => {
  const source = await readFile(new URL('../ui/sharing-experience.js', import.meta.url), 'utf8');
  for (const forbidden of [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /localStorage/,
    /sessionStorage/,
    /navigator\.clipboard/,
    /\/api\/connections/,
    /toolCache/,
    /businessResponse/,
    /telemetry/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /await openDraft\(payload\.text\)/);
});
