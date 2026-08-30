import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  assert.deepEqual(await checkStorefrontScreenshots({ repositoryRoot: root, assetMetadataPath: null }), [
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
      await assert.rejects(checkStorefrontScreenshots({ repositoryRoot: root, assetMetadataPath: null }), expected);
    });
  }
});

test('verifies screenshot and demo hashes, dimensions, two-column viewport, and credential-free state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-storefront-assets-'));
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const sha256 = createHash('sha256').update(pixel).digest('hex');
  await mkdir(join(root, 'docs/screenshots'), { recursive: true });
  await writeFile(join(root, 'docs/screenshots/market.gif'), pixel);
  await writeFile(join(root, 'docs/demo.gif'), pixel);
  await writeFile(join(root, 'docs/screenshots/assets.json'), JSON.stringify({
    schemaVersion: 1,
    capture: { browserViewport: { width: 1280, height: 720 }, productPanelWidth: 800, desktopCardColumns: 2, state: 'credential-free-mock' },
    screenshots: [{ path: 'docs/screenshots/market.gif', sha256, width: 1, height: 1 }],
    demo: { path: 'docs/demo.gif', sha256, width: 1, height: 1, durationSeconds: 0 },
  }));
  await writeFile(join(root, 'screenshots.json'), JSON.stringify(['docs/screenshots/market.gif']));
  assert.deepEqual(await checkStorefrontScreenshots({ repositoryRoot: root }), ['docs/screenshots/market.gif']);

  await writeFile(join(root, 'docs/screenshots/assets.json'), JSON.stringify({
    schemaVersion: 1,
    capture: { browserViewport: { width: 1280, height: 720 }, productPanelWidth: 800, desktopCardColumns: 2, state: 'credential-free-mock' },
    screenshots: [{ path: 'docs/screenshots/market.gif', sha256: '0'.repeat(64), width: 1, height: 1 }],
    demo: { path: 'docs/demo.gif', sha256, width: 1, height: 1 },
  }));
  await assert.rejects(checkStorefrontScreenshots({ repositoryRoot: root }), /SHA-256 漂移/);
});
