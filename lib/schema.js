/**
 * zod 校验：ConnectorDescriptor / ConnectionRecord / GrantRecord / JSON 导入归一。
 * 使用 zod v4；字段默认值在 normalize 阶段补齐，schema 只做形状校验（宽松校验、显式报错）。
 */
import { z } from 'zod';

/** 连接器目录里单个 MCP server 的描述 */
export const serverRefSchema = z.object({
  serverKey: z.string().min(1),
  url: z.string().min(1),
  serverName: z.string().min(1),
  transport: z.enum(['streamable-http', 'sse']).optional(),
  headers: z.record(z.string()).optional(),
});

/** 单个 prompt 示例 */
export const promptSampleSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  server: z.string().optional(),
});

/** 连接器描述（货架商品） */
export const connectorDescriptorSchema = z.object({
  schemaVersion: z.number().int().optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  published: z.boolean().optional(),
  featured: z.boolean().optional(),
  homepage: z.string().optional(),
  prompts: z.array(promptSampleSchema).optional(),
  auth: z
    .object({
      mode: z.enum(['oauth2-pkce', 'bearer', 'api-key', 'none']),
      issuer: z.string().optional(),
      scope: z.string().optional(),
      clientName: z.string().optional(),
      tokenEndpointAuthMethod: z.string().optional(),
      apiKeyHeader: z.string().optional(),
      grantSharing: z.string().optional(),
    })
    .optional(),
  servers: z.array(serverRefSchema).min(1),
});

/** 用户本机连接实例 */
export const connectionRecordSchema = z.object({
  key: z.string().min(1),
  connectorId: z.string().min(1),
  kind: z.enum(['oauth', 'manual', 'json']),
  name: z.string().min(1),
  transport: z.enum(['streamable-http', 'sse']),
  url: z.string().min(1),
  serverName: z.string().min(1),
  headers: z.record(z.string()).optional(),
  auth: z
    .object({
      mode: z.enum(['oauth', 'bearer', 'api-key']),
      bearerToken: z.string().optional(),
      apiKeyHeader: z.string().optional(),
      apiKeyValue: z.string().optional(),
      grantKey: z.string().optional(),
    })
    .optional(),
  enabled: z.boolean().optional(),
  lastError: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

/** OAuth 授权记录（通用多厂商） */
export const grantRecordSchema = z.object({
  key: z.string().min(1),
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  clientName: z.string().optional(),
  scope: z.string(),
  account: z.string(),
  accessToken: z.string(),
  accessTokenExpiresAt: z.number(),
  refreshToken: z.string(),
  authorizedResources: z.array(z.string()),
  connectorIds: z.array(z.string()),
  updatedAt: z.number(),
});

/** 目录缓存 / 覆盖记录（storage-domain catalog 表） */
export const catalogRecordSchema = z.object({
  key: z.string(), // 'remote' | 'overrides'
  updatedAt: z.number(),
  etag: z.string().optional(),
  connectors: z.array(z.unknown()),
});

/** 解析并归一化 ConnectorDescriptor；缺失字段补齐默认值 */
export function normalizeConnectorDescriptor(raw) {
  const parsed = connectorDescriptorSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid connector descriptor: ${issues}`);
  }
  const c = parsed.data;
  const servers = c.servers.map((s) => ({
    serverKey: s.serverKey,
    url: s.url,
    serverName: s.serverName,
    transport: s.transport ?? 'streamable-http',
    headers: s.headers ?? {},
  }));
  return {
    schemaVersion: c.schemaVersion ?? 1,
    id: c.id,
    name: c.name,
    vendor: c.vendor ?? '',
    icon: c.icon ?? '',
    category: c.category ?? '其他',
    summary: c.summary ?? '',
    description: c.description ?? '',
    tags: c.tags ?? [],
    published: c.published ?? true,
    featured: c.featured ?? false,
    homepage: c.homepage ?? '',
    prompts: c.prompts ?? [],
    auth: {
      mode: c.auth?.mode ?? 'none',
      issuer: c.auth?.issuer ?? '',
      scope: c.auth?.scope ?? 'mcp:tools',
      clientName: c.auth?.clientName ?? 'DeepSeek Harness - MCP 连接器',
      tokenEndpointAuthMethod: c.auth?.tokenEndpointAuthMethod ?? 'none',
      apiKeyHeader: c.auth?.apiKeyHeader ?? 'X-Api-Key',
      grantSharing: c.auth?.grantSharing ?? '',
    },
    servers,
  };
}

/** 归一化 ConnectionRecord */
export function normalizeConnectionRecord(raw) {
  const parsed = connectionRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid connection record: ${issues}`);
  }
  return parsed.data;
}
