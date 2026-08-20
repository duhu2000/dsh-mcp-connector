# MCP连接器（DeepSeek Harness 插件）

在 DeepSeek Harness Desktop 中提供类似 WorkBuddy 的 MCP 连接器市场与连接管理：浏览连接器、OAuth 授权、查看工具、快速发起对话，并管理已安装连接。

[![CI](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-mcp-connector.svg)](https://www.npmjs.com/package/dsh-mcp-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 功能

- 左侧主导航入口：目标位置为“新会话”下方、“工作区/会话列表”上方；若 DSH DOM 结构不兼容，自动回退到底部公开插槽。
- 图形化市场：市场/已安装、搜索、连接状态与刷新。
- 连接器详情：精选 Prompt 优先展示，点击可带入 DSH 新会话；工具按 Server 分组，支持描述、搜索和独立滚动。
- 三种接入：OAuth 2.0 PKCE、自定义 URL/鉴权、导入 `mcpServers` JSON；也支持从连接器描述 URL 安装。
- 生命周期管理：连接持久化、重启恢复、启停、断开、OAuth 刷新与撤销。
- 目录运营：内置目录、远程 registry、本地覆盖，支持 `published` 上下架与 `featured` 精选。
- 对话工具：`mcp_connector_catalog`、`connect`、`configure`、`import_json`、`install_from_url`、`status`、`set_enabled`、`disconnect`、`refresh_catalog`、`publish`、`tools_list`。

首版内置 4 个企查查连接器，卡片统一使用包内企查查 Logo；插件架构本身不限定厂商。

## 安装

要求：DeepSeek Harness Desktop/web profile，Node.js 20 或更高版本。

```bash
dsh plugin --profile web add dsh-mcp-connector
```

也可使用安装脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/install.sh)
```

安装或升级后需完全退出并重启 DeepSeek Harness Desktop。

## 使用

1. 点击左侧“🧩 MCP连接器”。
2. 在市场中选择连接器并完成授权或配置。
3. 打开卡片详情，可点击示例 Prompt 的发送按钮，在当前工作区创建/复用空白会话并写入草稿。
4. 在“已安装”或对话工具中查看、停用、恢复或断开连接。

连接成功后，工具按 `mcp__<serverName>__*` 前缀提供给模型。

## 配置

Bundle 默认配置位于 `cordis.patch.yml`：

```yaml
- id: mcp-connector
  name: dsh-mcp-connector
  config:
    catalogUrl: ''
    persistSecrets: true
    entryPrefix: mcp
    refreshSkewMs: 300000
    openBrowser: true
```

## 开发与发布门禁

```bash
npm run check
```

该命令依次执行语法检查、29 项测试和 npm 发布包白名单校验。CI 使用 `--legacy-peer-deps` 安装显式测试依赖，DSH 运行期 peer 仍由 Host 提供。`v*` Tag 会触发 GitHub Actions；Tag 必须与 `package.json` 版本一致。仓库配置 `NPM_TOKEN` 后自动发布 npm，否则只创建 GitHub Release。

当前公开版本为 [`dsh-mcp-connector@0.1.0`](https://www.npmjs.com/package/dsh-mcp-connector)，对应 [GitHub Release v0.1.0](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.1.0)。

版本能力与变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 安全与限制

- 凭证只持久化在 DSH storage domain，不进入目录、Git 仓库或对话历史。
- 外部 URL 仅允许 HTTPS，HTTP 仅允许回环地址；导入配置会校验 URL 与 Header。
- 当前以 streamable-http 为主并兼容 SSE；stdio 配置会被明确跳过。
- 顶部入口通过 DSH 稳定 `data-slot` 定位并使用 React Portal；DSH 若移除该标记，入口会回退到底部，不影响连接器功能。

## License

MIT
