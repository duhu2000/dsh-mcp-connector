/**
 * 连接器目录：内置 + 远程 registry + config 注入 + 本地覆盖（上架/下架开关）。
 * 合并键为 id，优先级：本地覆盖 > config.connectors > 远程 registry > 内置目录。
 */
import { readFileSync } from 'node:fs';
import { normalizeConnectorDescriptor } from './schema.js';
import { assertSafeUrl, assertSafeHeaderName } from './util.js';

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

/** 拉取远程 registry（HTTPS + TTL 缓存 + 可选 ETag） */
export async function fetchRemoteCatalog(catalogUrl, { requestTimeoutMs, etag } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), requestTimeoutMs ?? 15_000);
  try {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;
    const response = await fetch(catalogUrl, { headers, signal: controller.signal });
    if (response.status === 304) return { notModified: true };
    if (!response.ok) throw new Error(`catalog fetch HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.connectors) ? data.connectors : [];
    const connectors = list.map((raw) => auditDescriptor(normalizeConnectorDescriptor(raw)));
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
  // 精选位优先，其余按 id 排序保持稳定
  return [...list].sort((a, b) => (b.featured === true) - (a.featured === true) || a.id.localeCompare(b.id));
}
