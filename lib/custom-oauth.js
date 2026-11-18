/** Local custom connections: discovery does not open a browser or register a client. */
import { discoverProtectedResource, discoverServerMetadata } from './oauth.js';
import { validateConnectionRecord } from './mcp-validation.js';
import { assertSafeUrl } from './util.js';
import { createTranslator, DEFAULT_LOCALE } from './i18n/index.js';

export async function discoverCustomOAuth(record, timeoutMs) {
  assertSafeUrl(record.url);
  const resource = await discoverProtectedResource(record.url, timeoutMs);
  const resourceUrl = resource.resource || record.url;
  assertSafeUrl(resourceUrl);
  // Never infer a grant for another service from arbitrary metadata.
  if (new URL(resourceUrl).origin !== new URL(record.url).origin) throw new Error('OAuth resource origin mismatch');
  const issuer = resource.authorizationServers[0];
  const metadata = await discoverServerMetadata(issuer, timeoutMs);
  if (metadata.codeChallengeMethodsSupported.length && !metadata.codeChallengeMethodsSupported.includes('S256')) throw new Error('OAuth PKCE S256 unavailable');
  if (metadata.tokenEndpointAuthMethodsSupported.length && !metadata.tokenEndpointAuthMethodsSupported.includes('none')) throw new Error('OAuth public client registration unavailable');
  return { issuer, resource: resourceUrl, scope: resource.challengeScope ?? resource.scopesSupported.join(' ') };
}

export async function prepareCustomConnections(records, { timeoutMs, t = createTranslator(DEFAULT_LOCALE) } = {}) {
  const prepared = [], results = [];
  for (const input of records) {
    const record = { ...input, pendingAuthorization: false, oauthDiscovery: undefined };
    const result = await validateConnectionRecord(record, { timeoutMs, t });
    const eligible = record.transport === 'streamable-http' && record.authDetection !== 'none'
      && !record.auth && !Object.keys(record.headers ?? {}).length && !record.allowInsecurePrivateNetwork;
    if (!result.ok && result.httpStatus === 401 && eligible) {
      try {
        const oauthDiscovery = await discoverCustomOAuth(record, timeoutMs);
        prepared.push({ ...record, enabled: false, pendingAuthorization: true, oauthDiscovery });
        results.push({ ...result, ok: true, kind: 'authorization-required', message: t('待身份验证') });
        continue;
      } catch {
        results.push({ ...result, message: t('服务要求认证，但未发现可自动使用的 OAuth 配置；请核对服务商的凭据或客户端准入要求') });
        prepared.push(record);
        continue;
      }
    }
    prepared.push(record);
    results.push(result);
  }
  const failures = results.filter(result => !result.ok);
  return { ok: failures.length === 0, records: prepared, detail: { results },
    message: failures.length ? t('连接验证失败：{summary}{more}。未保存连接，请修正后重试。', { summary: failures.map(result => `${result.serverName}: ${result.message}`).join('; '), more: '' }) : '' };
}

export function customOAuthDescriptor(record) {
  return { id: record.key, name: record.name,
    auth: { mode: 'oauth2-pkce', ...record.oauthDiscovery, clientName: 'DeepSeek Harness - MCP Connector', tokenEndpointAuthMethod: 'none', grantSharing: 'connector' },
    servers: [{ serverKey: record.serverName, serverName: record.serverName, url: record.url, oauthResource: record.oauthDiscovery.resource, transport: 'streamable-http' }] };
}
