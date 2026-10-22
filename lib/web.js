/**
 * MCP连接器 —— web 半区：为图形化「插件市场」提供 HTTP 路由。
 *
 * 挂载到 ctx.webServer 的同源前缀：
 *   - GET  /mcp-connector/ui/*   静态 SPA（单页市场：市场 / 已安装 / 安装 / 卸载）
 *   - POST /mcp-connector/api    JSON-RPC 风格调度（method 白名单 → api 门面）
 *   - GET  /mcp-connector/events 无敏感数据的实时状态 SSE
 *
 * 所有路由都过浏览器信任 fence（loopback + 同源），与 better-sidebar 同一策略。
 * 本模块依赖 ctx.webServer 及 webStartup（新版）或 webRuntime（旧版）；非 web 部署时
 * 调用方应跳过挂载，保证插件仍可用于纯对话工具场景。
 *
 * 静态资源响应的 `Content-Security-Policy` 由 `buildCsp()` 生成；其中
 * `frame-ancestors` 来自插件配置 `frameAncestors`（默认 `['self']`，即只有同源页面
 * 能内嵌面板）。桌面壳（Tauri/Electron）里内嵌面板时祖先源与自身不同源，会被
 * 浏览器拦截，此时需由部署方显式追加外壳源（例如 `http://tauri.localhost`、
 * `tauri://localhost`）。用户输入进入响应头，因此 `normalizeFrameAncestors()`
 * 只接受关键字 / CSP host-source，其余一律丢弃（非法或全空则回退 `'self'`）。
 */
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE, createTranslator, normalizeLocale } from './i18n/index.js';
import { EN_DICTIONARY } from './i18n/locales/en.js';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');

/** GET /mcp-connector/api 允许调度的方法 → api 门面（白名单，杜绝任意反射调用）。 */
const API_WHITELIST = new Map([
  ['versionStatus', (api, p) => api.versionStatus(p?.force === true)],
  ['governance', (api) => api.governance()],
  ['previewPolicy', (api, p) => api.previewPolicy(p ?? {})],
  ['applyPolicy', (api, p) => api.applyPolicy(p ?? {})],
  ['rollbackPolicy', (api, p) => api.rollbackPolicy(p?.rollbackRevision, p?.expectedRevision)],
  ['scopeContext', (api, p) => api.scopeContext(p?.workspaceId)],
  ['previewConnectionScope', (api, p) => api.previewConnectionScope(p ?? {})],
  ['applyConnectionScope', (api, p) => api.applyConnectionScope(p ?? {})],
  ['previewConnectionScopeRollback', (api, p) => api.previewConnectionScopeRollback(p?.rollbackRevision)],
  ['rollbackConnectionScope', (api, p) => api.rollbackConnectionScope(p?.rollbackRevision, p?.expectedRevision)],
  ['catalog', (api, p) => api.catalog(p ?? {})],
  ['status', (api, p) => api.status(p ?? {})],
  ['healthCheck', (api, p) => api.healthCheck(p?.connectorId)],
  ['migrationPreview', (api, p) => api.migrationPreview(p ?? {})],
  ['migrateLegacy', (api, p) => api.migrateLegacy(p?.candidateIds ?? [])],
  ['connect', (api, p) => api.connect(p?.connectorId, p?.serverKey, undefined, p ?? {})],
  ['configure', (api, p) => api.configure(p ?? {})],
  ['importJson', (api, p) => api.importJson(p?.json, p ?? {})],
  ['exportConfig', (api) => api.exportConfig()],
  ['listSnapshots', (api) => api.listSnapshots()],
  ['createSnapshot', (api, p) => api.createSnapshot(p?.label)],
  ['previewSnapshot', (api, p) => api.previewSnapshot(p?.snapshotId)],
  ['restoreSnapshot', (api, p) => api.restoreSnapshot(p?.snapshotId)],
  ['installFromUrl', (api, p) => api.installFromUrl(p?.url, p ?? {})],
  ['renameConnection', (api, p) => api.renameConnection(p?.key, p?.name)],
  ['editableConnectionConfig', (api, p) => api.editableConnectionConfig(p?.key)],
  ['reconfigureConnection', (api, p) => api.reconfigureConnection(p?.key, p?.json)],
  ['editableLocalOverrides', (api, p) => api.editableLocalOverrides(p?.key)],
  ['applyLocalOverrides', (api, p) => api.applyLocalOverrides(p?.key, p?.json, p?.reset)],
  ['disconnect', (api, p) => api.disconnect(p?.key)],
  ['setEnabled', (api, p) => api.setEnabled(p?.key, p?.enabled !== false)],
  ['reconnect', (api, p) => api.reconnect(p?.key)],
  ['setInjectionMode', (api, p) => api.setInjectionMode(p?.key, p?.mode)],
  ['refreshCatalog', (api) => api.refreshCatalog()],
  ['toolsList', (api, p) => api.toolsList(p?.connectorId, p?.workspaceId, p?.cachedOnly === true, p?.connectionKey)],
  ['toolSearch', (api, p) => api.toolSearch(p ?? {})],
  ['toolExplorer', (api, p) => api.toolExplorer(p ?? {})],
  ['toolExplorerDetail', (api, p) => api.toolExplorerDetail(p ?? {})],
  ['toolExplorerAction', (api, p) => api.toolExplorerAction(p ?? {})],
  ['toolDetail', (api, p) => api.toolDetail(p ?? {})],
]);

