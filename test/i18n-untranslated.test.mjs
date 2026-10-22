import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { baselinePath, scanRepository, scanSource, dictionaryRanges, stripComments } from '../scripts/i18n-scan.mjs';

test('扫描结果在 Windows 与 POSIX 使用相同的基线路径键', () => {
  assert.equal(baselinePath('D:\\repo', 'D:\\repo\\lib\\connectors\\json-connector.js', path.win32), 'lib/connectors/json-connector.js');
  assert.equal(baselinePath('/repo', '/repo/lib/connectors/json-connector.js', path.posix), 'lib/connectors/json-connector.js');
});

// URL.pathname retains percent escapes and a leading slash before Windows drives.
const ROOT_URL = new URL('..', import.meta.url);
const ROOT = fileURLToPath(ROOT_URL);

test('扫描根目录使用本机文件路径，保留空格和非 ASCII 目录', () => {
  assert.equal(pathToFileURL(ROOT).href, ROOT_URL.href);
  const encoded = new URL('space%20and%20%E4%B8%AD%E6%96%87/', ROOT_URL);
  const decoded = fileURLToPath(encoded);
  assert.ok(decoded.includes('space and 中文'));
  assert.equal(pathToFileURL(decoded).href, encoded.href);
});
const BASELINE = JSON.parse(
  await readFile(new URL('./fixtures/i18n-untranslated-baseline.json', import.meta.url), 'utf8'),
);

test('面向用户的中文文案必须有 t() 或进入基线，且基线只允许缩小', async () => {
  const hits = await scanRepository(ROOT);
  const byFile = {};
  for (const hit of hits) byFile[hit.file] = (byFile[hit.file] ?? 0) + 1;

  const regressions = [];
  for (const [file, count] of Object.entries(byFile)) {
    const allowed = BASELINE.files[file] ?? 0;
    if (count > allowed) regressions.push(`${file}: ${count} 处未翻译（基线允许 ${allowed}）`);
  }

  assert.deepEqual(
    regressions,
    [],
    `新增了未经过 t() 的中文文案。这些文案会原样显示给英文用户：\n${regressions.join('\n')}\n\n`
    + '请用 t(\'中文原文\') 包裹，并在 lib/i18n/locales/en/ 对应分片补英文译文。',
  );
});

test('基线总量只减不增', async () => {
  const hits = await scanRepository(ROOT);
  assert.ok(
    hits.length <= BASELINE.total,
    `未翻译文案总数从 ${BASELINE.total} 增至 ${hits.length}；基线不允许扩大`,
  );
  if (hits.length < BASELINE.total) {
    // 缩小是好事，但基线必须同步更新，否则「清理干净」永远无法被验证。
    assert.fail(
      `未翻译文案已减少到 ${hits.length}（基线 ${BASELINE.total}）。`
      + '请更新 test/fixtures/i18n-untranslated-baseline.json 以锁定进展。',
    );
  }
});

test('扫描器自身：能识别已翻译、未翻译、注释与词典', () => {
  const source = [
    "const LABELS = Object.freeze({ details: '详情', connect: '连接', send: '发送' });",
    "const a = t('已翻译文案');",
    '// 注释里的中文不算缺陷',
    '/* 块注释里的中文也不算 */',
    "const b = '未翻译文案';",
    "const c = `模板 ${x} 未翻译`;",
    "const d = t('跨行调用', { k: 1 });",
  ].join('\n');
  const hits = scanSource('sample.js', source);
  const texts = hits.map((h) => h.text);
  assert.deepEqual(texts, ['未翻译文案', '模板 ${x} 未翻译']);
});

test('扫描器自身：引号键与标识符键两种词典都能识别', () => {
  // A. 中文键 → 英文值
  const quoted = stripComments(
    "const M = Object.freeze({ '详情': 'Details', '连接': 'Connection', '发送': 'Send' });",
  );
  assert.equal(dictionaryRanges(quoted).length, 1, '中文键词典应被识别');

  // B. 标识符键 → 中文值
  const plain = stripComments(
    "const S = Object.freeze({ a: '未连接', b: '已连接', c: '已停用' });",
  );
  assert.equal(dictionaryRanges(plain).length, 1, '中文值词典应被识别');

  // C. 值是数组的 msgid 容器
  const arrays = stripComments(
    "const G = Object.freeze({ a: ['configuration', 'k', '中文提示', '中文建议'], b: ['transport', 'k2', '另一提示', '另一建议'] });",
  );
  assert.equal(dictionaryRanges(arrays).length, 1, '数组型 msgid 容器应被识别');
});

