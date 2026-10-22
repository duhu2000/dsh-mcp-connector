/**
 * 英文词典（服务器侧与浏览器面板共用同一份 msgid 约定）。
 *
 * msgid = 中文原文。英文词典是「中文原文 → 英文」的扁平映射，按模块拆成分片，
 * 由本文件合并。分片让多个模块可以并行翻译、各自审校，不需要争用同一个文件。
 *
 * 合并规则：同一 msgid 允许被多个分片重复提供，但**译文必须一致**；
 * 不一致直接抛错，避免同一句中文在不同入口显示两种英文。
 *
 * 新增文案时：
 *   1. 在调用点写 `t('中文原文')`（有变量时写 `t('中文 {name} 原文', { name })`）；
 *   2. 在对应分片补一条英文；缺译文不会让界面空白，会回退中文原文。
 */
import host from './en/host.js';
import tools from './en/tools.js';
import diagnostics from './en/diagnostics.js';
import validation from './en/validation.js';
import web from './en/web.js';
import shared from './en/shared.js';
import client from './en/client.js';

/**
 * 合并分片并冻结。
 *
 * @param {Record<string, Record<string, string>>} fragments 分片名 → 词典
 * @returns {Readonly<Record<string, string>>} 合并后的只读词典
 * @throws {Error} 同一 msgid 在不同分片中译文不一致时
 */
export function mergeDictionaries(fragments) {
  const merged = {};
  const owners = {};
  for (const [fragment, dictionary] of Object.entries(fragments)) {
    for (const [msgid, translation] of Object.entries(dictionary ?? {})) {
      if (typeof translation !== 'string' || translation.trim() === '') {
        throw new Error(`i18n: 分片 "${fragment}" 的 "${msgid}" 译文为空`);
      }
      if (Object.hasOwn(merged, msgid) && merged[msgid] !== translation) {
        throw new Error(
          `i18n: "${msgid}" 在分片 "${owners[msgid]}" 与 "${fragment}" 中译文不一致`
          + `（"${merged[msgid]}" / "${translation}"）`,
        );
      }
      merged[msgid] = translation;
      owners[msgid] = fragment;
    }
  }
  return Object.freeze(merged);
}

/** 合并后的英文词典。 */
export const EN_DICTIONARY = mergeDictionaries({ host, tools, diagnostics, validation, web, shared, client });

export default EN_DICTIONARY;
