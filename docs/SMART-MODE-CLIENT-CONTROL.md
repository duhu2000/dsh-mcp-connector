# QMCP-4963 · 受控客户端与审核维护

> 历史阶段记录 / Historical evidence. 当前 PR 完成范围与剩余验收统一见 [PR 审阅入口](SMART-MODE-PR-REVIEW.md)。

2026-11-13，Asia/Shanghai。独立分支 `codex/qmcp-4963-client-control`，基于 `b1d6ac7`。先以合并提交 `e7e6682` 对齐本地已核对的 0.2.102 发行基线，再实现本轮功能。未推送、发布或安装到当前 DSH。

**结论：授权范围内的人工控制接口、独立只读审核存储及插件控制页端到端验收通过。当前 DSH 配置未变、生产智能模式未启用，真实来源等价和真实只读批准均为零。本轮不包含真实模型收益验收，阶段 1 完整验收仍未关闭。**

English: The isolated branch retains the 0.2.102 client fixes and adds an explicitly mounted human control plane, durable fingerprint-bound read-only evidence, and a browser control page. Real Host Session/JSONL and the installed native /compact command are exercised with synthetic data and an offline adapter. No production deployment, real business invocation, or actual provider measurement occurred.

## 基线与代码范围

发行基线合入保留现代 DSH 的工作区解析、独立会话草稿交接、导航取消与对应回归。开发包现为 0.2.102；这是独立分支的明确验证基线，不声称它是最新发行版本。当前安装包和配置未被替换。

| 文件 | 作用 |
| --- | --- |
| `lib/smart-mode-control.js` | 人工控制器；模式、明确来源和只读审核的预览/提交；会话操作与整层启停适配 |
| `lib/smart-mode-control-web.js` | 显式挂载的受认证 HTTP 路径、同源/Host fence、CSRF nonce、静态页及方法白名单 |
| `lib/smart-mode-store.js` | 独立 read_only_reviews 历史，复用原子发布、校验和、revision CAS 与默认拒绝批准 |
| `lib/smart-mode-integration.js` | 合并持久化审核、瞬时来源意图、会话加载释放及 profile 身份；保持生产 apply() 未挂载 |
| `lib/source-selection.js` | 可信意图复核，仍按当前权限、完整定义和已批准关系选择来源 |
| `lib/smart-mode-prepare.js` | 审核可选 reviewerHash，兼容旧 v1 记录 |
| `ui/smart-mode.html`、`ui/smart-mode.js` | 人工管理页；定义检查、预览、确认、来源选择/明确比较、核验维护和会话操作 |
| `ui/index.html` | 仅当受控能力端点实际可用时显示入口，传递界面语言 |
| i18n、lint、打包白名单 | 共用中英文词典；明确允许新增的两个 UI 文件，没有放开整个 UI 目录 |
| 夹具及测试 | 真实 Host + JSONL + 原生命令 + Node HTTP，仅合成账号、定义、证据及离线模型 |

## 人工控制与信任边界

`createSmartModeControl()`、`mountSmartModeControlRoutes()` 默认关闭。调用方必须明确提供独立 profile、唯一账号的六 Server scope、当前集成/Agent 服务和 Host 身份适配。启动前 realpath 核对 profile，运行中继续检查集成 profile 身份；没有当前 profile 默认路径。

受控页路径为 `/mcp-connector/smart-control/`。路由必须提供可信 `authorizeRequest`，缺失即拒绝挂载；没有 Host principal 或 read 权限返回 403。**回环地址和同源本身不等于操作员身份。** principal 由 Host 回调提供，不读取模型参数或请求正文中的身份声明。

请求同时校验 Host/Origin/Sec-Fetch-Site；POST 还要求页面签发的 principal 绑定 nonce，30 分钟过期。所有接口和静态资源均 no-store，页面使用同源 CSP。只有固定方法/字段可进入控制器，正文最大 16 KiB，错误只返回稳定码，不输出异常正文或凭据。

读、模式/来源管理、审核权限分别核对。commit 依据服务端预览种类再次检查权限；拥有审核权限不自动取得模式管理权限。预览 60 秒过期、绑定 principal/会话实例，成功受理后一次性消费；模式保存复核 revision，来源与审核提交复核当前定义和权限。模式、审核、清空等写操作在控制器内串行，跨实例存储写入仍受 revision CAS 保护。

原管理工具数量和模型入口没有增加。控制器、审核持久化和选择意图均不注册为模型工具；模型不能通过 `source.kind=user`、confirmed 标志或伪造 principal 写入审核或明确来源回执。

## 只读审核与来源选择

审核位于独立 profile 的 smart domain 下，按 account/group/sourceId/完整 definitionFingerprint 分区，每次写入独立 revision、checksum 和原子发布记录。只保存身份引用、哈希、结论、时间及操作员摘要，不保存完整 schema、业务样本或凭据。

启用审核必须通过服务端独立 `verifyReadOnlyReview` 策略，默认 false。名称前缀、annotations、候选相似度、界面点击和证据哈希本身不能产生批准。浏览器验收和测试仅允许字面合成账号及预置合成证据；没有批准真实账号的审核。撤回记录可以不增加批准，并在 Agent 忙碌时关闭后续工具可见性/派发，不替换或取消已发生的业务执行。

