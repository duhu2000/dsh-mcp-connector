/**
 * 通用 OAuth 客户端（RFC 8414/9728 + Authorization Code + PKCE S256 + DCR）。
 * 与 qcc-dsh-mcp-oauth 同源，但所有端点/scope/clientName 均来自调用参数，不硬编码任何厂商。
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_SCOPE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  VERIFIER_CHARSET,
  VERIFIER_MIN_LENGTH,
  VERIFIER_MAX_LENGTH,
} from './constants.js';

export class OAuthError extends Error {
  constructor(code, description, httpStatus = undefined) {
    super(description ?? code);
    this.name = 'OAuthError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class OAuthNetworkError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'OAuthNetworkError';
  }
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!response.ok) {
      if (body && typeof body === 'object' && typeof body.error === 'string') {
        throw new OAuthError(body.error, body.error_description, response.status);
      }
      throw new OAuthError('http_error', `HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
    }
    return body;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthNetworkError(`request failed: ${url}`, error);
  } finally {
    clearTimeout(timer);
  }
}

function formEncode(params) {
  return new URLSearchParams(params).toString();
}

/* ─────────────────────────── WWW-Authenticate 探测 ─────────────────────────── */

function parseWwwAuthenticateParam(header, key) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    if (k === key) return v;
  }
  return null;
}

/** 对 stream 端点发一次 initialize，尝试从 WWW-Authenticate 读出 resource_metadata 地址。 */
async function probeResourceMetadataFromChallenge(streamUrl, timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const response = await fetch(streamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'dsh-mcp-connector', version: '1.0' },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const auth = response.headers.get('www-authenticate');
    return parseWwwAuthenticateParam(auth, 'resource_metadata');
  } catch {
    return null;
  }
}

/** 由 stream URL 推导 protected resource metadata 地址（fallback 启发式）。 */
export function resourceMetadataUrlFallback(streamUrl) {
  const u = new URL(streamUrl);
  const marker = '/mcp/';
  const index = u.pathname.indexOf(marker);
  if (index !== -1) {
    return `${u.origin}${u.pathname.slice(0, index + marker.length)}.well-known/oauth-protected-resource/${u.pathname.slice(index + marker.length)}`;
  }
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`;
}

/* ─────────────────────────── 阶段一：Protected Resource Metadata ─────────────────────────── */

export async function discoverProtectedResource(streamUrl, timeoutMs) {
  const fromChallenge = await probeResourceMetadataFromChallenge(streamUrl, timeoutMs);
  const url = fromChallenge ?? resourceMetadataUrlFallback(streamUrl);
  const body = await fetchJson(url, { method: 'GET' }, timeoutMs);
  if (!Array.isArray(body.authorization_servers) || body.authorization_servers.length === 0) {
    throw new OAuthError('invalid_metadata', 'protected resource metadata missing authorization_servers');
  }
  return {
    resource: body.resource,
    authorizationServers: body.authorization_servers,
    scopesSupported: body.scopes_supported ?? [],
    bearerMethodsSupported: body.bearer_methods_supported ?? [],
    resourceName: body.resource_name,
  };
}

/* ─────────────────────────── 阶段二：OAuth Server Metadata ─────────────────────────── */

export async function discoverServerMetadata(issuer, timeoutMs) {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`;
  const body = await fetchJson(url, { method: 'GET' }, timeoutMs);
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
    if (typeof body[field] !== 'string' || body[field].length === 0) {
      throw new OAuthError('invalid_metadata', `oauth server metadata missing ${field}`);
    }
  }
  return {
    issuer: body.issuer ?? issuer,
    authorizationEndpoint: body.authorization_endpoint,
    tokenEndpoint: body.token_endpoint,
    registrationEndpoint: body.registration_endpoint,
    revocationEndpoint: body.revocation_endpoint,
    responseTypesSupported: body.response_types_supported ?? [],
    grantTypesSupported: body.grant_types_supported ?? [],
    codeChallengeMethodsSupported: body.code_challenge_methods_supported ?? [],
    tokenEndpointAuthMethodsSupported: body.token_endpoint_auth_methods_supported ?? [],
    scopesSupported: body.scopes_supported ?? [],
  };
}

