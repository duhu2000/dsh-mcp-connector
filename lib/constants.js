/**
 * MCP连接器插件 - 常量定义
 */
export const PLUGIN_NAME = 'mcp-connector';

/** 通用 OAuth 默认 scope */
export const DEFAULT_SCOPE = 'mcp:tools';

/** 默认账号标识（预留多账号） */
export const DEFAULT_ACCOUNT = 'default';

/** 自定义 / JSON 导入连接的 connectorId 占位 */
export const CUSTOM_CONNECTOR_ID = '__custom__';
export const JSON_CONNECTOR_ID = '__json__';

/** 保留 id 前缀：社区 PR 注册表拒绝占用 */
export const RESERVED_ID_PREFIXES = ['qcc-', 'dsh-', 'mcp-connector-'];

/** 请求 / 刷新默认值 */
export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog.json';
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_REFRESH_SKEW_MS = 300_000;
export const DEFAULT_CATALOG_TTL_MS = 3_600_000;

/** PKCE 约束（RFC 7636） */
export const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-';
export const VERIFIER_MIN_LENGTH = 43;
export const VERIFIER_MAX_LENGTH = 128;

/** MCP Streamable HTTP 探测用的协议版本 */
export const MCP_PROTOCOL_VERSION = '2025-03-26';
