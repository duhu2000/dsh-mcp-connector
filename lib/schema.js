/**
 * zod 校验：ConnectorDescriptor / ConnectionRecord / GrantRecord / JSON 导入归一。
 * 使用 zod v4；字段默认值在 normalize 阶段补齐，schema 只做形状校验（宽松校验、显式报错）。
 */
import { z } from 'zod';

/** 连接器目录里单个 MCP server 的描述 */
export const serverRefSchema = z.object({
  serverKey: z.string().min(1),
  url: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  credentialBindings: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  serverName: z.string().min(1),
  transport: z.enum(['streamable-http', 'sse', 'stdio']).optional(),
  headers: z.record(z.string()).optional(),
});

/** 市场凭据输入定义；只描述表单，绝不包含真实值。 */
export const credentialFieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, '仅允许字母开头及字母/数字/_/-'),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  helpLabel: z.string().optional(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
});

/** Prompt 模板变量；目录只描述表单，不保存用户输入。 */
export const promptVariableSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, '仅允许字母开头及字母/数字/_/-'),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
});

/** 单个 prompt 示例 */
export const promptSampleSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  server: z.string().optional(),
  variables: z.array(promptVariableSchema).optional(),
});

export const toolSnapshotSchema = z.object({
  serverKey: z.string().min(1),
  serverName: z.string().optional(),
  tools: z.array(z.object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
  })),
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
  promptVariables: z.array(promptVariableSchema).optional(),
  prompts: z.array(promptSampleSchema).optional(),
  probeStatus: z.enum(['pass', 'partial', 'fail', 'unverified']).optional(),
  probeCheckedAt: z.number().int().optional(),
  probeReportUrl: z.string().optional(),
  toolsSnapshot: z.array(toolSnapshotSchema).optional(),
  auth: z
    .object({
      mode: z.enum(['oauth2-pkce', 'bearer', 'api-key', 'none']),
      issuer: z.string().optional(),
      scope: z.string().optional(),
      clientName: z.string().optional(),
      tokenEndpointAuthMethod: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
      apiKeyHeader: z.string().optional(),
      grantSharing: z.string().optional(),
      credentialName: z.string().optional(),
      credentialPlaceholder: z.string().optional(),
      credentialDescription: z.string().optional(),
      credentialHelpLabel: z.string().optional(),
      credentialFields: z.array(credentialFieldSchema).optional(),
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
  serverKey: z.string().min(1).optional(),
  transport: z.enum(['streamable-http', 'sse', 'stdio']),
  url: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
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
  clientSecret: z.string().optional(),
  clientSecretExpiresAt: z.number().optional(),
  tokenEndpointAuthMethod: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
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
  const servers = c.servers.map((s) => {
    const rawTransport = s.transport ?? 'streamable-http';
    const transport = rawTransport === 'sse' ? 'streamable-http' : rawTransport;
    if (transport === 'stdio' && !s.command) {
      throw new Error(`server "${s.serverKey}": transport=stdio 时 command 必填`);
    }
    if (transport === 'streamable-http' && !s.url) {
      throw new Error(`server "${s.serverKey}": transport=streamable-http 时 url 必填`);
    }
    return {
      serverKey: s.serverKey,
      url: transport === 'streamable-http' ? s.url : undefined,
      command: transport === 'stdio' ? s.command : undefined,
      args: transport === 'stdio' ? (s.args ?? []) : undefined,
      env: transport === 'stdio' ? (s.env ?? {}) : undefined,
      credentialBindings: transport === 'stdio' ? (s.credentialBindings ?? {}) : undefined,
      cwd: transport === 'stdio' ? (s.cwd ?? '') : undefined,
      serverName: s.serverName,
      transport,
      headers: transport === 'streamable-http' ? (s.headers ?? {}) : {},
    };
  });
  const authMode = c.auth?.mode ?? 'none';
  const fallbackCredentialLabel = c.auth?.credentialName
    || (authMode === 'bearer' ? 'Bearer Token' : authMode === 'api-key' ? 'API Key' : '凭据');
  const credentialFields = c.auth?.credentialFields?.length
    ? c.auth.credentialFields.map((field) => ({
        key: field.key,
        label: field.label,
        placeholder: field.placeholder ?? '',
        description: field.description ?? '',
        helpLabel: field.helpLabel ?? '',
        required: field.required !== false,
        secret: field.secret !== false,
      }))
    : ['bearer', 'api-key'].includes(authMode)
      ? [{
          key: 'credential',
          label: fallbackCredentialLabel,
          placeholder: c.auth?.credentialPlaceholder ?? '',
          description: c.auth?.credentialDescription ?? '',
          helpLabel: c.auth?.credentialHelpLabel ?? '',
          required: true,
          secret: true,
        }]
      : [];
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
    promptVariables: c.promptVariables ?? [],
    prompts: c.prompts ?? [],
    probeStatus: c.probeStatus ?? 'unverified',
    probeCheckedAt: c.probeCheckedAt,
    probeReportUrl: c.probeReportUrl ?? '',
    toolsSnapshot: c.toolsSnapshot ?? [],
    auth: {
      mode: authMode,
      issuer: c.auth?.issuer ?? '',
      scope: c.auth?.scope ?? 'mcp:tools',
      clientName: c.auth?.clientName ?? 'DeepSeek Harness - MCP 连接器',
      tokenEndpointAuthMethod: c.auth?.tokenEndpointAuthMethod ?? 'none',
      apiKeyHeader: c.auth?.apiKeyHeader ?? 'X-Api-Key',
      grantSharing: c.auth?.grantSharing ?? '',
      credentialName: c.auth?.credentialName ?? '',
      credentialPlaceholder: c.auth?.credentialPlaceholder ?? '',
      credentialDescription: c.auth?.credentialDescription ?? '',
      credentialHelpLabel: c.auth?.credentialHelpLabel ?? '',
      credentialFields,
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
  const data = parsed.data;
  const transport = data.transport === 'sse' ? 'streamable-http' : data.transport;
  if (transport === 'stdio' && !data.command) {
    throw new Error('invalid connection record: transport=stdio 时 command 必填');
  }
  if (transport === 'streamable-http' && !data.url) {
    throw new Error('invalid connection record: transport=streamable-http 时 url 必填');
  }
  return {
    ...data,
    transport,
    url: transport === 'streamable-http' ? data.url : undefined,
    command: transport === 'stdio' ? data.command : undefined,
    args: transport === 'stdio' ? (data.args ?? []) : undefined,
    env: transport === 'stdio' ? (data.env ?? {}) : undefined,
    cwd: transport === 'stdio' ? (data.cwd ?? '') : undefined,
    headers: transport === 'streamable-http' ? (data.headers ?? {}) : {},
    auth: transport === 'stdio' ? undefined : data.auth,
  };
}
