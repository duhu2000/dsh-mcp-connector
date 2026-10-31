import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  isSupportedLocale,
  resolveLocale,
  interpolate,
  createTranslator,
} from '../lib/i18n/index.js';
import { EN_DICTIONARY, mergeDictionaries } from '../lib/i18n/locales/en.js';

test('支持的语言集合固定为中英，默认语言保持中文', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.deepEqual([...SUPPORTED_LOCALES], ['zh-CN', 'en']);
  assert.deepEqual({ ...LOCALE_LABELS }, { 'zh-CN': '中文', en: 'English' });
});

test('语言标签归一化覆盖大小写、下划线与区域子标签', () => {
  for (const value of ['zh', 'zh-CN', 'zh_CN', 'zh-Hans-CN', 'ZH-cn', '  zh  ']) {
    assert.equal(normalizeLocale(value), 'zh-CN', value);
  }
  for (const value of ['en', 'EN', 'en-US', 'en_GB', 'en-Latn-US']) {
    assert.equal(normalizeLocale(value), 'en', value);
  }
  for (const value of ['fr', 'de-DE', 'ja', '', '   ', null, undefined, 42, {}, []]) {
    assert.equal(normalizeLocale(value), undefined, String(value));
  }
  assert.equal(isSupportedLocale('en'), true);
  assert.equal(isSupportedLocale('zh'), false, '未归一化的标签不算支持');
});

test('配置解析：显式语言优先，auto 才看 Host 与环境，未知语言回退中文', () => {
  const env = { LANG: 'en_US.UTF-8' };
  // 显式选择不受环境变量影响：这是中文优先产品的默认安全值。
  assert.equal(resolveLocale('zh-CN', { env }), 'zh-CN');
  assert.equal(resolveLocale('zh', { env: { LANG: 'zh_CN.UTF-8' } }), 'zh-CN');
  assert.equal(resolveLocale('en', { env: { LANG: 'zh_CN.UTF-8' } }), 'en');
  // auto：Host 优先，其次 LC_ALL → LC_MESSAGES → LANG。
  assert.equal(resolveLocale('auto', { env }), 'en');
  assert.equal(resolveLocale('auto', { env: { LANG: 'zh_CN.UTF-8' } }), 'zh-CN');
  assert.equal(resolveLocale('auto', { hostLocale: 'en-US', env: { LANG: 'zh_CN.UTF-8' } }), 'en');
  assert.equal(resolveLocale('auto', { env: { LC_ALL: 'fr_FR', LANG: 'zh_CN.UTF-8' } }), 'zh-CN');
  assert.equal(resolveLocale('auto', { env: { LC_MESSAGES: 'en_GB', LANG: 'zh_CN.UTF-8' } }), 'en');
  // 未知 / 缺失 / C locale 一律回退中文默认。
  assert.equal(resolveLocale('auto', { env: {} }), 'zh-CN');
  assert.equal(resolveLocale('auto', { env: { LANG: 'fr_FR.UTF-8' } }), 'zh-CN');
  assert.equal(resolveLocale('fr', { env }), 'zh-CN');
  assert.equal(resolveLocale(undefined, { env }), 'zh-CN');
  assert.equal(resolveLocale('', { env }), 'zh-CN');
  assert.equal(resolveLocale(null, { env }), 'zh-CN');
});

