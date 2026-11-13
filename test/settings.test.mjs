import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONNECTOR_SETTINGS_NAMESPACE,
  SHOW_SIDEBAR_ENTRY_FIELD,
  ENTRY_LOCATION_FIELD,
  ENTRY_LOCATIONS,
  DEFAULT_ENTRY_LOCATION,
  ConnectorSettings,
  installConnectorSettings,
  normalizeEntryLocation,
  entryLocationFromLegacyFlag,
  legacyLocationFromLayers,
  resolveLocationFromLayers,
} from '../lib/settings.js';

test('connector settings expose both fields with the documented default', () => {
  assert.deepEqual(ConnectorSettings({}), {
    showSidebarEntry: true,
    entryLocation: DEFAULT_ENTRY_LOCATION,
  });
  assert.equal(DEFAULT_ENTRY_LOCATION, 'both', '全新安装默认 both，与旧行为一致');
});

test('settings namespace is optional and uses the composed config as its base', () => {
  let requestedServices;
  let registration;
  const ctx = {
    inject(services, callback) {
      requestedServices = services;
      callback({
        settings: {
          register(namespace, schema, options) {
            registration = { namespace, schema, options };
          },
        },
      });
    },
  };

  installConnectorSettings(ctx, { showSidebarEntry: false });

  assert.deepEqual(requestedServices, ['settings']);
  assert.equal(registration.namespace, CONNECTOR_SETTINGS_NAMESPACE);
  assert.equal(registration.schema, ConnectorSettings);
  assert.deepEqual(registration.options.base, {
    [SHOW_SIDEBAR_ENTRY_FIELD]: false,
    // 旧布尔 false 表示「只在设置页打开」，对应 settings。
    [ENTRY_LOCATION_FIELD]: 'settings',
  });
});

test('hosts with settings injection but no register method keep loading', () => {
  assert.doesNotThrow(() => installConnectorSettings({
    inject(_services, callback) { callback({ settings: {} }); },
  }, {}));
});

test('hosts without optional injection support keep loading', () => {
  assert.doesNotThrow(() => installConnectorSettings({}, {}));
});

test('missing or non-callable optional settings APIs keep loading', () => {
  for (const injected of [undefined, null, {}, { settings: null }, { settings: { register: true } }]) {
    assert.doesNotThrow(() => installConnectorSettings({
      inject(_services, callback) { callback(injected); },
    }));
  }
});

test('settings registration preserves receiver and does not swallow provider errors', () => {
  const failure = new Error('provider registration failed');
  const settings = {
    register() {
      assert.equal(this, settings);
      throw failure;
    },
  };
  assert.throws(() => installConnectorSettings({
    inject(_services, callback) { callback({ settings }); },
  }), (error) => error === failure);
});

test('entry location accepts exactly the three supported values', () => {
  for (const location of ENTRY_LOCATIONS) {
    assert.equal(ConnectorSettings({ entryLocation: location }).entryLocation, location);
  }
  assert.deepEqual(ENTRY_LOCATIONS, ['both', 'sidebar', 'settings']);
});

test('entry location rejects unknown values instead of silently accepting them', () => {
  for (const invalid of ['nope', '', 'BOTH', 1, true]) {
    assert.throws(() => ConnectorSettings({ entryLocation: invalid }), /entryLocation/);
  }
});

test('normalizeEntryLocation is fail-safe on any input', () => {
  for (const location of ENTRY_LOCATIONS) assert.equal(normalizeEntryLocation(location), location);
  for (const invalid of [undefined, null, '', 0, 1, true, {}, [], 'unknown']) {
    assert.equal(normalizeEntryLocation(invalid), DEFAULT_ENTRY_LOCATION);
  }
});

test('legacy true maps to both so the Settings quick-open action survives', () => {
  // 旧版 true 的既有行为是「侧栏可见 + 设置页有打开按钮」= both。
  // 映射成 sidebar 会悄悄删掉一个现存入口。
  assert.equal(entryLocationFromLegacyFlag(true), 'both');
  assert.equal(entryLocationFromLegacyFlag(false), 'settings');
  assert.equal(entryLocationFromLegacyFlag(undefined), undefined);
  assert.equal(entryLocationFromLegacyFlag('true'), undefined);
});