/* ───────────────────────── 信任 fence ───────────────────────── */

function header(headers, name) {
  const value = headers?.[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseAuthority(host) {
  if (typeof host !== 'string' || host.length === 0) return undefined;
  try {
    const u = new URL(`http://${host}`);
    if (!u.hostname) return undefined;
    return { hostname: u.hostname, host: u.host, port: u.port };
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    hostname.endsWith('.localhost')
  );
}

function isTrustedAuthority(url, trustedHosts) {
  for (const raw of trustedHosts ?? []) {
    const authority = typeof raw === 'string' ? parseAuthority(raw) : undefined;
    if (authority && authority.host === url.host) return true;
  }
  return false;
}

/**
 * 浏览器信任 fence：Host 必须是本机回环或部署声明的可信域，且请求非跨站、Origin 与 Host 同源。
 */
export function isTrustedWebRequest(request, trustedHosts = []) {
  const host = header(request.headers, 'host');
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false;
  const origin = header(request.headers, 'origin');
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/* ───────────────────────── 小工具 ───────────────────────── */

function writeJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req, { t = createTranslator(DEFAULT_LOCALE) } = {}) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error(t('请求体不能超过 1 MiB'));
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function extOf(pathname) {
  const i = pathname.lastIndexOf('.');
  return i >= 0 ? pathname.slice(i).toLowerCase() : '';
}

/** 面板读取的全局变量名；与 `ui/index.html` 中的读取逻辑保持一致。 */
const LOCALE_GLOBAL = '__MCP_CONNECTOR_LOCALE__';

/**
 * 把生效语言注入面板 HTML。
 *
 * 面板是独立的内联脚本，无法 import `lib/i18n`，因此由 Host 在服务端把语言
 * 写进一个全局常量，面板优先读取它。注入方式：
 *   - 只在 `</head>` 前插入一行 `<script>window.__MCP_CONNECTOR_LOCALE__="en"</script>`；
 *   - 值来自 `resolveLocale()` 的归一化结果，只可能是 `zh-CN` / `en`，
 *     且再经 `JSON.stringify` 转义，不存在注入面。
 *
 * 找不到 `</head>` 时原样返回（面板会回退到 `<html lang>`），不猜测插入位置。
 *
 * @param {Buffer} body 原始 index.html 内容
 * @param {'zh-CN'|'en'} locale 生效语言
 * @returns {Buffer} 注入后的内容（未改动时为原 Buffer）
 */
export function injectPanelLocale(body, locale) {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  // 中文是面板内置默认值：不注入任何内容，保持既有响应字节完全不变。
  if (normalized === DEFAULT_LOCALE) return body;
  const html = body.toString('utf8');
  const marker = '</head>';
  const index = html.indexOf(marker);
  if (index < 0) return body;
  const snippet = `<script>window.${LOCALE_GLOBAL}=${JSON.stringify(normalized)}</script>`;
  return Buffer.from(html.slice(0, index) + snippet + html.slice(index), 'utf8');
}

/** 把 URL pathname 安全地映射到 ui 目录内的文件（防目录穿越）。 */
export function splitUiPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const segments = decoded.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return undefined;
  return segments;
}

export function resolveUiFile(pathname) {
  const segments = splitUiPath(pathname);
  if (segments === undefined) return { ok: false };
  if (segments.length === 0) return { ok: true, path: join(UI_DIR, 'index.html'), rel: 'index.html' };
  const abs = resolve(UI_DIR, ...segments);
  const relAbs = relative(UI_DIR, abs);
  if (relAbs === '..' || relAbs.startsWith(`..${sep}`) || isAbsolute(relAbs) || relAbs === '') return { ok: false };
  return { ok: true, path: abs, rel: segments.join('/') };
}

/* ───────────────────── CSP / frame-ancestors ───────────────────── */

/** 面板静态资源的固定指令（`frame-ancestors` 由配置决定，单独拼接）。 */
const CSP_HEAD =
  "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; connect-src 'self'";
const CSP_TAIL = "base-uri 'none'; form-action 'none'";

/** 裸关键字（含已带引号写法）→ CSP 规范写法；`*` 单独处理。 */
const KEYWORD_SOURCES = new Map([
  ['self', "'self'"],
  ["'self'", "'self'"],
  ['none', "'none'"],
  ["'none'", "'none'"],
]);

/**
 * CSP host-source：`[scheme://]host[:port][/path]`。
 * 字符集是白名单式的，因此 `;`、`,`、空白、引号、控制字符等注入载荷在正则阶段就被拒绝。
 */
const HOST_SOURCE =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/)?(?:\*|(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::(\*|[0-9]{1,5}))?(?:\/[A-Za-z0-9\-._~!$&()*+=:@%/]*)?$/;

/** 单个配置项 → CSP source；不合法返回 undefined。 */
function normalizeFrameAncestor(raw) {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  const keyword = KEYWORD_SOURCES.get(value.toLowerCase());
  if (keyword !== undefined) return keyword;
  if (value === '*') return '*';
  const match = HOST_SOURCE.exec(value);
  if (match === null) return undefined;
  const port = match[1];
  if (port !== undefined && port !== '*') {
    const number = Number(port);
    if (!Number.isInteger(number) || number < 1 || number > 65535) return undefined;
  }
  return value;
}

/**
 * 归一化 `frameAncestors` 配置：只保留合法关键字 / CSP host-source，去重并保持顺序。
 *
 * 接受：`self` / `'self'` / `none` / `'none'` / `*`，以及 host-source
 * `tauri://localhost`、`http://tauri.localhost:1420`、`https://*.example.com`、`127.0.0.1:3080`。
 * 拒绝：空串、含 `;`/`,`/空白的注入尝试、`'unsafe-inline'` 等非 host-source 关键字、
 * scheme-source（`data:`、`https:`）以及任何不符合 host-source 语法的值。
 *
 * fail-safe：入参不是数组、或过滤后为空 → 回退 `['self']`（拒绝嵌入，而不是放行任意源）。
 *
 * @param {unknown} values 插件配置里的 `frameAncestors`
 * @returns {string[]} 非空的、可直接拼进响应头的 CSP source 列表
 */
export function normalizeFrameAncestors(values) {
  const accepted = [];
  if (Array.isArray(values)) {
    for (const raw of values) {
      if (typeof raw !== 'string') continue;
      const source = normalizeFrameAncestor(raw);
      if (source !== undefined && !accepted.includes(source)) accepted.push(source);
    }
  }
  return accepted.length > 0 ? accepted : ["'self'"];
}

/**
 * 生成面板静态资源的完整 CSP 字符串；`frame-ancestors` 由配置决定。
 *
 * @param {unknown} frameAncestors 同 `normalizeFrameAncestors()` 的入参
 * @returns {string} 可直接作为 `content-security-policy` 响应头的值
 */
export function buildCsp(frameAncestors) {
  const sources = normalizeFrameAncestors(frameAncestors).join(' ');
  return `${CSP_HEAD}; frame-ancestors ${sources}; ${CSP_TAIL}`;
}

/* ───────────────────────── 路由挂载 ───────────────────────── */

/** Alternative dependencies, not an AND: alpha.1 removed webRuntime.
 * Keep each mount owned by its injection context; prefer webStartup when both exist.
 */
export function injectWebRoutes(ctx, api, options = {}) {
  const candidates = new Map();
  let active;
  let dispose;
  const reconcile = () => {
    const next = candidates.get('webStartup') ?? candidates.get('webRuntime');
    if (next === active) return;
    dispose?.();
    dispose = undefined;
    active = next;
    if (next) {
      dispose = mountWebRoutes(next.ctx, api, {
        ...options, trustedHosts: next.trustedHosts,
      });
      options.logger?.info?.('mcp-connector web UI mounted at /mcp-connector/ui/');
    }
  };
  for (const name of ['webStartup', 'webRuntime']) {
    ctx.inject(['webServer', name], (wctx) => {
      wctx.effect(() => {
        const candidate = { ctx: wctx, trustedHosts: wctx[name].trustedHosts ?? [] };
        candidates.set(name, candidate);
        reconcile();
        return () => {
          if (candidates.get(name) === candidate) candidates.delete(name);
          reconcile();
        };
      });
    });
  }
}

/**
 * 挂载 web 路由。`wctx` 为已注入 webServer 和对应信任服务的子上下文。
 * `frameAncestors` 为面板可嵌入白名单（缺省 = `['self']`，只有同源页面能内嵌；
 * 桌面壳场景由调用方显式追加外壳源）。返回 disposer（卸载三条 prefix 路由）。
 *
 * `locale` 只影响本层自身产生的文案（例如未知方法的提示）；面板文案由面板按
 * `?locale=` 自行选择。缺省为中文，既有部署行为不变。
 */
export function mountWebRoutes(wctx, api, { logger, eventHub, frameAncestors, locale, trustedHosts = wctx.webStartup?.trustedHosts ?? wctx.webRuntime?.trustedHosts ?? [] } = {}) {
  const fence = (req) => isTrustedWebRequest(req, trustedHosts);
  const csp = buildCsp(frameAncestors);
  const t = createTranslator(locale, { en: EN_DICTIONARY });

  const apiDisposer = wctx.webServer.register({
    kind: 'prefix',
    path: '/mcp-connector/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, message: 'forbidden' });
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        res.end();
        return;
      }
      try {
        const body = await readJsonBody(req, { t });
        const dispatch = API_WHITELIST.get(body?.method);
        if (!dispatch) {
          writeJson(res, 400, {
            ok: false,
            message: t('未知方法 "{method}"（可用：{methods}）', {
              method: body?.method ?? '',
              methods: [...API_WHITELIST.keys()].join(t('、')),
            }),
          });
          return;
        }
        const result = await dispatch(api, body?.params ?? {});
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn?.(`web api error: ${message}`);
        writeJson(res, 400, { ok: false, message });
      }
    },
  });

  const eventsDisposer = wctx.webServer.register({
    kind: 'prefix',
    path: '/mcp-connector/events',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, message: 'forbidden' });
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' });
        res.end();
        return;
      }
      if (!eventHub) {
        writeJson(res, 503, { ok: false, message: 'status events unavailable' });
        return;
      }
      if (!eventHub.subscribe(req, res)) {
        writeJson(res, 503, { ok: false, message: 'too many status event clients' });
      }
    },
  });

  const uiDisposer = wctx.webServer.register({
    kind: 'prefix',
    path: '/mcp-connector/ui',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/mcp-connector\/ui/, '') || '/';
      const file = resolveUiFile(pathname);
      if (!file.ok) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      try {
        const raw = await readFile(file.path);
        // 只有面板首页需要知道语言；资源文件原样返回。
        const body = file.rel === 'index.html' ? injectPanelLocale(raw, locale) : raw;
        res.writeHead(200, {
          'content-type': MIME[extOf(file.rel)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'content-security-policy': csp,
          'content-length': body.length,
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    },
  });

  return () => {
    apiDisposer?.();
    eventsDisposer?.();
    uiDisposer?.();
  };
}
