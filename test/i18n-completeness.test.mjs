/**
 * 翻译完备性门禁。
 *
 * 本仓库的约定是「msgid = 中文原文」，缺译文时回退中文。回退保证界面不会空白，
 * 但也意味着**漏译是静默的**。因此这里用静态扫描把漏译变成可见的门禁：
 *
 * 1. 英文词典里没有空译文、没有占位符缺失/多余（`{name}` 在译文里必须一一对应）。
 * 2. 各源文件里出现的 `t('中文…')` msgid 必须在英文词典中命中。
 * 3. 英文译文不应残留中文（除了刻意保留的中文术语/标点）。
 *
 * 扫描是启发式的：它只检查确实写进 `t('…')` 的中文，不要求改造每一处中文
 * （注释、日志、连接器数据本来就该保留中文）。
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { EN_DICTIONARY } from '../lib/i18n/locales/en.js';
import { CJK, listSourceFiles, stripComments } from '../scripts/i18n-scan.mjs';


/** 收集 `t('中文')` / `t("中文")` / `t(`中文`)` 形式的 msgid。 */
function collectMsgids(source) {
  const ids = new Set();
  const pattern = /\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(pattern)) {
    const text = match[2];
    if (CJK.test(text)) ids.add(text);
  }
  return ids;
}

const SOURCES = [
  'lib/index.js',
  'lib/tools.js',
  'lib/diagnostics.js',
  'lib/mcp-validation.js',
  'lib/connection-scopes.js',
  'lib/governance.js',
  'lib/web.js',
  'lib/client.js',
];

test('英文词典没有空译文', () => {
  for (const [msgid, translation] of Object.entries(EN_DICTIONARY)) {
    assert.equal(typeof translation, 'string', msgid);
    assert.notEqual(translation.trim(), '', `译文为空：${msgid}`);
  }
});

test('英文译文的占位符与 msgid 一一对应', () => {
  const placeholders = (text) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort();
  for (const [msgid, translation] of Object.entries(EN_DICTIONARY)) {
    assert.deepEqual(placeholders(translation), placeholders(msgid),
      `占位符不一致：${msgid} -> ${translation}`);
  }
});

test('英文译文不残留中文', () => {
  for (const [msgid, translation] of Object.entries(EN_DICTIONARY)) {
    assert.equal(CJK.test(translation), false, `译文仍含中文：${msgid} -> ${translation}`);
  }
});

test('源文件里 t() 的中文 msgid 都有英文译文', async () => {
  const missing = [];
  for (const file of SOURCES) {
    let source;
    try {
      source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    } catch {
      continue; // 文件可能尚未改造完成
    }
    for (const msgid of collectMsgids(source)) {
      if (!Object.hasOwn(EN_DICTIONARY, msgid)) missing.push(`${file}: ${msgid}`);
    }
  }
  assert.deepEqual(missing, [], `以下 msgid 缺少英文译文：\n${missing.join('\n')}`);
});

test('英文词典不含仅用于测试的占位键', () => {
  for (const msgid of Object.keys(EN_DICTIONARY)) {
    assert.notEqual(msgid.trim(), '', '空 msgid');
  }
});

/* ───────────── 浏览器面板（ui/index.html）───────────── */

/**
 * 判断某个源码位置是否位于 JS 注释中。
 *
 * 只做「按行 + 块注释区间」的判定：面板里的文档示例都出现在注释里，
 * 用这个足够区分真实调用与说明文字，也不需要完整词法分析。
 */
function commentRanges(source) {
  const ranges = [];
  // 块注释：/ * ... * /（面板内没有嵌套块注释）
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  // 行注释：从 // 到行尾，但排除已被块注释覆盖的位置。
  const insideRange = (index) => ranges.some(([from, to]) => index >= from && index < to);
  let offset = 0;
  for (const line of source.split('\n')) {
    const marker = line.indexOf('//');
    if (marker >= 0 && !insideRange(offset + marker)) {
      ranges.push([offset + marker, offset + line.length]);
    }
    offset += line.length + 1;
  }
  return ranges;
}

/** 取出面板内联脚本。 */
async function panelScript() {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  return { script: html.match(/<script>([\s\S]*?)<\/script>/)[1] };
}

