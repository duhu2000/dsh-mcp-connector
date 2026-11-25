import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import spawn from 'cross-spawn';
import { checkRepositoryLinks } from '../scripts/check-repository-links.mjs';

test('repository links require tracked targets and valid Markdown fragments', async () => {
  const docs = {
    'README.md': '[guide][g]\n\n[g]: docs/指南.md#使用步骤\n\n<img src="docs/example.png">',
    'docs/指南.md': '## 使用步骤\n\n[missing](../removed.md) [wrong](#old) [folder](../docs/)',
  };
  const failures = await checkRepositoryLinks([...Object.keys(docs), 'docs/example.png'], path => docs[path]);
  assert.deepEqual(failures, [
    'docs/指南.md -> ../removed.md (missing tracked target)',
    'docs/指南.md -> #old (missing anchor)',
  ]);
});

async function packFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'connector-release-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', project)));
  const write = async (path, data) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
  };
  const tutorials = await readdir(new URL('docs/tutorials/', project));
  for (const file of pkg.files.filter(p => p.startsWith('docs/') && !p.endsWith('/tutorials'))) await write(file, 'fixture');
  for (const file of tutorials.filter(p => p.endsWith('.md'))) await write('docs/tutorials/' + file, 'fixture');
  await write('install.sh', 'PKG="dsh-mcp-connector"\n');
  await write('docs/screenshots/private-review.png', 'synthetic image');
  await write('verify.mjs', 'import ' + JSON.stringify(new URL('scripts/verify-pack.mjs', project).href) + ';\n');
  await write('package.json', JSON.stringify({
    name: 'release-guard-fixture', version: '1.0.0', files: pkg.files,
    scripts: { check: 'node verify.mjs', prepublishOnly: pkg.scripts.prepublishOnly },
  }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { cwd: root });
  git('init', '-q');
  await write('lib/example.js', '// committed fixture\n');
  git('add', '.');
  git('commit', '-qm', 'Commit fixture');
  const npm = (...args) => spawn.sync('npm', args, { cwd: root, encoding: 'utf8' });
  return { git, npm, write };
}

test('a packable untracked source fails and an unlisted tracked screenshot is excluded', async t => {
  const { npm, write } = await packFixture(t);
  let result = npm('run', 'check');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const packed = npm('pack', '--dry-run', '--json', '--ignore-scripts');
  assert.equal(packed.status, 0, packed.stderr);
  const listing = Object.values(JSON.parse(packed.stdout))[0].files;
  assert.ok(!listing.some(file => file.path.endsWith('/private-review.png')));
  await write('lib/private-review.js', '// synthetic draft\n');
  result = npm('run', 'check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Untracked package file: lib\/private-review\.js/);
});

test('directory publish rejects uncommitted package content', async t => {
  const { git, npm, write } = await packFixture(t);
  const publish = () => npm('publish', '--dry-run', '--offline', '--foreground-scripts', '--registry=http://127.0.0.1:9');
  const clean = publish();
  assert.equal(clean.status, 0, clean.stderr || clean.error?.message);

  function expectBlocked(diagnostic) {
    const result = publish();
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, output);
    assert.ok(output.includes(diagnostic), output);
  }

  await write('lib/example.js', '// unstaged change\n');
  expectBlocked('M\tlib/example.js');
  git('add', 'lib/example.js');
  expectBlocked('M\tlib/example.js');
  git('commit', '-qm', 'Commit updated fixture');

  await write('lib/new.js', '// new package file\n');
  expectBlocked('Untracked package file: lib/new.js');
  git('add', 'lib/new.js');
  expectBlocked('A\tlib/new.js');
  git('commit', '-qm', 'Commit new fixture file');
  git('rm', '-q', 'lib/new.js');
  expectBlocked('D\tlib/new.js');
});
