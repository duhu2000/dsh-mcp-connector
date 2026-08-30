import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_CATALOG_FALLBACK_URLS, DEFAULT_CATALOG_URL, DEFAULT_STARTUP_TIMEOUT_MS } from '../lib/constants.js';
import { Config } from '../lib/index.js';

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
});

test('client bundle declares its exact dynamic runtime external', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const runtimeSpecifier = '@deepseek-ai/dsh-client-runtime/client';

  assert.match(clientSource, new RegExp(`require\\(\"${runtimeSpecifier}\"\\)`));
  assert.deepEqual(packageJson.dsh.client.external, [runtimeSpecifier]);
});
