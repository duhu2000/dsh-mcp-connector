import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { packageTarExecutable } from '../scripts/fixtures/package-tar.mjs';

test('Windows archive tool ignores a GNU tar directory at the front of PATH', () => {
  assert.equal(packageTarExecutable({ platform: 'win32', env: {
    SystemRoot: 'C:\\Windows', PATH: 'C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\System32',
  } }), 'C:\\Windows\\System32\\tar.exe');
});

test('Windows environment variable names are matched without case sensitivity', () => {
  assert.equal(packageTarExecutable({ platform: 'win32', env: { sYsTeMrOoT: 'D:\\Windows System\\' } }),
    'D:\\Windows System\\System32\\tar.exe');
});

test('Windows archive tool accepts WINDIR when SystemRoot is absent', () => {
  assert.equal(packageTarExecutable({ platform: 'win32', env: { WINDIR: 'C:\\Windows' } }),
    'C:\\Windows\\System32\\tar.exe');
});

test('missing or relative Windows system roots never fall back to PATH', () => {
  for (const env of [{ PATH: 'C:\\Program Files\\Git\\usr\\bin' }, ...['Windows', '\\Windows', 'C:Windows', '\\\\server\\Windows', ''].map(SystemRoot => ({ SystemRoot }))]) {
    assert.throws(() => packageTarExecutable({ platform: 'win32', env }), /absolute SystemRoot or WINDIR/);
  }
});

test('non-Windows archive tool keeps the existing tar lookup', () => {
  for (const platform of ['linux', 'darwin']) assert.equal(packageTarExecutable({ platform, env: {} }), 'tar');
});

test('local archives with spaces and Windows drive colons survive PATH shadowing', async (t) => {
  const parent = resolve(tmpdir()), root = await fs.mkdtemp(join(parent, 'qmcp-4963-tar spaces-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), parent);
    assert.ok(basename(root).startsWith('qmcp-4963-tar spaces-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(join(root, 'package'));
  const metadata = JSON.stringify({ name: 'synthetic-package', version: '0.0.0' });
  await fs.writeFile(join(root, 'package', 'package.json'), metadata);
  const archive = join(root, 'local package.tgz'), tar = packageTarExecutable();
  execFileSync(tar, ['-czf', archive, '-C', root, 'package/package.json']);
  const localPath = process.platform === 'win32' ? archive.replaceAll('\\', '/') : archive;
  const env = { ...process.env };
  if (process.platform === 'win32') {
    const shadow = join(root, 'shadow'); await fs.mkdir(shadow);
    // An executable that rejects tar flags makes accidental PATH lookup fail.
    await fs.copyFile(process.execPath, join(shadow, 'tar.exe'));
    env.PATH = shadow + delimiter + env.PATH;
    const wrong = spawnSync('tar.exe', ['-xOf', localPath, 'package/package.json'], { env, encoding: 'utf8' });
    assert.notEqual(wrong.status, 0, 'the shadow must reject archive extraction');
    assert.match(wrong.stderr ?? '', /bad option|unknown option/i, 'the shadow Node executable must actually run');
  }
  assert.equal(execFileSync(tar, ['-xOf', localPath, 'package/package.json'], { env, encoding: 'utf8' }), metadata);
});