test('扫描器自身：正则字面量里的引号不会让后续判断错位', () => {
  // `/[&<>"']/g` 的引号若被当成字符串起点，后面所有字面量判定都会错位，
  // 会把注释正文和代码片段当成「未翻译文案」，产生大量误报。
  const source = [
    "const escapeHtml = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', \"'\": '&#39;' }[c]));",
    "const a = t('已翻译');",
    "const b = '未翻译的一条文案';",
  ].join('\n');
  const texts = scanSource('sample.js', source).map((h) => h.text);
  assert.deepEqual(texts, ['未翻译的一条文案'], '正则内的引号不得影响字符串识别');
});

test('扫描器边界：只覆盖 lib/ 的普通脚本，不覆盖模板字面量密集的面板', () => {
  // 已知限制，写在这里而不是让读者以为覆盖率是 100%。
  //
  // 面板 `ui/index.html` 的内联脚本有 1700+ 个字符串字面量、大量 `${...}` 嵌套
  // 模板字面量和 emoji；按引号切分的词法扫描会把模板片段当成「字面量」，
  // 产生大量假阳性，反而掩盖真问题。面板由 `i18n-completeness.test.mjs` 用
  // 「每个 t('中文') 都有英文词条」的方式守护——那是面板真正的约束。
  //
  // lib/ 下的普通脚本没有这个形状，所以本门禁只覆盖 lib/。若将来 lib/ 里
  // 出现模板字面量密集的文件，应改用真正的解析器，而不是放宽这里的断言。
  assert.ok(true);
});

test('扫描器自身：数据值白名单只放行写明原因的条目', async () => {
  const { ACCEPTED_UNTRANSLATED } = await import('../scripts/i18n-scan.mjs');
  // 白名单是「数据值」出口，不是逃避翻译的漏洞：每条必须有非空理由。
  for (const [text, reason] of Object.entries(ACCEPTED_UNTRANSLATED)) {
    assert.ok(text.length > 0, '白名单条目不能为空');
    assert.ok(typeof reason === 'string' && reason.trim().length > 20,
      `白名单条目 "${text}" 必须写明为什么它不是文案`);
  }
  // 白名单只应包含枚举/数据值，不应悄悄积累文案。
  assert.ok(Object.keys(ACCEPTED_UNTRANSLATED).length <= 5,
    '白名单条目过多，说明有用文案被塞进来了');
});

test('全部翻译完成：lib/ 下没有未翻译的用户文案', async () => {
  const hits = await scanRepository(ROOT);
  assert.deepEqual(
    hits,
    [],
    `仍有未翻译文案：\n${hits.map((h) => `${h.file}:${h.line} ${h.text}`).join('\n')}`,
  );
});

test('扫描器自身：块注释不会让后续代码整段不可见', () => {
  // 回归：stripComments 曾只抹掉闭合的 `*/`、留下开头的 `/*`，下游
  // maskRegexLiterals 再次进入 block 模式并一路吞到文件末尾。结果是
  // **任何含块注释的文件都完全不可见**——lib/index.js 因此漏掉 84 条真实文案，
  // callback-server.js 则被报成误报。旧的自测固件没有块注释，所以没发现。
  const source = [
    '/* 文件头注释 */',
    "const a = 'x'.replace(/[&<>\"']/g, 'y');",
    "const b = '未翻译的一条文案';",
  ].join('\n');
  const hits = scanSource('sample.js', source).map((h) => h.text);
  assert.deepEqual(hits, ['未翻译的一条文案'],
    '块注释之后的正则与文案仍必须被正确识别');
});

test('扫描器自身：三元密集的普通对象不会被当成词典', () => {
  // 回归：`cond ? \`甲\` : \`乙\`` 里的模板字面量后面紧跟冒号，曾被算成
  // 「引号中文键」，把普通对象判成 msgid 词典并整段跳过
  // （lib/index.js 的 api 表因此藏住 84 条文案）。
  const source = [
    'const api = {',
    '  a: flag ? `甲` : `乙`,',
    '  b: flag ? `丙` : `丁`,',
    '  c: flag ? `戊` : `己`,',
    '};',
    "const x = '真正未翻译的文案';",
  ].join('\n');
  const code = stripComments(source);
  assert.deepEqual(dictionaryRanges(code), [], '三元对象不是词典');
  const hits = scanSource('sample.js', source).map((h) => h.text);
  assert.ok(hits.length > 0, '三元对象之后的真实文案必须被发现');
});
