import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartModeDiscoveryPublisher } from '../lib/smart-mode-discovery.js';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { host, profileHarness, temporaryProfile } from '../scripts/fixtures/smart-mode-profile.mjs';

test('raw publisher invalidation masks prepared schemas, lookup and dispatch while preserving a compatible session',
  { skip: !host, timeout: 30000 }, async (t) => {
    const h = await profileHarness(t, await temporaryProfile(t));
    const compat = (await h.create('discovery-compat')).agent; await h.drive(compat);
    await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
    const agent = (await h.create('discovery-smart')).agent; await h.drive(agent);
    const source = h.sources[0], capabilityId = `source:${source.sourceId}`;
    assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
    let fail = true;
    const publisher = createSmartModeDiscoveryPublisher({ enabled: true, scope: h.scope,
      getRecords: () => h.records, isRecordUsable: () => true, integration: h.integration,
      listTools: async (record) => {
        if (fail) throw new Error('remote metadata unavailable');
        return { tools: h.rows.filter((row) => row.connectionKey === record.key).map((row) => row.definition) };
      },
    });
    t.after(() => publisher.dispose());
    await assert.rejects(publisher.refresh(), { code: 'RAW_DISCOVERY_FAILED' });
    assert.equal(h.ctx.tools.schemas(agent).some((tool) => tool.name === source.publicName), false);
    assert.equal(agent.ctx.tools.get(source.publicName, agent), undefined);
    const result = await h.ctx.tools.execute({ agent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: 'metadata-unavailable', name: source.publicName, arguments: '{}' }] });
    assert.equal(result.results[0].result.isError, true);
    assert.ok(compat.ctx.tools.get(source.publicName, compat));
    const revision = h.integration.status().viewRevision;
    assert.throws(() => h.integration.publishViews({ readOnlyReviews: h.reviews }, { expectedRevision: revision }),
      { code: 'RAW_DISCOVERY_UNAVAILABLE' });
    fail = false; await publisher.refresh();
    // A failed refresh permanently invalidates the old preparation. A fresh
    // permission/review check is needed, even when the raw hash is unchanged.
    assert.equal(h.integration.status(agent).restriction.preparedCount, 0);
    assert.equal((await h.integration.prepare(agent, { capabilityIds: [capabilityId] })).ok, true);
  });

test('unreviewed raw metadata can be discovered but cannot implicitly authorize preparation',
  { skip: !host, timeout: 30000 }, async (t) => {
    const profile = await temporaryProfile(t);
    await assert.rejects(profileHarness(t, profile, { data: sourceFixture(), relation: true }), /External metadata/);
    await assert.rejects(profileHarness(t, profile, { data: sourceFixture(), syntheticOutcomes: true }), /External metadata/);
    const h = await profileHarness(t, profile, { data: sourceFixture() });
    await h.integration.setDefaultMode({ mode: 'smart', expectedRevision: 0 });
    const agent = (await h.create('discovery-no-reviews')).agent; await h.drive(agent);
    const publisher = createSmartModeDiscoveryPublisher({ enabled: true, scope: h.scope,
      getRecords: () => h.records, isRecordUsable: () => true, integration: h.integration,
      listTools: async (record) => ({ tools: h.rows.filter((row) => row.connectionKey === record.key).map((row) => row.definition) }),
    });
    t.after(() => publisher.dispose());
    assert.equal((await publisher.refresh()).reviewCount, 0);
    assert.equal((await h.integration.prepare(agent, { capabilityIds: [`source:${h.sources[0].sourceId}`] })).message,
      'READ_ONLY_REVIEW_REQUIRED');
    assert.equal(h.integration.status(agent).restriction.preparedCount, 0);
  });
