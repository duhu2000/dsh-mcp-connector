import test from 'node:test';
import assert from 'node:assert/strict';
import { AppViews } from '../lib/mcp-apps/views.js';
import { appDescriptor, modelResult, readUiResource, APP_MIME } from '../lib/mcp-apps/policy.js';
const binding = { sessionId: 's1', callId: 'c1', connectionId: 'conn1', accountId: 'a1', generation: 'g1' };
const tool = { name: 'open_chart', _meta: { ui: { resourceUri: 'ui://example/chart' } } };
const result = { content: [{ type: 'text', text: 'chart' }], structuredContent: { value: 42 }, _meta: { privateValue: 'ui-only' } };
const make = (views) => views.create({ binding, tool, args: {}, result });
const resource = { contents: [{ uri: 'ui://example/chart', mimeType: APP_MIME, text: '<h1>Chart</h1>' }] };
const allow = async () => true;
const options = { authorize: allow, validateArguments: allow, confirm: allow, tools: [tool] };

test('UI metadata stays out of model result and persisted presentation', () => {
  const created = make(new AppViews());
  assert.deepEqual(created.model, modelResult(result));
  assert.equal(JSON.stringify(created).includes('ui-only'), false);
  assert.equal(created.presentation.viewId.length, 43);
  assert.equal(appDescriptor({ _meta: { ui: { visibility: ['app'] } } }).modelVisible, false);
  assert.equal(appDescriptor({ _meta: { 'ui/resourceUri': 'ui://legacy/view' } }).resourceUri, 'ui://legacy/view');
});
test('cross-session, call, service, account and connection generation denied', async () => {
  const views = new AppViews(); const { presentation } = make(views);
  for (const key of Object.keys(binding)) {
    await assert.rejects(views.resource(presentation.viewId, { ...binding, [key]: 'other' }, { authorize: allow }), /FORBIDDEN/);
  }
});
test('resource fetch preserves UI-only result but validates resource identity/MIME/size/access', async () => {
  const views = new AppViews(); const { presentation } = make(views);
  const actual = await views.resource(presentation.viewId, binding, { authorize: allow, client: { readResource: async () => resource } });
  assert.equal(actual.result._meta.privateValue, 'ui-only');
  for (const patch of [{ uri: 'ui://other/view' }, { mimeType: 'text/html' }, { text: undefined }]) {
    assert.throws(() => readUiResource({ contents: [{ ...resource.contents[0], ...patch }] }, tool._meta.ui.resourceUri), /INVALID/);
  }
  assert.throws(() => readUiResource(resource, tool._meta.ui.resourceUri, { maxBytes: 1 }), /TOO_LARGE/);
  assert.throws(() => readUiResource({ contents: [{ ...resource.contents[0], _meta: { ui: { csp: { connectDomains: ['https://evil.example'] } } } }] }, tool._meta.ui.resourceUri), /EXTERNAL/);
});
test('expiry and disconnect invalidate views including an in-flight read', async () => {
  let now = 0; const views = new AppViews({ now: () => now, ttlMs: 10 }); const { presentation } = make(views);
  now = 10;
  await assert.rejects(views.resource(presentation.viewId, binding, { authorize: allow }), /FORBIDDEN/);
  now = 0; const p = make(views).presentation;
  await assert.rejects(views.resource(p.viewId, binding, { authorize: allow, client: { readResource: async () => { views.invalidate('conn1'); return resource; } } }), /FORBIDDEN/);
});
test('callback refuses missing policy/confirmation/model-only tool and prevents double click', async () => {
  const views = new AppViews(); const id = make(views).presentation.viewId;
  const request = { name: tool.name };
  const client = { callTool: async () => result };
  await assert.rejects(views.call(id, binding, request, { ...options, client, confirm: undefined }), /CONFIRMATION/);
  await assert.rejects(views.call(id, binding, request, { ...options, client, authorize: undefined }), /ACCESS_DENIED/);
  await assert.rejects(views.call(id, binding, request, { ...options, client, tools: [{ ...tool, _meta: { ui: { visibility: ['model'] } } }] }), /NOT_APP_VISIBLE/);
  let release; const wait = new Promise(r => { release = r; });
  const pending = views.call(id, binding, request, { ...options, client: { callTool: async () => { await wait; return result; } } });
  await new Promise(r => setImmediate(r));
  await assert.rejects(views.call(id, binding, request, { ...options, client }), /IN_PROGRESS/);
  release(); assert.deepEqual(await pending, result);
});
test('bounded cache and independent non-recharge tools', () => {
  const views = new AppViews({ maxViews: 1 }); make(views);
  assert.throws(() => make(views), /LIMIT/);
  views.clear();
  assert.doesNotThrow(() => views.create({ binding, tool: { ...tool, name: 'open_weather' }, args: {}, result }));
});

import { registerAppTools } from '../lib/mcp-apps/registration.js';
test('single registrar keeps app-only tools out of model and only exposes view handle', async () => {
  const definitions = new Map(); const views = new AppViews();
  const runtime = { register(d) { assert.equal(definitions.has(d.name), false); definitions.set(d.name, d); return () => definitions.delete(d.name); } };
  const client = { callTool: async () => result, readResource: async () => resource };
  const registration = registerAppTools({ runtime, client, views, source: { ...binding, serverName: 'example' }, authorize: allow, tools: [tool, { name: 'app_callback', _meta: { ui: { visibility: ['app'] } } }, { name: 'ordinary', inputSchema: { type: 'object' } }] });
  assert.equal(definitions.size, 2);
  const def = definitions.get('mcp__example__open_chart');
  const value = await def.execute({}, { agent: { session: { id: 's1' } }, callId: 'c1' });
  assert.equal(JSON.stringify(value).includes('ui-only'), false);
  assert.equal(JSON.stringify(def.output.presentationMeta({}, value)).includes('ui-only'), false);
  // DSH snapshots/freezes values before projection; object identity is not stable.
  const p = def.output.presentationMeta({}, structuredClone(value)).mcpApp;
  const loaded = await views.resource(p.viewId, binding, { client, authorize: allow });
  assert.equal(loaded.result._meta.privateValue, 'ui-only');
  registration.dispose(); assert.equal(definitions.size, 0);
  await assert.rejects(views.resource(p.viewId, binding, { client, authorize: allow }), /FORBIDDEN/);
  await assert.rejects(def.execute({}, { agent: { session: { id: 's1' } }, callId: 'c1' }), /CLOSED/);
});
test('registration collision rolls back partially registered tools', () => {
  let disposed = 0; let count = 0;
  assert.throws(() => registerAppTools({ runtime: { register() { if (++count === 2) throw new Error('conflict'); return () => disposed++; } }, client: {}, views: new AppViews(), source: { ...binding, serverName: 'example' }, tools: [tool, { name: 'second' }] }), /conflict/);
  assert.equal(disposed, 1);
});
