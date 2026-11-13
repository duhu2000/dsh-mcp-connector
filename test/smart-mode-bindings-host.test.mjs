import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartModeDiscoveryPublisher } from '../lib/smart-mode-discovery.js';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { indexRawToolSources } from '../lib/source-relations.js';
import { readOnlyReviewFor } from '../scripts/fixtures/read-only-review.mjs';
import { host, profileHarness, temporaryProfile } from '../scripts/fixtures/smart-mode-profile.mjs';

const contract = (name, fn) => test(`legacy/candidate Host: ${name}`, { skip: !host, timeout: 30000 }, fn);
function legacyData() {
  const data = sourceFixture();
  const servers = data.records.slice(0, 6).map((record) => {
    record.transport = 'streamable-http'; record.url = `https://fixture.invalid/${record.serverKey}`;
    const server = { serverKey: record.serverKey, serverName: record.serverName, transport: record.transport, url: record.url };
    delete record.serverKey; return server;
  });
  return { data, descriptors: [{ id: 'qcc-company', servers }] };
}
const reviewData = (data) => [...data.index.values()].map((source) => readOnlyReviewFor(data.scope, source,
  { validFrom: 0, expiresAt: Date.now() + 86400000 }));
const names = (h, agent) => h.ctx.tools.schemas(agent).map((tool) => tool.name);
const deniedDispatch = async (h, agent, source) => {
  assert.equal(agent.ctx.tools.get(source.publicName, agent), undefined);
  assert.equal(names(h, agent).includes(source.publicName), false);
  const result = await h.ctx.tools.execute({ agent, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: 'synthetic-denied', name: source.publicName, arguments: '{}' }] });
  assert.equal(result.results[0].result.isError, true);
};

contract('discovery and schema/lookup/dispatch share the same inferred view, preserve permissions and roll back', async (t) => {
  const { data, descriptors } = legacyData(), before = structuredClone(data.records);
  const h = await profileHarness(t, await temporaryProfile(t), { data, reviews: reviewData(data), getConnectorDescriptors: () => descriptors });
  const compat = (await h.create('legacy-compatible')).agent; await h.drive(compat);
  const beforeNames = names(h, compat);
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const smart = (await h.create('legacy-smart')).agent, sibling = (await h.create('legacy-sibling')).agent;
  await h.drive(smart); await h.drive(sibling);
  const publisher = createSmartModeDiscoveryPublisher({ enabled: true, scope: data.scope, integration: h.integration,
    getRecords: () => { assert.fail('publisher must reuse the integration record view'); }, isRecordUsable: () => true,
    listTools: async (record) => { assert.equal(record.serverKey, record.serverName.slice(4));
      return { tools: h.rows.filter((row) => row.connectionKey === record.key).map((row) => row.definition) }; },
  }); t.after(() => publisher.dispose());
  await publisher.refresh();
  const source = h.sources[0];
  assert.equal((await h.integration.prepare(smart, { capabilityIds: [`source:${source.sourceId}`] })).ok, true);
  assert.ok(names(h, smart).includes(source.publicName));
  await deniedDispatch(h, sibling, source);
  assert.deepEqual(names(h, compat), beforeNames);
  h.denied.add(source.publicName);
  await h.integration.refreshControl();
  await deniedDispatch(h, smart, source);
  assert.deepEqual(data.records, before, 'no serverKey or credential is written back');
  await h.integration.dispose();
  assert.ok(smart.ctx.tools.get(source.publicName, smart));
  assert.deepEqual(names(h, compat), beforeNames);
});

contract('catalog withdrawal and coordinated endpoint changes revoke already prepared tools', async (t) => {
  const { data, descriptors } = legacyData();
  const h = await profileHarness(t, await temporaryProfile(t), { data, reviews: reviewData(data), getConnectorDescriptors: () => descriptors });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const agent = (await h.create('legacy-revocation')).agent; await h.drive(agent);
  const source = h.sources[0];
  await h.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] });
  const descriptor = descriptors.pop();
  await h.integration.refreshControl();
  await deniedDispatch(h, agent, source);
  descriptors.push(descriptor);
  await h.integration.refreshControl();
  assert.equal(h.integration.status(agent).restriction.preparedCount, 0, 'revoked preparation cannot revive after catalog recovery');
  await h.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] });
  data.records[0].url += '/changed'; descriptor.servers[0].url = data.records[0].url;
  data.records[0].serverKey = 'company';
  await h.integration.refreshControl();
  await deniedDispatch(h, agent, source);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [`source:${source.sourceId}`] })).ok, false);
});

contract('registration candidates do not merge, bypass reviews or approve their observations', async (t) => {
  const { data, descriptors } = legacyData();
  data.rows[0].definition._registration_tool = 1; data.rows[1].definition._registration_tool = 2;
  data.index = indexRawToolSources(data.scope, data.rows);
  const h = await profileHarness(t, await temporaryProfile(t), { data, getConnectorDescriptors: () => descriptors });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const agent = (await h.create('extension-candidates')).agent; await h.drive(agent);
  const groups = await h.integration.candidates(agent);
  assert.equal(groups.length, 1); assert.equal(groups[0].match, 'registration-extension-difference');
  assert.equal(groups[0].mergeApproved, false);
  assert.equal((await h.integration.prepare(agent, { capabilityIds: [`source:${h.sources[0].sourceId}`] })).message, 'READ_ONLY_REVIEW_REQUIRED');
  await deniedDispatch(h, agent, h.sources[0]);
});

contract('registration-only raw changes invalidate a prepared readonly review without changing the Host schema', async (t) => {
  const { data, descriptors } = legacyData();
  const h = await profileHarness(t, await temporaryProfile(t), { data, reviews: reviewData(data), getConnectorDescriptors: () => descriptors });
  await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
  const agent = (await h.create('extension-review')).agent; await h.drive(agent);
  const source = h.sources[0], args = { capabilityIds: [`source:${source.sourceId}`] };
  assert.equal((await h.integration.prepare(agent, args)).ok, true);
  data.rows[0].definition._registration_tool = 'new-synthetic-registration';
  h.integration.publishViews({ rawSources: data.rows }, { expectedRevision: h.integration.status().viewRevision });
  await deniedDispatch(h, agent, source);
  assert.equal((await h.integration.prepare(agent, args)).message, 'READ_ONLY_REVIEW_REQUIRED');
});
