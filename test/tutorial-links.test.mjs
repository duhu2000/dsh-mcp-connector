import test from 'node:test';
import assert from 'node:assert/strict';

import { checkTutorialLinks, extractLocalLinks } from '../scripts/check-tutorial-links.mjs';

const DIR = 'docs/tutorials';

/**
 * Build an injectable, in-memory fs over a flat map of relative paths -> contents.
 * Keeps the tests hermetic: no real files, no network.
 */
function makeFs(files) {
  const paths = Object.keys(files);
  const isDir = (path) => paths.some((p) => p.startsWith(`${path}/`));
  return {
    readFile: async (path) => {
      path = path.replaceAll('\\', '/');
      if (!(path in files)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return files[path];
    },
    readdir: async (path) => {
      path = path.replaceAll('\\', '/');
      const entries = new Set();
      for (const p of paths) {
        if (p.startsWith(`${path}/`)) entries.add(p.slice(path.length + 1).split('/')[0]);
      }
      return [...entries];
    },
    stat: async (path) => {
      path = path.replaceAll('\\', '/');
      if (path in files || isDir(path)) return {};
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
  };
}

test('extractLocalLinks keeps only local relative file links', () => {
  const markdown = [
    '[Ext](https://example.com/x.md)',
    '[Mail](mailto:a@b.com)',
    '[Anchor](#section)',
    '[ProtoRel](//example.com/x.md)',
    '[Valid](README.md)',
    '[Fragment](OAUTH-DIAGNOSTICS.md#section)',
    '[Parent](../USER-GUIDE.md)',
  ].join('\n');

  assert.deepEqual(extractLocalLinks(markdown), [
    'README.md',
    'OAUTH-DIAGNOSTICS.md#section',
    '../USER-GUIDE.md',
  ]);
});

test('valid relative link passes', async () => {
  const fs = makeFs({
    [`${DIR}/README.md`]: '[A](JSON-MIGRATION.md)\n',
    [`${DIR}/JSON-MIGRATION.md`]: '# json\n',
  });

  assert.deepEqual(await checkTutorialLinks({ dir: DIR, ...fs }), []);
});

test('broken target reports `source -> target`', async () => {
  const fs = makeFs({ [`${DIR}/README.md`]: '[A](MISSING.md)\n' });

  assert.deepEqual(await checkTutorialLinks({ dir: DIR, ...fs }), [
    'docs/tutorials/README.md -> MISSING.md',
  ]);
});

test('external links and in-page anchors are ignored and never hit the filesystem', async () => {
  const calls = [];
  const fs = makeFs({
    [`${DIR}/README.md`]: [
      '[Ext](https://example.com/x.md)',
      '[Mail](mailto:a@b.com)',
      '[Anchor](#section)',
      '[ProtoRel](//example.com/x.md)',
    ].join('\n'),
  });

  const failures = await checkTutorialLinks({
    dir: DIR,
    readFile: async (p, enc) => { calls.push(p); return fs.readFile(p, enc); },
    readdir: async (p) => { calls.push(p); return fs.readdir(p); },
    stat: async (p) => { calls.push(p); return fs.stat(p); },
  });

  assert.deepEqual(failures, []);
  assert.ok(!calls.some((p) => /example\.com|mailto:/.test(p)), `unexpected fs call: ${calls}`);
});

test('`#fragment` is stripped before resolving', async () => {
  const fs = makeFs({
    [`${DIR}/README.md`]: '[A](OAUTH-DIAGNOSTICS.md#section)\n',
    [`${DIR}/OAUTH-DIAGNOSTICS.md`]: '# oauth\n',
  });

  assert.deepEqual(await checkTutorialLinks({ dir: DIR, ...fs }), []);
});

test('URL-encoded target is decoded before the existence check', async () => {
  const fs = makeFs({
    [`${DIR}/README.md`]: '[A](my%20file.md)\n',
    [`${DIR}/my file.md`]: '# spaced\n',
  });

  assert.deepEqual(await checkTutorialLinks({ dir: DIR, ...fs }), []);
});

test('broken URL-encoded target is reported as written', async () => {
  const fs = makeFs({ [`${DIR}/README.md`]: '[A](missing%20file.md)\n' });

  assert.deepEqual(await checkTutorialLinks({ dir: DIR, ...fs }), [
    'docs/tutorials/README.md -> missing%20file.md',
  ]);
});

test('links resolve relative to the source file, including a subdirectory', async () => {
  const fs = makeFs({
    [`${DIR}/sub/guide.md`]: '[A](../README.md)\n[B](../OAUTH-DIAGNOSTICS.md)\n',
    [`${DIR}/README.md`]: '# entry\n',
    [`${DIR}/OAUTH-DIAGNOSTICS.md`]: '# oauth\n',
  });

  let reads = 0;
  assert.deepEqual(await checkTutorialLinks({ dir: `${DIR}/sub`, ...fs, readFile: async (...args) => {
    reads++;
    return fs.readFile(...args);
  } }), []);
  assert.equal(reads, 1, 'must actually read the subdirectory source');
});

test('code examples are ignored; angle targets, parentheses and titles work', () => {
  const markdown = [
    '```md', '[code](missing.md)', '```',
    '~~~', '[code](missing.md)', '~~~',
    '    [indented](missing.md)', '`[inline](missing.md)`',
    '[space](<my file.md>)', '[parens](guide(v2).md "a title")',
    '[escaped](guide\\(v2\\).md)', '[external](<https://example.com>)',
    '[absolute](/outside.md)', '[reference][id]',
  ].join('\n');
  assert.deepEqual(extractLocalLinks(markdown), ['my file.md', 'guide(v2).md', 'guide(v2).md']);
});

test('repository escapes and invalid encodings fail before stat', async () => {
  const fs = makeFs({ [`${DIR}/README.md`]: '[escape](../../../outside.md)\n[bad](bad%ZZ.md)\n[encoded](%2Fetc/passwd)' });
  let calls = 0;
  const failures = await checkTutorialLinks({ ...fs, stat: async () => { calls++; } });
  assert.equal(failures.length, 3);
  assert.equal(calls, 0);
});

test('valid angle and balanced-parentheses filenames are checked, not skipped', async () => {
  const fs = makeFs({ [`${DIR}/README.md`]: '[space](<my file.md>)\n[paren](guide(v2).md)' });
  assert.deepEqual(await checkTutorialLinks(fs), [
    'docs/tutorials/README.md -> guide(v2).md',
    'docs/tutorials/README.md -> my file.md',
  ]);
});

test('links that leave the tutorials directory are still validated', async () => {
  const fs = makeFs({
    [`${DIR}/README.md`]: '[A](../USER-GUIDE.md)\n[B](../MISSING.md)\n',
    'docs/USER-GUIDE.md': '# guide\n',
  });

  assert.deepEqual(await checkTutorialLinks({ dir: DIR, ...fs }), [
    'docs/tutorials/README.md -> ../MISSING.md',
  ]);
});

test('the real docs/tutorials directory has no broken local links', async () => {
  assert.deepEqual(await checkTutorialLinks(), []);
});
