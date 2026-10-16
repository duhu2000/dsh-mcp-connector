#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
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
export function extractLocalLinks(markdown) {
  const linkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
  const links = [];

  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    // Drop an optional Markdown title: `(path "title")` / `(path 'title')`.
    const target = match[1].trim().split(/\s+/)[0];
    if (!target) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // scheme
    if (target.startsWith('//')) continue; // protocol-relative
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
      try {
        // Normalize instead of `resolve` so paths stay relative to the repo root
        // (deterministic, and keeps failure messages readable).
        resolvedPath = normalize(join(sourceDir, decodeURIComponent(pathPart)));
      } catch {
        // Malformed percent-encoding: still report it as a broken link.
        failures.push(`${sourcePath} -> ${rawTarget}`);
        continue;
      }

      try {
        await statImpl(resolvedPath); // file OR directory is fine
      } catch {
        failures.push(`${sourcePath} -> ${rawTarget}`);
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
