/**
 * 可分享连接模板。
 *
 * 这不是备份格式：只从严格允许的字段重建一条模板，绝不复制未知字段。
 * 自定义 stdio、额外 Header、本机/内网 URL 及无法证明来自公开目录的 OAuth 配置
 * 一律拒绝导出。公开目录的 OAuth / stdio 只输出目录引用，由目标用户在
 * 市场中重新授权/确认，不输出命令、参数或 env。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createTranslator, DEFAULT_LOCALE } from './i18n/index.js';

// Locale is scoped to each call, never shared across concurrent callers.
const translationContext = new AsyncLocalStorage();
const tZh = createTranslator(DEFAULT_LOCALE);
const t = (message, params) => (translationContext.getStore() ?? tZh)(message, params);

import { auditDescriptor, loadBundledCatalog } from './catalog.js';
import {
  REDACTED_VALUE,
  exportRedactedConnections,
  unresolvedRedactions,
} from './connection-backup.js';
import {
  assertSafeHeaderName,
  normalizeConnectionDisplayName,
  slugServerName,
} from './util.js';

export const SHARE_TEMPLATE_FORMAT = 'dsh-mcp-connector.share-template';
export const SHARE_TEMPLATE_VERSION = 1;
export const SHARE_TEMPLATE_INSTRUCTIONS = '导入前必须在本机重新填写所有 <REDACTED:REENTER> 值并显式确认；目录引用请回到市场重新授权或确认启动。';

const CUSTOM_CONNECTION_NAME = '自定义 MCP 连接';
const CUSTOM_SERVER_NAME = 'custom-mcp';
const SHAREABLE_API_KEY_HEADERS = new Map([
  ['x-api-key', 'X-Api-Key'],
  ['api-key', 'Api-Key'],
  ['apikey', 'ApiKey'],
  ['x-auth-token', 'X-Auth-Token'],
]);

const TOP_LEVEL_KEYS = new Set([
  'format', 'version', 'generatedAt', 'redacted', 'instructions', 'source',
  'connections', 'catalogConnections',
]);
const SOURCE_KEYS = new Set(['kind', 'connectorId', 'serverKey']);
const CONNECTION_KEYS = new Set([
  'name', 'serverName', 'transport', 'url', 'headers', 'authMode',
  'bearerToken', 'apiKeyHeader', 'apiKeyValue', 'redactedFields',
]);
const CATALOG_REFERENCE_KEYS = new Set([
  'connectorId', 'serverKey', 'name', 'serverName', 'action',
]);

export class ShareTemplateSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShareTemplateSafetyError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ShareTemplateSafetyError(code, message);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertOnlyKeys(value, allowed, path) {
  if (!plainObject(value)) fail('INVALID_TEMPLATE', t("{path} 必须是普通对象", { path }));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', t("{path} 包含不在可分享白名单中的字段", { path }));
  }
}

function safeName(value, fallback) {
  const candidate = String(value ?? '').trim();
  if (!candidate || /[\\/]|^[A-Za-z]:|file:/i.test(candidate)) return fallback;
  try {
    return normalizeConnectionDisplayName(candidate);
  } catch {
    return fallback;
  }
}

function assertPublicName(value, field) {
  const text = String(value ?? '');
  if (!text.trim() || text !== text.trim() || /[\u0000-\u001f\u007f\\/]|^[A-Za-z]:|file:/i.test(text)) {
    fail('INVALID_TEMPLATE', t("{field} 包含控制字符、路径或非公开名称", { field }));
  }
  try {
    normalizeConnectionDisplayName(text);
  } catch {
    fail('INVALID_TEMPLATE', t("{field} 不是有效的公开名称", { field }));
  }
  return text;
}

function assertCanonicalServerName(value, field) {
  const text = String(value ?? '');
  if (!text || slugServerName(text) !== text) fail('INVALID_TEMPLATE', t("{field} 必须是规范 serverName", { field }));
  return text;
}

function safeIdentifier(value, field) {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(text)) {
    fail('INVALID_CATALOG_REFERENCE', t("{field} 不是安全的公开目录标识", { field }));
  }
  return text;
}

function safeShareableApiKeyHeader(value) {
  const canonical = SHAREABLE_API_KEY_HEADERS.get(String(value ?? '').trim().toLowerCase());
  if (!canonical) {
    fail('API_KEY_HEADER_NOT_SHAREABLE', t("自定义 API Key Header 名无法证明不含租户或账号标识；请改用公开目录模板"));
  }
  return canonical;
}

function shareDocument({ source, connection, catalogConnection, generatedAt = Date.now() }) {
  const document = {
    format: SHARE_TEMPLATE_FORMAT,
    version: SHARE_TEMPLATE_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    redacted: true,
    instructions: SHARE_TEMPLATE_INSTRUCTIONS,
    source,
    connections: connection ? [connection] : [],
    catalogConnections: catalogConnection ? [catalogConnection] : [],
  };
  return assertShareableConnectionTemplate(document);
}

function httpConnection({
  name,
  serverName,
  url,
  redactUrl = false,
  authMode = 'none',
  apiKeyHeader,
  headerNames = [],
}) {
  const connection = {
    name: safeName(name, serverName),
    serverName: slugServerName(serverName),
    transport: 'streamable-http',
    url: redactUrl ? REDACTED_VALUE : safePublicUrl(url),
    headers: {},
    authMode,
    redactedFields: [],
  };
  if (redactUrl) connection.redactedFields.push('url');
  for (const headerName of [...new Set(headerNames.map(assertSafeHeaderName))].sort()) {
    connection.headers[headerName] = REDACTED_VALUE;
    connection.redactedFields.push(`headers.${headerName}`);
  }
  if (authMode === 'bearer') {
    connection.bearerToken = REDACTED_VALUE;
    connection.redactedFields.push('bearerToken');
  } else if (authMode === 'api-key') {
    connection.apiKeyHeader = safeShareableApiKeyHeader(apiKeyHeader || 'X-Api-Key');
    connection.apiKeyValue = REDACTED_VALUE;
    connection.redactedFields.push('apiKeyValue');
  } else if (authMode !== 'none') {
    fail('UNSUPPORTED_AUTH', t("只有 none、bearer 和 api-key HTTP 配置可生成可导入模板"));
  }
  return connection;
}

function catalogReference(descriptor, server) {
  return {
    connectorId: safeIdentifier(descriptor.id, 'connectorId'),
    serverKey: safeIdentifier(server.serverKey, 'serverKey'),
    name: safeName(descriptor.name, server.serverName),
    serverName: slugServerName(server.serverName),
    action: 'connect-from-catalog',
  };
}

function resolvePublishedCatalogReference(connectorId, serverKey, { allowSingleServerFallback = false } = {}) {
  const wantedConnectorId = safeIdentifier(connectorId, 'connectorId');
  const wantedServerKey = safeIdentifier(serverKey, 'serverKey');
  const matches = loadBundledCatalog().filter(
    (item) => item.id === wantedConnectorId && item.published !== false,
  );
  if (matches.length !== 1) {
    fail('CATALOG_NOT_PUBLISHED', t("目录引用不在包内已审计的公开目录中"));
  }
  const descriptor = auditDescriptor(matches[0]);
  const exactServer = descriptor.servers.find((item) => item.serverKey === wantedServerKey);
  const server = exactServer
    ?? (allowSingleServerFallback && descriptor.servers.length === 1 ? descriptor.servers[0] : null);
  if (!server) fail('CATALOG_REFERENCE_MISMATCH', t("目录引用与包内已审计记录不匹配"));
  return { descriptor, server, reference: catalogReference(descriptor, server) };
}

/**
 * 用户明确选择的本机连接→可分享模板。
 * 只支持结构简单的公网 HTTPS；其他情形必须改用已审计的公开目录模板。
 */
