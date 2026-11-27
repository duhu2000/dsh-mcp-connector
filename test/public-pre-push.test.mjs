import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../scripts/install-public-pre-push.mjs', import.meta.url));

function fixture(t, { installHook = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-public-pre-push-'));
  const cwd = join(root, 'local checkout');
  const remote = join(root, 'synthetic remote.git');
  mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  const run = (command, args) => spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  function ok(result) {
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  }
  const git = (...args) => ok(run('git', args));
  const install = (...args) => run(process.execPath, [installer, ...args]);
  function add(path, body = 'Synthetic example\n') {
    const dest = join(cwd, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    git('add', '--', path);
  }
  git('init', '-q', '--initial-branch=main');
  git('init', '-q', '--bare', '--initial-branch=main', remote);
  git('config', 'user.name', 'Synthetic Test');
  git('config', 'user.email', 'test@example.invalid');
  git('remote', 'add', 'origin', remote);
  add('package.json', '{"files":[]}\n');
  add('docs/guide.md');
  add('lib/example.js', 'export const version = 1;\n');
  git('commit', '-qm', 'Public baseline');
  git('push', '-u', 'origin', 'main');
  if (installHook) ok(install());
  git('switch', '-qc', 'topic');

  const push = (...refspecs) => run('git', ['push', 'origin', ...refspecs]);
  const remoteRefs = () => git('ls-remote', '--refs', 'origin');
  const remoteHas = ref => remoteRefs().split('\n').some(line => line.endsWith('\t' + ref));
  return { cwd, add, git, ok, install, push, remoteHas, remoteRefs };
}

test('push of a normal fix and an existing public guide succeeds', t => {
  const { add, git, ok, push, remoteHas } = fixture(t);
  add('lib/example.js', 'export const version = 2;\n');
  add('docs/guide.md', 'The synthetic feature is available.\n');
  git('commit', '-qm', 'Fix synthetic feature');
  ok(push('HEAD:refs/heads/topic'));
  assert.equal(remoteHas('refs/heads/topic'), true);
});

test('a document outside docs is rejected even when the worktree checker is changed', t => {
  const { add, git, push, remoteHas } = fixture(t);
  add('new-area/nested/summary.md', 'Synthetic mock schedule\n');
  add('scripts/check-public-paths.mjs', 'console.log("Synthetic replacement");\n');
  git('commit', '-qm', 'Add a synthetic document');
  const result = push('HEAD:refs/heads/topic');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new-area\/nested\/summary\.md.*unregistered public document/);
  assert.equal(remoteHas('refs/heads/topic'), false);
});

test('an unregistered document removed in a later commit still blocks a branch update', t => {
  const { add, git, ok, push, remoteRefs } = fixture(t);
  ok(push('HEAD:refs/heads/topic'));
  const before = remoteRefs();
  add('new-area/journal.txt');
  git('commit', '-qm', 'Add a synthetic-only note');
  const firstCommit = git('rev-parse', 'HEAD');
  git('rm', '--', 'new-area/journal.txt');
  git('commit', '-qm', 'Remove the note again');
  const result = push('HEAD:refs/heads/topic');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new-area\/journal\.txt.*unregistered public document/);
  assert.ok(result.stderr.includes(firstCommit));
  assert.equal(remoteRefs(), before);
});

test('explicit registration is exact and preserves the existing private-path rules', t => {
  const { add, git, ok, push, remoteHas } = fixture(t);
  git('config', '--local', '--add', 'dshPublic.documentPath', 'docs/new guide.md');
  git('config', '--local', '--add', 'dshPublic.documentPath', 'work/private.md');
  add('docs/new guide.md');
  git('commit', '-qm', 'Add a reviewed synthetic guide');
  ok(push('HEAD:refs/heads/topic'));
  add('docs/other guide.md');
  add('work/private.md');
  git('commit', '-qm', 'Add two synthetic-only notes');
  const result = push('HEAD:refs/tags/synthetic');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docs\/other guide\.md.*unregistered public document/);
  assert.match(result.stderr, /work\/private\.md.*reserved for private working materials/);
  assert.equal(remoteHas('refs/tags/synthetic'), false);
});

test('installation preserves an unrelated pre-push hook', t => {
  const { cwd, git, install } = fixture(t, { installHook: false });
  const hook = join(cwd, git('rev-parse', '--git-path', 'hooks'), 'pre-push');
  const custom = '#!/bin/sh\nexit 0\n';
  writeFileSync(hook, custom);
  const result = install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing hook preserved/);
  assert.equal(readFileSync(hook, 'utf8'), custom);
});
