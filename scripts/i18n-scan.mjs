/**
 * 中文文案覆盖扫描器。
 *
 * 目的：找出「面向用户的中文字面量没有经过 `t()`」的地方。
 *
 * 为什么不直接用正则：中文既会出现在**代码**里（未翻译的文案），也会出现在
 * 三处**合法**位置——注释、词典字面量（msgid 就是中文原文）、以及已包在
 * `t(...)` 里的实参。朴素的逐行正则会把这三类都算成缺陷，产生大量噪声，
 * 最后没人会看这个检查。所以这里做三件事：
 *
 *   1. 逐字符扫描剥离注释（字符串里的 `//`、正则里的引号都不会误判）；
 *   2. 识别「中文占多数」的对象字面量，视为 msgid 词典整体跳过；
 *   3. 从字面量**向外**看，判断它是不是 `t(...)` 的实参（支持跨行）。
 *
 * 只做词法级判断，不引入解析器依赖：本仓库没有 AST 依赖，且这里关心的是
 * 「这个字符串有没有被 t() 包住」，词法信息已经足够。
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** 是否含中日韩统一表意文字。 */
export const CJK = /[\u4e00-\u9fff]/;

/**
 * 剥离 JS 注释，保留字符串与模板字面量原样。
 *
 * @param {string} source 源码
 * @returns {string} 与原文等长（注释被替换为空格，保留换行以便定位行号）
 */
export function stripComments(source) {
  // 用 split('') 而不是展开运算符：`[...source]` 按**码点**迭代，而 `source[i]`
  // 按**码元**索引。面板里有 29 个 emoji（💬 🔗 🔑），一个 emoji 占 2 个码元，
  // 展开后数组会短一截，所有偏移随之错位，字符串切分全乱（曾把注释正文当成文案）。
  const out = source.split('');
  let i = 0;
  let mode = 'code'; // code | line | block | sq | dq | tpl | regex
  let inClass = false;
  // 这些字符之后的 `/` 更可能是正则字面量开头，而不是除号。
  const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n']);
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      // 注释起始的 `//`、`/*` 本身必须抹掉：否则 `stripComments` 的输出里还留着
      // `/*`，下游 `maskRegexLiterals` 会把它当成块注释再次进入 block 模式、
      // 一路吞到文件末尾——整份文件对扫描器不可见（曾导致 index.js 里 84 条
      // 真实文案与 callback-server 的误报）。
      if (c === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        mode = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        mode = 'block';
        i += 2;
        continue;
      }
      if (c === '/') {
        // 正则字面量：`/[&<>"']/g` 里的引号若被当成字符串起点，后面所有判定都会错位。
        let k = i - 1;
        while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k -= 1;
        const previous = k >= 0 ? source[k] : '\n';
        if (REGEX_PRECEDERS.has(previous)) { mode = 'regex'; inClass = false; i += 1; continue; }
        i += 1;
        continue;
      }
      if (c === "'") { mode = 'sq'; i += 1; continue; }
      if (c === '"') { mode = 'dq'; i += 1; continue; }
      if (c === '`') { mode = 'tpl'; i += 1; continue; }
      i += 1;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') mode = 'code'; else out[i] = ' ';
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        mode = 'code';
        continue;
      }
      if (c !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    if (mode === 'regex') {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { inClass = true; i += 1; continue; }
      if (c === ']') { inClass = false; i += 1; continue; }
      if (c === '/' && !inClass) mode = 'code';
      i += 1;
      continue;
    }
    // 字符串/模板内部：原样保留，处理转义与结束符。
    if (c === '\\') { i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) {
      mode = 'code';
    }
    i += 1;
  }
  return out.join('');
}

/**
 * 把正则字面量的**内容**替换为空格（保留长度与位置）。
 *
 * `stripComments` 已经能正确跳过正则（否则注释判定会错位），但后续按引号
 * 切分字符串时，`/[&<>"']/g` 里的引号仍会被当成字符串起点，把后面真正的
 * 字符串吞掉。所以在切字符串之前先把正则内容抹平。
 *
 * @param {string} source 已剥离注释的源码
 * @returns {string} 等长、正则内容被空格替换的源码
 */
