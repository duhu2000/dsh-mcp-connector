import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bundledTemplateReferences, loadBundledCatalog } from '../lib/catalog.js';
import { createCatalogReferenceTemplate, createCustomHttpTemplate } from '../ui/connection-template-sharing.js';
import { assertShareableConnectionTemplate } from '../lib/shareable-connection-template.js';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');

test('template reference endpoint exposes exactly four fixed-bundle fields, ignores caller data', async () => {
  const start = source.indexOf('    async templateCatalogReferences()');
  const end = source.indexOf('    async catalog(', start);
  const api = new Function('bundledTemplateReferences', 't', `return {${source.slice(start, end)}}`)(bundledTemplateReferences, text => text);
  const response = await api.templateCatalogReferences({ items: [{ connectorId: 'injected-private', name: 'private' }] });
  assert.equal(response.ok, true);
  const refs = response.detail.items;
  assert.ok(refs.length > 0);
  const bundled = loadBundledCatalog().filter((c) => c.published !== false);
  assert.equal(refs.length, bundled.reduce((n, c) => n + c.servers.length, 0));
  for (const ref of refs) {
    assert.deepEqual(Object.keys(ref).sort(), ['connectorId', 'name', 'serverKey', 'serverName']);
    assert.ok(bundled.some((c) => c.id === ref.connectorId && c.servers.some((s) => s.serverKey === ref.serverKey)));
    assert.doesNotThrow(() => assertShareableConnectionTemplate(createCatalogReferenceTemplate(refs, ref)));
  }
  assert.doesNotMatch(JSON.stringify(refs), /injected-private|https?:|Authorization|bearerToken/);
  const again = bundledTemplateReferences();
  refs[0].name = 'mutated';
  assert.notEqual(again[0].name, refs[0].name);
});

test('custom UI outputs are accepted by deterministic validator with all sensitive fields placeholders', () => {
  for (const authMode of ['none', 'bearer', 'api-key']) {
    const template = createCustomHttpTemplate({ authMode });
    assert.doesNotThrow(() => assertShareableConnectionTemplate(template));
    assert.equal(template.connections[0].url, '<REDACTED:REENTER>');
    assert.deepEqual(template.connections[0].headers, {});
  }
});

function loader(response) {
  let mounts = 0; let mountedOptions;
  const calls = [];
  const root = { textContent: '' };
  const start = html.indexOf('  async function openSafeTemplate(');
  const end = html.indexOf('  async function openFirstUse(', start);
  const factory = new Function('root', 'call', 'loadModule', 't', `
    let sharingSequence = 0, sharingDispose = null;
    const $ = key => key === '#safe-template-root' ? root : {classList:{contains:()=>true}};
    const openModal = () => sharingSequence++;
    const openSharingDraft = () => {}, showToast = () => {};
    ${html.slice(start, end).replace("import('./connection-template-sharing.js')", 'loadModule()')}
    return {open:openSafeTemplate, close:()=>sharingSequence++};
  `);
  const api = factory(root, async (method, params) => { calls.push([method, params]); return response; }, async () => ({ mount(_root, options) { mounts++; mountedOptions = options; return () => {}; } }), text => text);
  return { ...api, root, calls, get mounts() { return mounts; }, get options() { return mountedOptions; } };
}

test('safe template UI loads fixed reference endpoint only and fails closed', async () => {
  const refs = bundledTemplateReferences();
  const good = loader({ ok: true, detail: { items: refs } });
  await good.open();
  assert.deepEqual(good.calls, [['templateCatalogReferences', {}]]);
  assert.equal(good.mounts, 1);
  assert.equal(good.options.catalogReferences, refs);
  assert.deepEqual(Object.keys(good.options).sort(), ['catalogReferences', 'openDraft', 'showMessage']);
  for (const response of [{ ok: false }, { ok: true, detail: {} }]) {
    const bad = loader(response); await bad.open();
    assert.equal(bad.mounts, 0);
    assert.match(bad.root.textContent, /加载失败/);
  }
});

test('late template reference response cannot mount after closing', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const l = loader(pending);
  const opening = l.open(); l.close();
  resolve({ ok: true, detail: { items: [] } });
  await opening;
  assert.equal(l.mounts, 0);
});

test('fixed reference route ignores request params and hidden fields stay hidden under grid styles', async () => {
  const web = await readFile(new URL('../lib/web.js', import.meta.url), 'utf8');
  assert.match(web, /\['templateCatalogReferences', \(api\) => api\.templateCatalogReferences\(\)\]/);
  assert.match(html, /\.mcp-safe-template-share \[hidden\] \{ display: none !important; \}/);
});
