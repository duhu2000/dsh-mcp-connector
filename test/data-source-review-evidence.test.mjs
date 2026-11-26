import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConnectorDescriptor } from '../lib/schema.js';

const descriptor = {
  id: 'sample-data',
  name: 'Sample data service',
  servers: [{ serverKey: 'main', serverName: 'sample-data', url: 'https://example.org/mcp' }],
  toolsSnapshot: [{ serverKey: 'main', tools: [{ name: 'get_monthly_total' }] }],
};

test('discovering a tool preserves a partial probe result', () => {
  const card = normalizeConnectorDescriptor({ ...descriptor, probeStatus: 'partial' });
  assert.equal(card.toolsSnapshot[0].tools[0].name, 'get_monthly_total');
  assert.equal(card.probeStatus, 'partial');
});

test('a tool snapshot without a probe result remains unverified', () => {
  assert.equal(normalizeConnectorDescriptor(descriptor).probeStatus, 'unverified');
});

test('the descriptor rejects a business runtime status in the probe status field', () => {
  assert.throws(() => normalizeConnectorDescriptor({ ...descriptor, probeStatus: 'not-run' }), /probeStatus/);
});