test('legacy layers resolve user override before deployment base', () => {
  assert.equal(legacyLocationFromLayers({ user: { showSidebarEntry: false }, base: {} }), 'settings');
  assert.equal(legacyLocationFromLayers({ user: { showSidebarEntry: true }, base: {} }), 'both');
  // 用户层没有该字段时看基线。
  assert.equal(legacyLocationFromLayers({ user: {}, base: { showSidebarEntry: false } }), 'settings');
  assert.equal(legacyLocationFromLayers({ user: {}, base: {} }), undefined);
});

test('layered resolution prefers user choices and legacy overrides over base', () => {
  // 用户显式新选择
  assert.equal(
    resolveLocationFromLayers({ user: { entryLocation: 'sidebar' }, base: { entryLocation: 'both' } }),
    'sidebar',
  );
  // 用户旧覆盖优先于基线合成的新字段
  assert.equal(
    resolveLocationFromLayers({
      user: { showSidebarEntry: false },
      base: { entryLocation: 'both' },
    }),
    'settings',
  );
  // 基线新字段
  assert.equal(resolveLocationFromLayers({ user: {}, base: { entryLocation: 'settings' } }), 'settings');
  // 基线旧布尔
  assert.equal(resolveLocationFromLayers({ user: {}, base: { showSidebarEntry: false } }), 'settings');
  assert.equal(resolveLocationFromLayers({ user: {}, base: { showSidebarEntry: true } }), 'both');
  // 三层皆空 → 默认
  assert.equal(resolveLocationFromLayers({ user: {}, base: {} }), DEFAULT_ENTRY_LOCATION);
});

test('composed config seeds the entry location base and rejects unknown values', () => {
  let registration;
  const ctx = {
    inject(_services, callback) {
      callback({
        settings: {
          register(namespace, schema, options) {
            registration = { namespace, schema, options };
          },
        },
      });
    },
  };

  installConnectorSettings(ctx, { entryLocation: 'settings' });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'settings');

  // 非法值不会静默变成默认档位，而是退回「按旧布尔推导」的路径。
  installConnectorSettings(ctx, { entryLocation: 'not-a-location', showSidebarEntry: false });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'settings');

  installConnectorSettings(ctx, { entryLocation: 'not-a-location' });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], DEFAULT_ENTRY_LOCATION);
});

test('explicit entryLocation wins over a conflicting legacy boolean', () => {
  let registration;
  const ctx = {
    inject(_services, callback) {
      callback({
        settings: {
          register(namespace, schema, options) {
            registration = { namespace, schema, options };
          },
        },
      });
    },
  };

  installConnectorSettings(ctx, { showSidebarEntry: false, entryLocation: 'both' });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'both');
});

test('omitting entryLocation keeps the legacy-derived base instead of a synthesized default', () => {
  // 关键：Config 里不能有 entryLocation 的 schema 默认值，否则它会提前注入
  // base，把用户旧覆盖盖掉。省略时必须走旧布尔推导。
  let registration;
  const ctx = {
    inject(_services, callback) {
      callback({
        settings: {
          register(namespace, schema, options) {
            registration = { namespace, schema, options };
          },
        },
      });
    },
  };

  installConnectorSettings(ctx, { showSidebarEntry: true });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'both', '旧 true → both');

  installConnectorSettings(ctx, { showSidebarEntry: false });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'settings', '旧 false → settings');
});

test('merged value layer still honours the legacy boolean', () => {
  // 精简快照没有 user/base 分层时，value 兜底也不能只认新字段，
  // 否则「只有旧布尔」会错误回退到默认档位。
  assert.equal(resolveLocationFromLayers({ value: { showSidebarEntry: false } }), 'settings');
  assert.equal(resolveLocationFromLayers({ value: { showSidebarEntry: true } }), 'both');
  assert.equal(resolveLocationFromLayers({ value: { entryLocation: 'sidebar' } }), 'sidebar');
  // 新字段优先于同一层的旧布尔。
  assert.equal(
    resolveLocationFromLayers({ value: { entryLocation: 'settings', showSidebarEntry: true } }),
    'settings',
  );
  // 全空才用默认。
  assert.equal(resolveLocationFromLayers({ value: {} }), DEFAULT_ENTRY_LOCATION);
});
