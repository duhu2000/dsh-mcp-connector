/** Actual DSH CLI package changes and separate OS processes. Offline business/model fixtures only. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { smartModeQaVersion } from './fixtures/smart-mode-package-version.mjs';
import { packageTarExecutable } from './fixtures/package-tar.mjs';
import { compareVersions } from '../lib/version-status.js';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const anchor = process.env.DSH_HOST_INTEGRATION_ANCHOR;
if (!anchor) throw new Error('Explicit DSH_HOST_INTEGRATION_ANCHOR required; no default profile is read');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 24 || (nodeMajor === 24 && nodeMinor < 9)) throw new Error('DSH installer/module resolution requires Node >=24.9');
const require = createRequire(createRequire(resolve(anchor)).resolve('@deepseek-ai/dsh-agent-loop'));
const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.2-rc.1');
let npmCli;
for (const candidate of [process.env.npm_execpath,
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
  if (candidate && await fs.access(candidate).then(() => true, () => false)) { npmCli = candidate; break; }
}
if (!npmCli) throw new Error('Cannot find the installation-owned npm CLI; set npm_execpath explicitly');
const tar = packageTarExecutable();
const root = await fs.mkdtemp(join(tmpdir(), 'qmcp-4963-package-'));
await fs.writeFile(join(root, 'validation-home.json'), JSON.stringify({ task: 'QMCP-4963', syntheticOnly: true }));
const artifact = process.env.DSH_SMART_PACKAGE_EVIDENCE_DIR
  ? resolve(process.env.DSH_SMART_PACKAGE_EVIDENCE_DIR) : await fs.mkdtemp(join(tmpdir(), 'qmcp-4963-package-evidence-'));
await fs.mkdir(artifact, { recursive: true });
console.log(`PACKAGE_QA_EVIDENCE=${artifact}`);
console.log(`PACKAGE_QA_TAR=${tar}`);
const env = { ...process.env, DSH_HOME: root, CI: '1', NPM_CONFIG_USERCONFIG: join(root, '.npmrc') };
delete env.NODE_PATH; delete env.NODE_OPTIONS;
await fs.writeFile(join(root, '.npmrc'), 'registry=https://registry.npmjs.org/\nignore-scripts=true\n');
const results = [];
let ordinal = 0, error;
async function run(args, label, { cwd = source, allowedFailure = false } = {}) {
  console.log(`PACKAGE_QA_START=${label}`);
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = '';
  child.stdout.on('data', (value) => { output += value; });
  child.stderr.on('data', (value) => { stderr += value; });
  const timer = setTimeout(() => child.kill(), 180000); timer.unref();
  let code;
  try { code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); }); }
  finally { clearTimeout(timer); }
  await fs.writeFile(join(artifact, `${String(++ordinal).padStart(2, '0')}-${label}.log`), output + stderr);
  results.push({ label, pid: child.pid, exitCode: code, expectedFailure: allowedFailure });
  if (allowedFailure ? !Number.isInteger(code) || code === 0 : code !== 0) throw new Error(`${label} failed: ${(output + stderr).slice(-3000)}`);
  console.log(`PACKAGE_QA_PASS=${label}`); return output;
}
const packEntry = (value) => Array.isArray(value) ? value[0] : Object.values(value)[0];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHash = async (path) => sha(await fs.readFile(path));
let inputs;
try {
  const packs = join(root, 'packs'); await fs.mkdir(packs);
  let candidate = process.env.DSH_SMART_PACKAGE_CANDIDATE;
  if (!candidate) {
    const dry = packEntry(JSON.parse(await run([npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json'], 'candidate-file-list')));
    const stage = join(root, 'candidate'); await fs.mkdir(stage);
    for (const file of dry.files) {
      const target = join(stage, file.path); await fs.mkdir(dirname(target), { recursive: true });
      await fs.copyFile(join(source, file.path), target);
    }
    const metadata = JSON.parse(await fs.readFile(join(stage, 'package.json'), 'utf8'));
    const commit = process.env.DSH_SMART_QA_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    metadata.version = smartModeQaVersion(metadata.version, { buildNumber: Date.now(), commit });
    await fs.writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2));
    const packed = packEntry(JSON.parse(await run([npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', packs], 'pack-candidate', { cwd: stage })));
    candidate = join(packs, packed.filename);
  } else {
    assert.ok(process.env.DSH_SMART_PACKAGE_CANDIDATE_SHA256, 'external candidate requires SHA-256');
    assert.equal(await fileHash(candidate), process.env.DSH_SMART_PACKAGE_CANDIDATE_SHA256);
  }
  const manifest = JSON.parse(execFileSync(tar, ['-xOf', candidate, 'package/package.json'], { encoding: 'utf8' }));
  let baseline = process.env.DSH_SMART_PACKAGE_BASELINE;
  if (!baseline) {
    const packed = packEntry(JSON.parse(await run([npmCli, 'pack', 'dsh-mcp-connector@0.2.109', '--ignore-scripts', '--json', '--pack-destination', packs], 'pack-stable-baseline')));
    baseline = join(packs, packed.filename);
  }
  assert.equal(JSON.parse(execFileSync(tar, ['-xOf', baseline, 'package/package.json'], { encoding: 'utf8' })).version, '0.2.109');
  assert.ok(compareVersions(manifest.version, '0.2.109') > 0);
  // pnpm's Windows store index can exceed a component limit when a local spec
  // embeds a long relative path. Stage short names inside this owned test home.
  const localCandidate = join(packs, 'candidate.tgz'), localBaseline = join(packs, 'baseline.tgz');
  const candidateHash = await fileHash(candidate), baselineHash = await fileHash(baseline);
  await fs.copyFile(candidate, localCandidate); await fs.copyFile(baseline, localBaseline);
  candidate = localCandidate; baseline = localBaseline;
  assert.equal(await fileHash(candidate), candidateHash); assert.equal(await fileHash(baseline), baselineHash);
  for (const name of ['fresh', 'upgrade']) {
    const profile = join(root, 'profiles', name); await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(join(profile, 'validation-profile.json'), JSON.stringify({ task: 'QMCP-4963', syntheticOnly: true }));
    await fs.writeFile(join(profile, 'package.json'), JSON.stringify({ name: `qmcp-4963-${name}`, private: true,
      dependencies: {}, dsh: { profile: { bundles: ['dsh-mcp-connector'] } } }));
    await fs.writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nignoreScripts: true\n');
  }
  inputs = { home: root, artifact, anchor: resolve(anchor), candidate, candidateVersion: manifest.version,
    candidateSha256: await fileHash(candidate), baselineSha256: await fileHash(baseline),
    candidateIndexHash: sha(execFileSync(tar, ['-xOf', candidate, 'package/lib/index.js'])) };
  const inputPath = join(root, 'inputs.json'); await fs.writeFile(inputPath, JSON.stringify(inputs));
  env.DSH_SMART_PACKAGE_INPUTS = inputPath;
  const install = (profile, pkg, label, allowedFailure = false) => run([cli, 'plugin', '--profile', profile, 'add', '--save-exact', '--ignore-scripts',
    '--registry=https://registry.npmjs.org', '--config.minimumReleaseAge=0', pkg], label, { cwd: root, allowedFailure });
  const phase = (profile, action, version = manifest.version) => run([join(source, 'scripts', 'fixtures', 'smart-mode-package-phase.mjs'), profile, action, version], `${profile}-${action}`);
  await install('fresh', candidate, 'fresh-install'); await phase('fresh', 'fresh'); await phase('fresh', 'restart');
  const fresh = join(root, 'profiles', 'fresh');
  const before = { manifest: await fileHash(join(fresh, 'package.json')), lock: await fileHash(join(fresh, 'pnpm-lock.yaml')) };
  const invalid = join(root, 'invalid.tgz'); await fs.writeFile(invalid, 'synthetic invalid package');
  await install('fresh', invalid, 'invalid-install', true);
  assert.equal(await fileHash(join(fresh, 'package.json')), before.manifest); assert.equal(await fileHash(join(fresh, 'pnpm-lock.yaml')), before.lock);
  await phase('fresh', 'repair');
  await install('upgrade', baseline, 'stable-install'); await phase('upgrade', 'baseline', '0.2.109');
  await install('upgrade', candidate, 'upgrade-install'); await phase('upgrade', 'upgrade'); await phase('upgrade', 'restart');
  await phase('upgrade', 'withdraw'); await install('upgrade', baseline, 'downgrade-install'); await phase('upgrade', 'downgrade', '0.2.109');
  await install('upgrade', candidate, 'return-install'); await phase('upgrade', 'return'); await phase('upgrade', 'restart');
} catch (failure) { error = failure; }
finally {
  // Never recursively remove an unverified path or any existing user profile.
  assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('qmcp-4963-package-'));
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'validation-home.json'), 'utf8')), { task: 'QMCP-4963', syntheticOnly: true });
  await fs.rm(root, { recursive: true, force: true });
  await fs.writeFile(join(artifact, 'package-lifecycle-result.json'), JSON.stringify({ passed: !error, node: process.versions.node,
    archiveTool: tar,
    host: '0.2.2-rc.1', candidateVersion: inputs?.candidateVersion, candidateSha256: inputs?.candidateSha256,
    baseline: '0.2.109', baselineSha256: inputs?.baselineSha256, results, temporaryHomeRemoved: true,
    currentDshConfigurationLoaded: false, realBusinessCalls: 0, realModelCalls: 0 }, null, 2));
}
if (error) throw error;
console.log(`PACKAGE_QA_OK=${results.length} steps; temporary home removed; no real business/model calls`);
