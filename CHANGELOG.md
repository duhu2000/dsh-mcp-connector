# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；首个公开版本从 `0.1.0` 开始。

## [Unreleased]

## [0.2.22] - 2026-08-26

### Fixed

- 首次连接改为等待 `dsh-mcp-client` 完成 MCP `initialize` 与首次 `tools/list`；启动失败或超时不再提前保存、增加已安装数量或显示“已连接”。
- stdio 健康状态与工具详情改用 Host 实际注册的 `mcp__<serverName>__*` 工具；未注册工具保持“已配置”并显示可重试诊断。
- 手动 HTTP、免鉴权市场连接与 JSON 导入统一在落库前执行连接校验；DNS、网络、鉴权或协议失败时保留原配置且不写入无效记录。
- 市场 Web 请求增加连接、健康检查与工具加载超时，避免详情页无限停留在“加载中”。

### Verification

- 新增无效 HTTP 不落库、stdio Host 启动失败回滚、Host 工具注册状态和前端有限超时回归测试。

## [0.2.21] - 2026-08-25

### Documentation

- 产品介绍同步为公共 Registry 78 条、去重后市场 82 张卡片；新增 Registry/市场实时数量徽标。
- 新增每小时 Registry 统计同步工作流，以 `catalog-stats.json` 为权威来源更新中英文 README 与本地快照，避免后续上架造成宣传数量过期。

### Verification

- 插件 100 项自动测试、lint、Registry 统计同步幂等性、npm 发布文件白名单/敏感内容扫描和 `git diff --check` 通过。

## [0.2.20] - 2026-08-25

### Changed

- 默认公共 Registry 改用 jsDelivr CDN，并在主源请求失败时按顺序回退到 GitHub Raw，提升不同网络环境下远程市场目录的可用性。
- DSH Bundle 补丁与插件默认配置统一使用 jsDelivr 主源；用户显式配置的自定义目录地址保持单一来源，不会被公共备用源覆盖。

### Fixed

- 主源与备用源分别处理缓存协商；备用源不会复用或写入主源 ETag，避免跨源缓存标识导致错误的 `304 Not Modified`。
- 目录主源失败时记录逐源告警，并在备用源成功后继续刷新市场，避免一次网络故障导致远程目录完全不可用。

### Verification

- 插件 98 项自动测试、lint、npm 发布文件白名单/敏感内容扫描和 `git diff --check` 通过。
- 新增主源失败回退、主源 `304` 不访问备用源、默认配置与 Bundle 配置一致，以及自定义目录不启用公共回退的回归测试。

## [0.2.19] - 2026-08-24

### Fixed

- 所有对话工具结果在交给 DSH Host 前统一转换为 lossless JSON，清理 `undefined`、非有限数字、`BigInt`、稀疏数组和循环引用，修复 Windows DSH Desktop 的 `value is not lossless JSON` 错误。
- UI 静态文件路由不再使用平台相关的 `path.normalize` 处理 URL，Windows 下保持正斜杠语义并继续拒绝路径穿越，修复市场 iframe 返回 404。

### Documentation

- 中英文 README 更新为公共 Registry 61 条、与 4 张随包卡片合并后 65 张市场卡片的当前规模；重新采集市场总览并重建 16 秒演示 GIF。

### Verification

- 插件 94 项自动测试、lint、npm 发布文件白名单/敏感内容扫描和 `git diff --check` 通过。
- 手动执行最新 Registry `main` 的 61 项健康巡检：60 项通过、1 项部分通过；44 个远程 MCP Server 全部可达并识别成功，28 个 stdio Server 按安全策略未执行本地命令。

## [0.2.18] - 2026-08-24

### Added

- 市场 stdio 连接器支持声明多个凭据输入字段，并将用户在本机填写的值安全绑定到指定环境变量；目录仍禁止携带真实凭据，Registry 探针仍不执行本地命令。
- OAuth 动态客户端注册支持 `client_secret_post` 与 `client_secret_basic`，客户端密钥随本机 Grant 用于授权码交换、刷新和撤销。

### Security

- stdio 凭据值不进入 catalog/status/log；字段映射会校验环境变量名、未知引用、重复声明和未使用的必填字段。
- OAuth DCR 客户端密钥不进入公开输出，并支持服务端提供的到期时间检查。