export function maskRegexLiterals(source) {
  // 用 split('') 而不是展开运算符：`[...source]` 按**码点**迭代，而 `source[i]`
  // 按**码元**索引。面板里有 29 个 emoji（💬 🔗 🔑），一个 emoji 占 2 个码元，
  // 展开后数组会短一截，所有偏移随之错位，字符串切分全乱（曾把注释正文当成文案）。
  const out = source.split('');
  let i = 0;
  let mode = 'code';
  let inClass = false;
  const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n']);
  while (i < source.length) {
    const c = source[i];
    if (mode === 'code') {
      if (c === '/' && source[i + 1] === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && source[i + 1] === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'" ) { mode = 'sq'; i += 1; continue; }
      if (c === '"' ) { mode = 'dq'; i += 1; continue; }
      if (c === '`' ) { mode = 'tpl'; i += 1; continue; }
      if (c === '/') {
        let k = i - 1;
        while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k -= 1;
        if (REGEX_PRECEDERS.has(k >= 0 ? source[k] : '\n')) { mode = 'regex'; inClass = false; i += 1; continue; }
      }
      i += 1;
      continue;
    }
    if (mode === 'regex') {
      if (c === '\\') { out[i] = ' '; if (i + 1 < out.length) out[i + 1] = ' '; i += 2; continue; }
      if (c === '[') { inClass = true; out[i] = ' '; i += 1; continue; }
      if (c === ']') { inClass = false; out[i] = ' '; i += 1; continue; }
      if (c === '/' && !inClass) { mode = 'code'; i += 1; continue; }
      out[i] = ' ';
      i += 1;
      continue;
    }
    if (c === '\\') { i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    i += 1;
  }
  return out.join('');
}

/**
 * 找出「词典」对象字面量区间。
 *
 * 判据：一个 `const NAME = { ... }` / `Object.freeze({ ... })` 的体内，字符串有
 * 六成以上是中文。这类对象就是 msgid 表（例如 `CONNECTION_STATE_MSGIDS`、
 * `LABELS`、`MESSAGES_EN`），其中的中文是**合法**的，整体跳过。
 *
 * @param {string} source 已剥离注释的源码
 * @returns {Array<[number, number]>} 起止偏移
 */
export function dictionaryRanges(source) {
  const ranges = [];
  // 也覆盖 `const X = { k: ['枚举', '代码', '中文提示', '中文建议'] }` 与
  // 函数内的 `const values = { k: [...] }`：它们同样是 msgid 容器，
  // 只是值放在数组里而不是直接作值。
  // 也要认 `MESSAGES.en = { ... }` / `EXPORTS.x = { ... }` 这类**赋值**形式：
  // 面板的英文词典就是分两步写的（先 `const MESSAGES = {...}`，再
  // `MESSAGES.en = {...}`），只认 `const` 会把它当成正文。
  for (const match of source.matchAll(/(?:const\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*(?:Object\s*\.\s*freeze\s*\(\s*)?\{/g)) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(match.index, i);
    const strings = [...body.matchAll(/(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g)].map((m) => m[2]);
    if (strings.length < 3) continue;
    // 词典有两种写法，必须都认：
    //   A. 引号中文键 → 英文值：`'中文原文': 'English'`（MESSAGES_EN）
    //      中文只占约一半，所以「全部字符串」比例会漏判，要看键。
    //   B. 标识符键 → 中文值：`disconnected: '未连接'`（状态/阶段/指引表）
    //      键没有引号，所以「键」判据会漏判，要看值。
    // 键判据只认 `'字面量':` 且**排除三元分支**：`cond ? \`甲\` : \`乙\`` 里的
    // `` `甲` `` 后面也紧跟冒号，会把普通对象（如 index.js 的 api 表）误判成
    // msgid 词典，从而整段代码被跳过——曾因此漏掉 84 条真实文案。
    const ternaryCount = (body.match(/\?/g) ?? []).length;
    const quotedKeys = [...body.matchAll(/(['"])((?:\\[\s\S]|(?!\1)[^\\])*?)\1\s*:/g)].map((m) => m[2]);
    const keyRatio = quotedKeys.length ? quotedKeys.filter((k) => CJK.test(k)).length / quotedKeys.length : 0;
    const cjkStrings = strings.filter((s) => CJK.test(s)).length;
    const valueRatio = cjkStrings / strings.length;
    // C. 值是数组的 msgid 容器：`auth: ['authentication', '中文提示', '中文建议']`。
    //    每条记录里英文字符串（枚举/代码）会拉低比例，但中文字符串的**绝对数量**
    //    很多且没有任何 `t()` 包裹——这类字面量表就是词典。
    const bulkMsgids = cjkStrings >= 3 && !/\bt\(/.test(body);
    // 三元密集的对象不是词典：真正的 msgid 表里几乎不会有 `? :`。
    const ternaryHeavy = ternaryCount >= 3;
    if (!ternaryHeavy && (keyRatio > 0.6 || valueRatio > 0.6 || bulkMsgids)) {
      ranges.push([match.index, i]);
    }
  }
  return ranges;
}

/**
 * 有意不翻译的字符串：枚举/数据值，翻译会破坏相等比较或持久化。
 *
 * 每一条都必须写明原因。这里是**白名单**，不是「懒得翻」的出口：新增条目
 * 需要在 review 里解释清楚为什么它不是文案。
 */
export const ACCEPTED_UNTRANSLATED = Object.freeze({
  // 目录分类的**数据值**：`catalog.json` 里就是中文（"category": "其他"），
  // 面板 `CATEGORY_MAP[c] || '其他'` 与 `matchesMarketFilters` 按此值做相等比较，
  // 并会持久化进 catalog store。英文模式下把它翻译成 "Other" 会让默认分类的卡片
  // 从所有分类筛选里消失。分类的**显示名**由面板 `t(cat.label)` 单独翻译。
  '其他': 'catalog category data value, equality-compared in the panel and persisted',
});

/**
 * 判断偏移是否落在某个区间内。
 *
 * @param {number} index 偏移
 * @param {Array<[number, number]>} ranges 区间列表
 * @returns {boolean} 是否在区间内
 */
function within(index, ranges) {
  return ranges.some(([from, to]) => index >= from && index < to);
}

/**
 * 扫描单个文件里「未经过 t() 的中文字面量」。
 *
 * @param {string} file 文件路径（仅用于报告）
 * @param {string} source 源码
 * @returns {Array<{file: string, line: number, text: string}>} 命中项
 */
export function scanSource(file, source) {
  const code = maskRegexLiterals(stripComments(source));
  const dicts = dictionaryRanges(code);
  const hits = [];
  for (const match of code.matchAll(/(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g)) {
    const text = match[2];
    if (!CJK.test(text)) continue;
    if (within(match.index, dicts)) continue;
    // 从字面量向外跳过空白，看前面是不是 `t(`。
    let j = match.index - 1;
    while (j >= 0 && /\s/.test(code[j])) j -= 1;
    const isCall = code[j] === '(' && /(?:^|[^A-Za-z0-9_$])t$/.test(code.slice(Math.max(0, j - 2), j));
    if (isCall) continue;
    // 模板字面量里已经含 t(...) 插值的，视为已本地化。
    if (match[1] === '`' && /\bt\(/.test(text)) continue;
    // 白名单：数据/枚举值，翻译会破坏相等比较或持久化（见 ACCEPTED_UNTRANSLATED）。
    if (Object.hasOwn(ACCEPTED_UNTRANSLATED, text.trim())) continue;
    hits.push({ file, line: code.slice(0, match.index).split('\n').length, text: text.replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

/**
 * 递归列出目录下的 `.js` 文件，跳过词典目录与 node_modules。
 *
 * @param {string} dir 目录
 * @returns {Promise<string[]>} 文件路径
 */
export async function listSourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'i18n' || entry.name === 'node_modules') continue;
      out.push(...await listSourceFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 扫描整个 `lib/` 目录。
 *
 * @param {string} root 仓库根目录
 * @returns {Promise<Array<{file: string, line: number, text: string}>>} 命中项
 */
export function baselinePath(root, file, pathApi = path) {
  return pathApi.relative(root, file).split(pathApi.sep).join('/');
}

export async function scanRepository(root) {
  const files = await listSourceFiles(path.join(root, 'lib'));
  const hits = [];
  for (const file of files) {
    hits.push(...scanSource(baselinePath(root, file), readFileSync(file, 'utf8')));
  }
  return hits;
}
