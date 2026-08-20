# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；首个公开版本从 `0.1.0` 开始。

## [Unreleased]

### Added

- 图形化“添加连接”：手动配置、`mcpServers` JSON、连接器描述 URL，并提供错误修复提示。
- 参数化 Prompt：发送前收集企业、人员或主题等变量，不再硬编码示例主体。
- Tier 1 registry 种子：JSON Schema、确定性构建、无凭据 MCP/OAuth 探针和每周健康巡检。
- 两个旧企查查 OAuth 插件的授权预览和幂等复制迁移；源插件与源凭据始终保留。
- 本地 UI mock 测试壳和 Desktop 发版回归清单。

### Changed

- 未连接卡片也可查看详情；registry 提供 `toolsSnapshot` 时可在授权前预览工具。
- 工具每批渲染 50 条、连接器每批 60 张，并保留搜索能力。
- 增加基础中英文、系统深浅主题、焦点样式、Escape 关闭和弹框焦点循环。
- URL 安装描述持久化，重启后仍在市场显示。

### Security

- 远程 JSON 响应限制 2 MiB，Web API 请求体限制 1 MiB。
- 在 Schema 丢弃未知字段前扫描 token、API Key、secret 等夹带凭据。
- OAuth 元数据和重定向终点执行 HTTPS/loopback 白名单；Web UI 增加 CSP、`nosniff`、`no-referrer`。

### Fixed

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

[0.1.0]: https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.1.0
