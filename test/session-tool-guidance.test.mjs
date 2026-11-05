import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from '../lib/tools.js';
import { createTranslator } from '../lib/i18n/index.js';
import en from '../lib/i18n/locales/en.js';
import { createSessionToolInjectionController } from '../lib/session-injection.js';

const connectionKey = 'guide-weather';
const publicName = 'mcp__weather__forecast';

function captureSessionTool(t, sessionTools, options = {}) {
  const definitions = new Map();
  const dispose = registerTools({ tools: { register(definition) {
    definitions.set(definition.name, definition);
    return () => definitions.delete(definition.name);
  } } }, { sessionTools }, options);
  t.after(dispose);
  return definitions.get('mcp_connector_session_tools');
}

function sessionFixture(t, options = {}) {
  const agent = { id: 'guidance-agent', workspaceId: 'workspace-a', ctx: { tools: { restrict: () => () => {} } } };
  const records = [{ key: connectionKey, name: 'Weather', serverName: 'weather', enabled: true, injectionMode: 'session' }];
  const coordinator = createSessionToolInjectionController({ tools: {
    definitions: () => [{ name: publicName }], guard: () => () => {}, restrict() {},
  } }, {
    getRecords: () => records,
    workspaceIdForAgent: (current) => current.workspaceId,
    now: () => 1_000,
  });
  coordinator.mountAgents({ agents: { list: () => [agent] } });
  t.after(() => coordinator.dispose());
  const calls = [];
  const actions = {
    'preview-activate': coordinator.previewActivation,
    activate: coordinator.activate,
    deactivate: coordinator.deactivate,
    status: coordinator.status,
  };
  const tool = captureSessionTool(t, async (args, exec) => {
    calls.push({ args, exec });
    try {
      const detail = actions[args.action](exec.agent, args);
      return { ok: true, message: 'Session tool result', detail };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }, options);
  return { agent, coordinator, calls, tool };
}

function renderedText(tool, args, value) {
  return tool.output.render(args, value).map((part) => part.text).join('\n');
}

test('#212 preview guidance uses the real baseRevision and never authorizes activation', async (t) => {
  const { agent, coordinator, calls, tool } = sessionFixture(t);
  const args = { action: 'preview-activate', connectionKey: ` ${connectionKey} `, publicNames: [publicName, publicName] };
  const preview = await tool.execute(args, { agent });
  assert.equal(preview.ok, true, preview.message);
  assert.equal(preview.detail.baseRevision, 0);
  assert.deepEqual(preview.detail.nextStep.arguments, {
    action: 'activate', connectionKey, publicNames: [publicName], ttlMinutes: 30,
    expectedRevision: preview.detail.baseRevision, confirmed: false,
  });
  assert.equal(preview.detail.nextStep.toolName, 'mcp_connector_session_tools');
  assert.equal(preview.detail.nextStep.requiresUserConfirmation, true);
  assert.deepEqual(coordinator.status(agent).active, []);
  assert.equal(calls.length, 1);

  const suggested = preview.detail.nextStep.arguments;
  const unconfirmed = await tool.execute(suggested, { agent });
  assert.equal(unconfirmed.ok, false);
  assert.deepEqual(coordinator.status(agent).active, []);
  const confirmed = await tool.execute({ ...suggested, confirmed: true }, { agent });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.detail.activated, [publicName]);
});

for (const compact of [false, true]) {
  test('#212 search provides exact per-connection preview arguments without activating (' + (compact ? 'compact' : 'full') + ')', async (t) => {
    const items = [
      { connectionKey, serverName: 'weather', name: 'forecast', publicName },
      { connectionKey: 'guide-other', serverName: 'other', name: 'forecast', publicName: 'mcp__other__forecast' },
      { connectionKey, serverName: 'weather', name: 'not-observed' },
      { serverName: 'unknown', name: 'orphan', publicName: 'mcp__unknown__orphan' },
    ];
    const source = { ok: true, message: 'Cached candidates', detail: { items, source: 'last-success-cache', discoveryOnly: true, active: [] } };
    const snapshot = structuredClone(source);
    const calls = [];
    const agent = { id: 'search-agent' };
    const tool = captureSessionTool(t, async (args, exec) => { calls.push({ args, exec }); return source; }, { compact });
    const args = { action: 'search', query: 'forecast', limit: 4 };
    const result = await tool.execute(args, { agent });
    assert.equal(result.ok, true);
    assert.deepEqual(result.detail.items.slice(0, 2).map((item) => item.previewArguments), [
      { action: 'preview-activate', connectionKey, publicNames: [publicName] },
      { action: 'preview-activate', connectionKey: 'guide-other', publicNames: ['mcp__other__forecast'] },
    ]);
    for (const item of result.detail.items.slice(2)) assert.equal(item.previewArguments, undefined);
    assert.deepEqual(source, snapshot, 'guidance must not mutate cached API results');
    assert.equal(result.detail.source, 'last-success-cache');
    assert.equal(result.detail.discoveryOnly, true);
    assert.deepEqual(result.detail.active, []);
    assert.deepEqual(calls, [{ args, exec: { agent } }]);
    assert.equal(result.detail.nextStep, undefined);
    const text = renderedText(tool, args, result);
    for (const item of result.detail.items.slice(0, 2)) assert.ok(text.includes(JSON.stringify(item.previewArguments)));
    assert.ok(text.includes(result.detail.guidance));
  });
}

