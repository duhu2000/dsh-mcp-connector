import { createHash } from 'node:crypto';

export const TOOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const TOOL_CACHE_MAX_TOOLS = 512;
export const TOOL_CACHE_MAX_TOTAL_BYTES = 256 * 1024;
const TOOL_CACHE_MAX_DESCRIPTION_BYTES = 4 * 1024;
const TOOL_CACHE_MAX_SCHEMA_BYTES = 32 * 1024;
const TOOL_SEARCH_MAX_LIMIT = 100;
const OMITTED_SCHEMA_KEYS = new Set(['default', 'example', 'examples', 'const']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function truncateUtf8(value, maxBytes) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let output = '';
  let bytes = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point);
    if (bytes + size > maxBytes) break;
    output += point;
    bytes += size;
  }
  return output;
}

function sanitizeSchemaValue(value, state, depth = 0, propertyMap = false) {
  if (state.nodes >= 2_048 || depth > 10) {
    state.truncated = true;
    return undefined;
  }
  state.nodes += 1;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const safe = truncateUtf8(value, 2_048);
    if (safe !== value) state.truncated = true;
    return safe;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) state.truncated = true;
    return value.slice(0, 128)
      .map((item) => sanitizeSchemaValue(item, state, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return undefined;
  const output = {};
  const entries = Object.entries(value);
  if (entries.length > 128) state.truncated = true;
  for (const [rawKey, rawValue] of entries.slice(0, 128)) {
    if ((!propertyMap && OMITTED_SCHEMA_KEYS.has(rawKey)) || UNSAFE_KEYS.has(rawKey)) {
      if (OMITTED_SCHEMA_KEYS.has(rawKey)) state.truncated = true;
      continue;
    }
    const key = truncateUtf8(rawKey, 256);
    const child = sanitizeSchemaValue(rawValue, state, depth + 1,
      !propertyMap && ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(rawKey));
    if (key && child !== undefined) output[key] = child;
  }
  return output;
}

export function sanitizeToolMetadata(tool) {
  const name = truncateUtf8(tool?.name, 512).trim();
  if (!name) return null;
  const title = truncateUtf8(tool?.title || '', 1_024);
  const description = truncateUtf8(tool?.description || '', TOOL_CACHE_MAX_DESCRIPTION_BYTES);
  const schemaState = { nodes: 0, truncated: false };
  let inputSchema = sanitizeSchemaValue(tool?.inputSchema, schemaState);
  if (inputSchema !== undefined && Buffer.byteLength(JSON.stringify(inputSchema)) > TOOL_CACHE_MAX_SCHEMA_BYTES) {
    inputSchema = undefined;
    schemaState.truncated = true;
  }
  return {
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(schemaState.truncated ? { schemaTruncated: true } : {}),
  };
}

/** 不保存端点本身，只保存用于阻止旧端点缓存串用的不可逆签名。 */
export function connectionToolCacheSignature(record) {
  const identity = record?.transport === 'stdio'
    ? [record.transport, record.serverName, record.command, record.args ?? [], record.cwd ?? '']
    : [record?.transport, record?.serverName, record?.url ?? ''];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function createToolCatalogRecord(record, tools, now = Date.now()) {
  const safeTools = [];
  let totalBytes = 0;
  let truncated = false;
  for (const rawTool of tools ?? []) {
    if (safeTools.length >= TOOL_CACHE_MAX_TOOLS) {
      truncated = true;
      break;
    }
    const tool = sanitizeToolMetadata(rawTool);
    if (!tool) continue;
    const size = Buffer.byteLength(JSON.stringify(tool));
    if (totalBytes + size > TOOL_CACHE_MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    safeTools.push(tool);
    totalBytes += size;
  }
  return {
    key: record.key,
    connectorId: record.connectorId,
    ...(record.serverKey ? { serverKey: record.serverKey } : {}),
    serverName: record.serverName,
    connectionSignature: connectionToolCacheSignature(record),
    observedAt: now,
    updatedAt: now,
    ...(truncated ? { truncated: true } : {}),
    tools: safeTools,
  };
}

export function toolCatalogCacheView(entry, now = Date.now(), ttlMs = TOOL_CACHE_TTL_MS) {
  if (!entry) return null;
  const cacheAgeMs = Math.max(0, now - entry.observedAt);
  return {
    observedAt: entry.observedAt,
    cacheAgeMs,
    stale: cacheAgeMs > ttlMs,
    truncated: entry.truncated === true,
  };
}

export function normalizeToolSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/([\p{Script=Han}])([A-Za-z0-9])/gu, '$1 $2')
    .replace(/([A-Za-z0-9])([\p{Script=Han}])/gu, '$1 $2')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function toolSearchScore(tool, query) {
  const terms = query.split(' ').filter(Boolean);
  const fields = [tool.name, tool.title, tool.description].map(normalizeToolSearchText);
  const compactQuery = query.replace(/ /g, '');
  const compactFields = fields.map((field) => field.replace(/ /g, ''));
  const fieldIndex = fields.findIndex((field, index) => (
    terms.every((term) => field.includes(term)) || compactFields[index].includes(compactQuery)
  ));
  if (fieldIndex < 0) return -1;
  const field = fields[fieldIndex];
  const compact = compactFields[fieldIndex];
  let score = fieldIndex === 0 ? 300 : fieldIndex === 1 ? 180 : 80;
  if (field === query || compact === compactQuery) score += 1_000;
  else if (field.startsWith(query) || compact.startsWith(compactQuery)) score += 500;
  else if (field.includes(query) || compact.includes(compactQuery)) score += 250;
  score -= Math.min(field.length, 200) / 1_000;
  return score;
}

function validLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(TOOL_SEARCH_MAX_LIMIT, Math.trunc(parsed)));
}

