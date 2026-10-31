// #181: real packed-package installation, not a Desktop GUI acceptance test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = mkdtempSync(path.join(tmpdir(), 'connector-fresh-install-'));
const env = { ...process.env };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
function run(bin, args, cwd) {
  // Windows package-manager launchers are .cmd files; arguments below are fixed
  // or generated local paths, never third-party commands.
  return execFileSync(process.platform === 'win32' ? `${bin}.cmd` : bin,
    process.platform === 'win32' ? args.map(arg => `"${arg}"`) : args,
    { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
}
const packs = path.join(root, 'packs');
mkdirSync(packs);
const candidate = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packs], process.cwd()))[0];
const baseline = JSON.parse(run('npm', ['pack', 'dsh-mcp-connector@0.2.79', '--ignore-scripts', '--json', '--pack-destination', packs], root))[0];
for (const [label, packed, fixed] of [['baseline', baseline, false], ['candidate', candidate, true]]) {
  const profiles = path.join(root, label, 'profiles');
  const staging = path.join(profiles, '.generations', 'staging');
  const live = path.join(profiles, '.generations', 'live');
  mkdirSync(staging, { recursive: true });
  writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(path.join(staging, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  run('pnpm', ['add', '--ignore-scripts', '--save-exact', path.join(packs, packed.filename)], staging);
  assert.equal(existsSync(path.join(profiles, 'node_modules')), false, 'no shared installation closure');
  renameSync(staging, live);
  const plugin = path.join(live, 'node_modules', 'dsh-mcp-connector');
  const requirePlugin = createRequire(path.join(plugin, 'package.json'));
  if (!fixed) {
    assert.throws(() => requirePlugin.resolve('zod'), { code: 'MODULE_NOT_FOUND' });
    console.log('BASELINE 0.2.79: no generation-owned zod (reproduced missing dependency)');
    continue;
  }
  const resolved = realpathSync(requirePlugin.resolve('zod'));
  const relative = path.relative(realpathSync(live), resolved);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'zod realpath must stay in promoted generation');
  assert.equal(requirePlugin('./package.json').peerDependencies?.zod, undefined);
  const { z } = requirePlugin('zod');
  assert.deepEqual(z.record(z.string(), z.unknown()).parse({ ok: true }), { ok: true });
  // Import actual installed consumers, not only a hand-written Zod probe.
  for (const file of ['schema.js', 'local-overrides.js']) {
    await import(pathToFileURL(path.join(plugin, 'lib', file)).href);
  }
  console.log(`PASS ${label}: promoted generation owns zod; actual schema consumers import successfully`);
}
console.log(`Isolated evidence retained at ${root}; no user DSH profile was modified.`);