## [0.2.17] - 2026-08-24

### Documentation

- 新增面向下载用户的完整使用手册，覆盖安装/升级与重启、市场分类、鉴权状态、自定义 HTTP/stdio、JSON 导入、连接管理、安全边界和常见故障。
- 使用当前 14 张市场卡片与 6 张推荐位的实机界面重采 4 张公开截图，并重建 16 秒演示 GIF；同步链接 Registry 的第三方连接器上架指南。

## [0.2.16] - 2026-08-24

### Changed

- 市场分类栏移入固定 Header 第二行，不再悬浮覆盖滚动中的卡片；切换到“已安装”时自动隐藏并收回空间。
- 移除市场正文中的冗余连接器数量与操作提示，把市场/已安装总数改为页签内的轻量徽标。

### Verification

- 插件 88 项自动测试、lint 与 npm 发布文件白名单/敏感内容扫描通过。
- 使用 UI harness 验证桌面分类标签无横向溢出；滚动后 Header 与分类栏坐标保持不变，分类点击与已安装页签切换正常。

## [0.2.15] - 2026-08-24

### Fixed

- 未连接且目录没有工具快照的卡片详情不再误报“当前连接异常”；现在保持未连接状态，并提示连接后读取服务端工具清单。

### Verification

- 新增详情状态回归，插件自动测试增至 87 项；使用本机 DSH 对 Seedream 未配置详情进行实机验收。

## [0.2.14] - 2026-08-24

### Added

- 默认“全部”市场改为“推荐 + 9 类业务分类”的章节式浏览，每章默认展示 4 张卡片并支持就地“查看全部 / 收起”。
- 独立 Registry 新增由 Ace Data Cloud 托管的 Seedream 图片生成连接器，补齐“设计创意”分类；卡片明确第三方服务商、Bearer Token 与潜在计费边界。

### Changed

- 分类栏固定在市场滚动区域顶部；桌面端全部标签单行显示且不再出现横向滚动条，窄屏改为自动换行。
- 推荐位严格收敛为 4 张企查查卡片、北大法宝和 Wind，共 6 张；其他第三方连接器仍按业务分类展示。
- “企查查·法律数据”迁入“法律合规”，“企查查·文档报告”迁入“效率工具”并保持该分类首位。

### Verification

- 插件 86 项自动测试通过；Registry 10 项测试、10 条连接器构建和 schema/密钥审计通过。
- Seedream Hosted MCP 公网无凭据探针通过：端点可达并识别 MCP，正确返回 HTTP 401 鉴权挑战；未使用用户 Token，也未执行计费工具。

## [0.2.13] - 2026-08-24

### Added

- 当前市场已上架连接器全部进入推荐位；独立 Registry 新增 GitHub、Cloudflare、Notion、Tavily 四张经过官方配置与公开端点探针核验的推荐卡片。

### Changed

- 市场筛选精简为“全部 / 推荐 / 业务分类”，移除服务商下拉框和 OAuth、Key / Token、免密接入方式筛选，降低首屏信息密度。
- 独立 Registry 的北大法宝、Wind、八爪鱼、QVeris、盈米统一使用标准分类并进入推荐位。

### Verification

- 84 项插件自动测试、lint、内置目录校验与 45 个 npm 发布文件白名单/敏感内容扫描通过。
- Registry 9 项测试、9 条连接器构建、schema 校验与远程图标检查通过；GitHub、Cloudflare、Notion、Tavily 均完成 MCP 端点与鉴权元数据探针，未代替用户执行 OAuth 登录或授权后工具调用。

## [0.2.12] - 2026-08-23

### Added

- 新增 stdio 本地进程传输：支持手工配置与 `mcpServers` JSON 导入中的 `command`、`args`、`env`、`cwd`，由现有 `@deepseek-ai/dsh-mcp-client` 原生启动并注册工具。
- 市场 ConnectorDescriptor 与 Registry Schema 支持 stdio Server；公开目录探针只校验描述，绝不执行第三方目录中的本地命令。
- 市场新增“推荐”与 9 类业务分类筛选，可与搜索、服务商和接入方式组合使用；未知及历史分类在 UI 端安全归一化。

### Changed