持久化撤回优先于同指纹的初始内存审核。定义任何变化都必须匹配新的完整指纹；到期、损坏或未知存储版本不能冻结旧批准。审核记录缺少新的可选 reviewerHash 仍兼容 v1；新人工记录由服务端写入 reviewerHash，正文不能指定操作员身份。

明确来源经当前可发现/可用权限复核，绑定 SessionId、Agent 实例、capabilityId、sourceId 和完整定义指纹。意图只存运行内存，10 分钟过期；恢复、整层重挂载和清空不恢复旧意图或加载状态。保存选择不触发 prepare 或业务调用。仅在单独已批准关系中，用户明确比较两个来源时，才可选出两个来源；候选本身不能创建这种关系。

## 客户端及会话路径

新页面支持为当前账号六服务一次设置新会话默认模式、查看历史会话模式、来源检查与预览确认、审核保存/撤回、整层启停、新建/恢复、清空与压缩。已有会话不被默认模式切换追溯改写。

本轮端到端路径是 **本插件控制页 → 本插件 HTTP 控制器 → 实际 Host Session/Agent/JSONL/原生命令**。不是对当前 DSH 主界面所有原有菜单按钮的点测；当前主界面和既有会话没有被操作。生产 Host principal、工作区会话创建等适配仍由显式组合方提供，未在当前部署启用这些入口。

安装 Host 没有找到可复用的 clear Remote API。因此本插件的清空通过核验过的 Session surface replace：保留系统头，替换可见会话尾部，记录 sourceEventSeqs 并 flush 实际 JSONL。它释放本会话准备状态和瞬时来源意图，保留模式快照及历史日志，**不是永久删除历史**。

压缩调用实际安装的 CommandRuntime `/compact` 及 command-compact 插件，继续经过原生 compaction seam；不假造 Session RPC。成功用例产生 command/run、compaction/start/end、command/done 和持久化结果。短上下文若摘要不更短，原生命令拒绝提交，页面显示错误；不能当作成功压缩。

整层停用先执行全栈 idle/drain 预检，忙碌时拒绝，避免只释放部分限制。停用恢复原有工具视图，但保留审计和模式记录；重新启用会重新读取持久化状态，准备状态为空。新会话默认模式和整层启停在页面中分别显示，互不伪装。

## 验证与产物

Node 22.22.1，实际安装 Host 0.2.2-rc.1，独立 profile 和真实 JSONL。新增 **19 项**测试：4 项真实磁盘审核存储，15 项控制器/HTTP/Host 契约（其中默认关闭测试不依赖 Host）。覆盖并发 CAS、写失败恢复、损坏拒绝、独立批准、撤回、来源复核、角色/CSRF/profile 隔离、旧会话兼容、恢复、清空、原生命令、忙碌拒绝和整体回滚。合入发行基线也保留了其已有客户端回归。

最终 `npm run check`：**967 项，962 通过、0 失败、5 项原有跳过**。无新增跳过。lint、翻译门禁、文档/元数据检查、教程链接和打包通过，141 个发布文件在白名单内，无凭据或本机路径。

首次全量检查提示三处漏译，后续补齐；下一轮测试全部通过但打包白名单尚未登记两个新 UI 文件，随后仅增加两个精确文件规则。最终完整检查退出码为 0，没有扩大翻译基线或移除安全检查。

内置浏览器实际验证了模式预览/确认、新旧会话隔离、当前定义检查、合成审核版本 1 落盘、明确来源保存后零加载、压缩、清空后恢复及整层停用/重启。先观察了短上下文压缩拒绝，再以长合成素材验证成功；没有用失败截图冒充成功。

演示夹具为新会话填充合成素材并通过离线适配器形成历史，产品的 create/resume 适配器不会自动发送消息。首个演示进程没有保留退出通道，经唯一脚本/PID、临时目录及标记核对后停止并清理；第二个演示正常退出。没有停止当前 DSH。

任务产物 `qmcp-4963-client-control/` 包含：最终 `npm-check-verified-node22.log`、存储/HTTP 测试日志、`verified-profile-summary.json`、配置前后哈希、浏览器结束状态与清理凭据、`control-ui-verified.jpg`。截图只代表独立合成 profile，不能作为真实业务或生产启用证据。

最终全量测试有 47 份 Host/profile 指标回执，45 个不同 Host 临时 profile，均已清理；另有两个浏览器演示 profile 的独立清理记录。既有全量夹具四次纯本地合成业务函数执行仍属于原成功/失败/取消测试，不是企查查调用。本轮真实业务、DSH 真实模型请求、真实来源和只读批准均为 0。

## 当前环境与下一步

本轮当前 DSH 的 cordis.yml、cordis.patch.yml、package.json、pnpm-lock.yaml 四文件，开始和结束 SHA-256 均一致。未修改当前连接、注入模式、授权存储或智能模式设置。没有复制当前凭据到临时 profile，也没有执行新一轮真实目录采集或真实业务 canary。

本轮受控客户端/审核维护可交付，但不能据此宣称阶段 1 全部完成或真实 90% 收益达成。后续优先在独立 profile 对 v4-pro/flash 进行真实请求、usage、缓存和成本 A/B，先保持无业务调用、无真实合并；该步骤涉及真实模型请求，需明确单独调用范围。真实 prepare 功能验收还需独立核验少量真实只读定义，真实等价审批与生产部署继续单独控制。