test('#212 empty search gives recovery guidance without inventing tool names', async (t) => {
  const tool = captureSessionTool(t, async () => ({ ok: true, message: 'No matches', detail: { items: [] } }));
  const args = { action: 'search', query: 'missing' };
  const result = await tool.execute(args);
  assert.deepEqual(result.detail.items, []);
  assert.equal(result.detail.nextStep, undefined);
  assert.match(result.detail.guidance, /query/);
  assert.ok(renderedText(tool, args, result).includes(result.detail.guidance));
});

test('#212 text-only preview exposes the same exact safe activation template', async (t) => {
  const { agent, tool } = sessionFixture(t, { compact: true });
  const args = { action: 'preview-activate', connectionKey, publicNames: [publicName], ttlMinutes: 5 };
  const result = await tool.execute(args, { agent });
  assert.equal(result.ok, true, result.message);
  const text = renderedText(tool, args, result);
  assert.match(text, /revision: 0/);
  assert.match(text, /ttlMinutes: 5/);
  assert.ok(text.includes(publicName));
  assert.ok(text.includes(JSON.stringify(result.detail.nextStep.arguments, null, 2)));
  assert.ok(text.includes(result.detail.nextStep.instruction));
  assert.equal(result.detail.nextStep.arguments.confirmed, false);
  assert.equal(result.detail.nextStep.requiresUserConfirmation, true);
});

test('#212 rejected preview preserves its error and never supplies an activate template', async (t) => {
  const { agent, coordinator, tool } = sessionFixture(t);
  for (const args of [
    { action: 'preview-activate', connectionKey, publicNames: ['mcp__weather__guessed'] },
    { action: 'preview-activate', connectionKey: 'missing', publicNames: [publicName] },
    { action: 'preview-activate', connectionKey, publicNames: [publicName], ttlMinutes: 31 },
  ]) {
    const result = await tool.execute(args, { agent });
    assert.equal(result.ok, false);
    assert.equal(result.detail.nextStep, undefined);
    const text = renderedText(tool, args, result);
    assert.ok(text.startsWith(result.message));
    assert.ok(text.includes(result.detail.guidance));
    assert.match(result.detail.guidance, /preview-activate/);
    assert.match(result.detail.guidance, /search/);
    assert.deepEqual(coordinator.status(agent).active, []);
  }
});

test('#212 stale activation guidance cannot reuse an older preview revision', async (t) => {
  const { agent, coordinator, tool } = sessionFixture(t);
  const args = { action: 'preview-activate', connectionKey, publicNames: [publicName] };
  const preview = await tool.execute(args, { agent });
  const activation = { ...preview.detail.nextStep.arguments, confirmed: true };
  assert.equal((await tool.execute(activation, { agent })).ok, true);
  const stale = await tool.execute(activation, { agent });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /revision/);
  assert.equal(stale.detail.nextStep, undefined);
  assert.match(stale.detail.guidance, /preview-activate/);
  assert.equal(coordinator.status(agent).revision, 1);
  const refreshed = await tool.execute(args, { agent });
  assert.equal(refreshed.detail.nextStep.arguments.expectedRevision, 1);
  assert.equal(refreshed.detail.nextStep.arguments.confirmed, false);
});

test('#212 stale deactivation directs callers to status rather than a new activation', async (t) => {
  const { agent, tool } = sessionFixture(t);
  const preview = await tool.execute({ action: 'preview-activate', connectionKey, publicNames: [publicName] }, { agent });
  assert.equal((await tool.execute({ ...preview.detail.nextStep.arguments, confirmed: true }, { agent })).ok, true);
  const stale = await tool.execute({ action: 'deactivate', connectionKey, expectedRevision: 0 }, { agent });
  assert.equal(stale.ok, false);
  assert.equal(stale.detail.nextStep, undefined);
  assert.match(stale.detail.guidance, /deactivate.*status/);
  const status = await tool.execute({ action: 'status' }, { agent });
  assert.equal(status.detail.active.length, 1);
  const result = await tool.execute({ action: 'deactivate', connectionKey, expectedRevision: status.detail.revision }, { agent });
  assert.equal(result.ok, true);
  assert.deepEqual(result.detail.active, []);
});

for (const [args, value] of [
  [{ action: 'search', query: 'forecast' }, { ok: true, message: 'Candidates', detail: { items: [{ connectionKey, serverName: 'weather', name: 'forecast', publicName }] } }],
  [{ action: 'preview-activate' }, { ok: true, message: 'Preview', detail: { baseRevision: 7, connectionKey, publicNames: [publicName], ttlMinutes: 5, nextInferenceBoundary: true } }],
  [{ action: 'activate' }, { ok: false, message: 'Stale revision' }],
]) {
  test('#212 ' + args.action + ' guidance remains English for an English registration', async (t) => {
    const tool = captureSessionTool(t, async () => value, { t: createTranslator('en', { en }) });
    const result = await tool.execute(args);
    const text = renderedText(tool, args, result);
    assert.doesNotMatch(text, /[\u3400-\u9fff]/);
    assert.ok(text.length > value.message.length);
    if (args.action === 'preview-activate') assert.match(result.detail.nextStep.instruction, /confirm|authoriz/i);
  });
}
