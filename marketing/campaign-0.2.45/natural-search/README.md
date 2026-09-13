# MCP连接器 v0.2.45：自然搜索与转化文案包

状态：文案与指标基线已完成；新截图/视频为 `TODO`，公共文件尚未修改，未执行任何外部发布。

更新时间：2026-09-13（Asia/Shanghai）

## 1. 冻结事实与表达边界

- 产品版本：`dsh-mcp-connector@0.2.45`
- 合并提交：[`82d2406`](https://github.com/duhu2000/dsh-mcp-connector/commit/82d240601df73b8e704124100ec5771a0cd5514a)
- 产品 PR：[#73](https://github.com/duhu2000/dsh-mcp-connector/pull/73)
- Release：[`v0.2.45`](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.45)
- 截至 2026-09-11，公共 Registry 发布 106 条连接器描述；与随包卡片合并去重后，默认市场可浏览 110 张连接器卡片，覆盖 9 类，精选 6 张。动态页面数量以客户端刷新后的徽标为准。
- 工具页搜索当前范围内已启用连接的“最后成功安全缓存”，支持连接、服务、最近发现状态筛选和分页；搜索/筛选不请求目标 MCP，不执行目标工具。
- 参数详情显示类型、必填、枚举、常见约束与嵌套摘要，并保留“原始 Schema（安全缓存）”入口；这不是未经裁剪的服务端完整原文。
- “检查连接”和“重新发现工具”是单连接诊断动作，不是工具执行，也不承诺一键自动修复。
- 后台按到期与状态变化调度：健康连接五分钟后到期；普通失败从 30 秒指数退避、最长 15 分钟；429 结合 `Retry-After`，鉴权失败暂停自动重试。不能写成永久实时探针或“精确每五分钟刷新”。
- 缓存可查不代表服务当前可调用；目录缓存/随包回退也不代表断网可调用工具。
- 连接器卡片数、npm 下载量、clone 数均不是用户数；第三方连接器并非全部免费或免授权。

固定功能证据与教程补丁分别见：

- [`../search-closure/FEATURE-EVIDENCE.md`](../search-closure/FEATURE-EVIDENCE.md)
- [`../search-closure/README-PATCH.md`](../search-closure/README-PATCH.md)
- [`../search-closure/SCREENSHOT-ACCEPTANCE.md`](../search-closure/SCREENSHOT-ACCEPTANCE.md)

其中 `README-PATCH.md` 只负责工具教程段；首屏 hero 与统一营销口径以本文为准。三张新素材仍为 `TODO`。

统一中文术语：`MCP连接器`、`MCP Server`、`工具查找`、`连接排障`、`重新发现工具`、`最后成功缓存时间`。市场独立关键词字段可补空格变体 `MCP 连接器`。

## 2. 单一文案源

### 2.1 核心定位

**中文版（活动/首屏）**

> 超百个 MCP连接器，一个入口完成 MCP Server 接入、跨连接工具查找与连接排障。

**英文版（活动/首屏）**

> 100+ MCP connectors, one place to connect MCP servers, search tools across connections, and troubleshoot connections.

**耐久版（不依赖具体数量）**

> MCP连接器：在 DeepSeek Harness 中接入 MCP Server、跨连接查找工具，并完成连接管理与连接排障。

> MCP Connector for DeepSeek Harness: connect to MCP servers, search tools across connections, and manage or troubleshoot connections.

### 2.2 短简介

**中文**

DeepSeek Harness 的 MCP连接器：通过持续更新的连接器目录，在一个入口完成 MCP Server 接入、工具查找与连接排障；支持 OAuth 2.0 PKCE、API Key、Streamable HTTP/stdio 和 `mcpServers` JSON 导入。

**English（建议同时作为 npm description 与 GitHub About，241 个 ASCII 字符）**

DeepSeek Harness MCP Connector: connect servers, find tools across active connections, and troubleshoot discovery. Includes a continuously updated catalog; supports OAuth 2.0 PKCE, API keys, Streamable HTTP/stdio, and mcpServers JSON import.

说明：当前英文 npm description 为 305 个字符，npm 线上读取结果截断在约 255 字符处；上述 241 字符版本可完整显示，并将用户收益放在协议名之前。

### 2.3 长简介

**中文**

MCP连接器帮助 DeepSeek Harness 用户从持续更新的连接器目录接入 MCP Server，并在同一界面查找当前范围内已启用连接的工具、查看参数和来源、定位连接或发现失败。它支持 OAuth 2.0 PKCE、API Key、Streamable HTTP/stdio、`mcpServers` JSON 导入，以及连接检查和单连接工具重新发现。

工具搜索读取最后成功的安全缓存，不执行目标工具；缓存可见不等于服务当前可调用。第三方服务的授权、订阅、运行时、额度和数据许可，以各提供方规则为准。

**English**

MCP Connector helps DeepSeek Harness users connect MCP servers from a continuously updated catalog, then find tools across enabled connections, inspect readable parameters and source metadata, and troubleshoot connection or discovery failures from the same interface. It supports OAuth 2.0 PKCE, API keys, Streamable HTTP/stdio, `mcpServers` JSON import, connection checks, and scoped tool rediscovery.

Tool search reads the last successful sanitized cache and never executes a target tool. A visible cache does not guarantee that the remote service is currently callable. Provider authentication, subscriptions, runtimes, quotas, and data licenses remain provider-specific.

## 3. README 首屏与安装引导补丁建议

以下为供归口会话复制的草稿，不直接修改公共 README。

### 3.1 中文首屏

````markdown
# MCP连接器：在 DeepSeek Harness 接入、查找和排障 MCP Server

> 超百个 MCP连接器，一个入口完成 MCP Server 接入、跨连接工具查找与连接排障。

从持续更新的连接器目录接入 MCP Server；跨当前范围内已启用连接查找工具，查看易读参数、来源和最后成功缓存时间，并在发现异常时检查连接或重新发现工具。支持 OAuth 2.0 PKCE、API Key、Streamable HTTP/stdio 与 `mcpServers` JSON 导入。

工具查找读取最后成功的安全缓存，不执行目标工具；缓存可查不代表服务当前可调用。

## 30 秒开始

```bash
dsh plugin --profile web add dsh-mcp-connector
```

安装或升级后完全退出并重启 DeepSeek Harness Desktop；使用 `dsh web` 时先停止原进程再启动。然后点击左侧“🧩 MCP连接器”，或进入“设置 → 插件 → 插件配置 → MCP连接器”，点击“打开 MCP连接器”。

1. 在“市场”选择连接器并完成授权或配置。
2. 在“工具”跨连接搜索，并按连接、服务或最近发现状态筛选。
3. 查看参数与来源；异常时展开诊断，按提示检查连接或重新发现工具。

[用户手册](docs/USER-GUIDE.md) · [提交连接器](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md) · [问题反馈](https://github.com/duhu2000/dsh-mcp-connector/issues)
````

### 3.2 English hero

````markdown
# Connect, Find, and Troubleshoot MCP Servers in DeepSeek Harness

> 100+ MCP connectors, one place to connect MCP servers, search tools across connections, and troubleshoot connections.

Connect MCP servers from a continuously updated catalog. Search tools across enabled connections in the current scope, inspect readable parameters, source metadata, and the last successful cache time, then check a connection or rediscover its tools when discovery fails. Supports OAuth 2.0 PKCE, API keys, Streamable HTTP/stdio, and `mcpServers` JSON import.

Tool search reads the last successful sanitized cache and never executes a target tool. A visible cache does not guarantee that the service is currently callable.

## Start in 30 seconds

```bash
dsh plugin --profile web add dsh-mcp-connector
```

Fully quit and restart DeepSeek Harness Desktop after installation or upgrade. For `dsh web`, stop the existing process before starting it again. Open **MCP Connector** from the primary sidebar, or choose **Settings → Plugins → Plugin Configuration → MCP Connector → Open MCP Connector**.

1. Select a connector in **Marketplace** and finish authorization or configuration.
2. Use **Tools** to search across connections and filter by connection, service, or recent discovery state.
3. Inspect parameters and source metadata; when discovery fails, open diagnostics and check the connection or rediscover its tools.
````

## 4. 社区内容

### 4.1 中文短帖

DeepSeek Harness 里的 MCP 工具多起来后，最费时间的往往是：工具在哪、参数怎么填、连接为什么没刷新。

`dsh-mcp-connector v0.2.45` 新增统一“工具”页：跨当前范围内已启用连接搜索，按连接/服务/最近发现状态筛选，查看易读参数、来源和最后成功缓存时间，并可对单连接执行检查或重新发现。

```bash
dsh plugin --profile web add dsh-mcp-connector
```

工具查找只读安全缓存，不执行目标工具；缓存可见不代表服务当前可调用。

Release：https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.45

### 4.2 English short post

As MCP tools multiply in DeepSeek Harness, three questions become expensive: Where is the tool? What parameters does it need? Why did discovery stop updating?

`dsh-mcp-connector v0.2.45` adds one Tools view to search across enabled connections in the current scope, filter by connection/service/discovery state, inspect readable parameters and source metadata, and run a scoped connection check or rediscovery.

```bash
dsh plugin --profile web add dsh-mcp-connector
```

Search reads a sanitized last-success cache and never executes target tools. Cached visibility is not proof of current callability.

### 4.3 更新文章提纲

推荐标题：**接上 MCP Server 之后，怎么快速找到工具并判断连接出了什么问题？**

1. 痛点：连接数量增加后，工具分散、参数难读、缓存状态和实时可用性容易混淆。
2. 版本答案：0.2.45 的统一工具页，把搜索、筛选、参数、来源、缓存时间和排障入口放在同一流程。
3. 三个场景：
   - 已知道工具名：精确工具名优先，快速定位来源连接和服务。
   - 不清楚参数：查看类型/必填/枚举/嵌套摘要，必要时打开原始安全 Schema。
   - 最近发现失败：继续查看最后成功缓存和诊断，再检查连接或重新发现工具。
4. 诚实边界：只搜索当前范围内已启用连接的缓存；不执行工具；缓存不等于可调用；后台是有界调度和退避。
5. 安装与入口：安装命令、重启要求、侧边栏及设置页路径。
6. 参与方式：Star、提交连接器、提交可复现 Issue 或贡献修复。

英文文章可沿用标题：**After Connecting an MCP Server, How Do You Find Its Tools and Diagnose Discovery Failures?**，结构与上述六段一一对应。

## 5. 30–45 秒演示脚本

目标时长：43 秒。所有 Mock 场景需在画面中显著标注“演示数据 / Demo data”。真实授权时长不纳入演示承诺。

| 时间 | 画面 | 旁白/字幕 |
|---|---|---|
| 0–5 秒 | 从侧边栏打开 MCP连接器，快速扫过市场与“工具”页签 | “超百个 MCP连接器，一个入口完成 MCP Server 接入、跨连接工具查找与连接排障。” |
| 5–15 秒 | “工具”页展示至少两条连接/服务；输入自然、非敏感关键词，切换连接和服务筛选 | “跨当前范围内已启用连接查找工具，并按连接、服务和最近发现状态筛选。” |
| 15–24 秒 | 打开一个工具参数详情，依次展示类型、必填、枚举与一个嵌套结构；保留原始安全 Schema 入口 | “参数先给易读摘要；需要时仍可查看经过安全裁剪的原始 Schema。” |
| 24–35 秒 | 进入明确标注“演示数据”的受控超时状态；显示来源、最后成功缓存时间、诊断建议、“检查连接”“重新发现工具” | “发现异常时，缓存仍可用于定位；再按诊断检查连接或重新发现。缓存不代表当前一定可调用。” |
| 35–39 秒 | 模拟恢复为成功状态 | “恢复后状态会同步更新。” |
| 39–43 秒 | 安装命令、Release 与提交连接器入口 | “安装 v0.2.45，或提交你的连接器。” |

截图/录屏验收要求：

- 产品面板按真实 800px 宽度录制；桌面市场卡片一行 2 张，不得使用旧 3 列素材。
- 主图使用成功状态；故障图只能使用显著标注的受控模拟状态，不展示“需重新授权”作为主宣传状态。
- 不出现 Token、API Key、本机路径、真实用户查询、真实会话、付费账户或未公开结果。
- “统一找工具”图需同时出现至少两条连接/服务、来源与缓存时间，不能把单服务列表冒充跨连接搜索。
- “看懂参数”图需出现类型/必填/枚举/嵌套摘要和原始安全 Schema 入口。
- “状态与排障”图需保留故障标签、最后成功缓存、诊断建议和两个操作入口；不得通过后期美化篡改真实状态。
- `TODO`：制作并验收上述三张新图及最终 43 秒视频；当前只有规范，没有成品素材。

## 6. 推广前指标快照

采集时间：2026-09-12 21:44（Asia/Shanghai）。原始来源为 npm downloads API、GitHub Repository/Traffic API、GitHub Release 与公开搜索快照。

| 指标 | 2026-08-30 基线 | 2026-09-12 推广前快照 | 说明 |
|---|---:|---:|---|
| npm 下载，近 30 天 | 5,406 | 10,991 | 当前窗口 `2026-08-13`～`2026-09-11`；含 CI、重复安装与缓存未命中，不是用户数 |
| GitHub Stars | 8 | 20 | 累计快照，+12 |
| GitHub Forks | 2 | 3 | 累计快照，+1 |
| GitHub Watchers | 1 | 1 | 累计快照 |
| Open Issues | 1 | 3 | 当前为 #29、#53、#69；不作为负向转化率直接解释 |
| GitHub views，滚动 14 天 | 646 / 277 unique | 2,361 / 1,161 unique | 当前窗口 `2026-08-29`～`2026-09-11` |
| GitHub clones，滚动 14 天 | 1,174 / 247 unique | 1,294 / 240 unique | clone 与 unique cloner 均不等于安装用户 |
| Overview 热门路径 | 444 / 268 unique | 1,658 / 1,145 unique | GitHub popular paths API |
| 最新 npm / Release | `0.2.29` / `v0.2.29` | `0.2.45` / `v0.2.45` | 0.2.45 发布于 2026-09-12 |

当前主要 referrer（views / unique）：`github.com` 172/48、Google 64/32、Baidu 39/4、`awesome-dsh-plugin.com` 23/10、Bing 19/15、`npmjs.com` 10/5。

搜索诊断快照（Codex Web Search 索引；引擎/locale 不透明，因此只作方向性诊断，不替代正式无痕浏览器验收）：

| 查询 | 最佳项目相关结果 | 观察位置 |
|---|---|---:|
| `DeepSeek Harness MCP connector` | 前 10 条未观察到项目自有落地页 | >10 / 未观察到 |
| `dsh MCP connector marketplace` | dsh.pub 条目；GitHub 仓库随后出现 | 2；3 |
| `DeepSeek MCP 连接器` | npm 包页 | 4 |
| `model context protocol connector DeepSeek Harness` | 前 10 条未观察到项目自有落地页 | >10 / 未观察到 |

正式推广前仍需由归口会话在签出或全新浏览器中，以固定引擎和 locale 记录前两页；不得把上述方向性位置写成排名承诺。

## 7. D+7 / D+14 复盘方法

建议复盘日：D+7 为 2026-09-19，D+14 为 2026-09-26。此处只提供方法，不创建自动任务。

每次在同一时区记录：

1. npm downloads API 返回的 `downloads/start/end`；与 D0 比较仅作为安装意向代理，因为 30 天窗口高度重叠。
2. GitHub Stars、Forks、Watchers、Open Issues 的累计值与净增量。
3. GitHub 14 天 views/unique、clones/unique、Overview path 和 top referrers；保存原始 JSON，避免滚动窗口过期。
4. 固定四组自然搜索词；使用签出/全新浏览器，记录引擎、locale、日期、项目最佳结果、位置和落地页，至少查看前两页。
5. 首次贡献代理：首次 Issue/PR 数、首次 PR 合并数、`good first issue` 从认领到 PR 的时长。
6. 活动变更日志：实际改了哪些 README/元数据/截图/外部条目，何时上线；没有上线的草稿不能归因为增长原因。

判读规则：

- **可发现性改善**：项目自有页面在固定查询中新增命中/位置改善，或 Google/Bing/Baidu 的 unique referrer 同向增长。
- **社区意向改善**：同期 Stars/Forks/首次 Issue 或 PR 至少一个净增，并核对是否为真实社区行为。
- **安装意向改善**：npm 30 天下载代理上升，但只能与其他信号联合观察，不能换算为用户或真实转化率。
- **无结论**：仅下载量上升、滚动窗口错位、搜索索引尚未更新或没有明确上线时间时，不宣称文案带来转化。
- **下一轮选择**：D+7 优先修正未命中关键词/入口；D+14 再决定保留首屏、调整标题，或更换社区渠道。一次只改一个主假设，保留对照记录。

复盘表：

| 指标 | D0 | D+7 | D+14 | 数据窗口/时间 | 解释与限制 |
|---|---:|---:|---:|---|---|
| npm 下载（近 30 天） | 10,991 |  |  | 2026-08-13～09-11 | 非用户数 |
| Stars / Forks | 20 / 3 |  |  | 累计 | 记录净增 |
| views / unique | 2,361 / 1,161 |  |  | 滚动 14 天 | 保存 JSON |
| clones / unique | 1,294 / 240 |  |  | 滚动 14 天 | 非安装用户 |
| 自然搜索命中 | 见上表 |  |  | 固定引擎/locale | 不承诺默认排名 |
| 首次 Issue / PR / merged |  |  |  | 同期 | 人工去重 |

## 8. 公共文件补丁清单（交归口会话串行执行）

1. `marketing/metadata.json`
   - 将 `npm.description`、`github.description` 改为 2.2 的 241 字符英文短简介。
   - 将 `readme.heroZh/heroEn` 改为 2.1 活动版定位；`externalListing` 使用 2.3 长简介的单段精简版。
2. `package.json`
   - `description` 与 `marketing/metadata.json:npm.description` 完全一致。
3. `README.md` / `README.en.md`
   - 用第 3 节替换标题、hero、收益段与安装后入口；将详细协议能力放在收益之后。
   - 保留缓存与当前可调用性的显式边界。
4. `duhu2000__dsh-mcp-connector.yml`
   - 同步中英文外部 listing；保持单行、事实准确、无最高级表达。
5. `scripts/check-marketing-metadata.mjs`
   - 现有断言硬编码 `over one hundred...`、`discover/authorize/manage` 与“统一发现、授权和连接管理”；应改为从结构化定位词校验 `DeepSeek Harness`、连接/接入、工具查找和连接排障，避免新文案被旧口径门禁阻断。
   - 增加 npm description 字符数上限（建议 `<= 250`），防止线上再次截断。
6. GitHub About
   - 与 2.2 英文短简介一致；保留现有 20 个高意图 Topics。本轮不承诺排序变化。
7. 截图与视频
   - `TODO`：三张新图/43 秒视频通过第 5 节验收后，再由归口更新 `screenshots.json`、哈希和 README 引用。
8. 集成验证
   - 运行 `npm run check`、`npm run marketing:check:live`（外部字段实际更新后）及 storefront 门禁；本子任务未运行，因为公共文件未变更。

## 9. 交付与阻塞

- 已完成：事实冻结、中英文长短/耐久文案、README 首屏与安装引导、社区短帖、文章提纲、43 秒演示脚本、D0 指标快照、D+7/D+14 复盘方法、公共文件补丁清单。
- `TODO`：搜索闭环会话制作并验收三张新截图/视频；归口会话统一修改公共文件、运行检查、提交 PR，并在获得用户明确授权后处理 GitHub About、外部市场或新版本发布。
- 本目录没有修改产品代码、公共 README/元数据或任何外部状态。
