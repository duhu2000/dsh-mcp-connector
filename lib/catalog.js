/**
 * 连接器目录：内置 + 远程 registry + config 注入 + 本地覆盖（上架/下架开关）。
 * 合并键为 id，优先级：本地覆盖 > config.connectors > 远程 registry > 内置目录。
 */
import { readFileSync } from 'node:fs';
import { normalizeConnectorDescriptor } from './schema.js';
import { assertSafeUrl, assertSafeHeaderName } from './util.js';

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

const SECRET_KEY_RE = /^(?:access[-_]?token|refresh[-_]?token|token|api[-_]?key|secret|client[-_]?secret|password|authorization)$/i;
const SECRET_ENV_RE = /(?:token|secret|api[_-]?key|password|authorization|credential)/i;

/** 在 zod 丢弃未知字段前扫描原始 JSON，避免把夹带的 token 静默忽略。 */
export function auditRawDescriptor(raw, path = 'connector') {
  if (!raw || typeof raw !== 'object') return raw;
  for (const [key, value] of Object.entries(raw)) {
    const fieldPath = `${path}.${key}`;
    if (SECRET_KEY_RE.test(key) && value !== undefined && value !== null && String(value).trim() !== '') {
      throw new Error(`${fieldPath} 禁止携带凭证或密钥`);
    }
    if (typeof value === 'object') auditRawDescriptor(value, fieldPath);
  }
  return raw;
}

/** 读取包内内置目录 */
export function loadBundledCatalog() {
  try {
    const raw = readFileSync(new URL('../catalog/catalog.json', import.meta.url), 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : Array.isArray(data?.connectors) ? data.connectors : [];
    return list.map(normalizeConnectorDescriptor);
  } catch {
    return [];
  }
}

/** 安全审计：目录禁止携带密钥、URL 协议白名单、header 名白名单。 */
export function auditDescriptor(descriptor) {
  for (const server of descriptor.servers) {
    if (server.transport === 'stdio') {
      if (descriptor.auth.mode !== 'none') {
        throw new Error(`connector "${descriptor.id}" 的 stdio server 只能使用 auth.mode=none；凭据应由用户本机 env 配置`);
      }
      for (const name of Object.keys(server.env ?? {})) {
        if (SECRET_ENV_RE.test(name)) {
          throw new Error(`connector "${descriptor.id}" servers[].env 禁止携带密钥类变量: ${name}`);
        }
      }
      continue;
    }
    assertSafeUrl(server.url);
    for (const name of Object.keys(server.headers ?? {})) {
      assertSafeHeaderName(name);
      if (/authorization|token|secret|api[-_]?key/i.test(name)) {
        throw new Error(`connector "${descriptor.id}" servers[].headers 禁止携带密钥类头: ${name}`);
      }
    }
  }
  return descriptor;
}

export async function readLimitedJson(response, maxBytes = MAX_CATALOG_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`JSON 响应超过 ${maxBytes} bytes`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`JSON 响应超过 ${maxBytes} bytes`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 拉取远程 registry（HTTPS + TTL 缓存 + 可选 ETag） */
export async function fetchRemoteCatalog(catalogUrl, { requestTimeoutMs, etag } = {}) {
  assertSafeUrl(catalogUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), requestTimeoutMs ?? 15_000);
  try {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;
    const response = await fetch(catalogUrl, { headers, signal: controller.signal });
    assertSafeUrl(response.url || catalogUrl);
    if (response.status === 304) return { notModified: true };
    if (!response.ok) throw new Error(`catalog fetch HTTP ${response.status}`);
    const data = await readLimitedJson(response);
    const list = Array.isArray(data) ? data : Array.isArray(data?.connectors) ? data.connectors : [];
    const connectors = list.map((raw) => auditDescriptor(normalizeConnectorDescriptor(auditRawDescriptor(raw))));
    return { notModified: false, etag: response.headers.get('etag') ?? undefined, connectors };
  } finally {
    clearTimeout(timer);
  }
}

/** 合并多层来源（sources 为低→高优先级的 descriptor 数组），再应用本地覆盖。 */
export function mergeCatalog(sources, overrides = new Map()) {
  const merged = new Map();
  for (const list of sources) {
    for (const descriptor of list) {
      merged.set(descriptor.id, descriptor);
    }
  }
  for (const [id, patch] of overrides) {
    const current = merged.get(id);
    if (!current) continue;
    const next = { ...current };
    if (typeof patch.published === 'boolean') next.published = patch.published;
    if (typeof patch.featured === 'boolean') next.featured = patch.featured;
    merged.set(id, next);
  }
  return [...merged.values()];
}

/** 目录查询（publishedOnly 默认只显示已上架） */
export function listCatalog(merged, { category, keyword, publishedOnly = true } = {}) {
  let list = merged;
  if (publishedOnly) list = list.filter((d) => d.published !== false);
  if (category) list = list.filter((d) => d.category === category);
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    list = list.filter((d) =>
      [d.id, d.name, d.vendor, d.category, d.summary, d.description, ...(d.tags ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw)),
    );
  }
  // 精选位优先；同级保留目录声明顺序，便于维护明确的市场陈列顺序。
  return [...list].sort((a, b) => (b.featured === true) - (a.featured === true));
}
