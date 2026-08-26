/**
 * 通道一：OAuth 一键授权（通用 Authorization Code + PKCE S256 + DCR）。
 * 完成全流程并把结果交给 index.js 落库、挂载 mcp-client 条目、调度刷新。
 */
import {
  discoverProtectedResource,
  discoverServerMetadata,
  registerClient,
  pkcePair,
  generateState,
  buildAuthorizeUrl,
  exchangeCode,
  extractTokenResources,
} from '../oauth.js';
import { startCallbackServer } from '../callback-server.js';
import { openBrowser } from '../util.js';

/**
 * @param {object} args
 * @param {object} args.connector 归一化后的连接器描述（auth.mode = oauth2-pkce）
 * @param {object} args.config 插件配置
 * @param {{info:Function,warn:Function,error:Function}} args.logger
 * @param {AbortSignal} [args.signal]
 */
export async function oauthAuthorize({ connector, config, logger, signal }) {
  const entryServer = connector.servers[0];
  if (!entryServer) throw new Error(`connector "${connector.id}" has no servers`);

  const protectedResource = await discoverProtectedResource(entryServer.url, config.requestTimeoutMs);
  const issuer = protectedResource.authorizationServers[0] ?? connector.auth.issuer;
  if (!issuer) throw new Error(`connector "${connector.id}" missing issuer`);

  const metadata = await discoverServerMetadata(issuer, config.requestTimeoutMs);
  const requestedAuthMethod = connector.auth.tokenEndpointAuthMethod ?? 'none';
  if (metadata.tokenEndpointAuthMethodsSupported.length > 0
      && !metadata.tokenEndpointAuthMethodsSupported.includes(requestedAuthMethod)) {
    throw new Error(`OAuth 服务不支持 token_endpoint_auth_method=${requestedAuthMethod}`);
  }
  const callback = await startCallbackServer({ path: '/callback', timeoutMs: config.callbackTimeoutMs, signal });
  const registration = await registerClient(metadata.registrationEndpoint, {
    clientName: connector.auth.clientName,
    redirectUris: [callback.url],
    scope: connector.auth.scope,
    tokenEndpointAuthMethod: requestedAuthMethod,
    timeoutMs: config.requestTimeoutMs,
  });

  const { verifier, challenge, method } = pkcePair();
  const state = generateState();
  const entryResource = protectedResource.resource ?? entryServer.url;
  const authorizeUrl = buildAuthorizeUrl(metadata, {
    clientId: registration.clientId,
    redirectUri: callback.url,
    state,
    challenge,
    challengeMethod: method,
    resource: entryResource,
    scope: connector.auth.scope,
  });

  logger.info(`opening authorization page: ${authorizeUrl}`);
  if (config.openBrowser) openBrowser(authorizeUrl, logger);
  else logger.info('openBrowser disabled — please open the URL above manually to authorize');

  const { code, state: returnedState } = await callback.waitForCallback();
  if (returnedState !== state) throw new Error('OAuth callback state mismatch — aborting (possible CSRF)');

  const token = await exchangeCode(metadata.tokenEndpoint, {
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
    code,
    redirectUri: callback.url,
    codeVerifier: verifier,
    resource: entryResource,
    scope: connector.auth.scope,
    timeoutMs: config.requestTimeoutMs,
  });

  // 按 token 实际授权范围过滤 server；非 JWT / 无 resource claim 时 fallback 全部
  const grantedUrls = extractTokenResources(token.accessToken);
  let grantedKeys;
  let grantedResources;
  if (grantedUrls) {
    const granted = new Set(grantedUrls);
    const grantedServers = connector.servers.filter((s) => granted.has(s.url));
    grantedKeys = grantedServers.map((s) => s.serverKey);
    grantedResources = grantedServers.map((s) => s.url);
    if (grantedKeys.length === 0) {
      grantedKeys = [entryServer.serverKey];
      grantedResources = [entryServer.url];
    }
  } else {
    grantedKeys = connector.servers.map((s) => s.serverKey);
    grantedResources = connector.servers.map((s) => s.url);
  }

  return {
    issuer,
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    clientSecretExpiresAt: registration.clientSecretExpiresAt,
    tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
    clientName: connector.auth.clientName,
    scope: connector.auth.scope,
    token,
    grantedKeys,
    grantedResources,
    entryResource,
  };
}
