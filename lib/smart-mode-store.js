/**
 * Explicit-profile, independent smart-mode storage. No DSH_HOME/default path,
 * Host table mirroring, credentials, messages or prepared-tool persistence.
 *
 * Publish fsynced private files using atomic no-replace hard links. There is no
 * stale lock to steal: snapshots are write-once, policies use revision slots.
 * Unsupported media fail closed; never fall back to overwrite or memory-only.
 */
import * as filesystem from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  SMART_MODE_DOMAIN_NAME, SMART_MODE_STORE_VERSION, normalizeSmartModeSnapshot,
  smartModeDefaultPolicySchema, smartModeError,
} from './smart-mode-schema.js';
import { normalizeSourceRelation, sourceError } from './source-relations.js';
import { normalizeReadOnlyReview } from './smart-mode-prepare.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validRevision = (n) => Number.isSafeInteger(n) && n >= 0;
const reference = (value) => {
  if (typeof value !== 'string' || !value || value.length > 512) throw smartModeError('INVALID_REFERENCE');
  return value;
};
const policyKey = (accountRef, groupId) => hash(JSON.stringify([reference(accountRef), reference(groupId)]));
const sessionKey = (sessionId) => hash(reference(sessionId));

function document(kind, keyHash, revision, payload) {
  const body = { version: SMART_MODE_STORE_VERSION, kind, keyHash, revision, payload };
  return { ...body, digest: hash(JSON.stringify(body)) };
}

function decode(text, kind, keyHash, revision) {
  let value;
  try { value = JSON.parse(text); } catch { throw smartModeError('MALFORMED_STORE_RECORD'); }
  if (!value || value.version !== SMART_MODE_STORE_VERSION) throw smartModeError('UNSUPPORTED_STORE_VERSION');
  if (!same(Object.keys(value).sort(), ['version', 'kind', 'keyHash', 'revision', 'payload', 'digest'].sort())
      || value.kind !== kind || value.keyHash !== keyHash || value.revision !== revision
      || !same(value, document(kind, keyHash, revision, value.payload))) throw smartModeError('INVALID_STORE_RECORD');
  return value.payload;
}

export class SmartModeStore {
  constructor({ profileDir, io = filesystem, confirmPermanentDeletion = async () => false,
    approveSourceRelation = async () => false, approveReadOnlyReview = async () => false } = {}) {
    if (typeof profileDir !== 'string' || !isAbsolute(profileDir)) throw smartModeError('EXPLICIT_PROFILE_REQUIRED');
    this.rootDir = join(resolve(profileDir), 'storages', SMART_MODE_DOMAIN_NAME);
    this.io = io;
    this.confirmPermanentDeletion = confirmPermanentDeletion;
    this.approveSourceRelation = approveSourceRelation;
    this.approveReadOnlyReview = approveReadOnlyReview;
    this.defaults = new Map();
    this.operations = new Set();
    this.closing = false;
  }

  static async open(options) {
    const store = new SmartModeStore(options);
    await store.initialize();
    return store;
  }

  snapshotPath(sessionId) { return join(this.rootDir, 'sessions', `${sessionKey(sessionId)}.json`); }
  deletionPath(sessionId) { return join(this.rootDir, 'deleted', `${sessionKey(sessionId)}.json`); }
  policyDir(accountRef, groupId) { return join(this.rootDir, 'defaults', policyKey(accountRef, groupId)); }

  async initialize() {
    await this.io.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const path = join(this.rootDir, 'domain.json');
    if (await this.readFile(path) === undefined) {
      // Missing metadata on a populated domain is damage, never an empty store.
      const files = await this.io.readdir(this.rootDir);
      if (files.some((name) => !name.startsWith('.pending-')) && await this.readFile(path) === undefined) {
        throw smartModeError('MISSING_DOMAIN_METADATA');
      }
      await this.publish(path, document('domain', SMART_MODE_DOMAIN_NAME, 1, null));
    }
    await this.assertDomain();
  }

  async assertDomain() {
    const text = await this.readFile(join(this.rootDir, 'domain.json'));
    if (text === undefined) throw smartModeError('MISSING_DOMAIN_METADATA');
    if (decode(text, 'domain', SMART_MODE_DOMAIN_NAME, 1) !== null) throw smartModeError('INVALID_STORE_RECORD');
  }

