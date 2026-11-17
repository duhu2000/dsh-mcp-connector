import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartModePrepareController, normalizeReadOnlyReview } from '../lib/smart-mode-prepare.js';
import { sourceFixture } from '../scripts/fixtures/source-selection.mjs';
import { readOnlyReviewFor } from '../scripts/fixtures/read-only-review.mjs';
import { createTranslator } from '../lib/i18n/index.js';
import { EN_DICTIONARY } from '../lib/i18n/locales/en.js';
import { fixture } from '../scripts/fixtures/smart-mode-prepare.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

const args = (f) => ({ capabilityIds: [f.capabilityId] });
const assertEmpty = (f, agent) => {
  assert.deepEqual(f.prepare.getPreparedNames(agent), []);
  assert.ok(f.sources.every((source) => !f.names(agent).includes(source.publicName)));
  assert.equal(f.counts().businessCalls, 0);
};

test('disabled prepare is inert and does not inspect Host, reviews or scope', async () => {
  const p = createSmartModePrepareController();
  p.mount(new Proxy({}, { get() { assert.fail('disabled Host access'); } }))();
  assert.equal((await p.prepare({}, {})).message, 'SMART_PREPARE_DISABLED');
  assert.deepEqual(p.getPreparedNames({}), []); p.dispose();
});

test('prepare requires explicit scope, restriction/selection callbacks and an independent review view', () => {
  const f = fixture();
  assert.throws(() => createSmartModePrepareController({ enabled: true, scope: f.scope }), { code: 'MISSING_PREPARE_CALLBACK' });
  assert.throws(() => normalizeReadOnlyReview({ ...f.reviews[0], rawDefinition: {} }), { code: 'INVALID_READ_ONLY_REVIEW' });
});

test('verified canonical loads only for this Agent, is idempotent and neither registers nor executes tools', async () => {
  const f = fixture(); const { agent } = f.make('a'), b = f.make('b'); const before = f.counts();
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  assert.deepEqual(f.prepare.getPreparedNames(agent), [f.sources[0].publicName]);
  assert.equal(f.guard(agent, f.sources[0].publicName), undefined);
  assert.ok(f.guard(b.agent, f.sources[0].publicName)); assertEmpty(f, b.agent);
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  assert.deepEqual(f.counts(), before); assert.equal(f.controller.status(agent).preparedCount, 1);
});

test('search renders capability identity and prepare exposes exact next-step names without schema or generic execution', async () => {
  const f = fixture(); const { agent } = f.make('management'); const def = agent.locals.get('mcp_connector_discover');
  const found = await def.execute({ action: 'search', query: f.sources[1].publicName }, { agent });
  assert.match(def.output.render({}, found)[0].text, new RegExp(f.capabilityId));
  const result = await def.execute({ action: 'prepare', ...args(f) }, { agent });
  assert.equal(result.ok, true); assert.equal(result.detail.nextInferenceBoundary, true);
  assert.match(def.output.render({}, result)[0].text, new RegExp(f.sources[0].publicName));
  assert.doesNotMatch(JSON.stringify(result), /inputSchema|outputSchema/);
  assert.ok(!f.names(agent).includes(f.sources[1].publicName));
  assert.equal(f.counts().businessCalls, 0); assert.equal(f.counts().legacyCalls, 0);
});

test('forged review, source, Agent, business-call and oversized arguments never load tools', async () => {
  const f = fixture(); const { agent } = f.make('args'), b = f.make('peer');
  for (const input of [{}, { capabilityIds: [] }, { capabilityIds: [f.capabilityId, f.capabilityId] },
    { capabilityIds: Array.from({ length: 9 }, (_, i) => `source:${i}`) },
    { ...args(f), source: f.sources[1] }, { ...args(f), confirmed: true }, { ...args(f), agentId: b.agent.id },
    { ...args(f), readOnly: true }, { ...args(f), reviews: f.reviews }]) {
    assert.equal((await f.prepare.prepare(agent, input)).message, 'INVALID_PREPARE_ARGUMENTS');
  }
  const def = agent.locals.get('mcp_connector_discover');
  await assert.rejects(def.execute({ action: 'prepare', ...args(f) }, { agent: b.agent }), /AGENT_MISMATCH/);
  assert.equal((await def.execute({ action: 'prepare', ...args(f), toolName: 'get_x' }, { agent })).ok, false);
  assertEmpty(f, agent);
});

