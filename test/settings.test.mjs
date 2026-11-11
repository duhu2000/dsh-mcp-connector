import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONNECTOR_SETTINGS_NAMESPACE,
  SHOW_SIDEBAR_ENTRY_FIELD,
  ENTRY_LOCATION_FIELD,
  ENTRY_LOCATIONS,
  ConnectorSettings,
  installConnectorSettings,
  normalizeEntryLocation,
  entryLocationFromLegacyFlag,
} from '../lib/settings.js';

test('connector settings default to a visible sidebar entry', () => {
  assert.deepEqual(ConnectorSettings({}), { showSidebarEntry: true, entryLocation: 'sidebar' });
  assert.deepEqual(ConnectorSettings({ showSidebarEntry: false }), {
    showSidebarEntry: false,
    entryLocation: 'sidebar',
  });
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
    // 旧配置只有布尔开关时，base 要翻译成等价的枚举，
    // 否则升级后原本隐藏的侧栏会重新出现。
    [ENTRY_LOCATION_FIELD]: 'settings',
  });
});

test('hosts with settings injection but no register method keep loading', () => {
  const ctx = {
    inject(_services, callback) {
      callback({ settings: {} });
    },
  };

  assert.doesNotThrow(() => installConnectorSettings(ctx, {}));
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
    const parsed = ConnectorSettings({ entryLocation: location });
    assert.equal(parsed.entryLocation, location);
  }
  assert.deepEqual(ENTRY_LOCATIONS, ['both', 'sidebar', 'settings']);
});

test('entry location rejects unknown values instead of silently accepting them', () => {
  for (const invalid of ['nope', '', 'BOTH', 1, true]) {
    assert.throws(() => ConnectorSettings({ entryLocation: invalid }), /entryLocation/);
  }
});

test('entry location falls back to the default when omitted or null', () => {
  assert.equal(ConnectorSettings({}).entryLocation, 'sidebar');
  assert.equal(ConnectorSettings({ entryLocation: null }).entryLocation, 'sidebar');
  assert.equal(ConnectorSettings({ entryLocation: undefined }).entryLocation, 'sidebar');
});

test('normalizeEntryLocation is fail-safe on any input', () => {
  for (const location of ENTRY_LOCATIONS) assert.equal(normalizeEntryLocation(location), location);
  for (const invalid of [undefined, null, '', 0, 1, true, {}, [], 'unknown']) {
    assert.equal(normalizeEntryLocation(invalid), 'sidebar');
  }
});

test('legacy boolean maps hidden to settings and visible to sidebar', () => {
  assert.equal(entryLocationFromLegacyFlag(false), 'settings');
  assert.equal(entryLocationFromLegacyFlag(true), 'sidebar');
  assert.equal(entryLocationFromLegacyFlag(undefined), undefined);
  assert.equal(entryLocationFromLegacyFlag('false'), undefined);
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

  installConnectorSettings(ctx, { entryLocation: 'not-a-location' });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'sidebar');
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

  // 新字段已经写明偏好时，旧布尔值不再参与推导。
  installConnectorSettings(ctx, { showSidebarEntry: false, entryLocation: 'both' });
  assert.equal(registration.options.base[ENTRY_LOCATION_FIELD], 'both');
});
