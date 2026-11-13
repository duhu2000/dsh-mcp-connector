import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isTrustedWebRequest } from './web.js';

const root = '/mcp-connector/smart-control';
const assets = new Map([['/', ['smart-mode.html', 'text/html; charset=utf-8']], ['/smart-mode.js', ['smart-mode.js', 'text/javascript; charset=utf-8']], ['/smart-mode-en.js', ['smart-mode-en.js', 'text/javascript; charset=utf-8']]]);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };

/** Explicit opt-in route. Host authentication/authorization is mandatory; the
 * loopback/origin fence alone is never treated as operator authentication.
 */
export function mountSmartModeControlRoutes(ctx, control, { enabled = false, authorizeRequest, trustedHosts = [], now = () => Date.now() } = {}) {
  if (!enabled) return () => {};
  if (typeof authorizeRequest !== 'function') throw new Error('CONTROL_AUTHORIZER_REQUIRED');
  const nonces = new Map();
  const stop = ctx.webServer.register({ kind: 'prefix', path: root, async handler(req, res) {
    if (!isTrustedWebRequest(req, trustedHosts)) return json(res, 403, { ok: false, code: 'CONTROL_FORBIDDEN' });
    let principal;
    try { principal = await authorizeRequest(req); } catch {}
    if (!principal?.id || !Array.isArray(principal.permissions) || !principal.permissions.includes('read')) return json(res, 403, { ok: false, code: 'CONTROL_FORBIDDEN' });
    const path = new URL(req.url, 'http://localhost').pathname.slice(root.length) || '/';
    if (path === '/capabilities' && req.method === 'GET') return json(res, 200, { enabled: true, url: `${root}/` });
    if (path === '/api') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
      const nonce = nonces.get(req.headers['x-mcp-control-nonce']);
      if (!req.headers.origin || !nonce || nonce.principalId !== principal.id || nonce.expiresAt <= now()) return json(res, 403, { ok: false, code: 'CONTROL_CSRF_REJECTED' });
      try {
        let length = 0; const chunks = [];
        for await (const chunk of req) { length += chunk.length; if (length > 16384) throw Object.assign(new Error(), { code: 'CONTROL_REQUEST_TOO_LARGE' }); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || Object.keys(body).some((key) => !['method', 'params'].includes(key))) throw Object.assign(new Error(), { code: 'CONTROL_INVALID_ARGUMENTS' });
        const result = await control.dispatch(body.method, body.params ?? {}, principal);
        return json(res, 200, { ok: true, result });
      } catch (error) { return json(res, 400, { ok: false, code: error.code ?? 'CONTROL_REQUEST_FAILED' }); }
    }
    const asset = assets.get(path);
    if (!asset || req.method !== 'GET') return json(res, 404, { ok: false, code: 'NOT_FOUND' });
    let body = await readFile(new URL(asset[0] === 'smart-mode-en.js' ? './i18n/locales/en/smart-mode.js' : `../ui/${asset[0]}`, import.meta.url), 'utf8');
    if (path === '/') {
      for (const [key, value] of nonces) if (value.expiresAt <= now()) nonces.delete(key);
      if (nonces.size >= 128) return json(res, 429, { ok: false, code: 'CONTROL_PAGE_LIMIT' });
      const nonce = randomBytes(24).toString('hex');
      nonces.set(nonce, { principalId: principal.id, expiresAt: now() + 1800000 });
      body = body.replace('CONTROL_NONCE_PLACEHOLDER', nonce);
    }
    res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" });
    res.end(body);
  } });
  return () => { nonces.clear(); stop(); };
}
