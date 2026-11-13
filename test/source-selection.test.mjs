import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintRawTool, canonicalSourceJson, indexRawToolSources, identifySourceCandidates } from '../lib/source-relations.js';
import { createSourceSelector } from '../lib/source-selection.js';
import { sanitizeToolMetadata } from '../lib/tool-catalog-cache.js';
import { sourceFixture, rawDefinition, relationFor } from '../scripts/fixtures/source-selection.mjs';

function fixture(options = {}) {
  const data = sourceFixture(options), snapshots = new Map(), intents = new Map(), denied = new Set(), manual = new Set(), unregistered = new Set();
  const holder = { relations: data.relations, clock: 1000 };
  const selector = createSourceSelector({ enabled: true, scope: data.scope,
    getSessionSnapshot: (agent) => snapshots.get(agent), getRawSources: () => data.rows,
    getRelations: () => holder.relations, now: () => holder.clock,
    getUserSourceIntent: (agent) => intents.get(agent),
    inspectSource: (agent, source) => ({ discoverable: !denied.has(`${agent.id}:${source.sourceId}`),
      available: !denied.has(`${agent.id}:${source.sourceId}`) && !manual.has(source.sourceId) && !unregistered.has(source.sourceId),
      registered: !unregistered.has(source.sourceId), manualPending: manual.has(source.sourceId) }),
  });
  const agent = (id, mode = 'smart') => { const value = { id, session: { id } }; snapshots.set(value, data.snapshot(id, mode)); return value; };
  const capabilityId = `relation:${data.relations[0].id}`;
  const pair = data.relations[0].members.map((member) => data.index.get(member.sourceId));
  const explicit = (value, sources, extra = {}) => {
    intents.set(value, { sessionId: value.id, accountRef: data.scope.accountRef, groupId: data.scope.groupId,
      capabilityId, kind: sources.length > 1 ? 'compare' : 'source', evidenceHash: 'a'.repeat(64), expiresAt: 9000,
      sources: sources.map((source) => ({ sourceId: source.sourceId, definitionFingerprint: source.definitionFingerprint })), ...extra });
  };
  return { ...data, selector, holder, agent, intents, snapshots, denied, manual, unregistered, capabilityId, pair, explicit };
}

test('full raw fingerprints preserve defaults, examples, const, output, annotations, execution and unknown extensions', () => {
  const definition = rawDefinition('raw/name'); const original = fingerprintRawTool(definition);
  const reversed = Object.fromEntries(Object.entries(definition).reverse());
  assert.deepEqual(fingerprintRawTool(reversed), original, 'object order does not matter');
  const changes = [
    (d) => { d.name = 'different'; }, (d) => { d.inputSchema.properties.query.default = 'other'; },
    (d) => { d.inputSchema.properties.query.examples = ['other']; }, (d) => { d.inputSchema.properties.query.const = 'other'; },
    (d) => { d.outputSchema.properties.result.type = 'number'; }, (d) => { d.annotations.readOnlyHint = false; },
    (d) => { d.execution.taskSupport = 'required'; }, (d) => { d._meta = { billing: 'different' }; },
  ];
  for (const change of changes) {
    const next = structuredClone(definition); change(next);
    assert.notEqual(fingerprintRawTool(next).definitionFingerprint, original.definitionFingerprint);
  }
  const editorial = { ...definition, description: 'Changed editorial text' };
  assert.notEqual(fingerprintRawTool(editorial).definitionFingerprint, original.definitionFingerprint);
  assert.equal(fingerprintRawTool(editorial).candidateFingerprint, original.candidateFingerprint);
  assert.notEqual(fingerprintRawTool(sanitizeToolMetadata(definition)).definitionFingerprint, original.definitionFingerprint);
});

test('fingerprinting rejects non-JSON values and never invokes getters or toJSON', () => {
  for (const value of [undefined, NaN, Infinity, 1n, () => {}, new Date(), [, 1]]) assert.throws(() => canonicalSourceJson(value));
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => canonicalSourceJson(cyclic));
  const accessor = { inputSchema: {} }; Object.defineProperty(accessor, 'name', { enumerable: true, get() { assert.fail('getter invoked'); } });
  assert.throws(() => fingerprintRawTool(accessor), { code: 'NON_JSON_DEFINITION' });
  assert.notEqual(canonicalSourceJson(-0), canonicalSourceJson(0));
});