test('candidate equality and readOnlyHint do not supply read-only approval or merge unapproved sources', async () => {
  const f = fixture(); const { agent } = f.make('candidates'); f.relations.splice(0);
  const ids = f.sources.slice(0, 2).map((source) => `source:${source.sourceId}`);
  f.reviews.splice(0);
  assert.equal((await f.prepare.prepare(agent, { capabilityIds: ids })).message, 'READ_ONLY_REVIEW_REQUIRED'); assertEmpty(f, agent);
  f.reviews.push(...f.sources.slice(0, 2).map((source) => readOnlyReviewFor(f.scope, source)));
  assert.equal((await f.prepare.prepare(agent, { capabilityIds: ids })).ok, true);
  assert.equal(f.prepare.getPreparedNames(agent).length, 2, 'candidate-only sources remain independent');
});

for (const [label, mutate] of [
  ['other account', (f) => { f.reviews[0].accountRef = 'another-grant'; }],
  ['other group', (f) => { f.reviews[0].groupId = 'another-group'; }],
  ['wrong full fingerprint', (f) => { f.reviews[0].definitionFingerprint = '0'.repeat(64); }],
  ['disabled', (f) => { f.reviews[0].enabled = false; }],
  ['expired', (f) => { f.at = 10000; }],
  ['not yet valid', (f) => { f.reviews[0].validFrom = 2000; }],
  ['future review', (f) => { f.reviews[0].review.reviewedAt = 2000; }],
]) test(`read-only evidence ${label} fails closed`, async () => {
  const f = fixture(); const { agent } = f.make(label); mutate(f);
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, false); assertEmpty(f, agent);
});

test('one missing review in a multi-capability request rolls back the complete batch', async () => {
  const f = fixture(); const { agent } = f.make('atomic');
  f.reviews.splice(2, 1);
  const result = await f.prepare.prepare(agent, { capabilityIds: [f.capabilityId, `source:${f.sources[2].sourceId}`] });
  assert.equal(result.message, 'READ_ONLY_REVIEW_REQUIRED'); assertEmpty(f, agent);
});

for (const [label, mutate] of [
  ['governance denial', (f) => { f.denied.add(f.sources[0].publicName); }],
  ['workspace removal', (f) => { f.hidden.add(f.records[0].key); }],
  ['connection disabled', (f) => { f.records[0].enabled = false; }],
  ['account binding changed', (f) => { f.records[0].auth.grantKey = 'other'; }],
  ['Host unregistered', (f) => { f.globals.delete(f.sources[0].publicName); }],
  ['manual not active', (f) => { f.records[0].injectionMode = 'session'; }],
  ['full definition changed', (f) => { f.rows[0].definition.description += ' changed'; }],
  ['relationship revised', (f) => { f.relations[0] = { ...f.relations[0], revision: 2 }; }],
  ['relationship disabled', (f) => { f.relations[0] = { ...f.relations[0], enabled: false }; }],
  ['relationship expired', (f) => { f.at = 10000; }],
]) test(`loading rechecks ${label} after asynchronous selection`, async () => {
  const f = fixture(); const { agent } = f.make(label); const original = f.selector.select;
  f.selector.select = async (...input) => { const plan = await original(...input); mutate(f); return plan; };
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, false); assertEmpty(f, agent);
});

test('review changes between validation and commit cannot load an outdated audit', async () => {
  let reads = 0;
  const f = fixture({ getReadOnlyReviews: (rows) => { if (++reads === 2) rows[0].enabled = false; return rows; } });
  const { agent } = f.make('audit-change');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, false); assertEmpty(f, agent);
});

test('async-only current source or review views reject the synchronous commit fence', async () => {
  const seed = sourceFixture();
  const a = fixture({ getRawSources: async () => seed.rows }); const x = a.make('async-source');
  assert.equal((await a.prepare.prepare(x.agent, args(a))).message, 'ASYNC_SOURCE_COMMIT_STATE'); assertEmpty(a, x.agent);
  const b = fixture({ getReadOnlyReviews: async (rows) => rows }); const y = b.make('async-review');
  assert.equal((await b.prepare.prepare(y.agent, args(b))).message, 'ASYNC_READ_ONLY_COMMIT_STATE'); assertEmpty(b, y.agent);
});

test('explicit denied source never switches; compare loads both only with their separate read-only evidence', async () => {
  const f = fixture(); const { agent } = f.make('explicit'); const pair = f.sources.slice(0, 2);
  f.intent(agent, [pair[0]]); f.denied.add(pair[0].publicName);
  assert.equal((await f.prepare.prepare(agent, args(f))).message, 'EXPLICIT_SOURCE_DENIED'); assertEmpty(f, agent);
  f.denied.clear(); f.intent(agent, pair, 'compare'); f.reviews[1].enabled = false;
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, false); assertEmpty(f, agent);
  f.reviews[1].enabled = true;
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true); assert.equal(f.prepare.getPreparedNames(agent).length, 2);
});

