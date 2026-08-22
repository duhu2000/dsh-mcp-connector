# MCP连接器插件移交文档

> 更新：2026-08-22
> 源码：`/Users/qcc/Documents/DuHu/QCC/beichacha_doc/云聚接口/MCP/MCP/workspace/mcp-connector-plugin`
> Desktop 安装副本：`/Users/qcc/.dsh/profiles/web/node_modules/dsh-mcp-connector`

## 1. 产品目标

为 DeepSeek Harness Desktop 提供类似 WorkBuddy 的通用 MCP 连接器入口和市场。用户应在“新会话”下、“工作区/会话列表”上看到“🧩 MCP连接器”，完成浏览、授权、查看能力和快速发起对话。

插件不等同于企查查专用 OAuth 插件：企查查是首批内置目录，长期目标是支持任意符合描述规范的 MCP Server。

## 2. 当前实现

- 目录：内置、远程 registry、配置注入、URL 动态安装、本地上下架覆盖。
- 连接：OAuth 2.0 Authorization Code + PKCE、自定义 Bearer/API Key/无鉴权、`mcpServers` JSON 导入。
- 管理：storage domain 持久化、重启恢复、启停、断开、OAuth 刷新与撤销。
- UI：市场/已安装、全文搜索、服务商/接入方式组合筛选、前 4 个企查查连接器、第 5 个北大法宝、第 6 个 Wind 第三方连接器、本地品牌 Logo、详情弹框。
- 详情：精选 Prompt 在上，工具默认折叠；按 Server 分组，含描述、搜索和 300px 独立滚动区。
- Prompt：iframe 通过同源 `postMessage` 请求 Client，随后 `connectWorkspace → setDraft → sessions.open`。
- P1 UI：统一“添加连接”支持手动、格式化 JSON、市场卡片 URL；Bearer/API Key 市场卡片可一次配置多 Server，并在持久化前执行 initialize 连通/鉴权校验；内置 Prompt 默认值一键发送，缺必填值时才置顶打开参数表单；固定中文界面、深浅主题和键盘操作。
- Registry：已拆分独立公开仓库 `duhu2000/dsh-mcp-connector-registry`，Schema、确定性构建、密钥审计、CI 与定时健康巡检均已配置。插件默认从 Raw `catalog.json` 拉取，失败时回退缓存/内置目录。
- 迁移：可预览/复制两个旧企查查插件授权，幂等且保留源数据；未获确认不自动执行。
- 入口：插件仍在公开 `sidebar.footer.action` 注册；组件运行后用 React Portal 插入 `[data-slot="sidebar.workspaces"]` 前。若目标缺失或 `react-dom` 不可用，保留 footer 入口作为降级。

## 3. P0 状态