test('raw provenance, exact public naming and unambiguous identity are mandatory', () => {
  const data = sourceFixture(); const row = data.rows[0];
  assert.throws(() => indexRawToolSources(data.scope, [{ ...row, origin: 'last-success-cache' }]), { code: 'RAW_PROVENANCE_REQUIRED' });
  assert.throws(() => indexRawToolSources(data.scope, [{ ...row, definition: { ...row.definition, schemaTruncated: true } }]), { code: 'RAW_PROVENANCE_REQUIRED' });
  assert.throws(() => indexRawToolSources(data.scope, [{ ...row, publicName: 'invented' }]), { code: 'AMBIGUOUS_SOURCE_DEFINITION' });
  assert.throws(() => indexRawToolSources(data.scope, [row, row]), { code: 'AMBIGUOUS_SOURCE_DEFINITION' });
});

test('356 definitions form 186 candidate identities with 170 duplicate observations; only synthetic approvals deduplicate', async () => {
  const f = fixture({ full: true }); const agent = f.agent('full');
  assert.equal(f.index.size, 356);
  assert.equal(new Set([...f.index.values()].map((s) => s.candidateFingerprint)).size, 186);
  assert.equal(identifySourceCandidates(f.index).length, 170);
  assert.equal((await f.selector.search(agent, { query: 'fixture', limit: 100 })).total, 186);
  f.holder.relations = f.relations.map((r) => ({ ...r, status: 'candidate' }));
  assert.equal((await f.selector.search(agent, { query: 'fixture', limit: 100 })).total, 356);
  assert.ok((await f.selector.candidates(agent)).every((r) => r.status === 'candidate'));
});

test('registration differences are versioned unapproved observations; full and strict hashes retain the extension', async () => {
  const f = fixture();
  f.holder.relations = [];
  f.rows[0].definition._registration_tool = 'synthetic-registration-a';
  f.rows[1].definition._registration_tool = 'synthetic-registration-b';
  const a = fingerprintRawTool(f.rows[0].definition), b = fingerprintRawTool(f.rows[1].definition);
  assert.notEqual(a.definitionFingerprint, b.definitionFingerprint);
  assert.notEqual(a.candidateFingerprint, b.candidateFingerprint);
  assert.equal(a.registrationCandidateFingerprint, b.registrationCandidateFingerprint);
  const agent = f.agent('extension-observer'), observations = await f.selector.candidates(agent);
  assert.equal(observations.length, 1);
  const group = observations[0];
  assert.equal(group.version, 2); assert.equal(group.status, 'candidate');
  assert.equal(group.match, 'registration-extension-difference');
  assert.deepEqual(group.differingContractFields, ['_registration_tool']);
  assert.equal(group.requiresVerification, true); assert.equal(group.mergeApproved, false);
  assert.equal(new Set(group.members.map((member) => member.definitionFingerprint)).size, 2);
  assert.equal((await f.selector.search(agent, { query: 'fixture', limit: 100 })).total, 4);
  const selected = await f.selector.select(agent, { capabilityId: `source:${f.pair[0].sourceId}` });
  assert.equal(selected.selected.length, 1); assert.deepEqual(selected.aliases, []);
  f.denied.add(`${agent.id}:${f.pair[1].sourceId}`);
  assert.deepEqual(await f.selector.candidates(agent), [], 'forbidden sources are not exposed as candidates');
});

test('relaxed candidates still distinguish unknown extensions, nested registration fields and schemas', () => {
  for (const change of [
    (d) => { d._meta = { _registration_tool: 'different' }; },
    (d) => { d.unknownExtension = true; },
    (d) => { d.inputSchema.properties.query.type = 'number'; },
    (d) => { d.outputSchema.properties.result.type = 'number'; },
    (d) => { d.annotations.readOnlyHint = false; },
    (d) => { d.execution.taskSupport = 'required'; },
    (d) => { d.name = 'different-name'; },
  ]) {
    const data = sourceFixture();
    data.rows[0].definition._registration_tool = 1; data.rows[1].definition._registration_tool = 2;
    change(data.rows[1].definition);
    assert.deepEqual(identifySourceCandidates(indexRawToolSources(data.scope, data.rows)), []);
  }
});

