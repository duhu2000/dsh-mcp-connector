import { createHash } from 'node:crypto';
import { z } from 'zod';
import { publicToolName } from './governance.js';
import { normalizeSmartEnterpriseScope } from './smart-mode-restrictions.js';

export const SOURCE_RELATION_VERSION = 1;
export const RAW_TOOL_ORIGIN = 'mcp-tools-list-raw-v1';
export const sourceError = (code) => Object.assign(new Error(`Smart sources: ${code}`), { code });
const digest = (value) => createHash('sha256').update(value).digest('hex');
const ref = z.string().min(1).max(512);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Canonical JSON without toJSON, coercion, trimming, truncation or schema cleaning. */
export function canonicalSourceJson(value) {
  const visiting = new Set();
  let nodes = 0;
  const encode = (item, depth = 0) => {
    if (++nodes > 100000 || depth > 100) throw sourceError('RAW_DEFINITION_LIMIT');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return Object.is(item, -0) ? '-0' : JSON.stringify(item);
    if (!item || typeof item !== 'object' || visiting.has(item)) throw sourceError('NON_JSON_DEFINITION');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw sourceError('NON_JSON_DEFINITION');
    visiting.add(item);
    let result;
    if (Array.isArray(item)) {
      const keys = Object.keys(item);
      if (keys.length !== item.length || keys.some((key, i) => key !== String(i))
          || Reflect.ownKeys(item).length !== item.length + 1
          || keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value'))) throw sourceError('NON_JSON_DEFINITION');
      result = `[${item.map((child) => encode(child, depth + 1)).join(',')}]`;
    } else {
      if (Reflect.ownKeys(item).some((key) => typeof key !== 'string')) throw sourceError('NON_JSON_DEFINITION');
      const keys = Object.keys(item).sort();
      if (keys.length !== Reflect.ownKeys(item).length) throw sourceError('NON_JSON_DEFINITION');
      for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value')) throw sourceError('NON_JSON_DEFINITION');
      result = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
    }
    visiting.delete(item);
    if (Buffer.byteLength(result) > 2 * 1024 * 1024) throw sourceError('RAW_DEFINITION_LIMIT');
    return result;
  };
  return encode(value);
}

export function fingerprintRawTool(definition) {
  const full = canonicalSourceJson(definition);
  const raw = JSON.parse(full);
  if (typeof raw?.name !== 'string' || !raw.name || !raw.inputSchema
      || typeof raw.inputSchema !== 'object' || Array.isArray(raw.inputSchema)) throw sourceError('INVALID_RAW_DEFINITION');
  // Editorial differences only influence candidate grouping. Even description-
  // only changes invalidate approval unless their full hashes were reviewed.
  const contract = Object.fromEntries(Object.entries(raw).filter(([key]) => !['title', 'description'].includes(key)));
  return Object.freeze({ rawName: raw.name,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    definitionFingerprint: digest(full), candidateFingerprint: digest(canonicalSourceJson(contract)) });
}

const relationMember = z.strictObject({
  sourceId: fingerprint,
  fingerprints: z.array(fingerprint).min(1).max(16),
  priority: z.number().int().min(0).max(10000),
  verifiedSuperset: z.boolean(),
});
const review = z.strictObject({
  semantics: z.literal('equivalent'),
  billing: z.enum(['equivalent', 'compatible']),
  rateLimits: z.enum(['equivalent', 'compatible']),
  freshness: z.enum(['equivalent', 'compatible']),
  evidenceHash: fingerprint,
  reviewedAt: time,
});
export const sourceRelationSchema = z.strictObject({
  version: z.literal(SOURCE_RELATION_VERSION), id: ref, accountRef: ref, groupId: ref,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(['candidate', 'approved']), enabled: z.boolean(),
  validFrom: time, expiresAt: time,
  members: z.array(relationMember).min(2).max(64), review: review.optional(),
}).superRefine((value, ctx) => {
  if (value.expiresAt <= value.validFrom || (value.status === 'approved' && !value.review)
      || new Set(value.members.map((member) => member.sourceId)).size !== value.members.length
      || value.members.some((member) => new Set(member.fingerprints).size !== member.fingerprints.length)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid source relation' });
  }
});

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export function normalizeSourceRelation(value) {
  const parsed = sourceRelationSchema.safeParse(value);
  if (!parsed.success) throw sourceError('INVALID_SOURCE_RELATION');
  return deepFreeze(parsed.data);
}

export function indexRawToolSources(inputScope, rows) {
  const scope = normalizeSmartEnterpriseScope(inputScope);
  const sources = new Map(), publicNames = new Set();
  for (const row of rows) {
    if (row.accountRef !== scope.accountRef || row.groupId !== scope.groupId) continue;
    const binding = scope.connections.find((entry) => entry.connectionKey === row.connectionKey);
    if (!binding) continue;
    if (row.origin !== RAW_TOOL_ORIGIN || row.definition?.schemaTruncated !== undefined
        || row.serverName !== binding.serverName) throw sourceError('RAW_PROVENANCE_REQUIRED');
    const fingerprints = fingerprintRawTool(row.definition);
    const sourceId = digest(canonicalSourceJson([scope.accountRef, scope.groupId, binding.connectionKey, binding.serverName, fingerprints.rawName]));
    const publicName = publicToolName(binding.serverName, fingerprints.rawName);
    if ((row.publicName !== undefined && row.publicName !== publicName) || sources.has(sourceId) || publicNames.has(publicName)) {
      throw sourceError('AMBIGUOUS_SOURCE_DEFINITION');
    }
    publicNames.add(publicName);
    sources.set(sourceId, Object.freeze({ sourceId, ...fingerprints, connectionKey: binding.connectionKey,
      serverName: binding.serverName, publicName }));
  }
  return sources;
}

/** Observations only: never creates an approval, preference or tool registration. */
export function identifySourceCandidates(sources) {
  const buckets = new Map();
  for (const source of sources.values()) {
    if (!buckets.has(source.candidateFingerprint)) buckets.set(source.candidateFingerprint, []);
    buckets.get(source.candidateFingerprint).push(source);
  }
  return [...buckets].filter(([, members]) => members.length > 1).map(([candidateFingerprint, members]) => Object.freeze({
    status: 'candidate', candidateFingerprint,
    members: members.map(({ sourceId, definitionFingerprint }) => Object.freeze({ sourceId, definitionFingerprint })),
  }));
}

export function sourceDecisionHash(value) { return digest(canonicalSourceJson(value)); }
