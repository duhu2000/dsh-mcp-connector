/**
 * Prompt 模板工具。支持推荐的 {{variable}}，并兼容早期设计稿中的 {variable}。
 * 用户输入只在浏览器当前弹框中使用，不持久化到目录或 Host。
 */

import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js';

/** 缺省译文：中文（既有调用点与测试无需改动）。 */
const tZh = createTranslator(DEFAULT_LOCALE);

const TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}|\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}/g;

export function listPromptVariables(text) {
  const names = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(TOKEN_RE)) {
    const name = match[1] ?? match[2];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function renderPromptTemplate(text, values = {}, variables = [], { t = tZh } = {}) {
  const specs = new Map(variables.map((variable) => [variable.name, variable]));
  const missing = [];
  const rendered = String(text ?? '').replace(TOKEN_RE, (_token, doubleName, singleName) => {
    const name = doubleName ?? singleName;
    const spec = specs.get(name);
    const value = String(values[name] ?? spec?.default ?? '').trim();
    if (!value && spec?.required !== false) missing.push(spec?.label ?? name);
    return value;
  });
  if (missing.length > 0) throw new Error(t('请填写：{fields}', { fields: [...new Set(missing)].join(t('、')) }));
  return rendered.replace(/\s+([，。！？；：])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}
