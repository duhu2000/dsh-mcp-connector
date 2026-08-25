# MCP连接器与连接管理市场（DeepSeek Harness 插件 / 扩展）

> 通用 MCP Connector / Connection Manager / Integration Marketplace，由企查查（Qichacha/QCC）团队发起并维护

在 DeepSeek Harness Desktop 中浏览和安装不同厂商的 MCP连接器，连接 MCP Server，通过 OAuth、API Key/URL 或 JSON 接入服务，发现工具与 Prompt，扩展 AI 技能，并管理已安装连接。

> 注：“技能扩展”指通过 MCP 工具和 Prompt 扩展智能体能力，本包不会伪装成独立 DSH Skill。

[English](README.en.md)

[用户手册](docs/USER-GUIDE.md) · [第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md) · [问题反馈](https://github.com/duhu2000/dsh-mcp-connector/issues)

[![CI](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-mcp-connector.svg)](https://www.npmjs.com/package/dsh-mcp-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 功能

- 左侧主导航入口：目标位置为“新会话”下方、“工作区/会话列表”上方；若 DSH DOM 结构不兼容，自动回退到底部公开插槽。
- 图形化市场：默认“全部”按推荐与 9 类业务分类分章节展示，每章先展示 4 张并可展开；分类栏固定可见，单分类页展示全部卡片。
- 图形化添加：手动 HTTP/stdio、`mcpServers` JSON、连接器描述 URL 三种入口，失败时保留表单并给出修复建议。
- 连接器详情：精选 Prompt 优先展示，点击可带入 DSH 新会话；工具按 Server 分组，支持描述、搜索和独立滚动。
- Prompt 模板：使用 `{{company}}` 等变量，发送前填写真实查询主体。
- 三种接入：OAuth 2.0 PKCE、自定义 HTTP/stdio、导入 `mcpServers` JSON；也支持从连接器描述 URL 安装。OAuth 动态注册兼容公共客户端以及 `client_secret_post` / `client_secret_basic` 机密客户端。
- 市场 Bearer/API Key 连接器先执行 MCP initialize 连通性与凭据校验，全部 HTTP Server 通过后才持久化凭据并进入“已安装”；stdio 卡片可声明多个本机凭据字段及其环境变量映射。
- 生命周期管理：连接持久化、重启恢复、启停、断开、OAuth 刷新与撤销；DCR 返回的客户端密钥与 Token 一同只保存在本机。
- 目录运营：内置目录、远程 registry、本地覆盖，支持 `published` 上下架与 `featured` 精选。
- 独立远程 Registry：新市场卡片合并后客户端刷新即可见，无需重新发布 npm；远程不可用时自动回退内置目录。
- Registry 工具链：Schema/唯一性/密钥审计、MCP/OAuth 无凭据探针、每周健康巡检。
- 平滑迁移：显式扫描并复制两个旧企查查 OAuth 插件授权；不删除原插件或原凭据。
- 对话工具：`mcp_connector_catalog`、`connect`、`configure`、`import_json`、`install_from_url`、`status`、`health_check`、`set_enabled`、`disconnect`、`refresh_catalog`、`publish`、`tools_list`。

截至 2026-08-24，公共 Registry 已发布 61 条连接器描述；与随包的 4 张企查查卡片合并去重后，市场页可浏览 65 张卡片，覆盖企业数据、金融投资、法律合规、开发工具、办公协作、调研分析、设计创意、效率工具和其他 9 类。推荐位严格保留 4 张企查查卡片、北大法宝和 Wind，共 6 张；其他连接器按业务分类展示。Registry 可独立持续更新，实际数量以客户端刷新后的市场页签徽标为准。

## 界面与演示

![MCP 连接器 16 秒演示](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/demo.gif)

| 市场总览 | 连接器详情与精选 Prompt |
|---|---|
| ![市场总览](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/01-market-overview.jpg) | ![连接器详情](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/02-connector-detail.jpg) |
| 工具发现、描述与独立滚动 | JSON 导入 |
| ![工具发现](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/03-tool-discovery.jpg) | ![JSON 导入](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/04-json-import.jpg) |

素材从本机 DSH `web` 验收环境采集，只展示公开市场元数据、示例 Prompt 和工具说明，不包含凭据、本机路径或查询结果。详见 [`docs/screenshots/README.md`](docs/screenshots/README.md)。

## 安装

要求：DeepSeek Harness Desktop/web profile，Node.js 20 或更高版本。

```bash
dsh plugin --profile web add dsh-mcp-connector
```

也可使用安装脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/install.sh)
```

重复执行安装命令即可升级。安装或升级后需完全退出并重启 DeepSeek Harness Desktop；使用 `dsh web` 时需先停止原进程再启动，`EADDRINUSE 127.0.0.1:3080` 表示已有实例正在运行。

## 使用

1. 点击左侧“🧩 MCP连接器”。
2. 在市场中选择连接器并完成授权或配置。
3. 打开卡片详情，可点击示例 Prompt 的发送按钮，在当前工作区创建/复用空白会话并写入草稿。
4. 在“已安装”或对话工具中查看、停用、恢复或断开连接。

连接成功后，工具按 `mcp__<serverName>__*` 前缀提供给模型。

分类浏览、四种鉴权状态、自定义 HTTP/stdio、JSON 导入、连接管理与故障排查见完整的[用户手册](docs/USER-GUIDE.md)。

## 配置

Bundle 默认配置位于 `cordis.patch.yml`：

```yaml
- id: mcp-connector
  name: dsh-mcp-connector
  config:
    catalogUrl: 'https://cdn.jsdelivr.net/gh/duhu2000/dsh-mcp-connector-registry@main/catalog.json'
    persistSecrets: true
    entryPrefix: mcp
    refreshSkewMs: 300000
    openBrowser: true
```

`catalogUrl` 默认通过 jsDelivr CDN 读取公共 [dsh-mcp-connector-registry](https://github.com/duhu2000/dsh-mcp-connector-registry)，支持 ETag/TTL 缓存；主源失败时自动尝试 GitHub raw 备用源，再回退到上次缓存或随包内置目录。jsDelivr 的分支 URL 可能存在缓存延迟，因此 Registry 合并后的新卡片不保证秒级出现。需要离线/私有模式时可将 `catalogUrl` 显式设为空字符串；显式配置其他目录 URL 时不会自动切换到公共备用源。

## 开发与发布门禁

```bash
npm run check
npm run registry:build
npm run registry:validate
npm run market:check
npm run dev:ui
```

`check` 执行语法检查、自动测试和 npm 发布包白名单校验；`market:check` 检查外部 DSH 市场 PR 与线上目录；`dev:ui` 启动不含真实凭据的本地 mock 市场。CI 使用 `--legacy-peer-deps` 安装显式测试依赖，DSH 运行期 peer 仍由 Host 提供。`v*` Tag 会触发 GitHub Actions；Tag 必须与 `package.json` 版本一致。Release 通过 npm Trusted Publishing (GitHub OIDC) 发布，不依赖长期 `NPM_TOKEN`。

当前公开版本为 [`dsh-mcp-connector@0.2.20`](https://www.npmjs.com/package/dsh-mcp-connector)，对应 [GitHub Release v0.2.20](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.20)。

版本能力与变更记录见 [CHANGELOG.md](CHANGELOG.md)。
Desktop 发版回归见 [docs/DESKTOP-E2E.md](docs/DESKTOP-E2E.md)。
市场卡片、公共 registry 与 OAuth 一键授权要求见 [docs/MARKET-REGISTRATION.md](docs/MARKET-REGISTRATION.md)。
stdio 传输的架构、透传边界与安全约束见 [docs/STDIO-SUPPORT.md](docs/STDIO-SUPPORT.md)。
第三方服务商提交市场卡片请阅读 Registry 的[第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)，无需修改插件代码或等待插件重新发布 npm。

## 安全与限制

- 凭证只持久化在 DSH storage domain，不进入目录、Git 仓库或对话历史。
- 市场 Key/Token 校验失败时不写入 storage domain；鉴权、超时、DNS、TLS/网络错误会分类提示。
- 外部 URL 仅允许 HTTPS，HTTP 仅允许回环地址；导入配置会校验 URL 与 Header。
- 远程目录/描述响应限制 2 MiB，Web API 请求限制 1 MiB；原始 JSON 在归一化前扫描凭据字段。
- 完整覆盖 Streamable HTTP 与 stdio；旧 `sse` 配置在导入/恢复时归一为 Streamable HTTP。stdio 的 `command/args/env/cwd` 原样交给 `@deepseek-ai/dsh-mcp-client`，插件本身不重复实现进程传输。
- stdio 会启动本机进程：仅导入或连接可信命令/软件包。市场目录只能用 `credentialFields` + `credentialBindings` 声明输入与 env 映射，不得携带真实 token/secret；用户填写值只写入本机连接记录并交给 Host。
- OAuth DCR 的 `client_secret` 与 Access/Refresh Token 采用相同的本机存储边界，不会进入市场 API、状态输出或日志。
- 顶部入口通过 DSH 稳定 `data-slot` 定位并使用 React Portal；DSH 若移除该标记，入口会回退到底部，不影响连接器功能。
- 旧授权迁移必须显式确认，只复制不删除；确认新连接可用后再手动停用旧插件。

## License

MIT
