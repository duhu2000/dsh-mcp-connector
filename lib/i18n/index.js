/**
 * 国际化（i18n）核心：语言标签归一化、词典查询、占位符插值。
 *
 * 设计取舍——**以中文原文作为 msgid**（gettext 风格）：
 *   - 中文文案已经遍布调用点、测试断言与截图，原文即键可保证中文界面零回归：
 *     词典缺项时 `t()` 原样返回中文，永远不会出现空白或英文串进中文界面。
 *   - 每个源文件可以独立改造，不需要先维护一张全局 key 注册表，减少并行改动冲突。
 *   - 英文词典是「中文原文 → 英文」的纯映射，便于逐条审校与后续增量补译。
 *
 * 约定：
 *   - `t(msgid, params)`：`params` 用 `{name}` 占位符插值，见 `interpolate()`。
 *   - 词典里**不存在**的键回退到 msgid（中文），绝不回退成空串。
 *   - 未提供值的占位符保持字面量，便于测试直接断言插值缺口，而不是静默吞掉。
 *
 * 本模块是纯函数模块：不读环境变量以外的状态、不依赖 DSH、不发网络请求，
 * 因此可同时被 Host 侧（lib/*.js）与浏览器侧（ui/index.html）复用。
 */

/** 默认语言：与既有中文界面一致，任何解析失败都回退到它。 */
export const DEFAULT_LOCALE = 'zh-CN';

/** 支持的语言（顺序即选择器展示顺序）。 */
export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en']);

/** 语言自称（选择器展示用，写在各自语言里）。 */
export const LOCALE_LABELS = Object.freeze({ 'zh-CN': '中文', en: 'English' });

/**
 * 归一化任意语言标签：BCP 47 大小写、下划线写法、区域子标签都收敛到支持的语言。
 *
 * `zh` / `zh-CN` / `zh-Hans-CN` / `zh_CN` → `'zh-CN'`；`en` / `en-US` / `EN` → `'en'`；
 * 其它语言或不合法输入返回 `undefined`（由调用方决定回退）。
 *
 * @param {unknown} value 待归一化的标签
 * @returns {'zh-CN'|'en'|undefined} 支持的语言 id
 */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return undefined;
  const tag = value.trim().toLowerCase();
  if (tag === '') return undefined;
  const [primary] = tag.split(/[-_]/);
  if (primary === 'zh') return 'zh-CN';
  if (primary === 'en') return 'en';
  return undefined;
}

/** 判断语言 id 是否被支持（已归一化）。 */
export function isSupportedLocale(value) {
  return SUPPORTED_LOCALES.includes(value);
}

/**
 * 解析插件配置里的 `locale`：
 *   - 未设置（`undefined` / `null` / 空串）→ `DEFAULT_LOCALE`，即既有的中文界面；
 *   - `'zh-CN'` / `'en'`（含 `zh`、`en-US` 等写法）→ 明确选择；
 *   - `'auto'` → 先看 Host 提供的语言，再看进程环境（`LC_ALL` → `LC_MESSAGES` → `LANG`），
 *     全都无法识别时回退 `DEFAULT_LOCALE`。
 *
 * 为什么未设置不等于 `auto`：本产品以中文为默认界面。若把「未配置」当成自动检测，
 * 一个 `LANG=en_US` 的机器会在升级后**静默变成英文界面**，这是明确的回归。
 * 因此自动检测必须由部署方显式写 `locale: 'auto'` 才生效。
 *
 * @param {unknown} value 配置值
 * @param {{ hostLocale?: unknown, env?: Record<string, string|undefined> }} [options]
 * @returns {'zh-CN'|'en'} 最终语言
 */
export function resolveLocale(value, { hostLocale, env = process.env } = {}) {
  const configured = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (configured === '') return DEFAULT_LOCALE;
  if (configured !== 'auto') return normalizeLocale(configured) ?? DEFAULT_LOCALE;
  const fromHost = normalizeLocale(hostLocale);
  if (fromHost !== undefined) return fromHost;
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
    const fromEnv = normalizeLocale(env?.[name]);
    if (fromEnv !== undefined) return fromEnv;
  }
  return DEFAULT_LOCALE;
}

/**
 * `{name}` 占位符插值。
 *
 * 只替换调用方显式提供的字段：缺失的占位符保持字面量（`{name}`），
 * 这样漏传参数在测试里是可断言的缺陷，而不是被静默替换成空串。
 * `params` 中的 `undefined` / `null` 视为「未提供」。
 *
 * @param {string} template 含 `{name}` 的模板
 * @param {Record<string, unknown>} [params] 插值字段
 * @returns {string} 插值结果
 */
export function interpolate(template, params) {
  if (typeof template !== 'string' || template === '') return '';
  if (params === undefined || params === null || typeof params !== 'object') return template;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => {
    const value = params[name];
    return value === undefined || value === null ? token : String(value);
  });
}

const EMPTY_DICTIONARY = Object.freeze({});

/**
 * 创建当前语言的翻译函数。
 *
 * 默认语言（中文）不需要词典：msgid 本身就是中文原文，直接返回，
 * 因此中文路径没有查表成本，也不存在「中文缺键」这种状态。
 *
 * @param {unknown} locale 语言（可传未归一化的标签）
 * @param {Record<string, Record<string, string>>} [dictionaries] 语言 → 词典
 * @returns {((msgid: string, params?: Record<string, unknown>) => string) & {
 *   locale: string, available: string[], missing: (msgid: string) => boolean }}
 *   `t` 函数；`t.locale` 为生效语言，`t.missing()` 用于词典完备性检查
 */
export function createTranslator(locale, dictionaries = {}) {
  const active = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  const dictionary = active === DEFAULT_LOCALE
    ? EMPTY_DICTIONARY
    : (dictionaries?.[active] ?? EMPTY_DICTIONARY);

  const t = (msgid, params) => {
    const key = typeof msgid === 'string' ? msgid : String(msgid ?? '');
    const template = Object.hasOwn(dictionary, key) ? dictionary[key] : key;
    return interpolate(template, params);
  };
  t.locale = active;
  t.available = [...SUPPORTED_LOCALES];
  t.missing = (msgid) => active !== DEFAULT_LOCALE && !Object.hasOwn(dictionary, msgid);
  return t;
}
