/**
 * 英文词典分片：shared（跨模块共用的工具与底层文案）。
 *
 * 覆盖 `lib/util.js`、`lib/prompts.js`、`lib/tool-catalog-cache.js`、
 * `lib/probe.js`、`lib/migration.js`、`lib/version-status.js`、
 * `lib/connection-backup.js`、`lib/local-overrides.js` 等没有专属分片的模块。
 *
 * msgid 为中文原文；缺译文时回退中文原文，不会显示空白。
 */
export default {
  '连接显示名不能为空': 'Connection display name cannot be empty',
  '连接显示名不能包含控制字符': 'Connection display name cannot contain control characters',
  '连接显示名不能超过 80 个字符': 'Connection display name cannot exceed 80 characters',

  /* cli-providers.js —— 面向模型的工具与参数描述 */
  '钉钉工作台 CLI': 'DingTalk Workspace CLI',
  '读取当前钉钉 OAuth 身份的用户、组织和部门信息。': 'Read the user, organization, and department information of the current DingTalk OAuth identity.',
  '按关键词只读搜索钉钉企业通讯录。多人同名时应展示候选，不得自动选择。': 'Search the DingTalk enterprise directory by keyword, read-only. When several people share a name, present the candidates; never select one automatically.',
  '按一个或多个 userId 批量读取钉钉用户资料。': 'Read DingTalk user profiles for one or more userIds in bulk.',
  '只读列出当前用户在指定时间范围内的钉钉日程；不传时间时由 dws 使用默认范围。': "List the current user's DingTalk calendar events in the given time range, read-only; when no time is given, dws uses its default range.",
  '按日程 ID 只读获取钉钉日程详情。': 'Get DingTalk calendar event details by event ID, read-only.',
  '只读列出当前用户的钉钉待办。': "List the current user's DingTalk to-dos, read-only.",
  '按待办 ID 只读获取钉钉待办详情。': 'Get DingTalk to-do details by to-do ID, read-only.',
  '只读搜索当前用户有权访问的钉钉文件和文档。': 'Search the DingTalk files and documents the current user can access, read-only.',
  '只读列出指定时间范围内当前用户待处理的钉钉 OA 审批实例；不会执行同意或拒绝。': 'List the DingTalk OA approval instances awaiting the current user in the given time range, read-only; it never approves or rejects.',
  '只读列出指定时间范围内当前用户收到的钉钉日志。': 'List the DingTalk reports the current user received in the given time range, read-only.',
  '只读列出当前用户可用的钉钉日志模板。': 'List the DingTalk report templates available to the current user, read-only.',
  '可选的钉钉账号 profile（建议使用 corpId:userId）。不填写时使用 dws 当前 profile。': 'Optional DingTalk account profile (corpId:userId is recommended). When omitted, the current dws profile is used.',
  '姓名、职位或通讯录关键词。': 'A name, job title, or directory keyword.',
  '钉钉 userId 列表。': 'List of DingTalk userIds.',
  'ISO 8601 开始时间。': 'ISO 8601 start time.',
  'ISO 8601 结束时间。': 'ISO 8601 end time.',
  '日程 ID。': 'Event ID.',
  '页码。': 'Page number.',
  '每页数量。': 'Page size.',
  'true 仅已完成，false 仅未完成；不传则不过滤。': 'true for completed only, false for incomplete only; omit to apply no filter.',
  '待办任务 ID。': 'To-do task ID.',
  '文件或文档标题、内容关键词。': 'File or document title or content keyword.',
  '分页游标。': 'Pagination cursor.',
  '返回数量。': 'Number of results to return.',

  /* cli-providers.js —— CLI 运行时错误（保留 [CLI_*] 代码前缀，只译正文） */
  '请指定原生 exe，而非 shell 启动脚本': 'Specify a native exe rather than a shell launcher script',
  '已发现 dws npm 启动脚本，但未找到有效的官方原生程序；请检查 CLI 安装，或通过 DSH_MCP_DINGTALK_DWS_BIN 指定 dws.exe': 'A dws npm launcher script was found, but no valid official native program; check the CLI installation or point DSH_MCP_DINGTALK_DWS_BIN at dws.exe',
  'DSH 进程 PATH 中未找到 dws 原生程序或官方 npm 包；请检查安装与 DSH 环境后重启，不代表 OAuth 未登录': 'No native dws program or official npm package was found in the DSH process PATH; check the installation and the DSH environment, then restart. This does not mean OAuth is signed out',
  '未找到官方 CLI 命令“{command}”；请先完成安装和 OAuth 登录，再重启 DSH': 'Official CLI command “{command}” was not found; finish the installation and the OAuth sign-in, then restart DSH',
  '无法验证钉钉 OAuth 状态：官方 CLI 未返回有效 JSON；请检查 CLI 版本后重试': 'Cannot verify the DingTalk OAuth status: the official CLI returned no valid JSON; check the CLI version and retry',
  '钉钉待授权：官方 CLI 当前未登录。具备企业授权条件后，在运行 DSH 的同一系统用户终端执行 npx -y dingtalk-workspace-cli@1.0.61 auth login。若已确认企业未开放 CLI，请等待管理员处理，无需反复登录、重启或填写 API Key；仅凭未登录状态不能判断管理员是否限制': 'DingTalk authorization pending: the official CLI is not signed in. Once the organization can authorize it, run npx -y dingtalk-workspace-cli@1.0.61 auth login in a terminal of the same system user that runs DSH. If the organization has confirmed the CLI is not enabled, wait for an administrator; there is no need to sign in repeatedly, restart, or enter an API Key. A signed-out state alone does not prove an administrator restriction',
  '无法确认钉钉授权状态：官方 CLI 返回失败或不完整的状态响应；请核对 CLI 诊断。不能据此判断为未登录或管理员限制': 'Cannot confirm the DingTalk authorization status: the official CLI returned a failed or incomplete status response; check the CLI diagnostics. This alone does not prove a missing sign-in or an administrator restriction',
  '身份认证或授权失败；请运行 dws auth login，并确认企业管理员已开启 CLI 访问': 'Authentication or authorization failed; run dws auth login and confirm the organization administrator has enabled CLI access',
  '参数未通过当前固定 dws 版本校验；请核对工具参数或升级 MCP 连接器目录': 'The arguments failed validation in the currently pinned dws version; check the tool arguments or upgrade the MCP connector catalog',
  '钉钉要求补充权限授权；请按官方授权提示完成后重试': 'DingTalk requires additional permission authorization; follow the official prompt to complete it, then retry',
  'dws 命令或服务发现失败；请检查网络、登录状态与 MCP 连接器目录版本': 'The dws command or service discovery failed; check the network, the sign-in status, and the MCP connector catalog version',
  'CLI Provider 未就绪：{error}': 'CLI Provider is not ready: {error}',

  /* session-injection.js */
  '不支持的工具注入模式: {value}': 'Unsupported tool injection mode: {value}',
  'ttlMinutes 必须介于 1 与 {max} 之间': 'ttlMinutes must be between 1 and {max}',
  'MCP 工具 {name} 所属连接已停用': 'The connection that owns MCP tool {name} is disabled',
  'MCP 工具 {name} 需要当前会话显式激活': 'MCP tool {name} requires explicit activation in the current session',
  'MCP 工具 {name} 不属于当前工作区': 'MCP tool {name} does not belong to the current workspace',
  'MCP 工具 {name} 已被治理策略拒绝': 'MCP tool {name} was denied by a governance policy',
  'MCP 工具 {name} 未在当前会话激活或已过期': 'MCP tool {name} is not activated in the current session or has expired',
  '当前 DSH Host 不同时支持 tools.guard 与 Agent tools.restrict，不能安全使用按会话注入': 'This DSH Host does not support both tools.guard and Agent tools.restrict, so per-session injection cannot be used safely',
  '缺少 Agent 会话上下文': 'Missing Agent session context',
  'connectionKey 必填': 'connectionKey is required',
  '连接 "{name}" 已停用': 'Connection "{name}" is disabled',
  '连接 "{name}" 未设为“按会话启用”': 'Connection "{name}" is not set to “enable per session”',
  '连接 "{name}" 不属于当前工作区': 'Connection "{name}" does not belong to the current workspace',
  '必须指定至少一个精确 public tool name': 'At least one exact public tool name must be specified',
  'Host 尚未观察到工具 "{name}"': 'The Host has not observed the tool "{name}" yet',
  '工具 "{tool}" 不属于连接 "{name}"': 'Tool "{tool}" does not belong to connection "{name}"',
  '工具 "{tool}" 已被治理策略拒绝': 'Tool "{tool}" was denied by a governance policy',
  '激活必须来自用户明确确认': 'Activation must come from an explicit user confirmation',
  '会话工具状态已变化（当前 revision={revision}），请重新预览': 'The session tool state changed (current revision={revision}); preview again',
  '会话工具状态已变化（当前 revision={revision}），请重新读取': 'The session tool state changed (current revision={revision}); read it again',

  /* probe.js */
  'registry connectors 必须是数组': 'registry connectors must be an array',
  '重复 connector id: {id}': 'Duplicate connector id: {id}',
  '重复 serverName: {name}': 'Duplicate serverName: {name}',
  'stdio 目录探针不会执行本地命令；安装后由 dsh-mcp-client 启动并注册工具': 'The stdio catalog probe never runs local commands; after installation dsh-mcp-client starts it and registers its tools',

  /* migration.js */
  '{plugin}:{key} 记录格式不兼容': 'Incompatible record format at {plugin}:{key}',
  '{plugin} 读取失败：{error}': 'Failed to read {plugin}: {error}',

  /* version-status.js */
  '返回了无效版本': 'returned an invalid version',

  /* connection-backup.js */
  '将 <REDACTED:REENTER> 与 <REDACTED:LOCAL_VALUE> 替换为本机真实值后再导入；OAuth 项请从市场重新授权。': 'Replace <REDACTED:REENTER> and <REDACTED:LOCAL_VALUE> with the real local values before importing; reauthorize OAuth entries from the marketplace.',
};
