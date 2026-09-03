# MCP连接器：DeepSeek Harness MCP Server 连接与管理市场

> DeepSeek Harness 的 MCP连接器与 MCP Server 市场，收录超百个 MCP连接器并持续更新；统一发现、授权和连接管理，支持 OAuth 2.0 PKCE、API Key、stdio/HTTP、mcpServers JSON 导入，以及工具与 Prompt 发现；由企查查/QCC 团队维护

在 DeepSeek Harness Desktop/Web 中一站式管理不同厂商的 MCP 连接：支持 OAuth 2.0 PKCE、API Key、stdio/HTTP、`mcpServers` JSON 导入、工具与 Prompt 发现，并通过独立 Registry 持续更新精选连接器目录。

> 注：“技能扩展”指通过 MCP 工具和 Prompt 扩展智能体能力，本包不会伪装成独立 DSH Skill。

[English](README.en.md)

[用户手册](docs/USER-GUIDE.md) · [第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md) · [首次贡献](docs/FIRST-CONTRIBUTION.md) · [参与贡献](CONTRIBUTING.md) · [问题反馈](https://github.com/duhu2000/dsh-mcp-connector/issues)

[![CI](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-mcp-connector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-mcp-connector.svg)](https://www.npmjs.com/package/dsh-mcp-connector)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mcp-connector.svg)](https://www.npmjs.com/package/dsh-mcp-connector)
[![GitHub stars](https://img.shields.io/github/stars/duhu2000/dsh-mcp-connector?style=flat)](https://github.com/duhu2000/dsh-mcp-connector/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/duhu2000/dsh-mcp-connector?style=flat)](https://github.com/duhu2000/dsh-mcp-connector/forks)
[![GitHub Release](https://img.shields.io/github/v/release/duhu2000/dsh-mcp-connector)](https://github.com/duhu2000/dsh-mcp-connector/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Registry connectors](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fduhu2000%2Fdsh-mcp-connector-registry%2Fmain%2Fcatalog-stats.json&query=%24.registryCount&label=Registry%20connectors&color=5865f2)](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/catalog-stats.json)
[![Marketplace cards](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fduhu2000%2Fdsh-mcp-connector-registry%2Fmain%2Fcatalog-stats.json&query=%24.marketCount&label=Marketplace%20cards&color=16a34a)](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/catalog-stats.json)

## 30 秒开始

```bash
dsh plugin --profile web add dsh-mcp-connector
```

安装或升级后完全重启 DeepSeek Harness Desktop 或 `dsh web`，然后打开左侧「🧩 MCP连接器」。

![MCP 连接器 16 秒演示](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/demo.gif)

如果它帮你更快地接入 MCP Server，欢迎 [GitHub 点个 Star](https://github.com/duhu2000/dsh-mcp-connector/stargazers)、[提交新的连接器](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)或[参与贡献](CONTRIBUTING.md)。

## 为什么使用 MCP连接器

| 能力 | 普通 MCP 配置面板 | MCP连接器 |
|---|:---:|:---:|
| 手工配置 MCP Server | ✅ | ✅ |
| 持续更新的精选连接器目录 | 通常无 | ✅ |
| OAuth 2.0 PKCE 与 API Key | 部分 | ✅ |
| HTTP、stdio 与 `mcpServers` JSON 导入 | 部分 | ✅ |
| 工具与 Prompt 发现 | 视实现而定 | ✅ |
| 授权恢复与连接生命周期管理 | 通常无 | ✅ |
| 连接健康检查与 Registry 刷新 | 通常无 | ✅ |
| 可解释诊断与诚实的未知状态 | 通常无 | ✅ |
| 插件版本检测与安全更新 | 通常无 | ✅ |

## 功能

- 左侧主导航入口：目标位置为“新会话”下方、“工作区/会话列表”上方；若 DSH DOM 结构不兼容，自动回退到底部公开插槽。
- 图形化市场：默认“全部”按推荐与 9 类业务分类分章节展示，每章先展示 4 张并可展开；分类栏固定可见，单分类页展示全部卡片。
- 图形化添加：手动 HTTP/stdio、`mcpServers` JSON、连接器描述 URL 三种入口，失败时保留表单并给出修复建议。
- 连接器详情：精选 Prompt 优先展示，点击可带入 DSH 新会话；工具按 Server 分组，支持描述、搜索和独立滚动。
- Prompt 模板：使用 `{{company}}` 等变量，发送前填写真实查询主体。
- 三种接入：OAuth 2.0 PKCE、自定义 HTTP/stdio、导入 `mcpServers` JSON；也支持从连接器描述 URL 安装。OAuth 动态注册兼容公共客户端以及 `client_secret_post` / `client_secret_basic` 机密客户端。
- 市场 Bearer/API Key 连接器先执行 MCP initialize 连通性与凭据校验，全部 HTTP Server 通过后才持久化凭据并进入“已安装”；stdio 卡片可声明多个本机凭据字段及其环境变量映射。
- 生命周期管理：连接持久化、重启恢复、启停、断开、OAuth 自动刷新/退避恢复与撤销；同 issuer 卡片共享一次授权，跨进程锁与独立原子 Grant journal 防止 Desktop/Web 并行时重复消耗 Refresh Token。
- 配置备份：一键复制/下载可再次导入的脱敏 JSON；连接变更前自动保存最多 20 个本机快照，支持预览与原子恢复。凭据、本地路径和 OAuth Grant 不进入导出结果。
- 三层治理：Connection、Server、Tool 规则按 Tool > Server > Connection > 默认允许解析；变更先预览、按 revision 提交并可回滚，由 DSH Host 的 schema/lookup/dispatch restriction 与最终执行 Guard 真实生效。
- 可解释诊断：只报告实际观察结果；未检查或 Host 状态不可见时显示“状态未知”，并提供失败阶段、稳定错误码、建议动作、检查时间和进程内最近成功时间。
- 目录运营：内置目录、远程 registry、本地覆盖，支持 `published` 上下架与 `featured` 精选。
- 独立远程 Registry：新市场卡片合并后客户端刷新即可见，无需重新发布 npm；远程不可用时自动回退内置目录。
- 插件版本与一键更新：版本发现独立于安装来源；页面通过 Update Provider 适配层探测安全更新能力。DSH Market API v1 是首个适配器，支持进度、稳定失败码、回滚及按宿主能力提供的重启/刷新操作；无可用 Provider 时回退到当前插件市场或 npm。
- Registry 工具链：Schema/唯一性/密钥审计、MCP/OAuth 无凭据探针、每周健康巡检。
- 平滑迁移：显式扫描并复制两个旧企查查 OAuth 插件授权；检测到旧插件仍启用并管理同名 Server 时阻断重复连接，避免凭据相互覆盖。
- 对话工具：`mcp_connector_catalog`、`connect`、`configure`、`import_json`、`export_config`、`snapshot`、`install_from_url`、`status`、`health_check`、`policy`、`set_enabled`、`disconnect`、`refresh_catalog`、`publish`、`tools_list`。

<!-- catalog-stats:start -->
截至 2026-09-02，公共 Registry 已发布 101 条连接器描述；与随包的 4 张企查查卡片合并去重后，市场页可浏览 105 张卡片，覆盖企业数据、金融投资、法律合规、开发工具、办公协作、调研分析、设计创意、效率工具、其他 9 类。推荐位严格保留 4 张企查查卡片、北大法宝和 Wind，共 6 张；其他连接器按业务分类展示。Registry 可独立持续更新，实际数量以客户端刷新后的市场页签徽标和上方实时统计徽标为准。
<!-- catalog-stats:end -->

## 界面与演示

| 市场总览 | 连接器详情与精选 Prompt |
|---|---|
| ![市场总览](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/01-market-overview.jpg) | ![连接器详情](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/02-connector-detail.jpg) |
| 工具发现、描述与独立滚动 | JSON 导入 |
| ![工具发现](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/03-tool-discovery.jpg) | ![JSON 导入](https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/docs/screenshots/04-json-import.jpg) |

素材从复刻真实 800px 产品面板的无凭据 UI 验收环境采集，桌面端一行 2 张卡片；只展示公开市场元数据、示例 Prompt 和明确标识的 Mock 工具说明，不包含凭据、本机路径或查询结果。详见 [`docs/screenshots/README.md`](docs/screenshots/README.md)。

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

分类浏览、鉴权与连接状态、自定义 HTTP/stdio、JSON 导入、脱敏备份、可解释诊断、兼容矩阵、责任边界与故障排查见完整的[用户手册](docs/USER-GUIDE.md)。

## 中文教程与生态入口

- [用户手册：安装、授权、诊断、兼容性与故障排查](docs/USER-GUIDE.md)
- [配置备份：脱敏导出、快照与恢复边界](docs/CONFIG-BACKUP.md)
- [连接、Server 与 Tool 治理](docs/TOOL-GOVERNANCE.md)
- [工具试运行：官方 API 证据与安全设计](docs/TOOL-TRIAL-DESIGN.md)
- [插件更新：版本检测、Provider 与回滚](docs/PLUGIN-UPDATE.md)
- [市场注册：本地卡片、公共 Registry 与 OAuth 要求](docs/MARKET-REGISTRATION.md)
- [第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)
- [首次贡献：从 good first issue 到第一个 PR](docs/FIRST-CONTRIBUTION.md)
- [开发、Fork 与贡献指南](CONTRIBUTING.md)
- [增长基线与月度复盘模板](docs/GROWTH-BASELINE.md)

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

## 兼容性与责任边界

| 项目 | 当前边界 |
|---|---|
| 宿主与运行时 | DSH Desktop / `web` profile，Node.js 20+ |
| MCP 客户端 | 官方 `@deepseek-ai/dsh-mcp-client` `^0.1.1-rc.2` |
| 传输 | Streamable HTTP、stdio；旧 `sse` 归一为 Streamable HTTP |
| 配置作用域 | 当前 DSH profile；暂无 project/global 两级作用域 |
| 配置交换 | JSON 导入、脱敏导出、最多 20 个本机快照、预览与原子恢复 |
| 治理与执行 | Connection / Server / Tool allow/deny，预览、revision 提交与回滚；暂无工具试运行 |

插件负责目录、授权、连接记录、官方客户端条目、治理规则、只读健康检查、工具发现和诊断；DSH Host 与官方 MCP 客户端负责 transport、stdio 子进程、工具注册、正式工具执行及权限/审批链。治理通过 Host 官方 restriction/guard 生效，插件不会从浏览器旁路调用 MCP 工具。详细状态语义、限制与排障见[用户手册第 7–10 节](docs/USER-GUIDE.md#73-如何理解连接诊断)。

## 开发与发布门禁

```bash
npm run check
npm run marketing:check:live
npm run registry:build
npm run registry:validate
npm run market:check
npm run dev:ui
```

`marketing/metadata.json` 是 npm 描述/关键词、GitHub About/Topics、中英文首屏 CTA 和外部分发文案的事实源。`check` 会离线阻断仓库内漂移；`marketing:check:live` 进一步核对线上 GitHub 与 npm，供元数据调整和月度复盘时执行。`market:check` 检查外部 DSH 市场 PR 与线上目录；`dev:ui` 启动不含真实凭据的本地 mock 市场。CI 使用 `--legacy-peer-deps` 安装显式测试依赖，DSH 运行期 peer 仍由 Host 提供。`v*` Tag 会触发 GitHub Actions；Tag 必须与 `package.json` 版本一致。Release 通过 npm Trusted Publishing (GitHub OIDC) 发布，不依赖长期 `NPM_TOKEN`。

公共 Registry 每次合并后会生成 `catalog-stats.json`；本仓库的定时工作流每小时同步中英文介绍和统计快照。npm 页面中的静态正文随版本发布更新，上方动态统计徽标则直接读取 Registry，可在不发布新 npm 版本时保持实时数量一致。

当前公开版本为 [`dsh-mcp-connector@0.2.32`](https://www.npmjs.com/package/dsh-mcp-connector)，对应 [GitHub Release v0.2.32](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.32)。

版本能力与变更记录见 [CHANGELOG.md](CHANGELOG.md)。
Desktop 发版回归见 [docs/DESKTOP-E2E.md](docs/DESKTOP-E2E.md)。
市场卡片、公共 registry 与 OAuth 一键授权要求见 [docs/MARKET-REGISTRATION.md](docs/MARKET-REGISTRATION.md)。
stdio 传输的架构、透传边界与安全约束见 [docs/STDIO-SUPPORT.md](docs/STDIO-SUPPORT.md)。
第三方服务商提交市场卡片请阅读 Registry 的[第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)，无需修改插件代码或等待插件重新发布 npm。

## 安全与限制

- 凭证只持久化在本机 DSH storage 边界：连接记录使用 storage domain，OAuth 轮换凭据同步保存到 `$DSH_HOME/storages/mcp_connector_grants_v1`。该目录为 0700、文件为 0600；凭证不进入市场目录、Git 仓库、页面、日志或对话历史。
- 市场 Key/Token 校验失败时不写入 storage domain；鉴权、超时、DNS、TLS/网络错误会分类提示。
- 未检查或 Host 状态不可见时显示“状态未知”，不会冒充健康；健康摘要与最近成功时间当前只保留在插件进程内。
- 外部 URL 仅允许 HTTPS，HTTP 仅允许回环地址；导入配置会校验 URL 与 Header。
- 远程目录/描述响应限制 2 MiB，Web API 请求限制 1 MiB；原始 JSON 在归一化前扫描凭据字段。
- 完整覆盖 Streamable HTTP 与 stdio；旧 `sse` 配置在导入/恢复时归一为 Streamable HTTP。stdio 的 `command/args/env/cwd` 原样交给 `@deepseek-ai/dsh-mcp-client`，插件本身不重复实现进程传输。
- stdio 会启动本机进程：仅导入或连接可信命令/软件包。市场目录只能用 `credentialFields` + `credentialBindings` 声明输入与 env 映射，不得携带真实 token/secret；用户填写值只写入本机连接记录并交给 Host。
- OAuth DCR 的 `client_secret` 与 Access/Refresh Token 采用相同的本机存储边界，不会进入市场 API、状态输出或日志。
- 脱敏导出把 Token/API Key、静态 Header/env 值、stdio 参数、本地目录及带查询参数的 URL 替换为占位符；OAuth 只保留重新授权引用。快照中的完整配置仍只在当前 profile 的 storage domain 内。
- 顶部入口通过 DSH 稳定 `data-slot` 定位并使用 React Portal；DSH 若移除该标记，入口会回退到底部，不影响连接器功能。
- 旧授权迁移必须显式确认，只复制不删除；确认新连接可用后再手动停用旧插件。
- 当前没有 project/global 作用域切换或工具试运行；治理规则作用于当前 profile，并由 DSH Host 正式工具执行链强制应用。试运行已完成官方 API 复核，但在 out-of-turn 审批编排和 MCP 副作用元数据缺口补齐前保持 design blocked。快照不能恢复服务端已撤销的 OAuth Grant。

## License

MIT
