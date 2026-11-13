import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartEnterpriseRecordView, assertSmartEnterpriseRecordView } from '../lib/smart-mode-bindings.js';
import { enterpriseFixture } from '../scripts/fixtures/smart-mode-enterprise.mjs';

export function legacyBindingsFixture() {
  const data = enterpriseFixture();
  const servers = data.records.slice(0, 6).map((row) => {
    row.transport = 'streamable-http'; row.url = `https://fixture.invalid/${row.serverKey}`;
    const server = { serverKey: row.serverKey, serverName: row.serverName, transport: row.transport, url: row.url };
    delete row.serverKey; return server;
  });
  const descriptors = [{ id: 'qcc-company', servers }];
  const view = createSmartEnterpriseRecordView({ scope: data.scope, getRecords: () => data.records,
    getConnectorDescriptors: () => descriptors });
  return { ...data, descriptors, view };
}

test('missing serverKey resolves only in a copied readonly view with exact catalog evidence', () => {
  const f = legacyBindingsFixture(), original = structuredClone(f.records), rows = f.view.records();
  assert.deepEqual(f.records, original);
  assert.equal(rows.length, 7); assert.equal(rows[6], f.records[6]);
  for (let i = 0; i < 6; i++) {
    assert.equal(rows[i].serverKey, f.scope.connections[i].serverId.slice(4));
    assert.equal(Object.hasOwn(f.records[i], 'serverKey'), false);
    assert.notEqual(rows[i].auth, f.records[i].auth);
    assert.throws(() => { rows[i].auth.grantKey = 'cannot-write'; }, TypeError);
  }
});

for (const [name, change, code = 'LEGACY_BINDING_UNVERIFIED'] of [
  ['no catalog', (f) => f.descriptors.splice(0)],
  ['duplicate connector', (f) => f.descriptors.push(structuredClone(f.descriptors[0]))],
  ['duplicate server', (f) => f.descriptors[0].servers.push({ ...f.descriptors[0].servers[0] })],
  ['conflicting key/name', (f) => f.descriptors[0].servers.push({ ...f.descriptors[0].servers[0], serverName: 'unrelated' })],
  ['catalog endpoint', (f) => { f.descriptors[0].servers[0].url += '/changed'; }],
  ['record endpoint', (f) => { f.records[0].url += '?changed=true'; }],
  ['transport', (f) => { f.records[0].transport = 'sse'; }],
  ['catalog transport', (f) => { f.descriptors[0].servers[0].transport = 'stdio'; }],
  ['catalog server name', (f) => { f.descriptors[0].servers[0].serverName = 'different'; }],
  ['explicit wrong key', (f) => { f.records[0].serverKey = 'risk'; }, 'GROUP_BINDING_CHANGED'],
  ['wrong account', (f) => { f.records[0].auth.grantKey = 'other-grant'; }, 'GROUP_BINDING_CHANGED'],
  ['wrong connector', (f) => { f.records[0].connectorId = 'other'; }, 'GROUP_BINDING_CHANGED'],
  ['duplicate connection key', (f) => f.records.push({ ...f.records[0] }), 'GROUP_BINDING_CHANGED'],
  ['namespace collision', (f) => f.records.push({ ...f.records[0], key: 'foreign-account', auth: { mode: 'oauth', grantKey: 'b' } }), 'GROUP_BINDING_CHANGED'],
]) test(`legacy binding rejects ${name}`, () => {
  const f = legacyBindingsFixture(); change(f); assert.throws(() => f.view.records(), { code });
});

test('inferred endpoints stay pinned even if catalog changes with the record or an explicit key is later added', () => {
  const f = legacyBindingsFixture(); f.view.records();
  f.records[0].url += '/replacement'; f.descriptors[0].servers[0].url = f.records[0].url;
  f.records[0].serverKey = 'company';
  assert.throws(() => f.view.records(), { code: 'GROUP_BINDING_CHANGED' });
  f.records[0].url = f.descriptors[0].servers[0].url = 'https://fixture.invalid/company';
  assert.equal(f.view.records()[0].serverKey, 'company');
  f.descriptors.splice(0);
  assert.throws(() => f.view.records(), { code: 'LEGACY_BINDING_UNVERIFIED' });
});

test('missing connection is not reconstructed; reuse across account/group boundaries is rejected', () => {
  const f = legacyBindingsFixture(); f.records.splice(0, 1);
  assert.equal(f.view.records().length, 6);
  assert.throws(() => assertSmartEnterpriseRecordView(f.view, { ...f.scope, accountRef: 'b' }), { code: 'RECORD_VIEW_SCOPE_MISMATCH' });
  assert.throws(() => assertSmartEnterpriseRecordView(f.view, { ...f.scope, groupId: 'b' }), { code: 'RECORD_VIEW_SCOPE_MISMATCH' });
});

test('explicit valid keys keep their existing contract; asynchronous catalog and record sources cannot authorize legacy inference', () => {
  const f = legacyBindingsFixture();
  for (const row of f.records.slice(0, 6)) row.serverKey = row.serverName.slice(4);
  assert.equal(createSmartEnterpriseRecordView({ scope: f.scope, getRecords: () => f.records }).records()[0], f.records[0]);
  delete f.records[0].serverKey;
  assert.throws(() => createSmartEnterpriseRecordView({ scope: f.scope, getRecords: async () => f.records }).records(), { code: 'ASYNC_BINDING_VIEW' });
  assert.throws(() => createSmartEnterpriseRecordView({ scope: f.scope, getRecords: () => f.records,
    getConnectorDescriptors: async () => f.descriptors }).records(), { code: 'ASYNC_BINDING_VIEW' });
});
