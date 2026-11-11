import z from '@deepseek-ai/schemastery';

export const CONNECTOR_SETTINGS_NAMESPACE = 'mcp-connector';
export const SHOW_SIDEBAR_ENTRY_FIELD = 'showSidebarEntry';
export const ENTRY_LOCATION_FIELD = 'entryLocation';

/**
 * 入口展示位置的三个档位。
 *
 * - `both`：侧栏图标与设置页的快捷打开按钮都可用；
 * - `sidebar`（默认）：只保留侧栏图标，设置页只负责改偏好；
 * - `settings`：隐藏侧栏图标，只从设置页进入。
 *
 * 三档都至少保留一处入口，避免把面板锁成打不开。
 */
export const ENTRY_LOCATIONS = ['both', 'sidebar', 'settings'];

/**
 * 归一化入口展示位置；非法值回退 `sidebar`。
 *
 * @param {unknown} value 配置值、设置文档中的值或界面传入值
 * @returns {'both'|'sidebar'|'settings'}
 */
export function normalizeEntryLocation(value) {
  return ENTRY_LOCATIONS.includes(value) ? value : 'sidebar';
}

/**
 * 把旧版布尔开关翻译成新枚举，用于没有 `entryLocation` 的历史文档。
 *
 * 旧版 `showSidebarEntry: false` 的实际效果是「侧栏不显示」，对应新版的
 * `settings`；`true` 对应 `sidebar`。不这样映射的话，曾经隐藏过入口的用户
 * 升级后会突然重新看到侧栏图标。
 *
 * @param {unknown} value 旧版布尔值
 * @returns {'sidebar'|'settings'|undefined} 无法判断时返回 undefined
 */
export function entryLocationFromLegacyFlag(value) {
  if (value === false) return 'settings';
  if (value === true) return 'sidebar';
  return undefined;
}

export const ConnectorSettings = z.object({
  [SHOW_SIDEBAR_ENTRY_FIELD]: z.boolean().default(true),
  [ENTRY_LOCATION_FIELD]: z
    .union(ENTRY_LOCATIONS.map((location) => z.const(location)))
    .default('sidebar'),
});

/**
 * Register the connector's user-facing settings only while a Settings provider
 * is present. The provider owns persistence; older DSH hosts keep the composed
 * config and continue loading the connector normally.
 */
export function installConnectorSettings(ctx, config = {}) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx?.settings?.register !== 'function') return;

    // 组合配置里没有 entryLocation 时，沿用旧开关表达的可见性偏好，
    // 让升级前后「侧栏是否出现」保持一致。
    const legacyBase = entryLocationFromLegacyFlag(config[SHOW_SIDEBAR_ENTRY_FIELD]);
    const base = config[ENTRY_LOCATION_FIELD] === undefined && legacyBase !== undefined
      ? legacyBase
      : normalizeEntryLocation(config[ENTRY_LOCATION_FIELD]);

    settingsCtx.settings.register(CONNECTOR_SETTINGS_NAMESPACE, ConnectorSettings, {
      base: {
        [SHOW_SIDEBAR_ENTRY_FIELD]: config[SHOW_SIDEBAR_ENTRY_FIELD] !== false,
        [ENTRY_LOCATION_FIELD]: base,
      },
    });
  });
}
