/**
 * 连接器目录：内置 + 远程 registry + config 注入 + 本地覆盖（上架/下架开关）。
 * 合并键为 id，优先级：本地覆盖 > config.connectors > 远程 registry > 内置目录。
 */
import { readFileSync } from 'node:fs';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { normalizeConnectorDescriptor } from './schema.js';
import { assertSafeUrl, assertSafeHeaderName, assertPublicServerUrl } from './util.js';
import { DEFAULT_LOCALE, createTranslator } from './i18n/index.js';

/** 缺省译文：中文（既有调用点与测试无需改动）。 */
const tZh = createTranslator(DEFAULT_LOCALE);

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

const SECRET_KEY_RE = /^(?:access[-_]?token|refresh[-_]?token|token|api[-_]?key|secret|client[-_]?secret|password|authorization)$/i;
const SECRET_ENV_RE = /(?:token|secret|api[_-]?key|password|authorization|credential)/i;

/** 在 zod 丢弃未知字段前扫描原始 JSON，避免把夹带的 token 静默忽略。 */
export function auditRawDescriptor(raw, path = 'connector', { t = tZh } = {}) {
  if (!raw || typeof raw !== 'object') return raw;
  for (const [key, value] of Object.entries(raw)) {
    const fieldPath = `${path}.${key}`;
    // credentialBindings 的 key 是待注入的环境变量名，value 只能是凭据字段引用；
    // 真实值会在本机表单提交后写入 ConnectionRecord，不允许出现在目录中。
    if (key === 'credentialBindings' || key === 'headerCredentialBindings') continue;
    // credentialFields[].secret 只是“以密码框显示”的布尔声明，不是密钥值。
    if (key === 'secret' && typeof value === 'boolean' && /\.auth\.(?:credentialFields|headerCredentialFields)\.\d+\.secret$/.test(fieldPath)) continue;
    if (SECRET_KEY_RE.test(key) && value !== undefined && value !== null && String(value).trim() !== '') {
      throw new Error(t('{fieldPath} 禁止携带凭证或密钥', { fieldPath }));
    }
    if (typeof value === 'object') auditRawDescriptor(value, fieldPath, { t });
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

/** Sharing trust root: fixed package catalog only, never merged/config/remote sources. */
export function bundledTemplateReferences() {
  return loadBundledCatalog().filter((item) => item.published !== false).flatMap((item) => {
    const descriptor = auditDescriptor(item);
    return descriptor.servers.map((server) => ({
      connectorId: descriptor.id,
      serverKey: server.serverKey,
      name: descriptor.name,
      serverName: server.serverName,
    }));
  });
}

/**
 * 安全审计：目录禁止携带密钥、URL 协议白名单、header 名白名单。
 *
 * @param {object} descriptor 已归一化的连接器卡片
 * @param {{
 *   t?: (msgid: string, params?: object) => string,
 *   tolerant?: boolean,
 *   onEndpointRejected?: (error: Error, context: { descriptor: object, server: object }) => void,
 * }} [options]
 *
 * `tolerant`：审计降级模式，**只影响 servers[].url 的公网端点判定**（其余检查——schema、密钥、
 * 凭据绑定、协议白名单——仍然抛错）。开启后端点不合规不再抛出，而是回调 `onEndpointRejected`
 * 并保留卡片，供「加载期绝不能因单张卡片阻断整体」的入口使用。
 *
 * 用法约定（重要）：
 *   - `index.js` 的 `recomputeMerged()` 审计 **config.connectors** 时必须传 tolerant:true 并记录告警：
 *     用户本机配置里存在内网 / 公网 IPv6 卡片是合法场景，审计失败会让 apply() 抛错、插件整体起不来；
 *   - 远端 registry、`installFromUrl`、`validateRegistryDescriptors` 等「别人提供的卡片」入口
 *     必须保持默认严格模式（不传 tolerant），否则等于放弃 SSRF 防线。
 *
 *   // 示例（index.js recomputeMerged）
 *   const configConnectors = (config.connectors ?? []).map((raw) =>
 *     auditDescriptor(normalizeConnectorDescriptor(raw), {
 *       tolerant: true,
 *       onEndpointRejected: (error, { descriptor }) =>
 *         logger.warn(\`skip unsafe connector endpoint: \${descriptor.id}: \${error.message}\`),
 *     }));
 */
export function auditDescriptor(descriptor, { t = tZh, tolerant = false, onEndpointRejected } = {}) {
  const oauthHttpResources = new Set(
    descriptor.servers
      .filter((server) => ['streamable-http', 'sse'].includes(server.transport))
      .map((server) => server.oauthResource ?? server.url),
  );
  const credentialFields = descriptor.auth.credentialFields ?? [];
  const credentialKeys = new Set();
  for (const field of credentialFields) {
    if (credentialKeys.has(field.key)) throw new Error(t('connector "{id}" auth.credentialFields key 重复: {key}', { id: descriptor.id, key: field.key }));
    credentialKeys.add(field.key);
  }
  // 重复 serverKey 是致命的：连接记录、门禁、configure 都按 serverKey 定位 server，
  // 一张卡片声明两条同名 server（第一条 HTTP 无害、第二条 stdio 恶意）就能让门禁
  // 校验的和实际挂载的不是同一条（实测缺陷 S-2）。这里直接拒绝整张卡片。
  const seenServerKeys = new Set();
  for (const server of descriptor.servers) {
    if (seenServerKeys.has(server.serverKey)) {
      throw new Error(t('connector "{id}" 的 servers[].serverKey 重复: {key}', { id: descriptor.id, key: server.serverKey }));
    }
    seenServerKeys.add(server.serverKey);
  }
  const referencedCredentials = new Set();
  for (const server of descriptor.servers) {
    const headerBindings = server.headerCredentialBindings ?? {};
    if (Object.keys(headerBindings).length) {
      if (server.transport === 'stdio' || descriptor.auth.mode !== 'api-key') {
        throw new Error('headerCredentialBindings requires an HTTP API Key connector');
      }
      const headerNames = new Set(Object.keys(server.headers ?? {}).map(name => name.toLowerCase()));
      for (const [name, key] of Object.entries(headerBindings)) {
        assertSafeHeaderName(name);
        if (/^(host|cookie|set-cookie|proxy-authorization|content-length|transfer-encoding|connection|content-type|accept|origin|referer|mcp-session-id|mcp-protocol-version)$/i.test(name)) {
          throw new Error('headerCredentialBindings cannot bind protocol or routing headers');
        }
        if (headerNames.has(name.toLowerCase())) throw new Error('duplicate credential header');
        if (!credentialKeys.has(key)) throw new Error('unknown header credential field');
        headerNames.add(name.toLowerCase());
        referencedCredentials.add(key);
      }
    }
    if (server.transport === 'stdio') {
      for (const name of Object.keys(server.env ?? {})) {
        if (SECRET_ENV_RE.test(name)) {
          throw new Error(t('connector "{id}" servers[].env 禁止携带密钥类变量: {name}', { id: descriptor.id, name }));
        }
      }
      const bindings = server.credentialBindings ?? {};
      if (descriptor.auth.mode === 'oauth2-pkce') {
        if (Object.keys(bindings).length > 0) {
          throw new Error(t('connector "{id}" 的 OAuth stdio server 不能同时声明 credentialBindings', { id: descriptor.id }));
        }
        if (!server.oauthResource || !server.oauthTokenEnv) {
          throw new Error(t('connector "{id}" 的 OAuth stdio server 必须声明 oauthResource 和 oauthTokenEnv', { id: descriptor.id }));
        }
        assertSafeUrl(server.oauthResource);
        if (!oauthHttpResources.has(server.oauthResource)) {
          throw new Error(t('connector "{id}" 的 OAuth stdio oauthResource 必须引用同一连接器的 HTTP resource', { id: descriptor.id }));
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(server.oauthTokenEnv)) {
          throw new Error(t('connector "{id}" oauthTokenEnv 环境变量名非法: {env}', { id: descriptor.id, env: server.oauthTokenEnv }));
        }
        if (Object.hasOwn(server.env ?? {}, server.oauthTokenEnv)) {
          throw new Error(t('connector "{id}" oauthTokenEnv 与 servers[].env 重复声明: {env}', { id: descriptor.id, env: server.oauthTokenEnv }));
        }
        continue;
      }
      if (server.oauthResource || server.oauthTokenEnv) {
        throw new Error(t('connector "{id}" 只有 OAuth stdio server 可声明 oauthResource/oauthTokenEnv', { id: descriptor.id }));
      }
      if (descriptor.auth.mode === 'none' && Object.keys(bindings).length > 0) {
        throw new Error(t('connector "{id}" 的 stdio credentialBindings 需要 bearer/api-key 凭据定义', { id: descriptor.id }));
      }
      if (['bearer', 'api-key'].includes(descriptor.auth.mode) && Object.keys(bindings).length === 0) {
        throw new Error(t('connector "{id}" 的凭据型 stdio server 必须声明 credentialBindings', { id: descriptor.id }));
      }
      for (const [envName, credentialKey] of Object.entries(bindings)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
          throw new Error(t('connector "{id}" credentialBindings 环境变量名非法: {env}', { id: descriptor.id, env: envName }));
        }
        if (Object.hasOwn(server.env ?? {}, envName)) {
          throw new Error(t('connector "{id}" credentialBindings 与 servers[].env 重复声明: {env}', { id: descriptor.id, env: envName }));
        }
        if (!credentialKeys.has(credentialKey)) {
          throw new Error(t('connector "{id}" credentialBindings 引用了未知凭据字段: {key}', { id: descriptor.id, key: credentialKey }));
        }
        referencedCredentials.add(credentialKey);
      }
      continue;
    }
    assertSafeUrl(server.url);
    // 远端声明的服务器端点不得指向内网 / 链路本地 / 元数据（防 SSRF 跳板）。
    // 回环（127.0.0.1 / ::1 / localhost）与公网 IPv6 放行；内网、元数据、ULA、链路本地、
    // 以及无法判定的 NAT64 / 6to4 前缀一律拒绝。tolerant 模式下这里降级为告警、不阻断加载。
    if (tolerant) {
      try {
        assertPublicServerUrl(server.url);
      } catch (error) {
        onEndpointRejected?.(error, { descriptor, server });
      }
    } else {
      assertPublicServerUrl(server.url);
    }
    // HTTP Server 可声明 oauthResource：实际请求仍用 url（允许带查询参数，如 `?tools=`），
    // 但 OAuth resource 标识、authorizedResources 与刷新参数使用该规范值。
    if (server.oauthResource) {
      if (descriptor.auth.mode !== 'oauth2-pkce') {
        throw new Error(t('connector "{id}" 只有 oauth2-pkce 卡片可声明 oauthResource: {resource}', { id: descriptor.id, resource: server.oauthResource }));
      }
      assertSafeUrl(server.oauthResource);
      if (new URL(server.oauthResource).origin !== new URL(server.url).origin) {
        throw new Error(t('connector "{id}" oauthResource 必须与 server.url 同源: {resource}', { id: descriptor.id, resource: server.oauthResource }));
      }
    }
    if (server.oauthTokenEnv) {
      throw new Error(t('connector "{id}" 只有 OAuth stdio server 可声明 oauthTokenEnv', { id: descriptor.id }));
    }
    for (const name of Object.keys(server.headers ?? {})) {
      assertSafeHeaderName(name);
      if (/authorization|token|secret|api[-_]?key/i.test(name)) {
        throw new Error(t('connector "{id}" servers[].headers 禁止携带密钥类头: {name}', { id: descriptor.id, name }));
      }
    }
  }
  if (descriptor.auth.mode === 'oauth2-pkce' && oauthHttpResources.size === 0) {
    throw new Error(t('connector "{id}" 的 OAuth 授权至少需要一个 HTTP resource', { id: descriptor.id }));
  }
  if (['bearer', 'api-key'].includes(descriptor.auth.mode)) {
    const httpServers = descriptor.servers.filter((server) => ['streamable-http', 'sse'].includes(server.transport));
    if (httpServers.some(server => !Object.keys(server.headerCredentialBindings ?? {}).length) && credentialFields[0]) referencedCredentials.add(credentialFields[0].key);
    for (const field of credentialFields) {
      if (field.required && !referencedCredentials.has(field.key)) {
        throw new Error(t('connector "{id}" 必填凭据字段未被 HTTP 或 stdio 使用: {key}', { id: descriptor.id, key: field.key }));
      }
    }
  }
  return descriptor;
}

export async function readLimitedJson(response, maxBytes = MAX_CATALOG_BYTES, { t = tZh } = {}) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(t('JSON 响应超过 {maxBytes} bytes', { maxBytes }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(t('JSON 响应超过 {maxBytes} bytes', { maxBytes }));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(t('JSON 解析失败: {error}', { error: error instanceof Error ? error.message : String(error) }));
  }
}

/** 拉取远程 registry（HTTPS + TTL 缓存 + 可选 ETag） */
export async function fetchRemoteCatalog(catalogUrl, { requestTimeoutMs, etag, signal, t = tZh } = {}) {
  signal?.throwIfAborted();
  assertSafeUrl(catalogUrl);
  // Node 20+ does not consistently enable environment proxies for global fetch.
  // Scope the dispatcher to this request rather than changing the DSH Host's
  // global dispatcher. Undici handles HTTPS fallback and NO_PROXY matching.
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY;
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY;
  const dispatcher = httpProxy || httpsProxy ? new EnvHttpProxyAgent() : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), requestTimeoutMs ?? 15_000);
  try {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;
    // A request-owned dispatcher must use fetch from the same Undici package:
    // Node 26's built-in Undici is incompatible with this package's v6 agent.
    // Without a proxy, keep the Host's global fetch/dispatcher behavior.
    const requestFetch = dispatcher ? undiciFetch : globalThis.fetch;
    const response = await requestFetch(catalogUrl, {
      headers,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    assertSafeUrl(response.url || catalogUrl);
    if (response.status === 304) return { notModified: true };
    if (!response.ok) throw new Error(`catalog fetch HTTP ${response.status}`);
    const data = await readLimitedJson(response, MAX_CATALOG_BYTES, { t });
    const list = Array.isArray(data) ? data : Array.isArray(data?.connectors) ? data.connectors : [];
    const connectors = list.map((raw) => auditDescriptor(normalizeConnectorDescriptor(auditRawDescriptor(raw, 'connector', { t })), { t }));
    return { notModified: false, etag: response.headers.get('etag') ?? undefined, connectors };
  } finally {
    clearTimeout(timer);
    // Destroy also releases unread error/oversize bodies; close could wait for
    // those bodies indefinitely. Never destroy a dispatcher owned by the Host.
    await dispatcher?.destroy();
  }
}

/**
 * 按顺序拉取远程 registry。仅主源使用缓存 ETag；备用源总是全量拉取，
 * 且不返回备用源 ETag，避免下一次请求把它误发给主源。
 */
export async function fetchRemoteCatalogWithFallback(catalogUrl, fallbackUrls = [], opts = {}) {
  const t = opts.t ?? tZh;
  const urls = [catalogUrl, ...fallbackUrls].filter(Boolean);
  let lastError;
  for (let index = 0; index < urls.length; index += 1) {
    try {
      const fetched = await fetchRemoteCatalog(urls[index], {
        requestTimeoutMs: opts.requestTimeoutMs,
        etag: index === 0 ? opts.etag : undefined,
        signal: opts.signal,
        t,
      });
      return index === 0 ? fetched : { ...fetched, etag: undefined };
    } catch (error) {
      opts.signal?.throwIfAborted();
      lastError = error;
      opts.onSourceError?.({ index, error });
    }
  }
  throw lastError ?? new Error('catalog fetch failed for all sources');
}

/** 本机未发布草案不可遮蔽同 id 的正式远程卡片；其他动态卡片仍可覆盖。 */
export function visibleDynamicDescriptors(remote, dynamic) {
  const publishedRemoteIds = new Set(remote.filter((d) => d.published !== false).map((d) => d.id));
  return dynamic.filter((d) => d.published !== false || !publishedRemoteIds.has(d.id));
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
