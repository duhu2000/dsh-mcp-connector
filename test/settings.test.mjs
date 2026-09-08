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

test('hosts without optional injection support keep loading', () => {
  assert.doesNotThrow(() => installConnectorSettings({}, {}));
});
