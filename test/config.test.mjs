import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CATALOG_URL } from '../lib/constants.js';
import { Config } from '../lib/index.js';

test('default config uses the independent public registry', () => {
  assert.equal(
    DEFAULT_CATALOG_URL,
    'https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog.json',
  );
  assert.equal(Config({}).catalogUrl, DEFAULT_CATALOG_URL);
});

test('an explicit empty catalogUrl keeps bundled-only mode available', () => {
  assert.equal(Config({ catalogUrl: '' }).catalogUrl, '');
});
