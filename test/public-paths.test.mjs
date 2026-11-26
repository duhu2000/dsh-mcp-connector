import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-public-paths.mjs', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'public-paths-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  const check = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  function add(path, content = 'Synthetic fixture\n') {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
    git('add', '--', path);
  }
  git('init', '-q');
  add('package.json', JSON.stringify({ files: [] }));
  git('commit', '-qm', 'Initial fixture');
  return { git, add, check };
}

test('check the index from any branch and identify the blocked path', t => {
  const { add, check } = fixture(t);
  add('docs/architecture/public-integration.md');
  add('docs/private-cloud-integration.md');
  assert.equal(check('--staged').status, 0);
  add('docs/reviews/example.md');
  const result = check();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('docs/reviews/example.md'));
});

test('a draft removed in a later commit is still in the outgoing history', t => {
  const { git, add, check } = fixture(t);
  const base = git('rev-parse', 'HEAD');
  const path = 'docs/architecture/example-DRAFT.md';
  add(path);
  git('commit', '-qm', 'Add synthetic fixture');
  const bad = git('rev-parse', 'HEAD');
  git('rm', '--', path);
  assert.equal(check().status, 0);
  git('commit', '-qm', 'Remove fixture');
  assert.equal(check('--range', bad, 'HEAD').status, 0);
  const result = check('--range', base, 'HEAD');
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(path));
  assert.ok(result.stderr.includes(bad));
});

test('a new file introduced by a merge resolution is checked', t => {
  const { git, add, check } = fixture(t);
  const main = git('branch', '--show-current');
  git('switch', '-qc', 'topic');
  add('docs/integration.md');
  git('commit', '-qm', 'Public guide');
  git('switch', '-q', main);
  git('merge', '-q', '--no-ff', '--no-commit', 'topic');
  add('docs/内部排期.md');
  git('commit', '-qm', 'Merge topic with extra fixture');
  assert.equal(check('--range', 'HEAD^1', 'HEAD').status, 1);
});

test('distribution screenshots must be explicitly listed in the staged or committed manifest', t => {
  const { git, add, check } = fixture(t);
  const path = 'docs/screenshots/public-example.png';
  add(path);
  assert.equal(check().status, 1);
  add('package.json', JSON.stringify({ files: [path] }));
  assert.equal(check().status, 0);
  git('commit', '-qm', 'List reviewed image');
  assert.equal(check('--range', 'HEAD^', 'HEAD').status, 0);
});
