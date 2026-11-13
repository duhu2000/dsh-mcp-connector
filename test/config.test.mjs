import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';

import { DEFAULT_CATALOG_FALLBACK_URLS, DEFAULT_CATALOG_URL, DEFAULT_STARTUP_TIMEOUT_MS } from '../lib/constants.js';
import { Config } from '../lib/index.js';

function fieldValue(field) {
  return typeof field?.get === 'function' ? field.get() : field;
}

test('default config uses the independent public registry', () => {
  assert.equal(
    DEFAULT_CATALOG_URL,
    'https://cdn.jsdelivr.net/gh/duhu2000/dsh-mcp-connector-registry@main/catalog.json',
  );
  assert.deepEqual(DEFAULT_CATALOG_FALLBACK_URLS, [
    'https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog.json',
  ]);
  assert.equal(Config({}).catalogUrl, DEFAULT_CATALOG_URL);
  assert.equal(Config({}).startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
  assert.equal(fieldValue(Config({}).showSidebarEntry), true);
});

test('an explicit empty catalogUrl keeps bundled-only mode available', () => {
  assert.equal(Config({ catalogUrl: '' }).catalogUrl, '');
});

test('an explicit custom catalogUrl remains unchanged', () => {
  const customUrl = 'https://registry.example.com/catalog.json';
  assert.equal(Config({ catalogUrl: customUrl }).catalogUrl, customUrl);
});

test('bundle patch uses the same jsDelivr primary catalog source', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, new RegExp(DEFAULT_CATALOG_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(patch, /catalogUrl:\s*['"]https:\/\/raw\.githubusercontent\.com/);
  assert.match(patch, /showSidebarEntry:\s*true/);
});

test('client bundle is self-contained across Host store/runtime module layouts', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

  assert.doesNotMatch(clientSource, /require\("@deepseek-ai\/dsh-client-(?:store|runtime|ui-primitives)/);
  assert.equal(packageJson.dsh.client.external, undefined);
  assert.ok(!packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'));
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-client-store'], undefined);
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'], undefined);
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.equal(packageJson.peerDependencies.zod, undefined);
  assert.equal(packageJson.dependencies.zod, '^4.1.8');
  assert.equal(packageJson.devDependencies.zod, undefined);
  assert.equal(
    packageJson.peerDependencies['@deepseek-ai/dsh-mcp-client'],
    '^0.1.1-rc.2 || >=0.2.0-rc.1 <0.3.0-0',
  );
});

test('entryLocation is declared in the Host Config contract and validates its values', () => {
  // 维护者第 3 点：Config 不声明该字段时，schemastery 会保留未知键，
  // 非法值能一路传到归一化逻辑里被静默改写成默认档位。
  for (const location of ['both', 'sidebar', 'settings']) {
    assert.equal(fieldValue(Config({ entryLocation: location }).entryLocation), location);
  }
  assert.throws(() => Config({ entryLocation: 'not-a-location' }), /entryLocation/);
});

test('omitting entryLocation leaves it undefined so legacy config is not overwritten', () => {
  // 关键：Config 不能给 entryLocation 默认值。一旦有默认，该值会提前注入
  // settings base，把「用户旧的 showSidebarEntry 覆盖」盖掉。
  assert.equal(fieldValue(Config({}).entryLocation), undefined);
  assert.equal(fieldValue(Config({ showSidebarEntry: false }).entryLocation), undefined);
});

test('config forms can edit only the two entry preference fields', {
  skip: typeof z.boolean().volatile !== 'function',
}, () => {
  assert.deepEqual(Object.keys(Config.dict).filter(key => Config.dict[key].meta.volatile).sort(), [
    'entryLocation', 'showSidebarEntry',
  ]);
});

test('the shipped bundle patch does not pin entryLocation', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  // 省略是刻意的：由 installConnectorSettings() 按旧布尔推导 base。
  assert.doesNotMatch(patch, /entryLocation:/);
});
