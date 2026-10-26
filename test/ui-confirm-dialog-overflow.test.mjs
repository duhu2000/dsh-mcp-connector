import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 回归守护：改范围时的确认框（"预览并应用"）在 MCP 工具很多时，会把底部按钮挤出视口，
// 而遮罩本身不滚动、弹窗也没有高度上限，用户点不到「应用」，只能关掉重来。
//
// 成因有两层，缺一都不够：
//   ① .confirm-box 只限宽（width/max-width），没有任何高度约束，内容多高就多高；
//   ② .confirm-mask 是 display:flex + align-items:center 且没有 overflow，
//      弹窗一旦高于视口，上下两端都被裁掉，连滚动都没有。
// 所以本文件同时守两类东西：
//   - 结构断言：CSS 必须让弹窗限高、消息体内部滚动、按钮常驻；
//   - 行为断言：把 range 变更的提示文案函数真跑一遍，确认工具清单不会整屏铺开。
const normalizeLineEndings = (source) => source.replace(/\r\n?/g, '\n');
const uiSource = normalizeLineEndings(await readFile(new URL('../ui/index.html', import.meta.url), 'utf8'));

/** 取出某条顶层 CSS 规则的正文（该规则必须以 marker 开头，到第一个 } 为止）。 */
function rule(selector) {
  const start = uiSource.indexOf(`\n  ${selector} {`);
  assert.notEqual(start, -1, `ui/index.html 必须仍定义 ${selector}`);
  const end = uiSource.indexOf('}', start);
  assert.notEqual(end, -1, `${selector} 规则必须闭合`);
  return uiSource.slice(start, end + 1);
}

test('确认框限制高度，不会把底部按钮挤出视口', () => {
  const box = rule('.confirm-box');
  assert.match(box, /max-height:\s*calc\(100vh - 48px\)/, '必须给确认框一个基于视口的最大高度');
  assert.match(box, /display:\s*flex/, '限高后需要 flex 纵向布局来分配剩余空间');
  assert.match(box, /flex-direction:\s*column/);
});

test('消息体在确认框内部滚动，标题与按钮不参与滚动', () => {
  const message = rule('.confirm-message');
  assert.match(message, /overflow-y:\s*auto/, '超长工具清单必须在消息体内部滚动');
  assert.match(message, /min-height:\s*0/, 'flex 子项默认 min-height:auto 会让消息体撑破父级容器的限高');
  assert.match(message, /flex:\s*1 1 auto/);

  assert.match(rule('.confirm-actions'), /flex:\s*0 0 auto/, '按钮区不能被压缩');
  assert.match(rule('.confirm-box h3'), /flex:\s*0 0 auto/, '标题不能被压缩');
});

test('遮罩自身可滚动，作为内容仍超高的兜底', () => {
  const mask = rule('.confirm-mask');
  assert.match(mask, /overflow-y:\s*auto/, '遮罩必须可滚动，否则 flex 居中会把溢出部分裁掉');
  assert.match(mask, /padding:\s*24px 0/, '留出上下间距，滚动到端点时内容不贴边');
});

/* ─────────────────────── 提示文案的行为验证 ─────────────────────── */

function scopeAffectedTextSource() {
  // 从上限常量开始截取，函数体依赖它。
  const start = uiSource.indexOf('  const SCOPE_TOOLS_INLINE_LIMIT = ');
  assert.notEqual(start, -1, '必须在源码里声明 SCOPE_TOOLS_INLINE_LIMIT');
  assert.notEqual(uiSource.indexOf('  function scopeAffectedText(servers) {', start), -1,
    'ui/index.html 必须仍定义 scopeAffectedText');
  const end = uiSource.indexOf('\n  function confirmDialog(', start);
  assert.notEqual(end, -1, '必须能定位 scopeAffectedText 的函数边界');
  return uiSource.slice(start, end);
}

function makeScopeAffectedText() {
  const limit = uiSource.match(/const SCOPE_TOOLS_INLINE_LIMIT = (\d+);/);
  assert.ok(limit, '必须在源码里声明 SCOPE_TOOLS_INLINE_LIMIT');
  const factory = new Function(`${scopeAffectedTextSource()}; return scopeAffectedText;`);
  return { scopeAffectedText: factory(), limit: Number(limit[1]) };
}
test('工具过多时只列前若干项并补总数，不整屏铺开', () => {
  const { scopeAffectedText, limit } = makeScopeAffectedText();
  const last = `tool_${limit}`;
  const overflow = `tool_${limit + 1}`;
  const text = scopeAffectedText([{
    serverName: 'qcc',
    tools: Array.from({ length: 60 }, (_, index) => `tool_${index + 1}`),
  }]);
  assert.ok(text.startsWith('qcc：tool_1、'), '仍要点明是哪个 Server 的哪些工具');
  assert.ok(text.includes(last), `前 ${limit} 个工具应照常列出`);
  assert.ok(!text.includes(`${overflow}、`), '超出部分不应逐条铺开');
  assert.match(text, /…等共 60 个/, '必须补总数，避免用户以为只影响几个工具');
});

test('工具不多时原样列出；没有工具时明确说尚未观察', () => {
  const { scopeAffectedText } = makeScopeAffectedText();
  assert.equal(scopeAffectedText([{ serverName: 'small', tools: ['a', 'b'] }]), 'small：a、b');
  assert.equal(scopeAffectedText([{ serverName: 'unknown', tools: [] }]), 'unknown：工具清单尚未观察');
  assert.equal(scopeAffectedText([]), '', '没有 Server 时不应凭空产生文案');
});

test('范围变更与回滚两处确认都改用截断文案，不再各自内联拼接', () => {
  assert.doesNotMatch(uiSource, /const toolText = server\.tools\?\.length/, '旧的逐条拼接已收敛到 scopeAffectedText');
  const calls = uiSource.match(/scopeAffectedText\(/g) ?? [];
  // 1 处定义 + submitScopeChange、rollbackScope 两处调用
  assert.equal(calls.length, 3, '定义 1 处、调用 2 处');
});
