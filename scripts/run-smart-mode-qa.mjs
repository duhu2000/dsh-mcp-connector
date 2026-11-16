/** Offline QA only; excluded from the published plugin. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMART_PRODUCTION_HOST_VERSION } from '../lib/smart-mode-host.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2), command = args.shift();
const anchorFlag = args.indexOf('--anchor');
const anchor = anchorFlag >= 0 ? args.splice(anchorFlag, 2)[1] : process.env.DSH_HOST_INTEGRATION_ANCHOR;
const seeded = args.includes('--seeded');
if (seeded) args.splice(args.indexOf('--seeded'), 1);
if (!['check', 'serve'].includes(command) || !anchor || args.length || (seeded && command !== 'serve')) {
  console.error('Usage: node scripts/run-smart-mode-qa.mjs check|serve --anchor <Host install package.json> [--seeded]');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('QA requires Node >=22 (validated: 22 and CI 24)');
const selectedAnchor = resolve(anchor);
if (!(await stat(selectedAnchor)).isFile()) throw new Error('Host install anchor must be a file');
const require = createRequire(createRequire(selectedAnchor).resolve('@deepseek-ai/dsh-agent-loop'));
for (const name of ['dsh-agent-loop', 'dsh-tools', 'dsh-tool-executor-native', 'dsh-client-connection', 'dsh-api-session-controller']) {
  if (require(`@deepseek-ai/${name}/package.json`).version !== SMART_PRODUCTION_HOST_VERSION) {
    throw new Error(`QA requires ${name}@${SMART_PRODUCTION_HOST_VERSION}; no profile or configuration was opened`);
  }
}
// This directory contains evidence and a stop marker, never a copy of a user's profile.
const runDir = await mkdtemp(join(tmpdir(), 'qmcp-4963-qa-'));
const stopFile = join(runDir, 'STOP');
await mkdir(join(runDir, 'host-evidence'));
await writeFile(join(runDir, 'run.json'), JSON.stringify({ task: 'QMCP-4963', command, seeded,
  node: process.versions.node, host: SMART_PRODUCTION_HOST_VERSION, realBusinessCalls: 0, realModelCalls: 0 }, null, 2));
console.log(`QA_RUN_DIR=${runDir}`);
if (command === 'serve') console.log(`QA_STOP_FILE=${stopFile}`);
const tests = (await readdir(join(root, 'test'))).filter((name) => /^(smart-mode-|source-relations|source-selection|read-only-evidence|visibility-host).*\.test\.mjs$/.test(name)).sort();
const childArgs = command === 'check' ? ['--test', '--test-reporter=tap', ...tests.map((name) => `test/${name}`)]
  : ['scripts/fixtures/smart-mode-production-ui.mjs'];
const logPath = join(runDir, 'qa.log'), log = createWriteStream(logPath, { flags: 'wx' });
const child = spawn(process.execPath, childArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
  DSH_HOST_INTEGRATION_ANCHOR: selectedAnchor, DSH_SMART_ACCEPTANCE_EVIDENCE_DIR: join(runDir, 'host-evidence'),
  DSH_SMART_UI_QA: command === 'serve' ? '1' : '', DSH_SMART_UI_STOP_FILE: stopFile,
  DSH_SMART_UI_SEEDED: seeded ? '1' : '',
} });
for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { process.stdout.write(data); log.write(data); });
// A normal stop runs node:test cleanup, closes Host services and deletes the temporary profile.
const stop = () => { writeFile(stopFile, '').catch(() => {}); };
if (command === 'serve') process.on('SIGINT', stop);
let status;
try { status = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code) => done(code ?? 1)); }); }
finally { process.off('SIGINT', stop); await new Promise((done) => log.end(done)); }
const output = await readFile(logPath, 'utf8');
// An explicitly selected Host may not silently turn required contracts into skips.
if (command === 'check' && (!/^# tests \d+$/m.test(output) || !/^# fail 0$/m.test(output)
    || !/^# cancelled 0$/m.test(output) || !/^# skipped 0$/m.test(output))) status = 1;
await writeFile(join(runDir, 'result.json'), JSON.stringify({ exitCode: status, log: 'qa.log',
  realBusinessCalls: 0, realModelCalls: 0, syntheticOnly: true }, null, 2));
console.log(`QA_RESULT=${join(runDir, 'result.json')}`);
process.exitCode = status;
