import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const uiSource = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

test('内置 Prompt 有默认值时直接发送，无默认值才补全参数', () => {
  assert.match(uiSource, /function promptNeedsInput\(prompt\)/);
  assert.match(uiSource, /if \(!promptNeedsInput\(prompt\)\) \{\s*window\.__mcp\.sendPrompt\(renderResolvedPrompt\(prompt, \{\}\)\)/);
  assert.match(uiSource, /t\(promptNeedsInput\(prompt\) \? 'fillSend' : 'send'\)/);
});

test('参数弹框与发送提示位于详情弹框之上', () => {
  assert.match(uiSource, /\.detail-overlay \{[\s\S]*?z-index: 100;/);
  assert.match(uiSource, /\.modal-mask \{[^}]*z-index: 200;/);
  assert.match(uiSource, /\.toast \{[\s\S]*?z-index: 300;/);
});