test('prepare does not evict an active source to switch; resource release awaits P1-06', async () => {
  const f = fixture(); const { agent } = f.make('source-switch');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  f.intent(agent, [f.sources[1]]);
  // The old selection cannot execute under the new intent. Resource removal
  // and in-flight protection must be implemented before replacing its lease.
  assert.deepEqual(f.prepare.getPreparedNames(agent), []);
  assert.equal((await f.prepare.prepare(agent, args(f))).message, 'PREPARED_SOURCE_CHANGE_REQUIRES_RELEASE');
  assert.deepEqual(f.prepare.getPreparedNames(agent), []);
  assert.equal((await f.prepare.prepare(agent, { capabilityIds: [`source:${f.sources[2].sourceId}`] })).ok, true);
  assert.equal((await f.prepare.prepare(agent, args(f))).message, 'PREPARED_SOURCE_CHANGE_REQUIRES_RELEASE',
    'preparing an unrelated capability cannot discard the original reservation');
});

test('Host restriction installation failure restores the previous prepared set and native visibility', async () => {
  const f = fixture(); const { agent } = f.make('rollback');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  const before = f.names(agent); f.failRestrict();
  const result = await f.prepare.prepare(agent, { capabilityIds: [`source:${f.sources[2].sourceId}`] });
  assert.equal(result.ok, false); assert.deepEqual(f.names(agent), before);
  assert.deepEqual(f.prepare.getPreparedNames(agent), [f.sources[0].publicName]);
  assert.ok(f.guard(agent, f.sources[2].publicName));
  assert.equal(f.controller.status(agent).blocked, false);
});

test('queued concurrent requests preserve both successful updates and isolate a rejected batch', async () => {
  const f = fixture(); const { agent } = f.make('concurrent');
  const original = f.selector.select, gate = deferred(), entered = deferred(); let first = true;
  f.selector.select = async (...input) => { if (first) { first = false; entered.resolve(); await gate.promise; } return original(...input); };
  const one = f.prepare.prepare(agent, args(f)); await entered.promise;
  const two = f.prepare.prepare(agent, { capabilityIds: ['source:unknown'] });
  const three = f.prepare.prepare(agent, { capabilityIds: [`source:${f.sources[2].sourceId}`] });
  gate.resolve(); const results = await Promise.all([one, two, three]);
  assert.deepEqual(results.map((result) => result.ok), [true, false, true]);
  assert.deepEqual(new Set(f.prepare.getPreparedNames(agent)), new Set([f.sources[0].publicName, f.sources[2].publicName]));
});

test('canceling an asynchronous or queued native prepare prevents a late commit and permits a later request', async () => {
  const f = fixture(); const { agent } = f.make('cancel');
  const original = f.selector.select, gate = deferred(), entered = deferred(); let first = true;
  f.selector.select = async (...input) => { const plan = await original(...input);
    if (first) { first = false; entered.resolve(); await gate.promise; } return plan; };
  const abort = new AbortController(), queued = new AbortController();
  const def = agent.locals.get('mcp_connector_discover');
  const pending = def.execute({ action: 'prepare', ...args(f) }, { agent, signal: abort.signal });
  await entered.promise;
  const second = f.prepare.prepare(agent, args(f), { signal: queued.signal });
  abort.abort(); queued.abort(); gate.resolve();
  assert.equal((await pending).message, 'PREPARE_CANCELED');
  assert.equal((await second).message, 'PREPARE_CANCELED'); assertEmpty(f, agent);
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
});

test('review revocation, expiry and definition changes remove lookup eligibility and guard access', async () => {
  const f = fixture(); const { agent } = f.make('invalidate');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  f.reviews[0].enabled = false;
  assert.ok(f.guard(agent, f.sources[0].publicName)); f.controller.refresh(); assertEmpty(f, agent);
  f.reviews[0].enabled = true;
  assert.deepEqual(f.prepare.getPreparedNames(agent), [], 'revoked entries never resurrect without prepare');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  f.rows[0].definition.outputSchema.type = 'array';
  assert.ok(f.guard(agent, f.sources[0].publicName)); f.controller.refresh(); assertEmpty(f, agent);
});

test('replacing a registered Host definition invalidates its prior preparation even with an unchanged raw view', async () => {
  const f = fixture(); const { agent } = f.make('replacement');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  const name = f.sources[0].publicName; f.globals.set(name, { ...f.globals.get(name) });
  assert.ok(f.guard(agent, name)); f.controller.refresh(); assertEmpty(f, agent);
});