export function searchToolCatalog(entries, { query, connectorId, limit = 20 } = {}, now = Date.now(), ttlMs = TOOL_CACHE_TTL_MS) {
  if (!normalizeToolSearchText(query)) throw new Error('工具搜索关键词不能为空');
  return browseToolCatalog(entries, { query, connectorId, limit }, now, ttlMs).items;
}

export function browseToolCatalog(entries, { query, connectorId, serverName, limit = 20, offset = 0 } = {}, now = Date.now(), ttlMs = TOOL_CACHE_TTL_MS) {
  const normalizedQuery = normalizeToolSearchText(query);
  const results = [];
  for (const entry of entries ?? []) {
    if (connectorId && entry.connectorId !== connectorId) continue;
    if (serverName && entry.serverName !== serverName) continue;
    const cache = toolCatalogCacheView(entry, now, ttlMs);
    for (const tool of entry.tools ?? []) {
      const score = normalizedQuery ? toolSearchScore(tool, normalizedQuery) : 0;
      if (score < 0) continue;
      results.push({
        connectorId: entry.connectorId,
        connectionKey: entry.key,
        serverKey: entry.serverKey,
        serverName: entry.serverName,
        name: tool.name,
        title: tool.title || tool.name,
        description: tool.description || '',
        observedAt: cache.observedAt,
        cacheAgeMs: cache.cacheAgeMs,
        stale: cache.stale,
        score,
      });
    }
  }
  results.sort((left, right) => right.score - left.score
      || left.name.localeCompare(right.name)
      || left.serverName.localeCompare(right.serverName) || left.connectionKey.localeCompare(right.connectionKey));
  const start = Number.isFinite(Number(offset)) ? Math.max(0, Math.trunc(Number(offset))) : 0;
  return { total: results.length, items: results.slice(start, start + validLimit(limit)).map(({ score, ...item }) => item) };
}

export function findToolDetails(entries, { toolName, connectorId, serverName } = {}, now = Date.now(), ttlMs = TOOL_CACHE_TTL_MS) {
  const normalizedName = normalizeToolSearchText(toolName);
  if (!normalizedName) throw new Error('toolName 不能为空');
  const matches = [];
  for (const entry of entries ?? []) {
    if (connectorId && entry.connectorId !== connectorId) continue;
    if (serverName && entry.serverName !== serverName) continue;
    const cache = toolCatalogCacheView(entry, now, ttlMs);
    for (const tool of entry.tools ?? []) {
      if (normalizeToolSearchText(tool.name) !== normalizedName) continue;
      matches.push({
        connectorId: entry.connectorId,
        connectionKey: entry.key,
        serverKey: entry.serverKey,
        serverName: entry.serverName,
        name: tool.name,
        title: tool.title || tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema ?? null,
        schemaTruncated: tool.schemaTruncated === true,
        observedAt: cache.observedAt,
        cacheAgeMs: cache.cacheAgeMs,
        stale: cache.stale,
      });
    }
  }
  return matches.sort((left, right) => left.serverName.localeCompare(right.serverName));
}
