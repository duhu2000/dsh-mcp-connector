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

test('a packable untracked source fails and an unlisted tracked screenshot is excluded', async t => {
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
    scripts: { verify: 'node verify.mjs' },
  }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  const npm = (...args) => spawn.sync('npm', args, { cwd: root, encoding: 'utf8' });
  let result = npm('run', 'verify');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const packed = npm('pack', '--dry-run', '--json', '--ignore-scripts');
  assert.equal(packed.status, 0, packed.stderr);
  const listing = Object.values(JSON.parse(packed.stdout))[0].files;
  assert.ok(!listing.some(file => file.path.endsWith('/private-review.png')));
  await write('lib/private-review.js', '// synthetic draft\n');
  result = npm('run', 'verify');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Untracked package file: lib\/private-review\.js/);
});
