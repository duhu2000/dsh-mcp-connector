import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const marker = '# dsh-mcp-connector managed pre-push';
const [baseline = 'origin/main', ...extra] = process.argv.slice(2);
const baselineRef = baseline.startsWith('refs/remotes/') ? baseline : 'refs/remotes/' + baseline;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function install() {
  if (extra.length || !/^refs\/remotes\/[A-Za-z0-9._-]+\/main$/.test(baselineRef)) {
    throw new Error('Usage: npm run public:hooks:install -- [origin/main|upstream/main]');
  }
  const hooksPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (hooksPath.status === 0) {
    throw new Error('core.hooksPath is configured. Integrate the public check into the existing hook setup.');
  }
  if (hooksPath.status !== 1) throw new Error('Cannot read Git hook configuration.');
  try {
    git('rev-parse', '--verify', baselineRef + '^{commit}');
  } catch {
    throw new Error('Cannot read ' + baselineRef + '. Fetch the public upstream before installing.');
  }

  const hooks = git('rev-parse', '--path-format=absolute', '--git-path', 'hooks');
  const hook = join(hooks, 'pre-push');
  if (existsSync(hook) && !readFileSync(hook, 'utf8').startsWith('#!/bin/sh\n' + marker + '\n')) {
    throw new Error('Existing hook preserved at ' + hook + '. Integrate the public check into that hook.');
  }

  const snapshot = join(hooks, 'dsh-public-pre-push');
  mkdirSync(snapshot, { recursive: true });
  for (const name of ['check-public-paths.mjs', 'retired-public-paths.json']) {
    copyFileSync(new URL(name, import.meta.url), join(snapshot, name));
  }
  const launcher = [
    '#!/bin/sh',
    marker,
    'exec node "$(dirname "$0")/dsh-public-pre-push/check-public-paths.mjs" --pre-push ' + baselineRef,
    '',
  ].join('\n');
  writeFileSync(hook, launcher);
  chmodSync(hook, 0o755);
  console.log('Installed public pre-push check using %s.', baselineRef);
}

try {
  install();
} catch (error) {
  console.error('Cannot install public pre-push check: %s', error.message);
  process.exitCode = 1;
}