function createShareableTemplateFromConnectionImpl(record, options = {}) {
  if (!plainObject(record)) fail('INVALID_CONNECTION', t("请明确选择一条连接"));
  if (record.transport !== 'streamable-http') {
    fail('UNSUPPORTED_TRANSPORT', t("只有已归一化的 Streamable HTTP 自定义连接可生成重填模板"));
  }
  if (record.auth?.mode === 'oauth') {
    fail('CATALOG_REFERENCE_REQUIRED', t("OAuth 连接不导出本机状态；请选择对应的公开目录模板"));
  }
  if (record.transport === 'stdio') {
    fail('CUSTOM_STDIO_NOT_SHAREABLE', t("自定义 stdio 的命令、参数、env 和路径无法安全判断；请使用公开目录模板"));
  }
  if (Object.keys(record.headers ?? {}).length > 0) {
    fail('CUSTOM_HEADERS_NOT_SHAREABLE', t("含额外 Headers 的自定义连接不可分享；无法仅凭名称证明其不含凭据"));
  }

  // 先复用已有脱敏边界，再用白名单重建模板；不直接返回备份对象。
  const portable = exportRedactedConnections([record], { exportedAt: options.generatedAt }).connections[0];
  if (!portable) fail('INVALID_CONNECTION', t("连接无法生成脱敏边界"));
  const connection = httpConnection({
    // 显示名和 serverName 也可能嵌入客户/租户标识，自定义来源一律改为固定公开值。
    name: CUSTOM_CONNECTION_NAME,
    serverName: CUSTOM_SERVER_NAME,
    // 不复制自定义 URL：host/path/子域名也可能携带租户或凭据。
    url: REDACTED_VALUE,
    redactUrl: true,
    authMode: portable.authMode,
    apiKeyHeader: portable.apiKeyHeader,
  });
  return shareDocument({
    source: { kind: 'user-provided' },
    connection,
    generatedAt: options.generatedAt,
  });
}

