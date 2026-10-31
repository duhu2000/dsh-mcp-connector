import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../lib/i18n/index.js';
import { EN_DICTIONARY } from '../lib/i18n/locales/en.js';
import { normalizeScopeTarget } from '../lib/connection-scopes.js';
import { readHostToolNames } from '../lib/host-tool-names.js';
import { createShareableTemplateFromConnection } from '../lib/shareable-connection-template.js';
import { readFile } from 'node:fs/promises';
const en = createTranslator('en', { en: EN_DICTIONARY });
test('new scope and Host adapter failures are localized without changing machine fields', () => {
  assert.deepEqual(normalizeScopeTarget({ scope: 'project', workspaceIds: ['b', 'a'] }, { t: en }), { scope: 'project', workspaceIds: ['a', 'b'] });
  assert.throws(() => normalizeScopeTarget({ scope: 'project', workspaceIds: [] }, { t: en }), /valid Workspace IDs/);
  assert.throws(() => readHostToolNames({}, { t: en }), /This Host cannot/);
});
test('template validation locale is per-call and does not leak into Chinese callers', () => {
  assert.throws(() => createShareableTemplateFromConnection(null, { t: en }), /Select one connection/);
  assert.throws(() => createShareableTemplateFromConnection(null), /请明确选择一条连接/);
});
test('Host startup does not infer English from shell environment alone', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  assert.match(source, /resolveLocale\(config.locale, \{ hostLocale, env: \{\} \}\)/);
});
