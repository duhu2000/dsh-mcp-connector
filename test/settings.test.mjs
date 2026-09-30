import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONNECTOR_SETTINGS_NAMESPACE,
  SHOW_SIDEBAR_ENTRY_FIELD,
  ConnectorSettings,
  installConnectorSettings,
} from '../lib/settings.js';

test('connector settings default to a visible sidebar entry', () => {
  assert.deepEqual(ConnectorSettings({}), { showSidebarEntry: true });
  assert.deepEqual(ConnectorSettings({ showSidebarEntry: false }), { showSidebarEntry: false });
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
  assert.deepEqual(registration.options.base, { [SHOW_SIDEBAR_ENTRY_FIELD]: false });
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
