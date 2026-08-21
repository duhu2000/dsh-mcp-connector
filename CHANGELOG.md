# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；首个公开版本从 `0.1.0` 开始。

## [Unreleased]

### Added

- 新增 4 张由无真实凭据 UI harness 生成的核心界面截图，以及约 30 秒的演示 GIF；中英文 README 均可直接预览市场、详情 Prompt、工具发现和 JSON 导入体验。

### Changed

- 面向中国市场将 MCP 连接器运行界面固定为中文，移除顶部 `EN` 按钮、英文 UI 字典、语言偏好持久化和切换事件；英文 README 继续作为项目文档保留。

## [0.2.2] - 2026-08-21

### Added

- 新增英文版 README，便于国际用户了解安装、连接方式、市场目录和发布流程。

### Changed

- 产品名称和介绍统一为通用 MCP Connector Marketplace；企查查作为项目发起方、维护方和首批连接器提供方，不限定可接入厂商。
- 重构 npm 关键词，保留 DSH、Cordis、MCP、OAuth/PKCE 和企查查检索入口，并补充 `dsh-plugin`、`mcp-client`、`oauth2`、`enterprise-data`。
- 更新市场注册移交文档、测试数量和 awesome-dsh-plugin 注册描述，移除易过期的工具与 Prompt 数量。

## [0.2.1] - 2026-08-21

### Added

- 上线独立公共 `dsh-mcp-connector-registry`，新市场卡片合并后无需重发 npm 即可被客户端刷新获取。
- npm 发布流程切换为 GitHub Actions OIDC Trusted Publishing。

### Changed

- `catalogUrl` 默认指向公共 Registry，显式空字符串仍可关闭远程目录；拉取失败时保留缓存/内置目录回退。

## [0.2.0] - 2026-08-21

### Added

- 公共市场新增第 5 张“北大法宝·法律检索”第三方卡片，以一个 Bearer Token 批量配置官网公开的 9 个 MCP Server。
- 公共市场新增第 6 张“Wind·股票数据”第三方卡片，按万得 AIFin Market 官方配置接入股票数据 MCP Server。
- 图形化“添加连接”：手动配置、`mcpServers` JSON、连接器描述 URL，并提供错误修复提示。
- JSON 导入提供多行缩进示例、粘贴/手动格式化，并明确区分本机连接与市场卡片。
- Bearer/API Key 市场连接器支持一次填写凭据后批量连接卡片下所有 Server。
- 参数化 Prompt：发送前收集企业、人员或主题等变量，不再硬编码示例主体。
- Tier 1 registry 种子：JSON Schema、确定性构建、无凭据 MCP/OAuth 探针和每周健康巡检。
- 两个旧企查查 OAuth 插件的授权预览和幂等复制迁移；源插件与源凭据始终保留。
- 本地 UI mock 测试壳和 Desktop 发版回归清单。
- 市场注册指南，覆盖 ConnectorDescriptor、公共 registry 与 OAuth 一键授权服务端要求。

### Changed

- 市场 Bearer/API Key 连接器改为先验证所有 MCP Server 的连通性与凭据，通过后才进入“已安装”。
- 精简“导入 JSON”页面，只保留格式、本机凭据说明与导入操作；市场同级卡片按目录声明顺序陈列。
- “添加连接”默认打开并优先展示“导入 JSON”，同时缩短编辑区并固定底部操作栏，常规桌面窗口首屏即可看到导入按钮。
- 内置精选 Prompt 直接展示可读示例值并一键带入新会话；仅缺少必填默认值时才打开参数补全弹框。
- 未连接卡片也可查看详情；registry 提供 `toolsSnapshot` 时可在授权前预览工具。
- 工具每批渲染 50 条、连接器每批 60 张，并保留搜索能力。
- 增加基础中英文、系统深浅主题、焦点样式、Escape 关闭和弹框焦点循环。
- URL 安装描述持久化，重启后仍在市场显示。

### Security

- 远程 JSON 响应限制 2 MiB，Web API 请求体限制 1 MiB。
- 在 Schema 丢弃未知字段前扫描 token、API Key、secret 等夹带凭据。
- OAuth 元数据和重定向终点执行 HTTPS/loopback 白名单；Web UI 增加 CSP、`nosniff`、`no-referrer`。

### Fixed

- 错误 Key、超时、DNS 或 TLS/网络失败不再被当作“已连接”，失败时保留弹框且不持久化凭据。
- 历史凭据失效且工具全部加载失败时，详情页提供“重新配置凭据”入口并暂停发送 Prompt。
- 未配置远程 registry 时，“刷新”不再暴露 `catalogUrl 为空`等内部实现提示。
- Bearer/API Key 市场卡片配置成功后，市场操作按钮正确切换为“已连接”。
- Bearer/API Key 连接器的详情页按钮直接打开凭据录入弹框，不再显示面向开发者的 `mcp_connector_configure` 错误。
- 工具详情加载时正确携带已保存的 Bearer Token/API Key，避免连接成功后仍返回 401。
- 北大法宝卡片改用用户确认的北大法宝印章 Logo，不再显示通用天平 Emoji。
- 参数补全弹框和发送状态提示现在始终位于连接器详情弹框之上。
- 正确解析 `WWW-Authenticate: Bearer resource_metadata="…"` 首个参数。
- 修复鉴权表单 `hidden` 被网格布局覆盖、无鉴权模式误显示 API Key 字段。

## [0.1.0] - 2026-08-20

### Added

- DeepSeek Harness Desktop 左侧“MCP连接器”入口，位于“新会话”下、“工作区/会话列表”上，并提供 footer 自动降级。
- 图形化连接器市场与已安装列表，内置 4 个企查查连接器和本地 QCC Logo。
- OAuth 2.0 PKCE、自定义 MCP 配置、`mcpServers` JSON 导入和描述 URL 安装四条接入路径。
- 连接持久化、重启恢复、启停、断开、OAuth Token 刷新与撤销。
- 连接器详情弹框、按 Server 分组的工具描述/搜索/滚动，以及精选 Prompt 换一批。
- 示例 Prompt 一键带入 DSH 新会话，包含同源校验、超时提示和重复点击保护。
- 内置目录、远程 registry、本地覆盖、上下架与精选能力。
- 11 个 `mcp_connector_*` 对话工具。
- Node.js 20/22/24 CI、Tag 发布工作流和 npm 发布包白名单/敏感内容校验。

### Security

- 凭证仅持久化在 DSH storage domain。
- 外部 URL 与导入 Header 执行安全校验。
- iframe 消息校验同源和消息来源。

[Unreleased]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.1.0
