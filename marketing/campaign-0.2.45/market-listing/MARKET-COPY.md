# 0.2.45 市场文案与关键词

## 使用原则

- 产品名统一写作 `MCP连接器`；若市场有独立关键词字段，再补 `MCP 连接器` 作为空格变体。
- awesome-dsh-plugin 没有公开的描述字符上限，但要求单行、以句号结尾、只写可由代码核验的事实，不使用最高级或营销词。
- 其详情页 HTML meta description 会在约 155 字符处截断，因此核心定位和工具查找能力放在前部。
- “超百个”沿用已由 #4146 审核通过、且由 0.2.45 数据证据复核的保守口径；不在市场短文案中写易变的 106/110 精确数。
- 文案增加关键词只能改变“是否命中”；默认排序由下载量和 Stars 决定，不能承诺提升。

## A. awesome-dsh-plugin 完整描述（推荐）

英文，437 字符：

> MCP Connector for DeepSeek Harness with a directory of over one hundred connectors. Connect to MCP servers, search tools across connections, manage and troubleshoot connections, filter by connection/server/status, inspect readable parameters and the last successful cache time, and use per-connection diagnostics and tool rediscovery; supports OAuth 2.0 PKCE, API keys, stdio/HTTP, and mcpServers JSON import. Maintained by Qichacha/QCC.

中文，194 字符：

> MCP连接器：在 DeepSeek Harness 中通过持续更新的超百个连接器目录接入 MCP Server、跨连接查找工具，并完成连接管理与连接排障；可按连接/服务/发现状态筛选，查看易读参数、最后成功缓存时间和诊断，并逐连接重新发现工具；支持 OAuth 2.0 PKCE、API Key、stdio/HTTP 和 mcpServers JSON 导入；由企查查/QCC 团队维护。

这组文案覆盖五个验收查询，并把 0.2.45 的核心新增能力放在认证协议之前。它没有声称执行目标工具、离线可调用、全部免费或默认排名提升。

## B. 通用短描述（带目录规模）

适用于短描述字段或活动卡片；使用前确认该市场允许 `100+ / 超百个` 的事实表述。

英文，117 字符：

> 100+ MCP connectors, one place to connect MCP servers, search tools across connections, and troubleshoot connections.

中文，45 字符：

> 超百个 MCP连接器，一个入口完成 MCP Server 接入、跨连接工具查找与连接排障。

## C. 通用耐久短描述（不含数量）

适用于没有可审计数量来源、或同步周期不明的市场。

英文，132 字符：

> MCP Connector for DeepSeek Harness: connect to MCP servers, search tools across connections, and manage or troubleshoot connections.

中文，62 字符：

> MCP连接器：在 DeepSeek Harness 中接入 MCP Server、跨连接查找工具，并完成连接管理与连接排障。

## 关键词建议

按自然检索意图排序，不建议在正文中机械重复：

1. `MCP连接器`
2. `MCP Connector`
3. `MCP Server`
4. `连接器`
5. `连接管理`
6. `工具查找`
7. `连接排障`
8. `tool search`
9. `tool discovery`
10. `重新发现工具` / `tool rediscovery`
11. `OAuth 2.0 PKCE`
12. `API Key`
13. `stdio`
14. `HTTP`
15. `mcpServers JSON`

awesome-dsh-plugin 没有独立关键词字段，实际搜索的是卡片可见文本；完整描述自然覆盖前五个验收词即可。若其他市场支持 tags/keywords，按上面顺序填入其允许数量，不添加产品不具备的词。

## 避免表达

- 不写“最佳、最全、领先、官方、唯一、一站式”等无法客观核验或容易被视为营销的词。
- 不写“修改文案后默认排名上升”；默认位取决于近 30 天 npm 下载量及并列时的 Stars。
- 不把 106 条 Registry、110 张去重卡片或 npm 下载量写成用户数、客户数或安装人数。
- 不写“缓存后断网可用”或“故障时仍可调用”；只能写“可查看最后成功缓存时间”，缓存可查不代表当前可调用。
- 不写“全部免费”或“免授权”；不同连接器可能需要 OAuth、API Key、订阅、网络或本地运行环境。
- 不把本产品提交到只收 MCP Server 的目录并宣称其为 MCP Server；它是 DeepSeek Harness 插件、MCP 客户端/连接管理与连接器目录。

