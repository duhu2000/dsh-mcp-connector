/**
 * Name-only Host adapter. Never materialize schemas on the visibility event path.
 *
 * Upstream exposes definitions() on main. Published Host 0.1.2-rc.1 and
 * 0.2.1-rc.2/rc.3 instead expose view() at runtime (private in their typings).
 * Keep that legacy dependency here, read-only and shape-checked; never patch
 * the Host or retain its definitions. Pinned real-Host tests cover the bridge.
 */
import { createTranslator, DEFAULT_LOCALE } from './i18n/index.js';
const tZh = createTranslator(DEFAULT_LOCALE);

export function supportsHostToolNames(tools) {
  return typeof tools?.definitions === 'function' || typeof tools?.view === 'function';
}

export function readHostToolNames(tools, { t = tZh } = {}) {
  let names;
  if (typeof tools?.definitions === 'function') {
    const definitions = tools.definitions();
    if (!Array.isArray(definitions)) throw new Error(t("Host tools.definitions() 返回格式不兼容"));
    names = definitions.map((definition) => definition?.name);
  } else if (typeof tools?.view === 'function') {
    const view = tools.view();
    if (!(view?.visible instanceof Map)
        || !(view.knownNames instanceof Set)
        || !(view.restrictableNames instanceof Set)) {
      throw new Error(t("Host tools.view() 返回格式不兼容"));
    }
    names = [...view.visible.keys()];
  } else {
    // A schema fallback would reintroduce #178. Callers retain existing masks
    // on error and their independent execution guards remain active.
    throw new Error(t("当前 Host 不支持轻量工具名称读取，无法刷新工具可见性限制"));
  }
  if (names.some((name) => typeof name !== 'string' || !name)) {
    throw new Error(t("Host 工具名称格式不兼容"));
  }
  return [...new Set(names)].sort();
}
