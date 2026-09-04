/**
 * 企查查 OAuth 模拟服务器（测试用）
 * 模拟 agent.qcc.com 的：
 *   - /.well-known/oauth-authorization-server
 *   - /mcp/.well-known/oauth-protected-resource/{path}
 *   - /oauth/register / authorize / token / revoke
 *   - MCP stream 端点（401 challenge / Bearer 校验）
 *
 * 行为对齐《企查查MCP OAuth 接入文档_20260730_V1.4》。
 * 测试便利：authorize 带 auto=1 时直接 302 回跳（模拟用户点击授权）。
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const SCOPES = ['mcp:tools'];
const RESOURCES = ['company', 'risk', 'ipr', 'operation', 'history', 'executive'];

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function oauthError(res, code, description, status = 400) {
  json(res, status, { error: code, error_description: description });
}

function sha256b64url(text) {
  return createHash('sha256').update(text).digest('base64url');
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
  });
}

/**
 * @param {object} [options]
 * @param {number} [options.expiresIn=3600]
 * @param {string[]} [options.tokenResources] 若提供，签发的 access_token 为带 resource claim 的 JWT（值传 server key 数组，如 ['company','risk',...]，模拟企业认证授权范围）
 * @param {boolean} [options.uniqueClientIds=false] 每次动态注册签发不同 client_id，用于验证重新授权后的旧 grant 清理
 * @param {'none'|'client_secret_post'|'client_secret_basic'} [options.tokenEndpointAuthMethod='none'] DCR 返回的客户端鉴权方式
 * @param {number} [options.refreshFailures=0] 前 N 次刷新返回暂时性 server_error
 * @param {number} [options.registrationFailureStatus=0] DCR 固定返回的失败 HTTP 状态（用于客户端准入回归）
 */
