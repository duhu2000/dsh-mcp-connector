#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, win32, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Extract the targets of local relative file links from Markdown content.
 *
 * Only links that point at a file in this repository are returned:
 * - links with a URI scheme (`http://`, `https://`, `mailto:`, `tel:`, ...) are ignored
 * - protocol-relative links (`//host/...`) are ignored
 * - pure in-page anchors (`#section`) are ignored
 * Everything else (including `../USER-GUIDE.md` and `FOO.md#fragment`) is relative.
 *
 * @param {string} markdown - Markdown source.
 * @returns {string[]} Raw link targets, in document order.
 */
function withoutCode(markdown) {
  let fence;
  const lines = markdown.split('\n').map((line) => {
    const start = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`).test(line)) fence = null;
      return '';
    }
    if (start) { fence = { char: start[1][0], length: start[1].length }; return ''; }
    return /^( {4}|\t)/.test(line) ? '' : line;
  }).join('\n');
  // A code span closes only on an equally long run (not part of a longer one).
  let output = '';
  for (let pos = 0; pos < lines.length;) {
    if (lines[pos] !== '`') { output += lines[pos++]; continue; }
    const opening = /^`+/.exec(lines.slice(pos))[0];
    let end = pos + opening.length;
    let matched = false;
    while ((end = lines.indexOf('`', end)) >= 0) {
      const run = /^`+/.exec(lines.slice(end))[0];
      end += run.length;
      if (run.length === opening.length) { matched = true; break; }
    }
    if (matched) { output += ' '.repeat(end - pos); pos = end; }
    else { output += opening; pos += opening.length; }
  }
  return output;
}

/** Inline Markdown links/images only; reference links and HTML are out of scope. */
export function extractLocalLinks(markdown) {
  const source = withoutCode(markdown);
  const linkRegex = /\[[^\]\n]*\]\(\s*/g;
  const links = [];

  let match;
  while ((match = linkRegex.exec(source)) !== null) {
    let pos = linkRegex.lastIndex;
    let target = '';
    if (source[pos] === '<') {
      const end = source.indexOf('>', pos + 1);
      if (end < 0) continue;
      target = source.slice(pos + 1, end);
      pos = end + 1;
    } else {
      let depth = 0;
      for (; pos < source.length; pos++) {
        const char = source[pos];
        if (char === '\\' && /[()\\]/.test(source[pos + 1] ?? '')) { target += source[++pos]; continue; }
        if (char === '(') depth++;
        if (char === ')') { if (depth === 0) break; depth--; }
        if (/\s/.test(char) && depth === 0) break;
        target += char;
      }
      if (depth !== 0) continue;
    }
    // Accept an optional quoted/parenthesized title, but require the closing ).
    if (!/^\s*(?:(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\))\s*)?\)/.test(source.slice(pos))) continue;
    if (!target) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // scheme
    if (target.startsWith('//')) continue; // protocol-relative
    if (isAbsolute(target) || win32.isAbsolute(target)) continue;
    if (target.startsWith('#')) continue; // in-page anchor
    links.push(target);
  }

  return links;
}

/**
 * Validate the local relative file links inside `dir`'s Markdown files.
 *
 * No network access: only the filesystem is touched. All fs calls are injectable so
 * tests can run against an in-memory fixture.
 *
 * @param {object} [options]
 * @param {string} [options.dir='docs/tutorials'] - Directory holding the Markdown files.
 * @param {(path: string, encoding: string) => Promise<string>} [options.readFile]
 * @param {(path: string) => Promise<string[]>} [options.readdir]
 * @param {(path: string) => Promise<unknown>} [options.stat]
 * @returns {Promise<string[]>} Sorted `source -> target` failures (empty when all pass).
 */
export async function checkTutorialLinks({
  dir = 'docs/tutorials',
  repoRoot = '.',
  readFile: readFileImpl = readFile,
  readdir: readdirImpl = readdir,
  stat: statImpl = stat,
} = {}) {
  const failures = [];
  const entries = await readdirImpl(dir);
  const sources = entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => join(dir, entry))
    .sort();

  for (const sourcePath of sources) {
    const content = await readFileImpl(sourcePath, 'utf8');
    const sourceDir = dirname(sourcePath);

    for (const rawTarget of extractLocalLinks(content)) {
      const pathPart = rawTarget.split('#')[0];
      if (!pathPart) continue; // e.g. `FOO.md#anchor` never yields an empty path, defensive

      let resolvedPath;
      const failure = `${sourcePath.replaceAll('\\', '/')} -> ${rawTarget}`;
      try {
        const decoded = decodeURIComponent(pathPart);
        if (isAbsolute(decoded) || win32.isAbsolute(decoded)) throw new Error('absolute target');
        const target = resolve(sourceDir, decoded);
        const withinRoot = relative(resolve(repoRoot), target);
        if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
          throw new Error('target leaves repository');
        }
        resolvedPath = join(sourceDir, decoded);
      } catch {
        // Malformed percent-encoding: still report it as a broken link.
        failures.push(failure);
        continue;
      }

      try {
        await statImpl(resolvedPath); // file OR directory is fine
      } catch {
        failures.push(failure);
      }
    }
  }

  return failures.sort();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  checkTutorialLinks()
    .then((failures) => {
      if (failures.length > 0) {
        console.error('教程本地链接校验失败：');
        for (const failure of failures) console.error(failure);
        process.exitCode = 1;
      } else {
        console.log('教程本地链接校验通过：docs/tutorials');
      }
    })
    .catch((error) => {
      console.error(`教程本地链接校验失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
