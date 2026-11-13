import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartModeDiscoveryPublisher } from '../lib/smart-mode-discovery.js';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { fingerprintRawTool } from '../lib/source-relations.js';

function fixture(options = {}) {
  const data = sourceFixture();
  let revision = 0, blocked = false, rows = [], lists = 0, publishes = 0;
  const integration = {
    status: () => ({ viewRevision: revision }),
    invalidateViews({ expectedRevision }) {
      assert.equal(expectedRevision, revision); blocked = true; return { revision: ++revision };
    },
    publishViews(input, { expectedRevision }) {
      if (revision !== expectedRevision) throw new Error('conflict');
      rows = input.rawSources; blocked = false; publishes++;
      return { revision: ++revision, sourceCount: rows.length, reviewCount: 0 };
    },
  };
  const publisher = createSmartModeDiscoveryPublisher({ enabled: true, scope: data.scope,
    getRecords: () => data.records, isRecordUsable: () => true, integration,
    listTools: async (record) => { lists++; await options.beforeList?.(record, data);
      return { tools: data.rows.filter((row) => row.connectionKey === record.key).map((row) => row.definition) }; },
  });
  return { ...data, publisher, integration, get blocked() { return blocked; }, get rows() { return rows; },
    get lists() { return lists; }, get publishes() { return publishes; } };
}

test('disabled discovery never reads records, Host or network', async () => {
  const p = createSmartModeDiscoveryPublisher();
  assert.deepEqual(await p.refresh(), { enabled: false }); p.dispose();
});

test('six complete raw results publish once with full fingerprints and no implicit reviews', async () => {
  const f = fixture();
  const result = await f.publisher.refresh();
  assert.equal(f.lists, 6); assert.equal(f.publishes, 1); assert.equal(f.blocked, false);
  assert.equal(result.reviewCount, 0); assert.equal(result.definitionCount, 4);
  assert.deepEqual(f.rows[0].definition, sourceFixture().rows[0].definition);
  assert.equal(fingerprintRawTool(f.rows[0].definition).definitionFingerprint,
    [...f.index.values()][0].definitionFingerprint);
});

test('concurrent refreshes share one transaction; failed metadata never publishes a partial group or a remote error', async () => {
  let release;
  const wait = new Promise((done) => { release = done; });
  const f = fixture({ beforeList: async () => { await wait; throw new Error('Authorization: secret / remote body'); } });
  const first = f.publisher.refresh(), second = f.publisher.refresh();
  assert.equal(first, second); assert.equal(f.blocked, true); release();
  await assert.rejects(first, (error) => error.code === 'RAW_DISCOVERY_FAILED' && !error.message.includes('secret'));
  assert.equal(f.publishes, 0); assert.equal(f.lists, 1); assert.equal(f.blocked, true);
});

for (const [name, mutate] of [
  ['grant', (row) => { row.auth.grantKey = 'different-grant'; }],
  ['endpoint', (row) => { row.url = 'https://changed.invalid/mcp'; }],
  ['disabled', (row) => { row.enabled = false; }],
]) test(`in-place ${name} changes during discovery cannot revive the old view`, async () => {
  const f = fixture({ beforeList: (row, data) => mutate(data.records.find((item) => item.key === row.key)) });
  await assert.rejects(f.publisher.refresh(), { code: 'RAW_DISCOVERY_FAILED' });
  assert.equal(f.publishes, 0); assert.equal(f.blocked, true);
});

test('missing or colliding bindings fail before I/O; unrelated other-account records are not queried', async () => {
  const f = fixture(); f.records.push({ ...f.records[0], key: 'collision' });
  await assert.rejects(f.publisher.refresh(), { code: 'RAW_DISCOVERY_FAILED' }); assert.equal(f.lists, 0);
  f.records.pop(); f.records.splice(0, 1);
  await assert.rejects(f.publisher.refresh(), { code: 'RAW_DISCOVERY_FAILED' }); assert.equal(f.lists, 0);
});

test('cleaned cache entries and duplicate raw names fail closed', async () => {
  for (const definition of [{ name: 'cache', schemaTruncated: true, inputSchema: {} },
    { name: 'duplicate', inputSchema: {} }]) {
    const f = fixture();
    const original = sourceFixture().rows[0];
    f.publisher.dispose();
    const p = createSmartModeDiscoveryPublisher({ enabled: true, scope: f.scope,
      getRecords: () => f.records, isRecordUsable: () => true, integration: f.integration,
      listTools: async (record) => ({ tools: record.key === original.connectionKey ? [definition, definition] : [] }),
    });
    await assert.rejects(p.refresh(), { code: 'RAW_DISCOVERY_FAILED' }); assert.equal(f.publishes, 0);
  }
});

test('newer view publication and dispose defeat a delayed producer; a failed attempt is retryable', async () => {
  let release;
  const wait = new Promise((done) => { release = done; });
  let pause = true;
  const f = fixture({ beforeList: async () => { if (pause) await wait; } });
  const pending = f.publisher.refresh();
  f.integration.invalidateViews({ expectedRevision: f.integration.status().viewRevision }); release();
  await assert.rejects(pending, { code: 'RAW_DISCOVERY_FAILED' }); assert.equal(f.blocked, true);
  pause = false; await f.publisher.refresh(); assert.equal(f.publishes, 1);
  pause = true; const delayed = f.publisher.refresh(); f.publisher.dispose();
  await assert.rejects(delayed, { code: 'DISCOVERY_CLOSED' });
  await assert.rejects(f.publisher.refresh(), { code: 'DISCOVERY_CLOSED' }); assert.equal(f.blocked, true);
});
