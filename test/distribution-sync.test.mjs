import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_TARGETS,
  assessTarget,
  parseAwesome,
  parseDshbasePage,
  parseDshfind,
  parseJsonLdPage,
  reportMarkdown,
} from '../scripts/check-distribution-sync.mjs';

const target = { id: 'directory', label: 'Directory', url: 'https://example.test/plugin' };

test('runs the external directory check after a successful Release workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/distribution-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:\s*\n\s+workflows: \['Release'\]\s*\n\s+types: \[completed\]/);
  assert.match(workflow, /if: github\.event_name != 'workflow_run' \|\| github\.event\.workflow_run\.conclusion == 'success'/);
});

test('does not expose a closed PR as the awesome directory follow-up', () => {
  const awesome = DEFAULT_TARGETS.find((candidate) => candidate.id === 'awesome-dsh-plugin');
  assert.ok(awesome);
  assert.equal(awesome.trackingUrl, undefined);
});

test('parses the connector from awesome-dsh-plugin registry JSON', () => {
  assert.deepEqual(parseAwesome({
    updated: '2026-09-11',
    plugins: [{
      name: 'dsh-mcp-connector',
      url: 'https://github.com/duhu2000/dsh-mcp-connector',
      npm: 'dsh-mcp-connector',
      version: '0.2.41',
    }],
  }), {
    observedVersion: '0.2.41',
    npmPublished: true,
    detail: 'catalog updated 2026-09-11',
  });
});

test('parses dshfind install metadata', () => {
  assert.deepEqual(parseDshfind({
    install: { pkg_name: 'dsh-mcp-connector', pkg_version: '0.2.41', npm_published: true },
    last_synced_at: '2026-09-11T01:51:35Z',
  }), {
    observedVersion: '0.2.41',
    npmPublished: true,
    detail: 'last synced 2026-09-11T01:51:35Z',
  });
});

test('parses structured public directory pages', () => {
  const html = '<script type="application/ld+json">{"identifier":"dsh-mcp-connector","codeRepository":"https://github.com/duhu2000/dsh-mcp-connector","version":"0.2.41"}</script><a href="https://www.npmjs.com/package/dsh-mcp-connector">npm</a>';
  assert.deepEqual(parseJsonLdPage(html), {
    observedVersion: '0.2.41',
    npmPublished: true,
    detail: 'public plugin page',
  });
});

test('detects stale dshbase version and false npm claim', () => {
  const parsed = parseDshbasePage('<a href="https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.37">release</a><a href="https://www.npmjs.com/package/dsh-mcp-connector">npm</a><p>not published to npm</p>');
  assert.deepEqual(parsed, {
    observedVersion: '0.2.37',
    npmPublished: false,
    detail: 'page incorrectly says the package is not published to npm',
  });
});

test('classifies current, stale, invalid, missing, and unavailable targets', () => {
  assert.equal(assessTarget({ target, canonicalVersion: '0.2.41', parsed: { observedVersion: '0.2.41', npmPublished: true } }).status, 'current');
  assert.equal(assessTarget({ target, canonicalVersion: '0.2.41', parsed: { observedVersion: '0.2.39', npmPublished: true } }).status, 'stale');
  assert.equal(assessTarget({ target, canonicalVersion: '0.2.41', parsed: { observedVersion: '0.2.41', npmPublished: false } }).status, 'invalid');
  assert.equal(assessTarget({ target, canonicalVersion: '0.2.41', parsed: { observedVersion: null } }).status, 'missing');
  assert.equal(assessTarget({ target, canonicalVersion: '0.2.41', error: new Error('timeout') }).status, 'unavailable');
});

test('renders a compact GitHub step summary', () => {
  const markdown = reportMarkdown({
    canonicalVersion: '0.2.41',
    checkedAt: '2026-09-11T00:00:00Z',
    targets: [{ ...target, status: 'stale', expectedVersion: '0.2.41', observedVersion: '0.2.39', detail: 'catalog | stale' }],
  });
  assert.match(markdown, /Canonical npm version: `0\.2\.41`/);
  assert.match(markdown, /catalog \\| stale/);
});