  async readFile(path) {
    try {
      const size = (await this.io.stat(path)).size;
      if (size > 64 * 1024) throw smartModeError('STORE_RECORD_TOO_LARGE');
      const text = await this.io.readFile(path, 'utf8');
      if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw smartModeError('STORE_RECORD_TOO_LARGE');
      return text;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async syncDirectory(path) {
    // Node cannot fsync directories on Windows. File fsync + no-replace link
    // covers process crashes there; sudden power-loss durability is not claimed.
    if (process.platform === 'win32') return;
    const handle = await this.io.open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  async publish(path, value) {
    const serialized = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(serialized) > 64 * 1024) throw smartModeError('STORE_RECORD_TOO_LARGE');
    const dir = dirname(path);
    await this.io.mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.pending-${basename(path)}-${randomUUID()}`);
    try {
      const handle = await this.io.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      try { await this.io.link(temp, path); }
      catch (error) {
        if (error.code === 'EEXIST') return false;
        throw error;
      }
      await this.syncDirectory(dir);
      return true;
    } finally { await this.io.unlink(temp).catch(() => {}); }
  }

  async acknowledge(path) {
    // An earlier writer may have published successfully and failed its final
    // durability barrier. Idempotent retry must complete that barrier too.
    const handle = await this.io.open(path, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await this.syncDirectory(dirname(path));
  }

  run(task) {
    if (this.closing) return Promise.reject(smartModeError('STORE_CLOSED'));
    const pending = Promise.resolve().then(async () => { await this.assertDomain(); return task(); });
    this.operations.add(pending);
    pending.then(() => this.operations.delete(pending), () => this.operations.delete(pending));
    return pending;
  }

  async deleted(sessionId) {
    const text = await this.readFile(this.deletionPath(sessionId));
    if (text === undefined) return false;
    if (decode(text, 'deleted', sessionKey(sessionId), 1) !== null) throw smartModeError('INVALID_STORE_RECORD');
    return true;
  }

  async loadSnapshot(sessionId) {
    if (await this.deleted(sessionId)) throw smartModeError('SESSION_PERMANENTLY_DELETED');
    const text = await this.readFile(this.snapshotPath(sessionId));
    const snapshot = text === undefined ? undefined
      : normalizeSmartModeSnapshot(decode(text, 'snapshot', sessionKey(sessionId), 1), sessionId, { strict: true });
    if (await this.deleted(sessionId)) throw smartModeError('SESSION_PERMANENTLY_DELETED');
    return snapshot;
  }

  readSnapshot(sessionId) { return this.run(() => this.loadSnapshot(reference(sessionId))); }

  writeSnapshot(value) {
    let snapshot;
    try { snapshot = normalizeSmartModeSnapshot(value, value?.sessionId, { strict: true }); }
    catch (error) { return Promise.reject(error); }
    return this.run(async () => {
      const saved = await this.loadSnapshot(snapshot.sessionId);
      if (saved) {
        if (!same(saved, snapshot)) throw smartModeError('SNAPSHOT_CONFLICT');
        await this.acknowledge(this.snapshotPath(snapshot.sessionId));
        return saved;
      }
      if (snapshot.selection === 'smart-auto'
          || (snapshot.selection === 'legacy' && snapshot.policyRevision !== undefined)) {
        const policy = await this.loadPolicy(snapshot.accountRef, snapshot.groupId);
        if (!policy || policy.revision !== snapshot.policyRevision || policy.mode !== snapshot.mode
            || policy.policyVersion !== snapshot.policyVersion) throw smartModeError('DEFAULT_POLICY_CHANGED');
      }
      const path = this.snapshotPath(snapshot.sessionId);
      let created;
      try { created = await this.publish(path, document('snapshot', sessionKey(snapshot.sessionId), 1, snapshot)); }
      catch (error) {
        if (await this.deleted(snapshot.sessionId)) throw smartModeError('SESSION_PERMANENTLY_DELETED');
        throw error;
      }
      if (await this.deleted(snapshot.sessionId)) {
        await this.removeSnapshot(snapshot.sessionId);
        throw smartModeError('SESSION_PERMANENTLY_DELETED');
      }
      const committed = await this.loadSnapshot(snapshot.sessionId);
      if (!same(committed, snapshot)) throw smartModeError('SNAPSHOT_CONFLICT');
      if (!created) await this.acknowledge(path);
      return committed;
    });
  }

  async loadPolicy(accountRef, groupId) {
    const dir = this.policyDir(accountRef, groupId);
    let names;
    try { names = await this.io.readdir(dir); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    const records = names.filter((name) => !name.startsWith('.pending-')).sort();
    let latest;
    for (let i = 0; i < records.length; i++) {
      const revision = i + 1;
      if (records[i] !== `${String(revision).padStart(16, '0')}.json`) throw smartModeError('INVALID_POLICY_HISTORY');
      const text = await this.readFile(join(dir, records[i]));
      if (text === undefined) throw smartModeError('INVALID_POLICY_HISTORY');
      const parsed = smartModeDefaultPolicySchema.safeParse(decode(text, 'default', policyKey(accountRef, groupId), revision));
      if (!parsed.success || parsed.data.revision !== revision
          || parsed.data.accountRef !== accountRef || parsed.data.groupId !== groupId) throw smartModeError('INVALID_DEFAULT_POLICY');
      latest = Object.freeze(parsed.data);
    }
    return latest;
  }

  cacheDefault(accountRef, groupId, policy) {
    const key = policyKey(accountRef, groupId);
    const current = this.defaults.get(key);
    if (!current || (policy && policy.revision >= current.revision)) this.defaults.set(key, policy);
    return this.defaults.get(key);
  }

  refreshDefaultPolicy(accountRef, groupId) {
    return this.run(async () => {
      try { return this.cacheDefault(accountRef, groupId, await this.loadPolicy(accountRef, groupId)); }
      catch (error) { this.defaults.delete(policyKey(accountRef, groupId)); throw error; }
    });
  }

  selectDefault(accountRef, groupId) {
    if (this.closing) throw smartModeError('STORE_CLOSED');
    const key = policyKey(accountRef, groupId);
    if (!this.defaults.has(key)) throw smartModeError('DEFAULT_POLICY_NOT_LOADED');
    const policy = this.defaults.get(key);
    return policy ? Object.freeze({
      mode: policy.mode, accountRef: policy.accountRef, groupId: policy.groupId,
      policyVersion: policy.policyVersion, policyRevision: policy.revision,
      ...(policy.enabledAt !== undefined ? { enabledAt: policy.enabledAt } : {}),
    }) : undefined;
  }

  setDefaultPolicy(value, { expectedRevision } = {}) {
    if (!validRevision(expectedRevision) || expectedRevision === Number.MAX_SAFE_INTEGER) return Promise.reject(smartModeError('INVALID_EXPECTED_REVISION'));
    const input = smartModeDefaultPolicySchema.omit({ version: true, revision: true }).safeParse(value);
    if (!input.success) return Promise.reject(smartModeError('INVALID_DEFAULT_POLICY'));
    const candidate = smartModeDefaultPolicySchema.parse({ ...input.data, version: SMART_MODE_STORE_VERSION, revision: expectedRevision + 1 });
    return this.run(async () => {
      const { accountRef, groupId } = candidate;
      const path = join(this.policyDir(accountRef, groupId), `${String(candidate.revision).padStart(16, '0')}.json`);
      const current = await this.loadPolicy(accountRef, groupId);
      if (current?.revision === candidate.revision && same(current, candidate)) {
        await this.acknowledge(path);
        this.cacheDefault(accountRef, groupId, current);
        return current;
      }
      if ((current?.revision ?? 0) !== expectedRevision) throw smartModeError('POLICY_REVISION_CONFLICT');
      const created = await this.publish(path, document('default', policyKey(accountRef, groupId), candidate.revision, candidate));
      const committed = smartModeDefaultPolicySchema.parse(decode(await this.readFile(path), 'default', policyKey(accountRef, groupId), candidate.revision));
      if (!same(committed, candidate)) throw smartModeError('POLICY_REVISION_CONFLICT');
      if (!created) await this.acknowledge(path);
      this.cacheDefault(accountRef, groupId, committed);
      return Object.freeze(committed);
    });
  }

  async removeSnapshot(sessionId) {
    try { await this.io.unlink(this.snapshotPath(sessionId)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const dir = join(this.rootDir, 'sessions');
    let names;
    try { names = await this.io.readdir(dir); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    // Trusted permanent deletion also discards this Session's unpublished
    // crash remnants. Other Sessions and policy revisions are never touched.
    const prefix = `.pending-${sessionKey(sessionId)}.json-`;
    for (const name of names.filter((entry) => entry.startsWith(prefix))) {
      try { await this.io.unlink(join(dir, name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await this.syncDirectory(dir);
  }

  relationDir(accountRef, groupId, id) {
    return join(this.rootDir, 'source_relations', policyKey(accountRef, groupId), hash(reference(id)));
  }

  async loadSourceRelation(accountRef, groupId, idHash) {
    const dir = join(this.rootDir, 'source_relations', policyKey(accountRef, groupId), idHash);
    let names;
    try { names = await this.io.readdir(dir); }
    catch (cause) { if (cause.code === 'ENOENT') return undefined; throw cause; }
    let latest;
    const records = names.filter((name) => !name.startsWith('.pending-')).sort();
    for (let i = 0; i < records.length; i++) {
      const revision = i + 1;
      if (records[i] !== `${String(revision).padStart(16, '0')}.json`) throw sourceError('INVALID_RELATION_HISTORY');
      latest = normalizeSourceRelation(decode(await this.readFile(join(dir, records[i])), 'source-relation', idHash, revision));
      if (hash(latest.id) !== idHash || latest.accountRef !== accountRef || latest.groupId !== groupId
          || latest.revision !== revision) throw sourceError('INVALID_RELATION_HISTORY');
    }
    return latest;
  }

  readSourceRelation(accountRef, groupId, id) {
    return this.run(() => this.loadSourceRelation(accountRef, groupId, hash(reference(id))));
  }

  listSourceRelations(accountRef, groupId) {
    return this.run(async () => {
      let ids;
      try { ids = await this.io.readdir(join(this.rootDir, 'source_relations', policyKey(accountRef, groupId))); }
      catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
      if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw sourceError('INVALID_RELATION_HISTORY');
      const relations = [];
      for (const id of ids.sort()) {
        const relation = await this.loadSourceRelation(accountRef, groupId, id);
        if (relation) relations.push(relation);
      }
      return relations;
    });
  }

  setSourceRelation(value, { expectedRevision } = {}) {
    let candidate;
    try {
      if (!validRevision(expectedRevision) || expectedRevision === Number.MAX_SAFE_INTEGER) throw smartModeError('INVALID_EXPECTED_REVISION');
      if (!value || Object.hasOwn(value, 'version') || Object.hasOwn(value, 'revision')) throw sourceError('INVALID_SOURCE_RELATION');
      candidate = normalizeSourceRelation({ ...value, version: 1, revision: expectedRevision + 1 });
    } catch (cause) { return Promise.reject(cause); }
    return this.run(async () => {
      const { accountRef, groupId, id } = candidate;
      const idHash = hash(id), dir = this.relationDir(accountRef, groupId, id);
      const path = join(dir, `${String(candidate.revision).padStart(16, '0')}.json`);
      const current = await this.loadSourceRelation(accountRef, groupId, idHash);
      if (current?.revision === candidate.revision && same(current, candidate)) {
        await this.acknowledge(path); return current;
      }
      if ((current?.revision ?? 0) !== expectedRevision) throw sourceError('RELATION_REVISION_CONFLICT');
      if (candidate.status === 'approved' && candidate.enabled
          && await this.approveSourceRelation(candidate) !== true) throw sourceError('RELATION_APPROVAL_REQUIRED');
      const created = await this.publish(path, document('source-relation', idHash, candidate.revision, candidate));
      const committed = normalizeSourceRelation(decode(await this.readFile(path), 'source-relation', idHash, candidate.revision));
      if (!same(committed, candidate)) throw sourceError('RELATION_REVISION_CONFLICT');
      if (!created) await this.acknowledge(path);
      return committed;
    });
  }

  reviewKey(sourceId, definitionFingerprint) { return hash(JSON.stringify([reference(sourceId), reference(definitionFingerprint)])); }

  readOnlyReviewDir(accountRef, groupId, sourceId, definitionFingerprint) {
    return join(this.rootDir, 'read_only_reviews', policyKey(accountRef, groupId), this.reviewKey(sourceId, definitionFingerprint));
  }

  async loadReadOnlyReview(accountRef, groupId, key) {
    const dir = join(this.rootDir, 'read_only_reviews', policyKey(accountRef, groupId), key);
    let names;
    try { names = await this.io.readdir(dir); }
    catch (cause) { if (cause.code === 'ENOENT') return undefined; throw cause; }
    let latest;
    const files = names.filter((name) => !name.startsWith('.pending-')).sort();
    for (let i = 0; i < files.length; i++) {
      const revision = i + 1;
      if (files[i] !== `${String(revision).padStart(16, '0')}.json`) throw sourceError('INVALID_READ_ONLY_HISTORY');
      const review = normalizeReadOnlyReview(decode(await this.readFile(join(dir, files[i])), 'read-only-review', key, revision));
      if (review.accountRef !== accountRef || review.groupId !== groupId
          || this.reviewKey(review.sourceId, review.definitionFingerprint) !== key) throw sourceError('INVALID_READ_ONLY_HISTORY');
      latest = { revision, review };
    }
    return latest;
  }

  readReadOnlyReview(accountRef, groupId, sourceId, definitionFingerprint) {
    return this.run(() => this.loadReadOnlyReview(accountRef, groupId, this.reviewKey(sourceId, definitionFingerprint)));
  }

  listReadOnlyReviews(accountRef, groupId) {
    return this.run(async () => {
      let keys;
      try { keys = await this.io.readdir(join(this.rootDir, 'read_only_reviews', policyKey(accountRef, groupId))); }
      catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
      if (keys.some((key) => !/^[a-f0-9]{64}$/.test(key))) throw sourceError('INVALID_READ_ONLY_HISTORY');
      const result = [];
      for (const key of keys.sort()) { const entry = await this.loadReadOnlyReview(accountRef, groupId, key); if (entry) result.push(entry); }
      return result;
    });
  }

  setReadOnlyReview(value, { expectedRevision } = {}) {
    let candidate;
    try {
      if (!validRevision(expectedRevision) || expectedRevision === Number.MAX_SAFE_INTEGER) throw smartModeError('INVALID_EXPECTED_REVISION');
      candidate = normalizeReadOnlyReview(value);
    } catch (cause) { return Promise.reject(cause); }
    return this.run(async () => {
      const { accountRef, groupId, sourceId, definitionFingerprint } = candidate;
      const key = this.reviewKey(sourceId, definitionFingerprint), revision = expectedRevision + 1;
      const path = join(this.readOnlyReviewDir(accountRef, groupId, sourceId, definitionFingerprint), `${String(revision).padStart(16, '0')}.json`);
      const current = await this.loadReadOnlyReview(accountRef, groupId, key);
      if (current?.revision === revision && same(current.review, candidate)) { await this.acknowledge(path); return current; }
      if ((current?.revision ?? 0) !== expectedRevision) throw sourceError('READ_ONLY_REVISION_CONFLICT');
      if (candidate.enabled && await this.approveReadOnlyReview(candidate) !== true) throw sourceError('READ_ONLY_APPROVAL_REQUIRED');
      const created = await this.publish(path, document('read-only-review', key, revision, candidate));
      const saved = normalizeReadOnlyReview(decode(await this.readFile(path), 'read-only-review', key, revision));
      if (!same(saved, candidate)) throw sourceError('READ_ONLY_REVISION_CONFLICT');
      if (!created) await this.acknowledge(path);
      return { revision, review: saved };
    });
  }

  permanentlyDeleteSession(sessionId) {
    return this.run(async () => {
      reference(sessionId);
      if (await this.confirmPermanentDeletion(sessionId) !== true) throw smartModeError('PERMANENT_DELETION_NOT_CONFIRMED');
      // Tombstone wins over concurrent first writes. No raw SessionId, account
      // or group is retained here. Never delete the marker and reuse the ID.
      const path = this.deletionPath(sessionId);
      const created = await this.publish(path, document('deleted', sessionKey(sessionId), 1, null));
      if (!created) await this.acknowledge(path);
      if (!await this.deleted(sessionId)) throw smartModeError('INVALID_STORE_RECORD');
      await this.removeSnapshot(sessionId);
      return true;
    });
  }

  async lifecycleBindings({ accountRef, groupId }) {
    await this.refreshDefaultPolicy(accountRef, groupId);
    return {
      readSnapshot: (id) => this.readSnapshot(id),
      writeSnapshot: (snapshot) => this.writeSnapshot(snapshot),
      selectDefault: () => this.selectDefault(accountRef, groupId),
    };
  }

  close() {
    this.closing = true;
    return Promise.allSettled([...this.operations]).then(() => { this.defaults.clear(); });
  }
}
