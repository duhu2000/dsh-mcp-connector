/**
 * 对话工具面：目录 / 连接 / 配置 / 导入 / URL 安装 / 状态 / 启停 / 断开 / 刷新目录 / 上下架。
 */
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    detail: { type: 'object', additionalProperties: true },
  },
  required: ['ok', 'message'],
  additionalProperties: true,
};

const resultOutput = {
  schema: RESULT_SCHEMA,
  render(args, value) {
    return [{ type: 'text', text: value.message }];
  },
};

/** 目录工具：把货架明细逐条渲染出来，模型才能读到名称/分类/鉴权方式 */
const catalogOutput = {
  schema: RESULT_SCHEMA,
  render(args, value) {
    const lines = [value.message];
    const items = value.detail?.items ?? [];
    if (items.length) {
      lines.push('');
      for (const it of items) {
        const star = it.featured ? '⭐ ' : '';
        const connected = it.connected?.length ? `（已连接 ${it.connected.length}）` : '';
        const summary = it.summary ? ` — ${it.summary}` : '';
        lines.push(`- ${star}[${it.id}] ${it.name} · ${it.category} · ${it.authMode}${connected}${summary}`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

/** 状态工具：把每条连接逐条渲染出来 */
const statusOutput = {
  schema: RESULT_SCHEMA,
  render(args, value) {
    const lines = [value.message];
    const items = value.detail?.items ?? [];
    if (items.length) {
      lines.push('');
      for (const it of items) {
        const state = it.enabled ? '启用' : '停用';
        const auth = it.authMode === 'oauth'
          ? it.grant?.needsReauth ? 'oauth(需重新授权)' : it.grant?.missing ? 'oauth(授权缺失)' : 'oauth'
          : it.authMode;
        lines.push(`- [${it.key}] ${it.name} (${it.serverName}) · ${it.kind}/${auth} · ${state} → ${it.url}`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

const noArgs = { type: 'object', properties: {}, additionalProperties: false };

export function registerTools(ctx, api) {
  const disposers = [];
  const reg = (def) => disposers.push(ctx.tools.register(def));

  reg({
    name: 'mcp_connector_catalog',
    description:
      '列出 MCP 连接器市场目录（货架）：已上架的连接器，含名称/厂商/简介/分类/标签，以及是否已连接。' +
      '可按分类或关键词过滤。用户说「列出连接器」「有哪些连接器」「连接器市场」时使用。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '按分类过滤（企业数据/办公协作/地图出行/金融行情/开发工具/数据库/AI 模型/其他）' },
        keyword: { type: 'string', description: '按名称/厂商/简介/标签关键词过滤' },
      },
      additionalProperties: false,
    },
    output: catalogOutput,
    async execute(args) {
      return api.catalog(args ?? {});
    },
  });

  reg({
    name: 'mcp_connector_connect',
    description:
      '一键连接某个 MCP 连接器（按 connectorId）。OAuth 型会打开系统浏览器跳转授权页，登录授权后自动完成；' +
      '无鉴权型直接连接；需要 API Key / Bearer Token 的会提示改用 mcp_connector_configure 填写凭据。',
    parameters: {
      type: 'object',
      properties: {
        connectorId: { type: 'string', description: '连接器 id（来自 mcp_connector_catalog）' },
        serverKey: { type: 'string', description: '多 server 连接器指定入口 serverKey（可选）' },
      },
      required: ['connectorId'],
      additionalProperties: false,
    },
    output: resultOutput,
    timeoutMs: 180_000,
    async execute(args, exec) {
      return api.connect(args.connectorId, args.serverKey, exec.signal);
    },
  });

  reg({
    name: 'mcp_connector_configure',
    description:
      '自定义配置一个外部 MCP Server 连接：手工填 URL / transport / serverName / 鉴权（Bearer Token 或自定义 API Key 头）。' +
      '也可对市场中的 Bearer/API Key 连接器按 connectorId 一次配置全部 Server。',
    parameters: {
      type: 'object',
      properties: {
        connectorId: { type: 'string', description: '市场凭据型连接器 id；提供时无需 name/url' },
        name: { type: 'string', description: '连接展示名' },
        url: { type: 'string', description: 'MCP 端点 URL（https 或回环 http）' },
        transport: { type: 'string', enum: ['streamable-http', 'sse'], description: '传输方式，默认 streamable-http' },
        serverName: { type: 'string', description: 'serverName（决定工具名前缀 mcp__<serverName>__*，默认由 name 归一）' },
        authMode: { type: 'string', enum: ['none', 'bearer', 'api-key'], description: '鉴权方式，默认 none' },
        bearerToken: { type: 'string', description: 'authMode=bearer 时的 token' },
        apiKeyHeader: { type: 'string', description: 'authMode=api-key 时的头名，默认 X-Api-Key' },
        apiKeyValue: { type: 'string', description: 'authMode=api-key 时的值' },
        headersJson: { type: 'string', description: '额外静态头（JSON 对象字符串）' },
      },
      anyOf: [{ required: ['connectorId'] }, { required: ['name', 'url'] }],
      additionalProperties: false,
    },
    output: resultOutput,
    async execute(args) {
      return api.configure(args ?? {});
    },
  });

  reg({
    name: 'mcp_connector_import_json',
    description:
      '粘贴 JSON 批量导入外部 MCP 连接。支持两种格式：{ "mcpServers": { "name": {"type":"streamable-http","url":"...","headers":{...}} } } ' +
      '或 { "connections": [ {...} ] }。整体预校验，任一非法整体拒绝。',
    parameters: {
      type: 'object',
      properties: {
        json: { type: 'string', description: 'JSON 配置文本' },
      },
      required: ['json'],
      additionalProperties: false,
    },
    output: resultOutput,
    async execute(args) {
      return api.importJson(args.json);
    },
  });

  reg({
    name: 'mcp_connector_install_from_url',
    description:
      '从厂商提供的连接器描述 URL（well-known JSON，如 /dsh-connector.json）拉取并安装：先探测后落库，单个描述会自动连接。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '连接器描述 JSON 的 URL' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    output: resultOutput,
    timeoutMs: 60_000,
    async execute(args) {
      return api.installFromUrl(args.url);
    },
  });

  reg({
    name: 'mcp_connector_status',
    description: '查看全部 MCP 连接的状态：启用状态、连接类型、OAuth 过期时间、是否需要重新授权、最近错误。',
    parameters: noArgs,
    output: statusOutput,
    async execute() {
      return api.status();
    },
  });

  reg({
    name: 'mcp_connector_migration_preview',
    description:
      '只读检测旧 qcc-dsh-mcp-oauth / qcc-dsh-mcp-legal-oauth 的本机授权，返回可迁移数量与匹配 Server；不返回 token、不修改任何数据。',
    parameters: noArgs,
    output: resultOutput,
    async execute() {
      return api.migrationPreview({ scanStored: true });
    },
  });

  reg({
    name: 'mcp_connector_migrate_legacy',
    description:
      '在用户明确确认后，把旧企查查 OAuth 授权复制到 MCP连接器。幂等执行，保留旧插件与旧凭据，不会自动卸载或删除源数据。',
    parameters: {
      type: 'object',
      properties: {
        candidateIds: { type: 'array', items: { type: 'string' }, description: '来自 migration_preview 的 id；留空迁移全部可用项' },
      },
      additionalProperties: false,
    },
    output: resultOutput,
    async execute(args) {
      return api.migrateLegacy(args?.candidateIds ?? []);
    },
  });

  reg({
    name: 'mcp_connector_set_enabled',
    description: '启用或停用一条 MCP 连接（停用后工具下线，但连接记录保留，可重新启用）。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '连接 key（来自 mcp_connector_status）' },
        enabled: { type: 'boolean', description: 'true 启用 / false 停用' },
      },
      required: ['key', 'enabled'],
      additionalProperties: false,
    },
    output: resultOutput,
    async execute(args) {
      return api.setEnabled(args.key, args.enabled);
    },
  });

  reg({
    name: 'mcp_connector_disconnect',
    description: '断开并移除一条 MCP 连接；OAuth 连接会按引用计数撤销 refresh_token（无其他连接引用该授权时）。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '连接 key（来自 mcp_connector_status）' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    output: resultOutput,
    async execute(args, exec) {
      return api.disconnect(args.key, exec.signal);
    },
  });

  reg({
    name: 'mcp_connector_refresh_catalog',
    description: '强制重新拉取远程连接器目录（本地缓存失效），用于运营上架/下架后刷新货架。',
    parameters: noArgs,
    output: resultOutput,
    async execute() {
      return api.refreshCatalog();
    },
  });

  reg({
    name: 'mcp_connector_publish',
    description:
      '本机上架/下架某个连接器（MVP 简单开关，写本地覆盖）。仅影响目录可见性，不影响已装连接。',
    parameters: {
      type: 'object',
      properties: {
        connectorId: { type: 'string', description: '连接器 id' },
        published: { type: 'boolean', description: 'true 上架 / false 下架' },
      },
      required: ['connectorId', 'published'],
      additionalProperties: false,
    },
    output: resultOutput,
    async execute(args) {
      return api.publish(args.connectorId, args.published);
    },
  });

  /** 工具清单输出：按 server 分组展示工具 */
  const toolsListOutput = {
    schema: RESULT_SCHEMA,
    render(args, value) {
      const lines = [value.message];
      const servers = value.detail?.servers ?? [];
      if (servers.length) {
        for (const s of servers) {
          if (!s.ok) {
            lines.push(`\n- ${s.serverKey}: ❌ ${s.error}`);
            continue;
          }
          lines.push(`\n- ${s.serverKey} (${s.serverName}): ${s.tools.length} 个工具`);
          for (const t of s.tools.slice(0, 10)) {
            const desc = t.description ? ` — ${t.description.slice(0, 60)}${t.description.length > 60 ? '…' : ''}` : '';
            lines.push(`  - ${t.name}${desc}`);
          }
          if (s.tools.length > 10) lines.push(`  - … 还有 ${s.tools.length - 10} 个`);
        }
      }
      return [{ type: 'text', text: lines.join('\n') }];
    },
  };

  reg({
    name: 'mcp_connector_tools_list',
    description:
      '从已连接的 MCP server 动态获取工具清单。返回每个 server 的工具名称、标题和描述。' +
      '用户说「查看工具列表」「有哪些工具」「工具清单」时使用。',
    parameters: {
      type: 'object',
      properties: {
        connectorId: { type: 'string', description: '连接器 id（来自 mcp_connector_catalog）' },
      },
      required: ['connectorId'],
      additionalProperties: false,
    },
    output: toolsListOutput,
    timeoutMs: 30_000,
    async execute(args) {
      return api.toolsList(args.connectorId);
    },
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}
