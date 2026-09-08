import z from '@deepseek-ai/schemastery';

export const CONNECTOR_SETTINGS_NAMESPACE = 'mcp-connector';
export const SHOW_SIDEBAR_ENTRY_FIELD = 'showSidebarEntry';

export const ConnectorSettings = z.object({
  [SHOW_SIDEBAR_ENTRY_FIELD]: z.boolean().default(true),
});

/**
 * Register the connector's user-facing settings only while a Settings provider
 * is present. The provider owns persistence; older DSH hosts keep the composed
 * config and continue loading the connector normally.
 */
export function installConnectorSettings(ctx, config = {}) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(CONNECTOR_SETTINGS_NAMESPACE, ConnectorSettings, {
      base: {
        [SHOW_SIDEBAR_ENTRY_FIELD]: config[SHOW_SIDEBAR_ENTRY_FIELD] !== false,
      },
    });
  });
}