/**
 * 只从包内已审计、已发布的固定目录按 ID 解析重连引用。
 * 不接受用户粘贴的 descriptor，避免伪造“公开目录”夹带租户标识。
 */
function createShareableTemplateFromCatalogImpl({
  connectorId,
  serverKey,
  generatedAt,
} = {}) {
  const { descriptor, server } = resolvePublishedCatalogReference(connectorId, serverKey, {
    allowSingleServerFallback: true,
  });
  const source = {
    kind: 'catalog',
    connectorId: safeIdentifier(descriptor.id, 'connectorId'),
    serverKey: safeIdentifier(server.serverKey, 'serverKey'),
  };

  // 首版公开目录一律只输出引用。URL 路径/子域名也可能含租户标识；
  // 目标用户必须从当前已审计目录重新解析并确认，不复制端点、Header 或 CLI。
  return shareDocument({
    source,
    catalogConnection: catalogReference(descriptor, server),
    generatedAt,
  });
}

/** 严格验证可分享文档；任何未知字段都拒绝，不做“过滤后继续”。 */
function assertShareableConnectionTemplateImpl(input) {
  const document = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  assertOnlyKeys(document, TOP_LEVEL_KEYS, '$');
  if (document.format !== SHARE_TEMPLATE_FORMAT || document.version !== SHARE_TEMPLATE_VERSION) {
    fail('INVALID_TEMPLATE', t("不支持的可分享模板格式或版本"));
  }
  if (document.redacted !== true) fail('INVALID_TEMPLATE', t("可分享模板必须明确标记 redacted=true"));
  if (!Number.isFinite(Date.parse(document.generatedAt))) fail('INVALID_TEMPLATE', t("generatedAt 必须是 ISO 时间"));
  if (document.instructions !== SHARE_TEMPLATE_INSTRUCTIONS) {
    fail('INVALID_TEMPLATE', t("instructions 必须是固定安全说明"));
  }
  assertOnlyKeys(document.source, SOURCE_KEYS, '$.source');
  if (!['catalog', 'user-provided'].includes(document.source.kind)) fail('INVALID_TEMPLATE', t("不支持的模板来源"));
  if (document.source.kind === 'catalog') {
    safeIdentifier(document.source.connectorId, 'connectorId');
    safeIdentifier(document.source.serverKey, 'serverKey');
  } else if (document.source.connectorId !== undefined || document.source.serverKey !== undefined) {
    fail('INVALID_TEMPLATE', t("用户输入模板不得伪造公开目录身份"));
  }
  if (!Array.isArray(document.connections) || !Array.isArray(document.catalogConnections)) {
    fail('INVALID_TEMPLATE', t("connections 与 catalogConnections 必须是数组"));
  }
  if (document.connections.length + document.catalogConnections.length !== 1) {
    fail('INVALID_TEMPLATE', t("每份模板必须且只能包含一条连接或目录引用"));
  }
  if (document.source.kind === 'catalog' && document.connections.length > 0) {
    fail('INVALID_TEMPLATE', t("公开目录模板只能分享目录引用"));
  }
  if (document.source.kind === 'user-provided' && document.catalogConnections.length > 0) {
    fail('INVALID_TEMPLATE', t("用户输入模板不得伪造目录重连引用"));
  }
  for (const [index, connection] of document.connections.entries()) {
    assertOnlyKeys(connection, CONNECTION_KEYS, `$.connections[${index}]`);
    if (connection.transport !== 'streamable-http') fail('UNKNOWN_CLI_REFUSED', t("可导入分享模板不包含可执行 CLI"));
    if (connection.url !== REDACTED_VALUE) {
      fail('UNREDACTED_VALUE', t("用户输入模板不得携带原始 URL；必须在目标本机重填"));
    }
    connection.name = assertPublicName(connection.name, `$.connections[${index}].name`);
    connection.serverName = assertCanonicalServerName(connection.serverName, `$.connections[${index}].serverName`);
    if (connection.name !== CUSTOM_CONNECTION_NAME || connection.serverName !== CUSTOM_SERVER_NAME) {
      fail('UNREDACTED_VALUE', t("自定义连接的名称与 serverName 必须使用固定公开值"));
    }
    if (!['none', 'bearer', 'api-key'].includes(connection.authMode)) fail('UNSUPPORTED_AUTH', t("鉴权模式不可分享"));
    assertOnlyKeys(connection.headers, new Set(Object.keys(connection.headers ?? {})), `$.connections[${index}].headers`);
    if (Object.keys(connection.headers).length > 0) {
      fail('CUSTOM_HEADERS_NOT_SHAREABLE', t("自定义 Header 名和值都不进入分享模板"));
    }
    for (const [name, value] of Object.entries(connection.headers)) {
      assertSafeHeaderName(name);
      if (value !== REDACTED_VALUE) fail('UNREDACTED_VALUE', t("可分享模板不允许携带 Header 值"));
    }
    const hasBearer = Object.hasOwn(connection, 'bearerToken');
    const hasApiHeader = Object.hasOwn(connection, 'apiKeyHeader');
    const hasApiValue = Object.hasOwn(connection, 'apiKeyValue');
    if (connection.authMode === 'none' && (hasBearer || hasApiHeader || hasApiValue)) {
      fail('UNREDACTED_VALUE', t("none 鉴权模板不得携带任何凭据字段"));
    }
    if (connection.authMode === 'bearer') {
      if (connection.bearerToken !== REDACTED_VALUE || hasApiHeader || hasApiValue) {
        fail('UNREDACTED_VALUE', t("Bearer 模板只能携带重填占位符"));
      }
    }
    if (connection.authMode === 'api-key') {
      if (hasBearer || connection.apiKeyValue !== REDACTED_VALUE) {
        fail('UNREDACTED_VALUE', t("API Key 模板只能携带重填占位符"));
      }
      connection.apiKeyHeader = safeShareableApiKeyHeader(connection.apiKeyHeader);
    }
    if (!Array.isArray(connection.redactedFields)
      || connection.redactedFields.some((value) => typeof value !== 'string')) {
      fail('INVALID_TEMPLATE', t("redactedFields 必须是字符串数组"));
    }
    const expectedRedactions = ['url'];
    if (connection.authMode === 'bearer') expectedRedactions.push('bearerToken');
    if (connection.authMode === 'api-key') expectedRedactions.push('apiKeyValue');
    if (JSON.stringify(connection.redactedFields) !== JSON.stringify(expectedRedactions)) {
      fail('INVALID_TEMPLATE', t("redactedFields 必须与待重填字段完全一致"));
    }
  }
  for (const [index, reference] of document.catalogConnections.entries()) {
    assertOnlyKeys(reference, CATALOG_REFERENCE_KEYS, `$.catalogConnections[${index}]`);
    safeIdentifier(reference.connectorId, 'connectorId');
    safeIdentifier(reference.serverKey, 'serverKey');
    assertPublicName(reference.name, `$.catalogConnections[${index}].name`);
    assertCanonicalServerName(reference.serverName, `$.catalogConnections[${index}].serverName`);
    if (reference.action !== 'connect-from-catalog') fail('INVALID_TEMPLATE', t("目录引用只能要求用户回市场连接"));
  }
  if (document.source.kind === 'catalog') {
    const reference = document.catalogConnections[0];
    if (reference.connectorId !== document.source.connectorId || reference.serverKey !== document.source.serverKey) {
      fail('INVALID_TEMPLATE', t("目录引用与 source 身份不一致"));
    }
    const canonical = resolvePublishedCatalogReference(
      document.source.connectorId,
      document.source.serverKey,
    ).reference;
    if (reference.connectorId !== canonical.connectorId
      || reference.serverKey !== canonical.serverKey
      || reference.name !== canonical.name
      || reference.serverName !== canonical.serverName
      || reference.action !== canonical.action) {
      fail('CATALOG_REFERENCE_MISMATCH', t("目录引用与包内已审计记录不匹配"));
    }
  }
  return document;
}

