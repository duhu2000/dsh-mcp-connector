import z from '@deepseek-ai/schemastery';

export const CONNECTOR_SETTINGS_NAMESPACE = 'mcp-connector';
export const SHOW_SIDEBAR_ENTRY_FIELD = 'showSidebarEntry';
export const ENTRY_LOCATION_FIELD = 'entryLocation';

/**
 * 入口展示位置的三个档位。
 *
 * - `both`：侧栏图标与设置页的快捷打开按钮都可用；
 * - `sidebar`：只保留侧栏图标，设置页只负责改偏好；
 * - `settings`：隐藏侧栏图标，只从设置页进入。
 *
 * 三档都至少保留一处入口，避免把面板锁成打不开。
 */
export const ENTRY_LOCATIONS = ['both', 'sidebar', 'settings'];

/**
 * 全新安装的默认档位。
 *
 * 与旧行为保持一致：以前 `showSidebarEntry` 默认 `true`，侧栏可见且设置卡片
 * 提供打开按钮，等价于 `both`。
 */
export const DEFAULT_ENTRY_LOCATION = 'both';

/**
 * 归一化入口展示位置；非法值回退默认档位。
 *
 * @param {unknown} value 配置值、设置文档中的值或界面传入值
 * @returns {'both'|'sidebar'|'settings'}
 */
export function normalizeEntryLocation(value) {
  return ENTRY_LOCATIONS.includes(value) ? value : DEFAULT_ENTRY_LOCATION;
}

/**
 * 把旧版布尔开关翻译成新枚举。
 *
 * 旧版 `showSidebarEntry` 的**实际**行为：
 * - `true`：侧栏可见 **且** 设置卡片提供「打开 MCP连接器」按钮 → `both`
 * - `false`：侧栏隐藏，只能从设置卡片打开 → `settings`
 *
 * 把 `true` 直接映射成 `sidebar` 会悄悄删掉设置页那个现存入口，
 * 所以必须映射到 `both`。
 *
 * @param {unknown} value 旧版布尔值
 * @returns {'both'|'settings'|undefined} 无法判断时返回 undefined
 */
export function entryLocationFromLegacyFlag(value) {
  if (value === false) return 'settings';
  if (value === true) return 'both';
  return undefined;
}

/**
 * 旧版布尔开关的**有效值**：用户覆盖优先，其次部署基线。
 *
 * 两个来源都要看，因为分层解析里 `user` 会覆盖 `base`。只看其中一层会
 * 让另一层的旧偏好被合成出来的新字段盖掉。
 *
 * @param {{ user?: unknown, base?: unknown }} layers 快照的分层
 * @returns {'both'|'settings'|undefined}
 */
export function legacyLocationFromLayers(layers) {
  const fromUser = entryLocationFromLegacyFlag(readLegacyFlag(layers?.user));
  if (fromUser !== undefined) return fromUser;
  return entryLocationFromLegacyFlag(readLegacyFlag(layers?.base));
}

function readLegacyFlag(source) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
  return source[SHOW_SIDEBAR_ENTRY_FIELD];
}

/**
 * 从分层快照解析入口展示位置。
 *
 * **优先级**：用户显式选的 `entryLocation` → 用户旧布尔覆盖 → 部署基线的
 * `entryLocation` → 基线旧布尔 → 默认档位。
 *
 * 之所以先看 `user` 再回退旧布尔：`value` 是三层合并后的结果，其中
 * `entryLocation` 可能由 base 或 schema 默认值合成而来，**不能证明用户选过**。
 * 早先的实现只读 `value`，导致「用户旧覆盖 + 基线新字段」时旧覆盖被盖掉。
 *
 * @param {{ user?: unknown, base?: unknown }} layers 快照的分层
 * @returns {'both'|'sidebar'|'settings'}
 */
export function resolveLocationFromLayers(layers) {
  const userLocation = readLocation(layers?.user);
  if (userLocation !== undefined) return userLocation;

  const fromUserLegacy = entryLocationFromLegacyFlag(readLegacyFlag(layers?.user));
  if (fromUserLegacy !== undefined) return fromUserLegacy;

  const baseLocation = readLocation(layers?.base);
  if (baseLocation !== undefined) return baseLocation;

  return legacyLocationFromLayers({ base: layers?.base }) ?? DEFAULT_ENTRY_LOCATION;
}

function readLocation(source) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
  const value = source[ENTRY_LOCATION_FIELD];
  return ENTRY_LOCATIONS.includes(value) ? value : undefined;
}

export const ConnectorSettings = z.object({
  [SHOW_SIDEBAR_ENTRY_FIELD]: z.boolean().default(true),
  [ENTRY_LOCATION_FIELD]: z
    .union(ENTRY_LOCATIONS.map((location) => z.const(location)))
    .default(DEFAULT_ENTRY_LOCATION),
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

    // 组合配置里显式写了 entryLocation 就用它；否则把旧布尔开关翻译成等价档位，
    // 让升级前后「侧栏是否出现、设置页有没有打开按钮」都保持不变。
    const explicit = config[ENTRY_LOCATION_FIELD];
    const base = ENTRY_LOCATIONS.includes(explicit)
      ? explicit
      : (entryLocationFromLegacyFlag(config[SHOW_SIDEBAR_ENTRY_FIELD]) ?? DEFAULT_ENTRY_LOCATION);

    settingsCtx.settings.register(CONNECTOR_SETTINGS_NAMESPACE, ConnectorSettings, {
      base: {
        [SHOW_SIDEBAR_ENTRY_FIELD]: config[SHOW_SIDEBAR_ENTRY_FIELD] !== false,
        [ENTRY_LOCATION_FIELD]: base,
      },
    });
  });
}