test('占位符插值只替换已提供字段，缺失占位符保留字面量', () => {
  assert.equal(interpolate('已启用 {name}', { name: 'qcc' }), '已启用 qcc');
  assert.equal(interpolate('{a} 与 {b}', { a: 1, b: 2 }), '1 与 2');
  assert.equal(interpolate('缺 {missing}', {}), '缺 {missing}');
  assert.equal(interpolate('缺 {missing}', { missing: null }), '缺 {missing}');
  assert.equal(interpolate('缺 {missing}', { missing: undefined }), '缺 {missing}');
  assert.equal(interpolate('{name} {name}', { name: 'x' }), 'x x');
  assert.equal(interpolate('无占位符', { name: 'x' }), '无占位符');
  assert.equal(interpolate('{value}', { value: 0 }), '0', '0 与 false 是有效值');
  assert.equal(interpolate('{value}', { value: false }), 'false');
  assert.equal(interpolate('不该注入 {a}', { a: '<img onerror=x>' }), '不该注入 <img onerror=x>',
    '插值不做转义：调用方负责在写入 HTML 前转义');
  assert.equal(interpolate('', { a: 1 }), '');
  assert.equal(interpolate('原样'), '原样');
  assert.equal(interpolate('原样', null), '原样');
});

test('中文 translator 不做查表：msgid 即原文，缺词典也不影响中文界面', () => {
  const t = createTranslator('zh-CN');
  assert.equal(t.locale, 'zh-CN');
  assert.equal(t('已连接'), '已连接');
  assert.equal(t('已启用 "{name}"', { name: 'qcc' }), '已启用 "qcc"');
  assert.equal(t.missing('任意中文'), false, '中文永不缺译文');
  // 未归一化的标签也能工作。
  assert.equal(createTranslator('zh').locale, 'zh-CN');
  assert.equal(createTranslator('fr').locale, 'zh-CN', '不支持的语言回退中文');
  assert.equal(createTranslator(undefined).locale, 'zh-CN');
});

test('英文 translator 查表，缺失时回退中文原文而不是空串或 key', () => {
  const t = createTranslator('en', { en: { '已连接': 'Connected', '已启用 "{name}"': 'Enabled "{name}"' } });
  assert.equal(t.locale, 'en');
  assert.equal(t('已连接'), 'Connected');
  assert.equal(t('已启用 "{name}"', { name: 'qcc' }), 'Enabled "qcc"');
  assert.equal(t('没有译文的句子'), '没有译文的句子', '缺译文回退中文原文');
  assert.equal(t.missing('没有译文的句子'), true);
  assert.equal(t.missing('已连接'), false);
  // 没有词典时不会崩：整段回退中文。
  assert.equal(createTranslator('en')('原文'), '原文');
  // 原型链上的键不能被当成译文（避免 constructor / toString 之类的假命中）。
  assert.equal(t('constructor'), 'constructor');
  assert.equal(t('toString'), 'toString');
});

test('英文词典分片合并：重复 msgid 允许，冲突译文直接报错', () => {
  const merged = mergeDictionaries({
    a: { '已连接': 'Connected' },
    b: { '已连接': 'Connected', '目录': 'Catalog' },
  });
  assert.deepEqual({ ...merged }, { '已连接': 'Connected', '目录': 'Catalog' });
  assert.equal(Object.isFrozen(merged), true);
  assert.throws(() => mergeDictionaries({ a: { '已连接': 'Connected' }, b: { '已连接': 'Online' } }),
    /译文不一致/);
  assert.throws(() => mergeDictionaries({ a: { '已连接': '' } }), /译文为空/);
  assert.throws(() => mergeDictionaries({ a: { '已连接': '   ' } }), /译文为空/);
  assert.throws(() => mergeDictionaries({ a: { '已连接': null } }), /译文为空/);
  assert.deepEqual({ ...mergeDictionaries({}) }, {});
  assert.deepEqual({ ...mergeDictionaries({ a: undefined }) }, {});
});

test('已合并的英文词典是扁平字符串映射，且不含空译文', () => {
  assert.equal(Object.isFrozen(EN_DICTIONARY), true);
  for (const [msgid, translation] of Object.entries(EN_DICTIONARY)) {
    assert.equal(typeof msgid, 'string');
    assert.equal(typeof translation, 'string');
    assert.notEqual(translation.trim(), '', msgid);
  }
});