/** 面板自带的英文词典（`MESSAGES.en = { ... }`）。 */
function panelDictionary(script) {
  const block = script.match(/MESSAGES\.en\s*=\s*\{([\s\S]*?)\n[ \t]*\};/);
  assert.ok(block, 'ui/index.html 应定义 MESSAGES.en');
  // 词典字面量本身可能含注释（已被 stripComments 处理），可直接求值。
  return new Function(`return {${block[1]}};`)();
}

/** 把源码里的字符串字面量还原成运行时的真实值（处理 \n 等转义）。 */
function literalValue(quote, raw) {
  try {
    return quote === '`'
      ? new Function(`return \`${raw}\`;`)()
      : new Function(`return ${quote}${raw}${quote};`)();
  } catch {
    return raw;
  }
}

test('面板里 t() 的中文 msgid 都有英文译文', async () => {
  const { script } = await panelScript();
  const dictionary = panelDictionary(script);
  const ranges = commentRanges(script);
  const inComment = (index) => ranges.some(([from, to]) => index >= from && index < to);
  const msgids = new Set();
  for (const match of script.matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
    if (!CJK.test(match[2])) continue;
    if (inComment(match.index)) continue; // 文档示例，不是真实文案
    msgids.add(literalValue(match[1], match[2]));
  }
  assert.ok(msgids.size > 200, `应覆盖面板主要文案，实际只有 ${msgids.size} 条`);
  const missing = [...msgids].filter((msgid) => !Object.hasOwn(dictionary, msgid));
  assert.deepEqual(missing, [], `面板缺少英文译文：\n${missing.join('\n')}`);
});

test('面板英文词典的占位符与 msgid 一致，且不含中文', async () => {
  const { script } = await panelScript();
  const dictionary = panelDictionary(script);
  assert.ok(Object.keys(dictionary).length > 200, '面板英文词典应有完整词条');
  const placeholders = (text) => [...String(text).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort();
  for (const [msgid, translation] of Object.entries(dictionary)) {
    assert.deepEqual(placeholders(translation), placeholders(msgid), `占位符不一致：${msgid}`);
    assert.equal(CJK.test(translation), false, `译文仍含中文：${msgid} -> ${translation}`);
  }
});

test('面板中文词典为空：中文路径不做查表，msgid 即原文', async () => {
  const { script } = await panelScript();
  assert.match(script, /const MESSAGES = \{ 'zh-CN': \{\}, en: \{\} \};/,
    '中文默认语言必须使用空词典，避免中文界面被翻译表覆盖');
});

test('客户端 bundle 的内置词典与共享英文分片完全一致', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const block = source.match(/const MESSAGES_EN = Object\.freeze\(\{([\s\S]*?)\n\t\t\}\);/);
  assert.ok(block, 'lib/client.js 应内置 MESSAGES_EN 词典');
  const inline = new Function(`return {${block[1]}};`)();
  const shared = (await import('../lib/i18n/locales/en/client.js')).default;
  assert.deepEqual(Object.keys(inline).sort(), Object.keys(shared).sort(),
    '客户端内置词典与 lib/i18n/locales/en/client.js 的 key 必须一致');
  for (const key of Object.keys(inline)) {
    assert.equal(inline[key], shared[key], `译文不一致：${key}`);
  }
});

test('lib/ 下每个 t(中文…) msgid 都有英文译文（全量，非抽样）', async () => {
  // 回归：曾有 50 条 msgid 只翻译了源码、英文词条没落盘，界面上就会回退中文，
  // 而按文件的抽样断言看不出来。这里扫全量源码，逐条比对合并后的词典。
  const root = new URL('..', import.meta.url).pathname;
  const modules = await listSourceFiles(path.join(root, 'lib'));
  assert.ok(modules.length > 20, `应扫描到全部模块，实际 ${modules.length}`);

  const missing = [];
  for (const file of modules) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/\bt\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g)) {
      const msgid = match[2];
      if (!CJK.test(msgid)) continue;
      if (!Object.hasOwn(EN_DICTIONARY, msgid)) {
        missing.push(`${path.relative(root, file)} :: ${msgid}`);
      }
    }
  }
  assert.deepEqual(
    [...new Set(missing)],
    [],
    `以下 msgid 缺英文译文，英文界面会回退中文：\n${[...new Set(missing)].join('\n')}`,
  );
});
