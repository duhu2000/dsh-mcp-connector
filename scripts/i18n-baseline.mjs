#!/usr/bin/env node
/**
 * 重新生成「未翻译中文文案」基线。
 *
 * 只在**修好**文案之后运行：它把当前扫描结果写进
 * `test/fixtures/i18n-untranslated-baseline.json`，从而锁定进展。
 * 绝不要为了「让测试通过」而直接运行——那等于取消这个门禁。
 *
 * 用法：`node scripts/i18n-baseline.mjs`
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepository } from './i18n-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hits = await scanRepository(root);

const files = {};
for (const hit of hits) files[hit.file] = (files[hit.file] ?? 0) + 1;
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));

const payload = {
  _comment: '未翻译的中文字面量基线（scripts/i18n-scan.mjs 扫描，scripts/i18n-baseline.mjs 写入）。只允许减少：修好一个文件就把对应条目去掉；数量增加即视为回归。最终目标是把 files 清空。',
  total: hits.length,
  files: sorted,
};

const target = path.join(root, 'test', 'fixtures', 'i18n-untranslated-baseline.json');
await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`基线已更新：${hits.length} 处未翻译，涉及 ${Object.keys(sorted).length} 个文件`);
if (hits.length > 0) {
  for (const [file, count] of Object.entries(sorted)) console.log(`  ${String(count).padStart(3)}  ${file}`);
}