- 历史 `sse` 与 `type: "http"` 配置统一归一为 `streamable-http`，最终向底层只透传 `stdio` 或 `streamable-http`。
- 状态、健康检查和详情页识别 stdio 托管连接；目录审计禁止 stdio `env` 携带 token、secret、API Key、password 等密钥类变量。
- 同一连接切换 HTTP/stdio 传输时会清除上一种传输的 URL、Header、命令与环境变量，避免旧配置或凭据残留。
- 随包目录统一使用“法律合规”“金融投资”等标准分类，并将北大法宝与 Wind 标记为推荐连接器。

### Security

- stdio 仅允许用户主动配置或安装维护者审核过的市场描述；界面明确提示本地命令执行风险，凭据型环境变量只允许保存在本机连接记录中。

### Verification

- 84 项自动测试、lint 与 45 个 npm 发布文件白名单/敏感内容扫描通过。
- 使用 DSH Desktop 自带的 `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2` 完成真实 stdio 运行时冒烟：受控本地 MCP 进程成功启动、注册并调用工具，`args`、`env` 与 `cwd` 透传符合预期。

## [0.2.11] - 2026-08-23

### Added

- 新增八爪鱼云采集第三方市场卡片：通过标准 OAuth 2.1 Authorization Code + PKCE 和动态客户端注册完成一键授权，无需复制 API Key；精选 Prompt 覆盖模板搜索、任务进度、数据预览/导出，并在启动或停止云任务前要求用户确认。

### Changed

- OAuth 发现按 RFC 8414 元数据优先、OIDC Discovery 补充的方式合并端点，兼容动态客户端注册与撤销端点分散发布的服务。
- 将 OAuth 撤销端点视为可选能力：服务未发布该端点时仍可授权、刷新和断开，断开时删除 DSH 本机授权记录。

### Verification

- 75 项自动测试与 lint 通过；新增 OAuth/OIDC 元数据合并及无撤销端点兼容回归。
- 八爪鱼公开 MCP 端点、Protected Resource Metadata、Authorization Server Metadata、OIDC Discovery、PKCE S256 与动态客户端注册端点探针通过；Desktop 真实账户 OAuth 授权成功，枚举 1 个服务 / 12 个工具，`list_platforms` 只读调用返回成功且未创建或修改任务。

## [0.2.10] - 2026-08-22

### Fixed

- 工具发现遇到瞬时网络断开或 MCP 5xx 时自动重试一次；鉴权、协议、4xx 和超时仍直接返回，减少 QVeris 等远程服务偶发 TLS reset 导致的连接状态误报。

## [0.2.9] - 2026-08-22

### Added

- `tools/list` 现在在同一 MCP 会话内自动跟随 `nextCursor` 加载全部分页，并对重复游标、超过 100 页或 10,000 个工具的异常目录执行安全阻断。
- 工具详情统一使用中文服务计数；自动识别服务商返回的 deprecated 描述，将弃用别名排到末尾并标注“已弃用”。

## [0.2.8] - 2026-08-22

### Fixed

- 工具详情改为执行完整的 Streamable HTTP MCP 会话流程：`initialize` 后保存 `Mcp-Session-Id`，发送 `notifications/initialized`，再携带会话、协议版本和凭据请求 `tools/list`，修复 QVeris 等有状态 MCP Server 返回 HTTP 400 的问题。
- 会话结束后尽力发送 `DELETE` 释放服务端资源；鉴权失败、限流、HTTP/协议错误继续按类型更新连接健康状态。

### Registry

- 将 QVeris 工具快照校正为托管端实际返回的 8 个工具；移除当前运行时不存在的 `probe`，补充 3 个兼容旧客户端的弃用别名。
- QVeris 精选 Prompt 仅使用实际可用的 `discover`、`inspect` 和用量审计工具；未经用户明确确认仍不执行可能消耗 Credits 的 `call`/`execute_tool`。

### Documentation

- 统一 QVerisMCP 品牌名称，记录官方 Logo 因 `same-origin` 策略需由 Registry 自托管的 Desktop 兼容方案。
- 将已于 `0.1.0`–`0.2.0` 完成的 v2 详情页实施计划标记为已完成/归档，避免与当前待办混淆。

### Verification

- 69 项自动测试、lint 与 44 个 npm 发布文件白名单/敏感内容扫描通过。
- 使用 DSH 本机已保存的 QVeris API Key 完成真实只读验收：协议版本 `2025-03-26`、有状态会话建立成功、`tools/list` 返回 8 个工具；未执行任何付费能力调用。

