import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path/posix';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

// These are hashes of previously retired public paths, not file-content hashes.
const retiredPaths = new Set(JSON.parse(readFileSync(new URL('./retired-public-paths.json', import.meta.url), 'utf8')));
const privateDirectories = [
  'work', 'private', 'internal', 'docs/internal', 'docs/private', 'docs/reviews', 'docs/acceptance',
];
const material = /\.(?:md|mdx|txt|rst|adoc|pdf|docx?|pptx?|xlsx?|csv|json|jsonl|ya?ml|html?|log|jpe?g|png|gif|svg|webp|zip)$/i;
const draftName = /(?:^|[-_. ])(?:drafts?|(?:internal|private)[-_. ](?:only|notes|schedule|evidence)|handoff|workplan|raw[-_. ](?:evidence|acceptance)|competitor[-_. ](?:analysis|strategy))(?:$|[-_. ])/i;
const internalName = /草稿|原稿|内部排期|竞品(?:分析|策略)|原始(?:验收|证据)/u;

function reason(path, screenshots) {
  const lower = path.toLowerCase();
  if (retiredPaths.has(createHash('sha256').update(lower).digest('hex'))) {
    return 'previously retired path; submit public guidance at a documented public location';
  }
  if (privateDirectories.some(dir => lower === dir || lower.startsWith(dir + '/'))) {
    return 'reserved for private working materials';
  }
  if (/^marketing\/campaign[-/]/.test(lower) || /^plan(?:-[^/]+)?\.(?:md|pdf)$/.test(lower) ||
      /^docs\/acceptance[-.]/.test(lower) || lower === 'distribution/dsh-index/acceptance.md') {
    return 'internal plan or acceptance material';
  }
  if (lower.startsWith('docs/screenshots/') && !screenshots.has(path)) {
    return 'package.json must explicitly list each reviewed distribution screenshot';
  }
  if (/^(?:docs|marketing)\/(?:[^/]+\/)*(?:drafts?|internal|private)\//.test(lower)) {
    return 'private working directory';
  }
  const name = basename(lower);
  if (material.test(name) && (draftName.test(name) || internalName.test(name))) {
    return 'filename identifies an internal draft or working record';
  }
}

function changedPaths(args) {
  return git(...args).split('\0').filter(Boolean);
}

function inspect(paths, revision) {
  const screenshots = new Set();
  if (paths.some(path => path.toLowerCase().startsWith('docs/screenshots/'))) {
    const manifest = JSON.parse(git('show', revision + ':package.json'));
    for (const path of manifest.files) screenshots.add(path);
  }
  for (const path of paths) {
    const problem = reason(path, screenshots);
    if (problem) {
      process.exitCode = 1;
      console.error('%s %s: %s', revision || 'staged', JSON.stringify(path), problem);
    }
  }
}

const args = process.argv.slice(2);
const diffOptions = ['--no-renames', '--diff-filter=AMT', '--name-only', '-z'];
if (args.length === 0 || (args.length === 1 && args[0] === '--staged')) {
  inspect(changedPaths(['diff', '--cached', ...diffOptions, '--']), '');
} else if (args.length === 3 && args[0] === '--range') {
  const [base, head] = args.slice(1).map(ref =>
    git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').trim());
  const commits = git('rev-list', '--reverse', base + '..' + head).trim();
  for (const commit of commits.split('\n').filter(Boolean)) {
    // Combined diffs check merge resolutions without rechecking inherited files.
    inspect(changedPaths(['diff-tree', '--root', '--cc', '-r', '--no-commit-id',
      ...diffOptions, commit, '--']), commit);
  }
} else {
  console.error('Usage: node scripts/check-public-paths.mjs [--staged | --range <base> <head>]');
  process.exit(2);
}

if (process.exitCode) {
  console.error('Keep working materials private. Remove them from the staged changes or outgoing commits before pushing. See CONTRIBUTING.md.');
} else {
  console.log('Public path check passed. Review the content of documents, images and attachments before sharing.');
}
