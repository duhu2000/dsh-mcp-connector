import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCurrentReferences, referencedVersions } from '../scripts/check-readme-version.mjs';

const current = '[`dsh-mcp-connector@0.2.27`](https://www.npmjs.com/package/dsh-mcp-connector) and [Release v0.2.27](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.27)';

test('README version guard accepts matching npm and release references', () => {
  assert.doesNotThrow(() => assertCurrentReferences('README.md', current, '0.2.27'));
});

test('README version guard rejects stale references', () => {
  assert.throws(
    () => assertCurrentReferences('README.md', current, '0.2.28'),
    /references 0\.2\.27, expected 0\.2\.28/,
  );
});

test('README version guard requires both reference types', () => {
  assert.throws(
    () => assertCurrentReferences('README.md', 'dsh-mcp-connector@0.2.27', '0.2.27'),
    /missing GitHub Release/,
  );
});

test('referencedVersions returns every captured semantic version', () => {
  assert.deepEqual(
    referencedVersions('v0.2.27 and v0.2.28', /v(\d+\.\d+\.\d+)/g),
    ['0.2.27', '0.2.28'],
  );
});