function previewShareableConnectionTemplateImpl(input) {
  const document = assertShareableConnectionTemplate(input);
  const missing = unresolvedRedactions(document);
  const connection = document.connections[0];
  const reference = document.catalogConnections[0];
  return {
    format: document.format,
    version: document.version,
    action: connection ? 'import-json-after-confirmation' : 'connect-from-catalog',
    name: connection?.name ?? reference?.name,
    serverName: connection?.serverName ?? reference?.serverName,
    requiresCredentialReentry: missing.length > 0,
    missingFields: missing,
    requiresExplicitConfirmation: true,
    executableConfigurationIncluded: false,
    json: JSON.stringify(document, null, 2),
  };
}

function stringifyShareableConnectionTemplateImpl(input) {
  return JSON.stringify(assertShareableConnectionTemplate(input), null, 2);
}

export function createShareableTemplateFromConnection(input, options = {}) {
  return translationContext.run(options.t ?? translationContext.getStore() ?? tZh,
    () => createShareableTemplateFromConnectionImpl(input, options));
}

export function createShareableTemplateFromCatalog(input, options = {}) {
  return translationContext.run(options.t ?? translationContext.getStore() ?? tZh,
    () => createShareableTemplateFromCatalogImpl(input, options));
}

export function assertShareableConnectionTemplate(input, options = {}) {
  return translationContext.run(options.t ?? translationContext.getStore() ?? tZh,
    () => assertShareableConnectionTemplateImpl(input, options));
}

export function previewShareableConnectionTemplate(input, options = {}) {
  return translationContext.run(options.t ?? translationContext.getStore() ?? tZh,
    () => previewShareableConnectionTemplateImpl(input, options));
}

export function stringifyShareableConnectionTemplate(input, options = {}) {
  return translationContext.run(options.t ?? translationContext.getStore() ?? tZh,
    () => stringifyShareableConnectionTemplateImpl(input, options));
}