test('expanded observations do not overlap strict subgroups or cross account/group boundaries', () => {
  const data = sourceFixture();
  const third = data.scope.connections[2];
  data.rows.push({ ...structuredClone(data.rows[0]), connectionKey: third.connectionKey, serverName: third.serverName });
  data.rows.at(-1).definition._registration_tool = { source: 'synthetic-extension' };
  let index = indexRawToolSources(data.scope, data.rows);
  const groups = identifySourceCandidates(index);
  assert.equal(groups.length, 1); assert.equal(groups[0].members.length, 3);
  assert.throws(() => groups[0].members.push({}), TypeError);
  const others = indexRawToolSources({ ...data.scope, accountRef: 'b' }, data.rows.map((row) => ({ ...row, accountRef: 'b' })));
  assert.equal(identifySourceCandidates(new Map([...index, ...others])).length, 2);
  const first = [...index][0], otherFirst = [...others][0];
  assert.deepEqual(identifySourceCandidates(new Map([first, otherFirst])), []);
  const otherGroup = indexRawToolSources({ ...data.scope, groupId: 'b' }, data.rows.map((row) => ({ ...row, groupId: 'b' })));
  assert.equal(identifySourceCandidates(new Map([...index, ...otherGroup])).length, 2);
});

test('a registration-only change invalidates an approved fingerprint even when it remains a candidate', async () => {
  const f = fixture(), agent = f.agent('registration-change');
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).status, 'selected');
  f.rows[0].definition._registration_tool = 'changed';
  const observations = await f.selector.candidates(agent);
  assert.equal(observations[0].match, 'registration-extension-difference');
  const result = await f.selector.select(agent, { capabilityId: f.capabilityId });
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'SOURCE_DEFINITION_CHANGED');
});

test('old-name discovery returns canonical plus aliases; it never implicitly selects the old source', async () => {
  const f = fixture(); const agent = f.agent('aliases');
  const result = await f.selector.search(agent, { query: f.pair[1].publicName });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].publicName, f.pair[0].publicName);
  assert.equal(result.items[0].aliases[0].publicName, f.pair[1].publicName);
  const selected = await f.selector.select(agent, { capabilityId: result.items[0].capabilityId });
  assert.equal(selected.selected.length, 1); assert.equal(selected.selected[0].sourceId, f.pair[0].sourceId);
  assert.equal(selected.budgetException, false);
});

