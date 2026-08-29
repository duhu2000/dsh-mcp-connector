import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { checkStorefrontScreenshots } from '../scripts/check-storefront-screenshots.mjs';

async function fixture(manifest, files = ['docs/market.jpg']) {
  const root = await mkdtemp(join(tmpdir(), 'mcp-storefront-'));
  for (const path of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), 'image');
  }
  await writeFile(join(root, 'screenshots.json'), JSON.stringify(manifest));
  return root;
}

test('accepts an ordered list of repository-local screenshots', async () => {
  const root = await fixture(['docs/market.jpg', 'docs/details.png'], ['docs/market.jpg', 'docs/details.png']);
  assert.deepEqual(await checkStorefrontScreenshots({ repositoryRoot: root }), [
    'docs/market.jpg',
    'docs/details.png',
  ]);
});

test('rejects invalid screenshot declarations', async (t) => {
  const cases = [
    [[], /必须声明 1-8 张图片/],
    [['docs/market.jpg', 'docs/market.jpg'], /截图路径重复/],
    [['https://example.com/market.jpg'], /仓库内相对路径/],
    [['../market.jpg'], /不能离开仓库/],
    [['docs/missing.jpg'], /ENOENT/],
  ];

  for (const [manifest, expected] of cases) {
    await t.test(JSON.stringify(manifest), async () => {
      const root = await fixture(manifest);
      await assert.rejects(checkStorefrontScreenshots({ repositoryRoot: root }), expected);
    });
  }
});