test('插件不直接访问 ctx.locale：locale 是仅浏览器端服务，Host 侧没有', async () => {
  // 回归：Cordis 的上下文代理在读取未注入的服务时直接抛
  // `cannot get property "locale" without inject`，可选链（`ctx.locale?.`）拦不住，
  // 曾导致插件在 profile 中装载失败（application: failed）。
  // 而且 `locale` 是仅浏览器端的服务（98 个 Host 服务里没有它），
  // 在 Host 侧注入等待永远等不到，会静默退回中文。
  const raw = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  // 只看代码：注释里会引用错误写法作为说明。
  const source = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.equal(
    /ctx\.locale\s*\??\./.test(source),
    false,
    'lib/index.js 不能访问 ctx.locale：它是仅浏览器端服务，Host 侧访问会抛错'
  );
});

test('语言偏好从 Host loader 的 locale 插件配置读取', async () => {
  const raw = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  const fn = raw.match(/function readHostLocalePreference\(ctx\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'lib/index.js 应提供 readHostLocalePreference');
  const read = new Function(`return ${fn[0]};`)();
  const LOCALE = '@deepseek-ai/dsh-client-locale';
  const make = (config) => ({ loader: { entries: function* () { yield { options: { name: LOCALE, config } }; } } });
  // 用户在 DSH 里选了英文：Host 必须读到，否则面板永远停在中文。
  assert.equal(read(make({ preference: 'en' })), 'en');
  assert.equal(read(make({ preference: 'zh' })), 'zh');
  assert.equal(read(make({ preference: 'en-US' })), 'en-US');
  // 未设置偏好 = 跟随浏览器，Host 侧没有单值可用。
  assert.equal(read(make({})), undefined);
  assert.equal(read(make({ preference: '' })), undefined);
  // 插件未安装 / loader 不可用：都不得抛错。
  assert.equal(read({ loader: { entries: function* () { yield { options: { name: 'other', config: {} } }; } } }), undefined);
  assert.equal(read({}), undefined);
});

test('未声明 locale 时，auto 之外的配置完全不触碰语言服务', async () => {
  // 默认中文不应要求宿主提供 locale 服务。
  assert.equal(resolveLocale(undefined, {}), 'zh-CN');
  assert.equal(resolveLocale('zh-CN', {}), 'zh-CN');
  assert.equal(resolveLocale('en', {}), 'en');
});

test('客户端通过 ctx.reflect.get 读取可选 locale 服务，不用 ctx.locale', async () => {
  // 回归：`locale` 没有写进 client bundle 的 inject 列表，Cordis 的上下文代理在读取
  // 未注入属性时直接抛 `cannot get property "locale" without inject`，可选链拦不住。
  // 旧实现用 try/catch 吞掉异常 → activeLocale 永远是中文，侧边栏/设置卡片即使
  // 用户选了英文也显示中文。reflect.get 是官方「不要求 inject」的读取入口。
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const decl = src.match(/const inject = \[([\s\S]*?)\];/)[1];
  assert.equal(/"locale"/.test(decl), false,
    'locale 不得写进 inject 列表：本地化不能成为 bundle 的硬依赖（DESIGN-issue-63 §6.6）');
  // Strip line comments AND block-comment bodies (` * ...`, `/* ... */`).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.equal(/ctx\??\.locale\b/.test(code), false,
    '客户端不得直接访问 ctx.locale，必须走 ctx.reflect.get("locale")');
  assert.match(code, /ctx\?\.reflect\?\.get\?\.\("locale"\)/,
    '客户端应通过 ctx.reflect.get("locale") 读取语言服务');
});

test('侧边栏 label 传函数，语言变化后无需重新注册即可生效', async () => {
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  // 字符串 label 在注册时被固化；槽位支持 thunk，每次投影重新读取。
  assert.match(src, /label:\s*\(\)\s*=>\s*t\("MCP连接器"\)/,
    '侧边栏 label 必须传函数，否则语言晚于 apply 就绪时会停在中文');
});