| 节点 | 状态 |
|---|---|
| 入口、弹框、详情、Logo、Prompt 发送 | 已完成开发 |
| 左上角目标位置自动测试 | 已通过 |
| 左上角目标位置 Desktop 实机验收 | 已通过（2026-08-20 用户确认） |
| Wind 市场卡片、Key 预检、工具枚举与原生 MCP Tool call | 已通过（2026-08-21 用户确认；1 Server / 10 Tools） |
| lint + 单元/集成测试 | 通过，69 项 |
| npm 发布包校验 | 已通过，43 个白名单文件；含敏感内容与本机路径扫描 |
| GitHub Actions CI/Release | 已配置并通过（CI #1、Release #1） |
| 本地 Git 仓库与首个基线提交 | 已完成 |
| GitHub 远端建仓、push、`v0.1.0`、Release | 已完成 |
| npm `dsh-mcp-connector@0.1.0` | 已公开发布并完成全新安装验证 |
| `v0.2.0` / npm `0.2.0` | 已公开发布并通过公共 registry 全新安装验证 |
| 独立远程 Registry | 已建仓、push 并通过 CI；插件默认 URL 已纳入 0.2.1 |
| `v0.2.1` / npm `0.2.1` | 已由 GitHub OIDC Trusted Publishing 自动发布，Provenance 与全新下载包验证通过 |
| `v0.2.2` / npm `0.2.2` | 已由 GitHub OIDC 发布；通用产品定位、中英文 README 与市场注册元数据已收口，Provenance 和下载包验证通过 |
| `v0.2.3` / npm `0.2.3` | 已由 GitHub OIDC 发布；运行界面固定中文并移除 `EN` 切换，58/58 测试与 43 文件发布门禁通过 |
| `v0.2.4` / npm `0.2.4` | 已由 GitHub OIDC 发布；新增主动连接健康检查与分级状态，59/59 测试和 43 文件发布门禁通过 |
| `v0.2.5` / npm `0.2.5` | 已由 GitHub OIDC 发布；OAuth 重复点击合并、重新授权旧 grant 回收与启动历史孤立 grant 清理已完成；62/62 测试和 43 文件发布门禁通过 |
| `v0.2.6` / npm `0.2.6` | 已由 GitHub OIDC 发布；扩充 MCP连接器、连接管理、插件/扩展、Qichacha/QCC 与企查查等真实搜索元数据；62/62 测试和 43 文件发布门禁通过 |
| npm Trusted Publishing | 已绑定 `duhu2000/dsh-mcp-connector` / `release.yml`，权限仅 `publish`，无长期 `NPM_TOKEN` |
| Desktop 本机版本对齐 | `web` profile 已升级为 npm 精确版本 `dsh-mcp-connector@0.2.6`；依赖树与安装副本均为 `0.2.6`；升级前后存储哈希不变，19 条 Server 连接和 4 组授权记录均保留 |
| 外部 DSH 市场注册 | [awesome-dsh-plugin PR #2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633) 已提交且 CI 通过；新增每小时自动验收，PR 合并后会继续检查上游 YAML 与 DSH 实际 `plugins.json`，直到目录可搜索 |
| 本地草案清理 | 两份未跟踪旧草案已移至 `workspace/_archive/mcp-connector-plugin/2026-08-21/`，源码仓库已恢复干净 |

## 4. P1 状态

| 节点 | 状态 |
|---|---|
| 通用市场能力 | 多厂商目录、三通道接入、凭据预检、参数 Prompt、独立 Registry 均已完成并进入 `main` |
| 市场截图 | 已通过无凭据 UI harness 采集 4 张核心页面，保存在 `docs/screenshots/` |
| 演示 GIF | 已生成 `docs/demo.gif`，约 29.6 秒、960×540、1.3 MiB，并加入中英文 README |
| 第三方自助上架闭环 | 独立 Registry 已增加贡献指南、Connector request、PR 模板、CODEOWNERS、文件名/ID 门禁与 2 项自动测试；校验器已对齐 `0.2.2` |
| 中文单语言 UI | 已按中国市场定位移除 `EN` 切换按钮、英文 UI 字典和语言偏好状态；英文 README 仅作为项目文档保留 |
| 连接健康状态 | `0.2.4` 已发布并通过 Desktop 实机回归；本机存在配置不再直接等同于当前可用，OAuth 401/403 引导重新授权，网络/TLS 失败显示连接异常 |
| 0.2.3 Desktop 回归 | 完全重启后入口位置、市场弹框、6 张卡片和中文单语言界面通过实机截图验收；企查查企业工商、北大法宝代表 Server 的 `tools/list` 分别返回 16、2 个工具 |
| 0.2.4 Desktop 回归 | 完全重启并刷新后，企查查企业工商和北大法宝显示“已连接”，3 张过期/异常卡片显示“需要重新授权”，Wind 未配置显示“配置”；中文界面、入口位置和配置存储均正常 |
| 0.2.5 Desktop 回归 | 完全重启后插件日志确认清理 6 条历史孤立 grant；健康检查中企查查企业工商 6/6、法律数据 2/2、招投标 1/1、文档报告 1/1、北大法宝 9/9 均正常，共 5 个连接器、19/19 Server 健康；Wind 保持未配置 |
| 0.2.6 Desktop 回归 | 已完全重启；左侧入口客户端模块、中文单语市场、6 张卡片、详情弹框和 19 条已安装连接正常；企查查企业工商 `tools/list` 为 6/6 Server、185 工具，北大法宝为 9/9 Server、10 工具；Wind 当前未配置 |
| 市场筛选体验 | 已完成下一轮开发与无凭据 UI 回归；服务商、OAuth/Key·Token/免密可组合筛选，与搜索叠加，含清除入口和无结果状态 |
| 旧插件凭据迁移执行 | 已获用户明确确认并在 Desktop 实机执行；检测到企业工商、法律数据各 1 组旧授权，但对应目标连接均已存在，幂等迁移安全跳过；待迁移数为 0，旧插件源文件与新插件存储哈希均未变化 |

## 5. Desktop 验收清单（已通过）

2026-08-20 已完成 Desktop 实机验证，后续版本继续按以下项目回归：

1. 展开侧栏：MCP连接器位于新会话下、工作区上，社区插件市场仍在底部。
2. 收起侧栏：显示单独的 🧩 圆形入口，不挤压其他入口。
3. 展开/收起、切换工作区、新建会话后入口不消失、不重复。
4. 点击入口可打开市场，二级详情蒙层和关闭按钮正常。
5. 点击示例 Prompt 可打开新会话并写入草稿。
6. 若人为模拟找不到 `sidebar.workspaces`，底部入口仍可点击。

## 6. 开发与同步

```bash
cd /Users/qcc/Documents/DuHu/QCC/beichacha_doc/云聚接口/MCP/MCP/workspace/mcp-connector-plugin
npm run check
```

发布验收环境使用 npm 精确版本；当前 Desktop `web` profile 已固定为 `dsh-mcp-connector@0.2.6`。后续开发若临时切换到本地 `file:` 依赖，完成后必须重新安装目标 npm 版本并完全重启 DSH Desktop，不要只改 `node_modules` 安装目录。

关键文件：

- `lib/client.js`：侧栏入口、Portal、市场 Overlay、Prompt 新会话桥接。
- `ui/index.html`：市场 SPA 与详情交互。
- `lib/index.js`：Host API、连接生命周期、目录与工具枚举。
- `catalog/catalog.json`：内置连接器和 Prompt。
- `test/client.test.mjs`：Client 入口与 Prompt 桥接回归。
- `.github/workflows/`、`scripts/verify-pack.mjs`：发布门禁。
- `CHANGELOG.md`：首发能力与后续版本变更记录。

## 7. 发布结果

1. GitHub：https://github.com/duhu2000/dsh-mcp-connector
2. CI：https://github.com/duhu2000/dsh-mcp-connector/actions/runs/32494600132
3. Release：https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.6
4. npm：https://www.npmjs.com/package/dsh-mcp-connector
5. npm `latest`：`0.2.6`；发布包共 43 个文件，GitHub OIDC Release 与 CI 均通过；本次为搜索发现与产品元数据版本，不改变运行逻辑、连接权限或依赖。
6. 独立市场 Registry：https://github.com/duhu2000/dsh-mcp-connector-registry
7. 远程 Catalog：https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog.json
8. 外部市场 PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633

发布工作流会校验 Tag 必须等于 `v` + `package.json.version`；0.2.1 起使用 npm Trusted Publishing，GitHub-hosted runner 通过 OIDC 发布 npm 并创建 GitHub Release，不再需要长期 `NPM_TOKEN`。当前 npm CLI 与 Release runner 固定为 11.19.0，以支持必填的 Trusted Publisher `allowed_actions`。

## 8. 已知限制与风险

- DSH rc.7 没有目标位置的公开插槽，顶部入口依赖稳定 `data-slot` + Portal；已提供 footer 降级，但 DSH 大版本升级后应复测。
- Raw GitHub 目录默认缓存约 5 分钟，合并新卡片后客户端刷新可能需等待 CDN 缓存更新。
- 随 npm 包的 `catalog/catalog.json` 仍作为离线/故障回退；独立 Registry 不应包含任何用户凭据。
- 真实 OAuth、DSH 重启和旧凭据迁移必须在 Desktop 实机由用户确认；自动测试不使用真实凭据。
- 旧插件迁移已执行完毕且保留源数据；企查查法律、招投标和文档均已分别完成 OAuth 重新授权，0.2.5 Desktop 回归为 19/19 Server 健康。
- stdio MCP 不在首版范围；支持 streamable-http 与 SSE。
