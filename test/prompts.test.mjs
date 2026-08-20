import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPromptVariables, renderPromptTemplate } from '../lib/prompts.js';

test('Prompt 模板提取变量并保持首次出现顺序', () => {
  assert.deepEqual(listPromptVariables('查询 {{company}} 的 {{topic}}，比较 {company}'), ['company', 'topic']);
});

test('Prompt 模板渲染必填值并兼容默认值', () => {
  const variables = [
    { name: 'company', label: '企业名称', required: true },
    { name: 'topic', label: '主题', required: false, default: '股东结构' },
  ];
  assert.equal(renderPromptTemplate('查询 {{company}} 的 {{topic}}', { company: '企查查科技股份有限公司' }, variables), '查询 企查查科技股份有限公司 的 股东结构');
  assert.throws(() => renderPromptTemplate('查询 {{company}}', {}, variables), /企业名称/);
});