test('rollback refresh failure keeps admission and native dispatch blocked until the Host recovers', async () => {
  const f = fixture(); const { agent } = f.make('failed-rollback');
  // Host accepts the new mask, then final verification fails and the Host
  // refuses the compensating mask. The lifecycle barrier and guard must block.
  f.controller.sourceVisible = () => { f.failRestrict(5); return false; };
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, false);
  assert.ok(f.guard(agent, f.sources[0].publicName));
  assert.equal(f.controller.status(agent).blocked, true);
  assert.throws(() => f.controller.assertReady(agent));
  assert.deepEqual(f.prepare.getPreparedNames(agent), []);
  f.failRestrict(0); f.controller.refresh(); f.controller.assertReady(agent);
  assertEmpty(f, agent);
});

test('an independent Host deny layer cannot be bypassed or reported as a successful load', async () => {
  const f = fixture(); const { agent } = f.make('external-deny');
  const stop = agent.ctx.tools.restrict({ deny: [f.sources[0].publicName] });
  assert.equal((await f.prepare.prepare(agent, args(f))).message, 'PREPARE_COMMIT_INVALIDATED');
  assertEmpty(f, agent); stop(); assertEmpty(f, agent);
});

test('expired loaded read-only evidence is denied and cannot return merely by changing the clock back', async () => {
  const f = fixture(); const { agent } = f.make('expired-loaded');
  f.relations[0] = { ...f.relations[0], expiresAt: 20000 };
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  f.at = 10000; assert.ok(f.guard(agent, f.sources[0].publicName)); f.controller.refresh(); assertEmpty(f, agent);
  f.at = 1000; assertEmpty(f, agent);
});

test('unrelated source changes do not invalidate an otherwise current prepared definition', async () => {
  const f = fixture(); const { agent } = f.make('unrelated');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  f.rows[2].definition.description += ' unrelated';
  assert.deepEqual(f.prepare.getPreparedNames(agent), [f.sources[0].publicName]);
});

test('compat, same-ID replacement, child and disposed-pending Agent never inherit preparation', async () => {
  const f = fixture(); const { agent } = f.make('parent');
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  const child = f.make('child'), sameId = f.make('parent'), compat = f.make('compat', 'compat');
  assertEmpty(f, child.agent); assertEmpty(f, sameId.agent);
  const before = f.names(compat.agent);
  assert.equal((await f.prepare.prepare(compat.agent, args(f))).message, 'PREPARE_REQUIRES_SMART_MODE');
  assert.deepEqual(f.names(compat.agent), before);
  const original = f.selector.select, gate = deferred(), entered = deferred();
  f.selector.select = async (...input) => { const plan = await original(...input); entered.resolve(); await gate.promise; return plan; };
  const pending = f.prepare.prepare(child.agent, args(f)); await entered.promise;
  f.emit('agent/disposed', { agent: child.agent }); gate.resolve();
  assert.equal((await pending).message, 'PREPARE_SESSION_CHANGED'); assert.deepEqual(f.prepare.getPreparedNames(child.agent), []);
});

test('idle prepare teardown clears only preparation and preserves legacy configuration and outside tools', async () => {
  const f = fixture(); const { agent } = f.make('teardown');
  const records = structuredClone(f.records);
  assert.equal((await f.prepare.prepare(agent, args(f))).ok, true);
  agent.status = 'running'; assert.throws(() => f.prepare.dispose(), { code: 'PREPARE_DISPOSE_REQUIRES_IDLE_AGENT' });
  agent.status = 'idle'; f.prepare.dispose(); assertEmpty(f, agent);
  assert.ok(f.names(agent).includes('outside_fixture')); assert.deepEqual(f.records, records);
});

test('English optional prepare schema and rendered results remain translated', async () => {
  const f = fixture({ t: createTranslator('en', { en: EN_DICTIONARY }) }); const { agent } = f.make('en');
  const def = agent.locals.get('mcp_connector_discover');
  const result = await def.execute({ action: 'prepare', ...args(f) }, { agent });
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify({ description: def.description, parameters: def.parameters, output: def.output.render({}, result) }), /\p{Script=Han}/u);
});

test('full synthetic 356-source group prepares eight requested definitions and refuses excess retained capacity', async () => {
  const f = fixture({ full: true }); const { agent } = f.make('capacity');
  const capabilities = (await f.selector.search(agent, { query: 'fixture', limit: 100 })).items.map((item) => item.capabilityId);
  for (let i = 0; i < 32; i += 8) assert.equal((await f.prepare.prepare(agent, { capabilityIds: capabilities.slice(i, i + 8) })).ok, true);
  assert.equal(f.prepare.getPreparedNames(agent).length, 32);
  assert.equal((await f.prepare.prepare(agent, { capabilityIds: [capabilities[32]] })).message, 'PREPARED_SET_LIMIT');
  assert.equal(f.prepare.getPreparedNames(agent).length, 32); assert.equal(f.counts().businessCalls, 0);
});
