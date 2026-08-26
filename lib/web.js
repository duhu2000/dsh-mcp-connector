/**
 * MCP连接器 —— web 半区：为图形化「插件市场」提供 HTTP 路由。
 *
 * 挂载到 ctx.webServer 的同源前缀：
 *   - GET  /mcp-connector/ui/*   静态 SPA（单页市场：市场 / 已安装 / 安装 / 卸载）
 *   - POST /mcp-connector/api    JSON-RPC 风格调度（method 白名单 → api 门面）
 *
 * 所有路由都过浏览器信任 fence（loopback + 同源），与 better-sidebar 同一策略。
 * 本模块只依赖 ctx.webServer / ctx.webRuntime；在非 web 部署（无这两个服务）时
 * 调用方应跳过挂载，保证插件仍可用于纯对话工具场景。
 */
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');

/** GET /mcp-connector/api 允许调度的方法 → api 门面（白名单，杜绝任意反射调用）。 */
const API_WHITELIST = new Map([
  ['versionStatus', (api, p) => api.versionStatus(p?.force === true)],
  ['catalog', (api, p) => api.catalog(p ?? {})],
  ['status', (api) => api.status()],
  ['healthCheck', (api, p) => api.healthCheck(p?.connectorId)],
  ['migrationPreview', (api, p) => api.migrationPreview(p ?? {})],
  ['migrateLegacy', (api, p) => api.migrateLegacy(p?.candidateIds ?? [])],
  ['connect', (api, p) => api.connect(p?.connectorId, p?.serverKey)],
  ['configure', (api, p) => api.configure(p ?? {})],
  ['importJson', (api, p) => api.importJson(p?.json)],
  ['installFromUrl', (api, p) => api.installFromUrl(p?.url)],
  ['disconnect', (api, p) => api.disconnect(p?.key)],
  ['setEnabled', (api, p) => api.setEnabled(p?.key, p?.enabled !== false)],
  ['refreshCatalog', (api) => api.refreshCatalog()],
  ['toolsList', (api, p) => api.toolsList(p?.connectorId)],
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

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error('请求体不能超过 1 MiB');
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

/* ───────────────────────── 路由挂载 ───────────────────────── */

/**
 * 挂载 web 路由。`wctx` 为已注入 webServer/webRuntime 的子上下文。
 * 返回 disposer（卸载两条 prefix 路由）。
 */
export function mountWebRoutes(wctx, api, { logger }) {
  const trustedHosts = wctx.webRuntime?.trustedHosts ?? [];
  const fence = (req) => isTrustedWebRequest(req, trustedHosts);

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
        const body = await readJsonBody(req);
        const dispatch = API_WHITELIST.get(body?.method);
        if (!dispatch) {
          writeJson(res, 400, { ok: false, message: `未知方法 "${body?.method ?? ''}"（可用：${[...API_WHITELIST.keys()].join('、')}）` });
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
        const body = await readFile(file.path);
        res.writeHead(200, {
          'content-type': MIME[extOf(file.rel)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
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
    uiDisposer?.();
  };
}
