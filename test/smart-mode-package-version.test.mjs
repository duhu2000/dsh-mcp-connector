import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartModeQaVersion } from '../scripts/fixtures/smart-mode-package-version.mjs';
import { compareVersions } from '../lib/version-status.js';
import { readFileSync } from 'node:fs';
const commit = '28e1349d401343adeb82609db9c3d1d538c46f3f';

test('integrated QA version supersedes the current release and the sealed 7dfebc6 candidate', () => {
  const base = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const version = smartModeQaVersion(base, { buildNumber: 100, commit });
  assert.ok(compareVersions(version, base) > 0);
  assert.ok(compareVersions(version, '0.2.110-pr.243.qa.1794823352415+g7dfebc6') > 0);
});
test('QA build supersedes the previously delivered SHA-ordered packages', () => {
  const version = smartModeQaVersion('0.2.109', { buildNumber: 100, commit });
  for (const previous of ['0.2.109', '0.2.110-pr.243.ce02515', '0.2.110-pr.243.fc40a52', '0.2.110-pr.243.28e1349']) {
    assert.ok(compareVersions(version, previous) > 0, `${version} must supersede ${previous}`);
  }
});
test('QA ordering follows the build number even when Git SHA order goes backward', () => {
  const a = smartModeQaVersion('0.2.109', { buildNumber: 100, commit: 'f'.repeat(40) });
  const b = smartModeQaVersion('0.2.109', { buildNumber: 101, commit });
  assert.ok(compareVersions(b, a) > 0);
  const sameBuild = smartModeQaVersion('0.2.109', { buildNumber: 101, commit: 'f'.repeat(40) });
  assert.equal(compareVersions(b, sameBuild), 0, 'build metadata identifies source without changing precedence');
});
test('QA version refuses missing, invalid or ambiguous build inputs', () => {
  for (const args of [undefined, { buildNumber: 0, commit }, { buildNumber: 1.5, commit }, { buildNumber: 1, commit: '../file' }, { buildNumber: 1, commit, pullRequest: -1 }]) {
    assert.throws(() => smartModeQaVersion('0.2.109', args));
  }
  assert.throws(() => smartModeQaVersion('0.2.109-pr.1', { buildNumber: 1, commit }));
  assert.match(smartModeQaVersion('0.2.109', { buildNumber: 1, commit, pullRequest: 246 }), /^0\.2\.110-pr\.246\.qa\.1\+g/);
});
