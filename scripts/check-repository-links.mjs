import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';

function parseDocument(content) {
  const links = [];
  const anchors = new Set();
  const slugger = new GithubSlugger();
  function visit(node) {
    if (['link', 'image', 'definition'].includes(node.type)) links.push(node.url);
    if (node.type === 'heading') anchors.add(slugger.slug(toString(node, { includeHtml: false })));
    if (node.type === 'html') {
      for (const tag of node.value.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<[a-z][^>]*>/gi)) {
        for (const attr of tag[0].matchAll(/\s(href|src|id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          const value = attr[2] ?? attr[3] ?? attr[4];
          if (/^(id|name)$/i.test(attr[1])) anchors.add(value);
          else links.push(value);
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(fromMarkdown(content));
  return { links, anchors };
}

export async function checkRepositoryLinks(paths, read = path => readFile(path, 'utf8')) {
  const tracked = new Set(paths);
  const dirs = new Set(['.']);
  const documents = new Map();
  for (const path of tracked) {
    for (let parent = posix.dirname(path); !dirs.has(parent); parent = posix.dirname(parent)) dirs.add(parent);
    if (/\.md$/i.test(path)) documents.set(path, parseDocument(await read(path)));
  }
  const failures = [];
  for (const [source, { links }] of documents) {
    for (const link of links) {
      const local = link.replace(/^https:\/\/github\.com\/duhu2000\/dsh-mcp-connector\/(?:blob|tree)\/main\//i, '/')
        .replace(/^https:\/\/raw\.githubusercontent\.com\/duhu2000\/dsh-mcp-connector\/main\//i, '/');
      if (!local || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(local)) continue;
      const [resource, fragment] = local.split(/#(.*)/s);
      try {
        const path = decodeURIComponent(resource.split('?')[0]);
        const target = !path ? source : posix.normalize(path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(source), path));
        const normalized = target.replace(/\/$/, '') || '.';
        if (!tracked.has(normalized) && !dirs.has(normalized)) throw new Error('missing tracked target');
        if (fragment && documents.has(normalized) && !documents.get(normalized).anchors.has(decodeURIComponent(fragment))) {
          throw new Error('missing anchor');
        }
      } catch (error) {
        failures.push(`${source} -> ${link} (${error.message})`);
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const failures = await checkRepositoryLinks(paths);
  if (failures.length) throw new Error('Broken repository links:\n' + failures.join('\n'));
  console.log(`Repository links verified in ${paths.filter(path => /\.md$/i.test(path)).length} tracked Markdown files.`);
}
