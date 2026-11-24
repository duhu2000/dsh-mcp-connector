/** Validate npm's selected files and optionally retain the exact audited tarball. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { smartModeQaVersion } from './fixtures/smart-mode-package-version.mjs';

const WHITELIST = [
  /^package\.json$/,
  /^cordis\.patch\.yml$/,
  /^README\.md$/,
  /^README\.en\.md$/,
  /^screenshots\.json$/,
  /^CONTRIBUTING\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE$/,
  /^install\.sh$/,
  /^catalog\/[^/]+\.json$/,
  /^lib\/[^/]+\.js$/,
  /^lib\/connectors\/[^/]+\.js$/,
  // i18n 运行时与语言词典：随插件一起发布，英文界面依赖它们。
  /^lib\/i18n\/[^/]+\.js$/,
  /^lib\/i18n\/locales\/[^/]+\.js$/,
  /^lib\/i18n\/locales\/en\/[^/]+\.js$/,
  /^scripts\/(?:probe-connector|build-registry|cli-bridge|zerone-bridge|gildata-bridge|ui-harness)\.mjs$/,
  /^registry\/README\.md$/,
  /^registry\/catalog\.json$/,
  /^registry\/connectors\/[^/]+\.json$/,
  /^registry\/schema\/[^/]+\.json$/,
  /^docs\/(?:CLI-PROVIDERS|CONFIG-BACKUP|CONNECTION-SCOPES|DATA-MCP-CONTRIBUTION-REVIEW|DESKTOP-E2E|FIRST-CONTRIBUTION|I18N|MARKET-REGISTRATION|PLUGIN-UPDATE|SESSION-TOOL-INJECTION|SHAREABLE-CONNECTION-TEMPLATES|STDIO-SUPPORT|TOOL-GOVERNANCE|USER-GUIDE)\.md$/,
  /^docs\/tutorials\/(?:README|FIRST-SUCCESS-SCENARIOS|ONE-SUCCESS-CASE|SHARING-KIT|SHARING-AUTHOR-ASSETS|SHARING-UI-INTEGRATION|JSON-MIGRATION|OAUTH-DIAGNOSTICS|TOOL-SEARCH-RECOVERY|TRUSTED-STATUS-COPY)\.md$/,
  /^ui\/index\.html$/,
  /^ui\/smart-mode\.(?:html|js)$/,
  /^ui\/sharing-experience\.js$/,
  /^ui\/locale\.js$/,
  /^ui\/connection-template-sharing\.js$/,
  /^ui\/assets\/[^/]+\.(?:svg|png|webp)$/,
];

const requiredDocs = [
  'docs/DATA-MCP-CONTRIBUTION-REVIEW.md',
  'docs/DESKTOP-E2E.md',
  'docs/SESSION-TOOL-INJECTION.md',
  'docs/STDIO-SUPPORT.md',
  'docs/tutorials/README.md',
  'docs/tutorials/ONE-SUCCESS-CASE.md',
  'docs/tutorials/SHARING-KIT.md',
  'docs/tutorials/SHARING-AUTHOR-ASSETS.md',
  'docs/tutorials/SHARING-UI-INTEGRATION.md',
  'docs/tutorials/FIRST-SUCCESS-SCENARIOS.md',
  'docs/tutorials/JSON-MIGRATION.md',
  'docs/tutorials/OAUTH-DIAGNOSTICS.md',
  'docs/tutorials/TOOL-SEARCH-RECOVERY.md',
  'docs/tutorials/TRUSTED-STATUS-COPY.md',
];

const sensitivePatterns = [
  ['私钥', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['npm token', /npm_[A-Za-z0-9]{20,}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['OpenAI 风格密钥', /sk-[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['本机绝对路径', /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/],
];

function firstPackEntry(parsed) {
  if (Array.isArray(parsed)) return parsed[0];
  if (parsed && typeof parsed === 'object') return Object.values(parsed)[0];
  return undefined;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sha = (algorithm, bytes, encoding) => createHash(algorithm).update(bytes).digest(encoding);

function checkVersionStamp(pkg) {
  const original = JSON.parse(git('show', 'HEAD:package.json'));
  const build = /-pr\.\d+\.qa\.(\d+)\+g[0-9a-f]+$/.exec(pkg.version)?.[1];
  const version = smartModeQaVersion(original.version, {
    buildNumber: Number(build), pullRequest: Number(process.env.PR_NUMBER), commit: process.env.PR_HEAD_SHA,
  });
  assert.deepEqual(pkg, { ...original, version }, 'PR builds may change only the expected package version');
}

function verify(temp, destination, prBuild) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const packArgs = ['pack', '--json', '--ignore-scripts', ...(destination ? ['--pack-destination', temp] : ['--dry-run'])];
  // npm supplies its own CLI path when running either package script (including on Windows).
  const npmCli = process.env.npm_execpath;
  const raw = execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...packArgs] : packArgs, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const pack = firstPackEntry(JSON.parse(raw));
  if (!Array.isArray(pack?.files) || !pack.files.length) throw new Error('Empty or invalid npm pack manifest');
  const files = pack.files.map(entry => entry.path);
  const tracked = new Set(git('ls-files', '--cached', '-z').split('\0').filter(Boolean));
  const screenshots = pkg.files.filter(path => path.startsWith('docs/screenshots/'));
  if (!screenshots.length || pkg.files.includes('docs/screenshots') ||
      screenshots.some(path => !/^docs\/screenshots\/(?:en\/)?[\w.-]+\.(?:md|json|gif|jpe?g|png|svg|webp)$/.test(path))) {
    throw new Error('List each screenshot file explicitly in package.json');
  }
  for (const required of [...requiredDocs, ...screenshots]) {
    if (!files.includes(required)) throw new Error('Missing required package file: ' + required);
  }
  const manifest = Object.create(null);
  for (const file of files) {
    if (!tracked.has(file)) throw new Error('Untracked package file: ' + file);
    if (!screenshots.includes(file) && !WHITELIST.some(rule => rule.test(file))) {
      throw new Error('Unapproved package file: ' + file);
    }
    const bytes = readFileSync(file);
    const text = bytes.toString('utf8');
    for (const [label, pattern] of sensitivePatterns) {
      if (pattern.test(text)) throw new Error(`${file}: ${label}`);
    }
    manifest[file] = sha('sha256', bytes, 'hex');
  }
  if (!/^PKG="dsh-mcp-connector"$/m.test(readFileSync('install.sh', 'utf8'))) throw new Error('Unexpected install target');
  console.log(`verify-pack: ${files.length} tracked, allowlisted files`);
  if (!destination) return;

  if (prBuild) checkVersionStamp(pkg);
  git('diff', '--quiet', 'HEAD', '--', '.', ...(prBuild ? [':(exclude)package.json'] : []));
  assert.equal(basename(pack.filename), pack.filename);
  const archive = join(temp, pack.filename);
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['scripts/verify-pack-archive.py', archive], {
    input: JSON.stringify(manifest), stdio: ['pipe', 'inherit', 'inherit'],
  });
  const bytes = readFileSync(archive);
  const integrity = 'sha512-' + sha('sha512', bytes, 'base64');
  assert.equal(integrity, pack.integrity, 'npm pack integrity differs from tarball');
  copyFileSync(archive, join(destination, pack.filename), constants.COPYFILE_EXCL);
  console.log(`${pack.filename}: ${files.length} archived files verified, SHA-256 ${sha('sha256', bytes, 'hex')}`);
}

const args = process.argv.slice(2);
if (args.length && !(args[0] === '--pack-to' && args[1] && (args.length === 2 || (args.length === 3 && args[2] === '--pr')))) {
  throw new Error('Usage: verify-pack.mjs [--pack-to <existing directory> [--pr]]');
}
const temp = args.length ? mkdtempSync(join(tmpdir(), 'reviewed-npm-pack-')) : undefined;
try {
  verify(temp, args[1], args[2] === '--pr');
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}
