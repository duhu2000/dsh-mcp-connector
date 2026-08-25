import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  normalizeStats,
  renderChineseStats,
  syncRegistryStats,
} from '../scripts/sync-registry-stats.mjs';

const stats = {
  schemaVersion: 1,
  registryCount: 78,
  bundledUniqueCount: 4,
  marketCount: 82,
  featuredCount: 6,
  categoryCount: 9,
  categoryNames: ['企业数据', '金融投资', '法律合规', '开发工具', '办公协作', '调研分析', '设计创意', '效率工具', '其他'],
  updatedOn: '2026-08-25',
};

test('validates count relationships and safe category names', () => {
  assert.deepEqual(normalizeStats(stats), stats);
  assert.throws(() => normalizeStats({ ...stats, marketCount: 81 }), /marketCount must equal/);
  assert.throws(() => normalizeStats({ ...stats, categoryNames: [...stats.categoryNames.slice(0, 8), '[bad]'] }), /unsafe value/);
  assert.match(renderChineseStats(stats), /78 条.*82 张.*9 类.*6 张/s);
});

test('syncs the Chinese and English generated blocks plus local snapshot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-registry-stats-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'source.json');
  const chinesePath = join(directory, 'README.md');
  const englishPath = join(directory, 'README.en.md');
  const snapshotPath = join(directory, 'snapshot.json');
  const marked = 'before\n<!-- catalog-stats:start -->\nstale\n<!-- catalog-stats:end -->\nafter\n';
  await Promise.all([
    writeFile(sourcePath, JSON.stringify(stats)),
    writeFile(chinesePath, marked),
    writeFile(englishPath, marked),
  ]);

  await syncRegistryStats({ sourcePath, chineseReadmePath: chinesePath, englishReadmePath: englishPath, snapshotPath });
  const [chinese, english, snapshot] = await Promise.all([
    readFile(chinesePath, 'utf8'), readFile(englishPath, 'utf8'), readFile(snapshotPath, 'utf8'),
  ]);
  assert.match(chinese, /Registry 已发布 78 条.*82 张/s);
  assert.match(english, /publishes 78 connector descriptors.*exposes 82 cards/s);
  assert.deepEqual(JSON.parse(snapshot), stats);
});