## [0.2.7] - 2026-08-22

### Added

- 市场新增“服务商 + 接入方式”组合筛选，可快速查看 OAuth、Key/Token 或免密连接器，并可与全文搜索叠加。
- 新增 DSH 外部市场注册自动验收：每小时跟踪 PR #2633，合并后继续验证上游 YAML 与 DSH 实际 `plugins.json` 均已生效。

### Registry

- 独立远程 Registry 已扩展为 4 张第三方卡片、12 个 Server 和 16 个 Prompt；与随包目录合并后共 8 张已发布市场卡片。
- 新增“盈米·基金投顾”与“QVeris·通用能力网络”；QVeris 默认先做免费发现、参数检查与零成本询价，付费 `call` 需用户明确确认。

### Verification

- 自动化门禁通过 69 项测试与 43 个 npm 发布文件白名单/敏感内容扫描。
- QVeris Hosted MCP 无凭据公网探针返回预期的 HTTP 401，确认端点可达且正确要求 Bearer Key；未进行付费 `call`。
- DSH Desktop `web` profile 已精确对齐 `dsh-mcp-connector@0.2.7`；完全重启后左侧入口、中文单语界面、组合筛选和 8 张市场卡片通过，19 条连接和 4 组授权保持不变。

## [0.2.6] - 2026-08-21

### Documentation

- 记录 `0.2.5` GitHub/npm 发布、DSH Desktop 精确版本安装、孤立 grant 自动清理与 19/19 Server 健康回归结果。
- 扩充 GitHub Topic、仓库简介、README 和 npm 关键词，覆盖 MCP连接器、连接管理、插件/扩展、集成、Qichacha/QCC 和企查查等真实检索入口。
- 明确“技能扩展”指 MCP 工具与 Prompt 对智能体能力的扩展，不将本包标记为独立 DSH Skill。

## [0.2.5] - 2026-08-21

### Changed

- 同一连接器已有 OAuth 授权流程进行中时，后续重复点击复用同一 Promise，不再重复打开授权页或创建重复 grant。

### Security

- OAuth 重新授权成功后，撤销并删除已不再被连接引用的旧 refresh token/grant；插件启动时同步清理历史孤立 grant，仅保留当前连接仍引用的本机凭据。
- 授权流程中途失败时清理未被连接引用的临时 grant，避免失败重试累积敏感记录。

### Fixed

- 修复连续或并发 OAuth 重新授权后，本机可能残留重复且未被连接引用的授权记录。

### Documentation

- 记录 `0.2.4` GitHub/npm 发布、DSH Desktop 精确版本安装和连接健康状态实机回归结果。
- 记录旧企查查 OAuth 插件凭据迁移的用户确认、幂等执行和源数据保留验证结果。

## [0.2.4] - 2026-08-21

### Added

- 新增主动连接健康检查，支持 OAuth grant、Bearer/API Key 与无鉴权 MCP initialize 握手，并以 4 并发、5 秒单连接上限避免刷新风暴。
- 新增 `mcp_connector_health_check` 对话工具和同源 Web API，可检查单个或全部已配置连接器。

### Changed

- 市场卡片和“已安装”列表不再把“本机存在配置”等同于“当前可用”，改为展示已配置、已连接、需重新授权、部分异常、连接异常或已停用。
- 首次打开市场会在后台执行一次限流健康检查；用户点击“刷新”时同步刷新目录和连接状态。

### Fixed

- OAuth 过期/缺失或历史 Key 失效后，不再继续显示“已连接”；详情页会暂停 Prompt 发送并提供重新授权/重新配置入口。
- 网络、DNS、TLS 或服务端异常与凭据异常分开呈现，避免误导用户重复录入 Key。

## [0.2.3] - 2026-08-21

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

[Unreleased]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.22...HEAD
[0.2.22]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.21...v0.2.22
[0.2.21]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.20...v0.2.21
[0.2.20]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.19...v0.2.20
[0.2.19]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.18...v0.2.19
[0.2.18]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.17...v0.2.18
[0.2.17]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.16...v0.2.17
[0.2.16]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.15...v0.2.16
[0.2.15]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.14...v0.2.15
[0.2.14]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/duhu2000/dsh-mcp-connector/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.1.0