/* ─────────────────────────── 阶段三：动态注册客户端 ─────────────────────────── */

export async function registerClient(registrationEndpoint, { clientName, redirectUris, scope = DEFAULT_SCOPE, timeoutMs }) {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new OAuthError('invalid_client_metadata', 'redirect_uris is required');
  }
  const body = await fetchJson(
    registrationEndpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope,
      }),
    },
    timeoutMs,
  );
  if (typeof body.client_id !== 'string' || body.client_id.length === 0) {
    throw new OAuthError('invalid_client_metadata', 'registration response missing client_id');
  }
  return { clientId: body.client_id, clientIdIssuedAt: body.client_id_issued_at, clientName: body.client_name };
}

/* ─────────────────────────── PKCE ─────────────────────────── */

export function generateVerifier() {
  const bytes = randomBytes(48);
  let verifier = '';
  for (const byte of bytes) {
    verifier += VERIFIER_CHARSET[byte % VERIFIER_CHARSET.length];
  }
  if (verifier.length < VERIFIER_MIN_LENGTH || verifier.length > VERIFIER_MAX_LENGTH) {
    throw new OAuthError('pkce_generation', `unexpected verifier length ${verifier.length}`);
  }
  return verifier;
}

export function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function pkcePair() {
  const verifier = generateVerifier();
  return { verifier, challenge: generateCodeChallenge(verifier), method: 'S256' };
}

/* ─────────────────────────── 阶段四：发起授权 ─────────────────────────── */

export function buildAuthorizeUrl(metadata, { clientId, redirectUri, state, challenge, challengeMethod = 'S256', resource, scope = DEFAULT_SCOPE }) {
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', challengeMethod);
  if (resource) url.searchParams.set('resource', resource);
  return url.toString();
}

/* ─────────────────────────── 阶段五：换 token / 刷新 / 撤销 ─────────────────────────── */

export async function exchangeCode(tokenEndpoint, { clientId, code, redirectUri, codeVerifier, resource, scope, timeoutMs }) {
  const params = {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };
  if (resource) params.resource = resource;
  if (scope) params.scope = scope;
  const body = await fetchJson(
    tokenEndpoint,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode(params) },
    timeoutMs,
  );
  return parseTokenResponse(body, scope);
}

export async function refreshAccessToken(tokenEndpoint, { clientId, refreshToken, resource, scope, timeoutMs }) {
  const params = {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  };
  if (resource) params.resource = resource;
  if (scope) params.scope = scope;
  const body = await fetchJson(
    tokenEndpoint,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode(params) },
    timeoutMs,
  );
  return parseTokenResponse(body, scope);
}

export async function revokeRefreshToken(revocationEndpoint, { clientId, refreshToken, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({ client_id: clientId, token: refreshToken, token_type_hint: 'refresh_token' }),
      signal: controller.signal,
    });
    if (response.ok) return true;
    if (response.status === 400) return true; // RFC 7009：已失效也视为已撤销
    throw new OAuthError('revoke_failed', `revoke returned HTTP ${response.status}`, response.status);
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthNetworkError('revoke request failed', error);
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── 公共 ─────────────────────────── */

function base64UrlDecode(input) {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s, 'base64').toString('utf8');
}

/** 从 JWT access_token 提取 resource claim（RFC 9068）；非 JWT/无 claim 返回 null。 */
export function extractTokenResources(accessToken) {
  try {
    const segments = accessToken.split('.');
    if (segments.length !== 3) return null;
    const payload = JSON.parse(base64UrlDecode(segments[1]));
    if (Array.isArray(payload.resource)) return payload.resource.map(String);
    return null;
  } catch {
    return null;
  }
}

function parseTokenResponse(body, fallbackScope) {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new OAuthError('invalid_token_response', 'token response missing access_token');
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
  return {
    accessToken: body.access_token,
    tokenType: body.token_type ?? 'Bearer',
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    scope: body.scope ?? fallbackScope ?? DEFAULT_SCOPE,
  };
}

export function generateState() {
  return randomBytes(16).toString('base64url');
}
