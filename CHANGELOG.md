# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；首个公开版本从 `0.1.0` 开始。

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