test('title and description keywords remain discoverable without exposing full raw definitions', async () => {
  const f = fixture(); const agent = f.agent('keywords');
  f.rows[2].definition.title = '企业独有能力';
  f.rows[2].definition.description = '用于中文关键词检索';
  const result = await f.selector.search(agent, { query: '中文关键词' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '企业独有能力');
  assert.doesNotMatch(JSON.stringify(result), /inputSchema|outputSchema|annotations|execution/);
});

test('source order is explicit user choice, same-Agent successful use, reviewed superset, fixed priority', async () => {
  const f = fixture(); const a = f.agent('a'), b = f.agent('b');
  assert.equal((await f.selector.select(a, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[0].sourceId);
  await f.selector.recordSuccessfulUse(a, f.pair[1].sourceId);
  assert.equal((await f.selector.select(a, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
  assert.equal((await f.selector.select(b, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[0].sourceId);
  f.explicit(a, [f.pair[0]]);
  assert.equal((await f.selector.select(a, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[0].sourceId);
  const ranked = structuredClone(f.relations[0]); ranked.revision = 2;
  ranked.members.forEach((member, i) => { member.verifiedSuperset = false; member.priority = 10 - i; });
  f.holder.relations = [ranked];
  assert.equal((await f.selector.select(f.agent('priority'), { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
});

test('unsupported relation versions, future validity and expired identity-bound receipts are refused', async () => {
  const f = fixture(); const agent = f.agent('invalid');
  f.holder.relations = [{ ...f.relations[0], version: 900 }];
  await assert.rejects(f.selector.select(agent, { capabilityId: f.capabilityId }), { code: 'INVALID_SOURCE_RELATION' });
  f.holder.relations = [{ ...f.relations[0], validFrom: 1100 }];
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'RELATION_NOT_YET_VALID');
  f.holder.relations = f.relations; f.explicit(agent, [f.pair[0]], { expiresAt: 1000 });
  await assert.rejects(f.selector.select(agent, { capabilityId: f.capabilityId }), { code: 'TRUSTED_SOURCE_INTENT_EXPIRED' });
});

test('permission exceptions pick from current effective sources, preserve unique tools and do not propagate source denial', async () => {
  const f = fixture(); const agent = f.agent('denied');
  f.denied.add(`${agent.id}:${f.pair[0].sourceId}`);
  const result = await f.selector.select(agent, { capabilityId: f.capabilityId });
  assert.equal(result.selected[0].sourceId, f.pair[1].sourceId);
  const search = await f.selector.search(agent, { query: 'fixture' });
  assert.equal(search.total, 3); assert.equal(search.items.find((r) => r.capabilityId === f.capabilityId).aliases.length, 0);
  const unique = search.items.find((r) => r.relationStatus === 'unapproved');
  assert.equal((await f.selector.select(agent, { capabilityId: unique.capabilityId })).status, 'selected');
});

test('manual tools remain discoverable but cannot be selected for loading until original activation', async () => {
  const f = fixture(); const agent = f.agent('manual'); f.pair.forEach((source) => f.manual.add(source.sourceId));
  const searched = await f.selector.search(agent, { query: f.pair[0].rawName });
  assert.equal(searched.items[0].manual, true); assert.equal(searched.items[0].available, false);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'MANUAL_ACTIVATION_REQUIRED');
  f.manual.delete(f.pair[1].sourceId);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
});

test('cached but unregistered tools do not become available through an equivalence relation or manual hint', async () => {
  const f = fixture(); const agent = f.agent('unregistered');
  for (const source of f.pair) { f.unregistered.add(source.sourceId); f.manual.add(source.sourceId); }
  const found = await f.selector.search(agent, { query: f.pair[0].rawName });
  assert.equal(found.items[0].registered, false);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'HOST_TOOL_NOT_REGISTERED');
});

test('model claims cannot prove explicit source intent; a forbidden user-selected source fails closed', async () => {
  const f = fixture(); const agent = f.agent('explicit');
  await assert.rejects(f.selector.select(agent, { capabilityId: f.capabilityId, source: f.pair[1].sourceId, explicit: true }), { code: 'INVALID_SOURCE_SELECTION' });
  f.explicit(agent, [f.pair[1]]);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
  f.denied.add(`${agent.id}:${f.pair[1].sourceId}`);
  const denied = await f.selector.select(agent, { capabilityId: f.capabilityId });
  assert.equal(denied.reason, 'EXPLICIT_SOURCE_DENIED'); assert.deepEqual(denied.selected, []);
});

test('only trusted compare intent allows two sources and a budget exception; mismatched identity is refused', async () => {
  const f = fixture(); const agent = f.agent('compare');
  f.explicit(agent, f.pair);
  const compared = await f.selector.select(agent, { capabilityId: f.capabilityId });
  assert.equal(compared.selected.length, 2); assert.equal(compared.budgetException, true);
  await f.selector.recordFailure(agent, f.capabilityId, f.pair[0].sourceId);
  await f.selector.recordSuccessfulUse(agent, f.pair[1].sourceId);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'SOURCE_SWITCH_REQUIRES_CONFIRMATION', 'peer success cannot clear a failed comparison');
  f.intents.get(agent).sessionId = 'other';
  await assert.rejects(f.selector.select(agent, { capabilityId: f.capabilityId }), { code: 'INVALID_TRUSTED_SOURCE_INTENT' });
});

test('unknown definition changes quarantine the approval, while reviewed compatible fingerprints preserve successful choice', async () => {
  const f = fixture(); const agent = f.agent('change'); await f.selector.recordSuccessfulUse(agent, f.pair[1].sourceId);
  const savedPlan = await f.selector.select(agent, { capabilityId: f.capabilityId });
  f.rows[0].definition.description = 'New editorial text';
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'SOURCE_DEFINITION_CHANGED');
  assert.equal(await f.selector.validateSelection(agent, savedPlan), false);
  const current = indexRawToolSources(f.scope, f.rows).get(f.pair[0].sourceId);
  const compatible = structuredClone(f.relations[0]); compatible.revision = 2;
  compatible.members[0].fingerprints.push(current.definitionFingerprint);
  f.holder.relations = [compatible];
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
});

test('definition removal and newly added unique tools do not disappear behind a whole-connection decision', async () => {
  const f = fixture(); const agent = f.agent('added');
  f.rows.shift();
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
  f.rows.push({ ...f.rows[0], definition: rawDefinition('new_unique_tool') });
  const added = await f.selector.search(agent, { query: 'new_unique_tool' });
  assert.equal(added.items.length, 1); assert.equal(added.items[0].relationStatus, 'unapproved');
});

test('expiry and each independent kill switch remove only that relation; stale capability requests cannot use it', async () => {
  const f = fixture({ full: true }); const agent = f.agent('expiry');
  f.holder.relations = f.relations.map((r, i) => i === 0 ? { ...r, enabled: false, revision: 2 } : r);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'RELATION_DISABLED');
  assert.equal((await f.selector.search(agent, { query: 'fixture', limit: 100 })).total, 187);
  f.holder.relations = f.relations.map((r, i) => i === 0 ? { ...r, expiresAt: 1000 } : r);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'RELATION_EXPIRED');
  assert.equal((await f.selector.select(agent, { capabilityId: `relation:${f.relations[1].id}` })).status, 'selected');
});

test('multiple grants, mismatched snapshot scope and compatibility mode cannot share source decisions', async () => {
  const f = fixture(); const agent = f.agent('grant');
  f.rows.push({ ...f.rows[0], accountRef: 'other-grant' });
  f.holder.relations = [...f.relations, { ...f.relations[0], accountRef: 'other-grant' }];
  assert.equal((await f.selector.search(agent, { query: 'fixture' })).total, 3);
  const compat = f.agent('compat', 'compat'); assert.equal((await f.selector.select(compat, { capabilityId: f.capabilityId })).status, 'compat');
  f.snapshots.set(agent, { ...f.snapshot(agent.id), accountRef: 'other-grant' });
  await assert.rejects(f.selector.search(agent, { query: 'fixture' }), { code: 'SOURCE_SCOPE_MISMATCH' });
});

test('overlapping approvals are not transitively merged; only conflicting groups are quarantined', async () => {
  const f = fixture(); const agent = f.agent('overlap'); const unique = [...f.index.values()].find((s) => !f.pair.includes(s));
  f.holder.relations = [...f.relations, relationFor(f.scope, 'overlap', [f.pair[1], unique])];
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'OVERLAPPING_RELATIONS');
  assert.equal((await f.selector.search(agent, { query: 'fixture' })).total, 1);
});

test('a failed call never automatically switches source and alternatives require a fresh trusted receipt', async () => {
  const f = fixture(); const agent = f.agent('failed');
  await f.selector.recordFailure(agent, f.capabilityId, f.pair[0].sourceId);
  await f.selector.recordSuccessfulUse(agent, f.pair[1].sourceId);
  const blocked = await f.selector.select(agent, { capabilityId: f.capabilityId });
  assert.equal(blocked.reason, 'SOURCE_SWITCH_REQUIRES_CONFIRMATION'); assert.ok(blocked.alternatives.length);
  f.explicit(agent, [f.pair[1]]);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[1].sourceId);
  await f.selector.recordFailure(agent, f.capabilityId, f.pair[1].sourceId);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'SOURCE_SWITCH_REQUIRES_CONFIRMATION');
  f.explicit(agent, [f.pair[0]], { evidenceHash: 'b'.repeat(64) });
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[0].sourceId);
});

test('selection stamps invalidate on relation, permission or definition changes and preference state dies with Agent', async () => {
  const f = fixture(); const agent = f.agent('stamped');
  const plan = await f.selector.select(agent, { capabilityId: f.capabilityId });
  assert.equal(await f.selector.validateSelection(agent, plan), true);
  assert.equal(await f.selector.validateSelection(agent, { ...plan, selected: [plan.aliases[0]] }), false, 'copied stamp cannot authorize edited plan');
  assert.equal(await f.selector.validateSelection(agent, { ...plan, budgetException: true }), false);
  f.denied.add(`${agent.id}:${f.pair[0].sourceId}`);
  assert.equal(await f.selector.validateSelection(agent, plan), false);
  f.denied.clear(); await f.selector.recordSuccessfulUse(agent, f.pair[1].sourceId);
  let onDisposed;
  f.selector.mount({ on(type, callback) { onDisposed = callback; return () => {}; } });
  onDisposed({ agent });
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).selected[0].sourceId, f.pair[0].sourceId);
});

test('expired user intent does not let a failed call bypass the source-switch latch', async () => {
  const f = fixture(); const agent = f.agent('expired-receipt');
  f.explicit(agent, [f.pair[0]], { expiresAt: 1000 });
  assert.equal(await f.selector.recordFailure(agent, f.capabilityId, f.pair[0].sourceId), true);
  f.intents.delete(agent);
  assert.equal((await f.selector.select(agent, { capabilityId: f.capabilityId })).reason, 'SOURCE_SWITCH_REQUIRES_CONFIRMATION');
});

test('disabled selector does not access callbacks or Host and performs no execution or preparation', async () => {
  const selector = createSourceSelector(); selector.mount(new Proxy({}, { get() { assert.fail('disabled Host access'); } }))();
  assert.equal((await selector.select({}, { capabilityId: 'anything' })).status, 'disabled');
  assert.deepEqual(await selector.candidates({}), []);
});
