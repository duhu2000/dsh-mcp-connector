import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLegacyConflicts, legacyClientOwnsEntry } from '../lib/legacy-plugin-conflict.js';
import { createTranslator, DEFAULT_LOCALE } from '../lib/i18n/index.js';

const t = createTranslator(DEFAULT_LOCALE);
const clientName = '@deepseek-ai/dsh-mcp-client';

function entry(id, name, config = {}, disabled = false) {
  return { id, disabled, options: { id: id.split(':').at(-1), name, config } };
}

function conflicts(entries, ...names) {
  return detectLegacyConflicts({ *entries() { yield* entries; } }, names.map(serverName => ({ serverName })), t);
}

test('旧包在多个 include 树中的启用实例与实际授权资源分别识别', () => {
  const entries = [
    entry('first:qcc-mcp-oauth', 'qcc-dsh-mcp-oauth', {}, true),
    entry('work:qcc-mcp-oauth', 'qcc-dsh-mcp-oauth'),
    entry('work:qcc-legal-mcp-oauth', 'qcc-dsh-mcp-legal-oauth'),
    entry('mcp-qcc-company', clientName, { serverName: 'company' }),
    entry('mcp-qcc-legal-case', clientName, { serverName: 'legal-case' }),
  ];
  const result = conflicts(entries, 'qcc-company', 'qcc-case', 'other');
  assert.deepEqual(result.map(({ kind, pluginId, pluginEntryIds, entryIds, serverNames }) =>
    ({ kind, pluginId, pluginEntryIds, entryIds, serverNames })), [
    { kind: 'plugin', pluginId: 'qcc-mcp-oauth', pluginEntryIds: ['work:qcc-mcp-oauth'], entryIds: ['mcp-qcc-company'], serverNames: ['qcc-company'] },
    { kind: 'plugin', pluginId: 'qcc-legal-mcp-oauth', pluginEntryIds: ['work:qcc-legal-mcp-oauth'], entryIds: ['mcp-qcc-legal-case'], serverNames: ['qcc-case'] },
  ]);
});

test('法律残留与新客户条目 ID 相同，通过 serverName 和包名区分归属', () => {
  const id = 'mcp-qcc-legal-regulation';
  const legacy = entry(id, clientName, { serverName: 'legal-regulation' });
  const restored = entry(id, clientName, { serverName: 'qcc-regulation' });
  for (const other of [restored, entry(id, 'other-plugin', { serverName: 'legal-regulation' })]) {
    assert.deepEqual(conflicts([other], 'qcc-regulation'), []);
    assert.equal(legacyClientOwnsEntry({ resolve: () => other }, id, 'qcc-regulation'), false);
  }
  assert.equal(legacyClientOwnsEntry({ resolve: () => legacy }, id, 'qcc-regulation'), true);
  const [match] = conflicts([legacy], 'qcc-case', 'qcc-regulation');
  assert.equal(match.kind, 'residual');
  assert.deepEqual(match.entryIds, [id]);
  assert.deepEqual(match.serverNames, ['qcc-regulation']);
  assert.match(match.message, /mcp-qcc-legal-regulation/);
});

test('仅报启用的对应服务残留，可识别旧插件设置的条目前缀和完整路径', () => {
  const entries = [
    entry('bundle:company-auth', 'qcc-dsh-mcp-oauth', { mcpEntryPrefix: 'company-mcp' }, true),
    entry('tree:company-mcp-risk', clientName, { serverName: 'risk' }),
    entry('tree:company-mcp-company', clientName, { serverName: 'company' }, true),
    entry('another-plugin', clientName, { serverName: 'risk' }),
  ];
  const result = conflicts(entries, 'qcc-company', 'qcc-risk', 'qcc-ipr');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'residual');
  assert.deepEqual(result[0].entryIds, ['tree:company-mcp-risk']);
});

test('仅提供 resolve 的旧宿主可识别法律服务', () => {
  const id = 'mcp-qcc-legal-case';
  const loader = { resolve(key) {
    if (id === key) return entry(key, clientName, { serverName: 'legal-case' });
    throw Error('cannot resolve entry');
  } };
  const [match] = detectLegacyConflicts(loader, [{ serverName: 'qcc-case' }], t);
  assert.equal(match.kind, 'residual');
  assert.deepEqual(match.entryIds, [id]);
});
