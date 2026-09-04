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

const OAUTH_STAGE_LABELS = Object.freeze({
  'resource-discovery': '受保护资源发现',
  'server-metadata': 'OAuth 服务发现',
  'callback-listener': '本机回调监听',
  'client-registration': 'OAuth 客户端注册',
  'authorization-callback': '浏览器授权回调',
  'token-exchange': 'OAuth Token 换取',
});

async function atOAuthStage(stage, action) {
  try {
    return await action();
  } catch (error) {
    if (error && typeof error === 'object' && !error.oauthStage) {
      error.oauthStage = stage;
      error.oauthStageLabel = OAUTH_STAGE_LABELS[stage] ?? stage;
    }
    throw error;
  }
}

function stagedError(stage, message) {
  const error = new Error(message);
  error.oauthStage = stage;
  error.oauthStageLabel = OAUTH_STAGE_LABELS[stage] ?? stage;
  return error;
}

/** 把 OAuth 底层异常收敛为可操作、不泄露响应体的用户诊断。 */
export function describeOAuthAuthorizationError(error) {
  const stage = error?.oauthStage ?? 'unknown';
  const stageLabel = error?.oauthStageLabel ?? OAUTH_STAGE_LABELS[stage] ?? 'OAuth 授权';
  const httpStatus = Number.isInteger(error?.httpStatus) ? error.httpStatus : undefined;
  const upstreamCode = typeof error?.code === 'string' ? error.code : undefined;
  if (stage === 'client-registration' && httpStatus === 403) {
    return {
      message: 'OAuth 客户端注册被服务商拒绝（HTTP 403），尚未进入浏览器授权。该服务可能只允许已审核客户端；请查看服务商的 MCP 客户端准入说明，或等待连接器完成官方登记。',
      detail: {
        kind: 'oauth-client-registration-rejected',
        stage,
        stageLabel,
        code: 'oauth-dcr-forbidden',
        httpStatus,
        upstreamCode,
      },
    };
  }
  const safeReason = httpStatus
    ? (upstreamCode && upstreamCode !== 'http_error' ? upstreamCode : '服务端拒绝请求')
    : String(error?.message ?? '未知错误')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 240);
  return {
    message: `${stageLabel}失败${httpStatus ? `（HTTP ${httpStatus}）` : ''}：${safeReason}`,
    detail: {
      kind: 'oauth-authorization',
      stage,
      stageLabel,
      code: upstreamCode ?? 'oauth-error',
      ...(httpStatus ? { httpStatus } : {}),
    },
  };
}

/**
 * @param {object} args
 * @param {object} args.connector 归一化后的连接器描述（auth.mode = oauth2-pkce）
 * @param {object} args.config 插件配置
 * @param {{info:Function,warn:Function,error:Function}} args.logger
 * @param {AbortSignal} [args.signal]
 */
export async function oauthAuthorize({ connector, config, logger, signal }) {
  const entryServer = connector.servers[0];
  if (!entryServer) throw stagedError('resource-discovery', `connector "${connector.id}" has no servers`);

  const protectedResource = await atOAuthStage(
    'resource-discovery',
    () => discoverProtectedResource(entryServer.url, config.requestTimeoutMs),
  );
  const issuer = protectedResource.authorizationServers[0] ?? connector.auth.issuer;
  if (!issuer) throw stagedError('resource-discovery', `connector "${connector.id}" missing issuer`);

  const metadata = await atOAuthStage(
    'server-metadata',
    () => discoverServerMetadata(issuer, config.requestTimeoutMs),
  );
  const requestedAuthMethod = connector.auth.tokenEndpointAuthMethod ?? 'none';
  if (metadata.tokenEndpointAuthMethodsSupported.length > 0
      && !metadata.tokenEndpointAuthMethodsSupported.includes(requestedAuthMethod)) {
    throw stagedError('server-metadata', `OAuth 服务不支持 token_endpoint_auth_method=${requestedAuthMethod}`);
  }
  const callback = await atOAuthStage(
    'callback-listener',
    () => startCallbackServer({ path: '/callback', timeoutMs: config.callbackTimeoutMs, signal }),
  );
  try {
    const registration = await atOAuthStage('client-registration', () => registerClient(metadata.registrationEndpoint, {
      clientName: connector.auth.clientName,
      redirectUris: [callback.url],
      scope: connector.auth.scope,
      tokenEndpointAuthMethod: requestedAuthMethod,
      timeoutMs: config.requestTimeoutMs,
    }));

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

    const { code, state: returnedState } = await atOAuthStage(
      'authorization-callback',
      () => callback.waitForCallback(),
    );
    if (returnedState !== state) {
      const error = new Error('OAuth callback state mismatch — aborting (possible CSRF)');
      error.oauthStage = 'authorization-callback';
      error.oauthStageLabel = OAUTH_STAGE_LABELS['authorization-callback'];
      throw error;
    }

    const token = await atOAuthStage('token-exchange', () => exchangeCode(metadata.tokenEndpoint, {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
      code,
      redirectUri: callback.url,
      codeVerifier: verifier,
      resource: entryResource,
      scope: connector.auth.scope,
      timeoutMs: config.requestTimeoutMs,
    }));

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
  } finally {
    await callback.close().catch((error) => logger?.warn(`close OAuth callback listener failed: ${error.message}`));
  }
}