export function createMockQccServer({
  expiresIn = 3600,
  tokenResources,
  uniqueClientIds = false,
  tokenEndpointAuthMethod = 'none',
  refreshFailures = 0,
  registrationFailureStatus = 0,
} = {}) {
  const state = {
    clientId: 'wb_dyn_mock_0001',
    registrationCount: 0,
    registered: null,             // { clientName, redirectUris, grantTypes, responseTypes }
    codes: new Map(),             // code -> { clientId, redirectUri, challenge, resource, used }
    refreshTokens: new Map(),     // refreshToken -> { accessToken, clientId, expiresIn }
    revokedRefresh: new Set(),
    expiresIn,
    tokenResources,
    tokenEndpointAuthMethod,
    clientSecret: 'mock-dynamic-client-secret',
    clients: new Map(),
    refreshCount: 0,
    refreshAttempts: 0,
    refreshFailuresRemaining: refreshFailures,
    clientAuthMethods: [],
  };

  const decodeFormComponent = (value) => decodeURIComponent(String(value).replace(/\+/g, ' '));
  const authenticateClient = (req, params) => {
    let clientId;
    let clientSecret;
    if (tokenEndpointAuthMethod === 'client_secret_basic') {
      const header = req.headers.authorization ?? '';
      if (!header.startsWith('Basic ')) return null;
      let decoded;
      try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return null; }
      const colon = decoded.indexOf(':');
      if (colon === -1) return null;
      clientId = decodeFormComponent(decoded.slice(0, colon));
      clientSecret = decodeFormComponent(decoded.slice(colon + 1));
    } else {
      clientId = params.get('client_id');
      clientSecret = params.get('client_secret');
    }
    const registeredClient = state.clients.get(clientId);
    if (!registeredClient) return null;
    if (tokenEndpointAuthMethod !== 'none' && clientSecret !== registeredClient.clientSecret) return null;
    state.clientAuthMethods.push(tokenEndpointAuthMethod);
    return clientId;
  };

  /** 生成 access_token：tokenResources（server key 数组）提供时为 JWT（payload.resource），否则为普通字符串 */
  const makeAccessToken = () => {
    if (tokenResources) {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ client_name: 'DeepSeek Harness - QCC MCP', scope: 'mcp:tools', resource: tokenResources.map((r) => `${base}/mcp/${r}/stream`) }),
      ).toString('base64url');
      return `${header}.${payload}.mock-signature`;
    }
    return `mock-at-${randomBytes(12).toString('hex')}`;
  };
  let base = ''; // 实际监听端口确定后填充

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const { pathname } = url;

    // ── OAuth Server Metadata ──
    if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: [tokenEndpointAuthMethod],
        scopes_supported: SCOPES,
      });
    }

    // ── Protected Resource Metadata：/mcp/.well-known/oauth-protected-resource/{resource}/{name} ──
    const protectedMatch = pathname.match(/^\/mcp\/\.well-known\/oauth-protected-resource\/([^/]+)\/([^/]+)$/);
    if (protectedMatch && req.method === 'GET') {
      const [, resource, name] = protectedMatch;
      if (!RESOURCES.includes(resource)) return json(res, 404, { error: 'not_found' });
      return json(res, 200, {
        resource: `${base}/mcp/${resource}/${name}`,
        authorization_servers: [base],
        scopes_supported: SCOPES,
        bearer_methods_supported: ['header'],
        resource_name: '企查查 智能体数据平台 (mock)',
      });
    }

    // ── 动态注册 ──
    if (pathname === '/oauth/register' && req.method === 'POST') {
      if (registrationFailureStatus > 0) {
        return oauthError(res, 'access_denied', 'client is not on the approved catalog', registrationFailureStatus);
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.client_name || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
        return oauthError(res, 'invalid_client_metadata', 'client_name and redirect_uris are required');
      }
      for (const uri of body.redirect_uris) {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
          return oauthError(res, 'invalid_client_metadata', `redirect_uri not allowed: ${uri}`);
        }
      }
      const grantTypes = body.grant_types ?? ['authorization_code'];
      if (!grantTypes.includes('authorization_code')) {
        return oauthError(res, 'invalid_client_metadata', 'grant_types must include authorization_code');
      }
      state.registered = {
        clientName: body.client_name,
        redirectUris: body.redirect_uris,
        grantTypes,
        responseTypes: body.response_types ?? ['code'],
        tokenEndpointAuthMethod: body.token_endpoint_auth_method ?? 'none',
      };
      if (state.registered.tokenEndpointAuthMethod !== tokenEndpointAuthMethod) {
        return oauthError(res, 'invalid_client_metadata', `token_endpoint_auth_method must be ${tokenEndpointAuthMethod}`);
      }
      state.registrationCount += 1;
      if (uniqueClientIds) state.clientId = `wb_dyn_mock_${String(state.registrationCount).padStart(4, '0')}`;
      state.clients.set(state.clientId, { clientSecret: state.clientSecret, tokenEndpointAuthMethod });
      const registration = {
        client_id: state.clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
        grant_types: grantTypes,
        response_types: body.response_types ?? ['code'],
        token_endpoint_auth_method: tokenEndpointAuthMethod,
      };
      if (tokenEndpointAuthMethod !== 'none') {
        registration.client_secret = state.clientSecret;
        registration.client_secret_expires_at = 0;
      }
      return json(res, 200, registration);
    }

    // ── 授权页 ──
    if (pathname === '/oauth/authorize' && req.method === 'GET') {
      const { client_id: clientId, redirect_uri: redirectUri, state: stateParam, code_challenge: challenge, resource, scope } = Object.fromEntries(url.searchParams);
      const reg = state.registered;
      if (!reg || reg.redirectUris.find((u) => u.split('?')[0] === redirectUri.split('?')[0]) === undefined) {
        return oauthError(res, 'invalid_request', 'client not registered or redirect_uri mismatch');
      }
      if (!challenge || !stateParam) return oauthError(res, 'invalid_request', 'missing code_challenge');
      if (scope && scope !== 'mcp:tools') return oauthError(res, 'invalid_scope', 'only mcp:tools supported');
      if (resource && !RESOURCES.some((r) => resource.endsWith(`/mcp/${r}/stream`))) {
        return oauthError(res, 'invalid_target', 'resource not in allowlist');
      }
      const code = randomBytes(16).toString('hex');
      state.codes.set(code, { clientId, redirectUri, challenge, resource, used: false });
      const location = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(stateParam ?? '')}`;
      if (url.searchParams.get('auto') === '1') {
        res.writeHead(302, { Location: location });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><body><a href="${location}">模拟用户点击授权</a></body></html>`);
    }

    // ── Token ──
    if (pathname === '/oauth/token' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      const authenticatedClientId = authenticateClient(req, params);
      if (!authenticatedClientId) return oauthError(res, 'invalid_client', 'client authentication failed', 401);
      const grantType = params.get('grant_type');
      if (grantType === 'authorization_code') {
        const code = params.get('code');
        const record = state.codes.get(code);
        if (!record || record.used) return oauthError(res, 'invalid_grant', 'authorization code invalid or already used');
        if (record.clientId !== authenticatedClientId) return oauthError(res, 'invalid_grant', 'client_id mismatch');
        if (record.redirectUri !== params.get('redirect_uri')) return oauthError(res, 'invalid_grant', 'redirect_uri mismatch');
        const verifier = params.get('code_verifier');
        if (!verifier || sha256b64url(verifier) !== record.challenge) return oauthError(res, 'invalid_grant', 'PKCE verification failed');
        record.used = true;
        const refreshToken = randomBytes(24).toString('base64url');
        const accessToken = makeAccessToken();
        state.refreshTokens.set(refreshToken, { accessToken, clientId: record.clientId, expiresIn: state.expiresIn });
        return json(res, 200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: state.expiresIn,
          refresh_token: refreshToken,
          scope: 'mcp:tools',
        });
      }
      if (grantType === 'refresh_token') {
        state.refreshAttempts += 1;
        if (state.refreshFailuresRemaining > 0) {
          state.refreshFailuresRemaining -= 1;
          return oauthError(res, 'server_error', 'temporary refresh outage', 503);
        }
        const refreshToken = params.get('refresh_token');
        const record = state.refreshTokens.get(refreshToken);
        if (!record || state.revokedRefresh.has(refreshToken) || record.clientId !== authenticatedClientId) {
          return oauthError(res, 'invalid_grant', 'refresh token invalid or expired');
        }
        // 轮换：作废旧 refresh token，签发新的一对（文档 §12.1）
        state.refreshTokens.delete(refreshToken);
        state.refreshCount += 1;
        const newRefreshToken = randomBytes(24).toString('base64url');
        const accessToken = makeAccessToken();
        state.refreshTokens.set(newRefreshToken, { accessToken, clientId: record.clientId, expiresIn: state.expiresIn });
        return json(res, 200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: state.expiresIn,
          refresh_token: newRefreshToken,
          scope: 'mcp:tools',
        });
      }
      return oauthError(res, 'unsupported_grant_type', 'grant_type not supported');
    }

    // ── Revoke ──
    if (pathname === '/oauth/revoke' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      if (!authenticateClient(req, params)) return oauthError(res, 'invalid_client', 'client authentication failed', 401);
      const token = params.get('token');
      if (params.get('token_type_hint') !== 'refresh_token') return oauthError(res, 'unsupported_token_type', 'only refresh_token hint supported');
      if (state.refreshTokens.has(token)) {
        state.refreshTokens.delete(token);
        state.revokedRefresh.add(token);
      }
      return json(res, 200, {});
    }

    // ── MCP stream（401 challenge / Bearer 校验）──
    const mcpMatch = pathname.match(/^\/mcp\/([^/]+)\/stream$/);
    if (mcpMatch && req.method === 'POST') {
      const [, resource] = mcpMatch;
      if (!RESOURCES.includes(resource)) return json(res, 404, { error: 'not_found' });
      const auth = req.headers.authorization ?? '';
      const valid = auth.startsWith('Bearer mock-at-');
      if (!valid) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer error="invalid_token", error_description="Missing or invalid token", resource_metadata="${base}/mcp/.well-known/oauth-protected-resource/${resource}/stream"`,
        });
        return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' } }));
      }
      return json(res, 200, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: `qcc-${resource}-mock`, version: '1.0' } } });
    }

    return json(res, 404, { error: 'not_found' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      base = `http://127.0.0.1:${port}`;
      resolve({
        base,
        state,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
