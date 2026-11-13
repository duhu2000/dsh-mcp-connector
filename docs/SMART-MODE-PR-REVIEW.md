# QMCP-4963 · PR 范围与验收入口

本文件是本次 PR 的统一审阅入口。其他 `SMART-MODE-*.md` 保留各轮实施时的版本、结果和未完成项，属于历史证据；当前完成状态以本文件为准。冻结新增功能，首次收口完成 main 对齐，后续仅修复审阅发现的问题并补齐回归。

English: This PR delivers default-off smart-mode components and controlled, isolated validation for one account's six QCC enterprise servers. Production composition, real read-only/source approvals, actual provider benefit measurements and rollout are not delivered. Historical phase reports remain evidence rather than the current completion checklist. Ready for review means ready for code review, not production deployment or merge approval.

Review follow-up: bound compat-session scope checks, pending preparation/clear races, partial lifecycle subscription rollback and rejected asynchronous permission callbacks are corrected without adding capabilities.

## 用户问题与本期范围

同一账号的多个企业 Server 具有重复工具，常驻注入完整定义增加模型上下文。目标是在权限与现有会话行为兼容的前提下，搜索时只给简要目录，prepare 后才给少量完整定义；只有独立批准的来源关系可以合并。

本期绑定一个明确的账号/grant，仅包含 `qcc-company`、`qcc-risk`、`qcc-ipr`、`qcc-operation`、`qcc-history`、`qcc-executive`。其他账号、企查查法律、法宝及其他连接不在智能范围，不作会话总量下降承诺。

PR 基于 `main` 的 `7b83486`（0.2.103），在 `codex/qmcp-4963-pr` 汇集全部先前 QMCP-4963 提交并合入该 main。保留原任务分支与历史，不重复合并各阶段分支。保留上游客户端、设置、市场统计及版本文档；不创建新发行版本。

## 已完成：代码和受控工程验收

| 范围 | 当前实现 | 审阅位置 |
| --- | --- | --- |
| 生命周期及独立存储 | Agent.id/SessionId 身份、模式快照、旧会话兼容、fork/subagent 继承、真实磁盘 revision/CAS、写失败和恢复 | `smart-mode-lifecycle.js`、`smart-mode-schema.js`、`smart-mode-store.js` |
| 会话限制 | 按 Agent 约束 schema/lookup/dispatch；智能会话两个入口，兼容会话原 25 个；权限变化和失败封闭 | `smart-mode-restrictions.js`、`host-tool-names.js`、`tools.js` |
| 发现与绑定 | 原始定义可信发布、刷新失效、历史缺少 serverKey 的内存映射；不回写旧记录 | `smart-mode-discovery.js`、`smart-mode-bindings.js` |
| 来源选择 | 完整原始定义指纹、版本化候选与批准分离、账号隔离、明确来源、过期/撤权/定义变化复核 | `source-relations.js`、`source-selection.js` |
| prepare | 绑定完整指纹的独立只读核验、加载前权限和关系复核、会话隔离、失败回滚；prepare 本身不执行业务 | `smart-mode-prepare.js` |
| 资源保护 | 包含两入口的组内预算、固定/滑动 TTL、LRU、Native 在途及批次保护、安全释放、忙碌回滚拒绝 | `smart-mode-resources.js` |
| 受控组合及人工入口 | 显式 profile/Host 契约组合；有身份/权限/CSRF 的控制页、审核维护、明确来源、会话清空/压缩、整层停用 | `smart-mode-integration.js`、`smart-mode-control*.js`、`ui/smart-mode.*` |

以上模块位于 `lib/`，测试与合成夹具位于 `test/`、`scripts/fixtures/`。中英文用户文案、lint 和精确的打包白名单同步维护。

生产 `apply()` 只导出这些工厂，不组合或挂载智能层、独立存储及人工控制路由。旧页面只有能力端点实际可用时才显示智能入口；当前安装不会因此获得可用的生产智能模式。原有 `compactManagementTools` 全局开关不是会话模式开关。

## 未完成：实际可用与发布验收

| 剩余事项 | 完成条件 | 对当前审阅/发布的影响 |
| --- | --- | --- |
| 生产 Host 组合 | 明确 opt-in 接入原始发现、权限、可信操作员身份、Workspace 会话操作和能力门；验证停用/重启 | 否；阻止声称安装即可用 |
| 真实只读定义核验 | 独立业务核验证据绑定完整定义指纹；未核验时 prepare 保持拒绝 | 否；阻止相应真实工具 prepare 验收 |
| 真实来源关系核验 | 独立确认返回语义、计费、限流、数据新鲜度、有效期和逐组 kill switch | 否；阻止相应来源合并，不阻止独立来源路径 |
| 真实模型收益 A/B | 在独立 profile、明确授权次数下测 v4-pro/flash 请求、usage、缓存与成本 | 否；阻止真实收益结论 |
| 更广 Host/执行器适配 | 本地完整契约固定验证 Native Host；PTC/嵌套派发及其他版本须单独能力验收 | 否；不得扩大支持声明 |
| 维护者审阅与发布 | 等待维护者代码审阅；之后另行决定合并、发布和受控灰度 | 允许进入代码审阅，不代表审阅通过或发布批准 |

不以批准全部真实候选作为提 PR 的前提，也不以本地合成批准代替真实批准。进入代码审阅、合并 PR、发布安装包和启用生产智能模式是不同动作，本次只推进代码审阅。

最终复核确认上轮四类修复及其回归已纳入 `d610140`，未发现本期默认关闭、受控工程范围内新的代码阻塞项。该提交的 12 项远端 CI 全部通过，未留下未解决的审阅讨论或要求修改的审阅意见。本轮仅同步审阅状态与边界说明，不修改运行代码，不合并 PR。状态切换前继续核对最新 head 和 CI；生产接入、真实核验及收益测试仍按上表单独控制。

## PR #243 审阅修复

基于首次收口提交 `f8eaefe` 审阅会话隔离、权限、prepare 与回滚，确认并修复以下四类问题。仍在 `codex/qmcp-4963-pr`，不合并 PR，不变更生产接入范围。

| 问题及触发条件 | 修复与回归 |
| --- | --- |
| 兼容快照已经绑定其他账号/组时，控制器只针对 smart 检查绑定，可能列出标题或调用恢复/清空等操作 | 列表、恢复和所有依赖 agentFor 的路径统一检查已绑定账号/组；未绑定历史会话及同账号 compat 继续兼容。两个外部绑定用例检查七种入口，确认会话操作回调未执行 |
| Agent 为 idle 但 prepare 仍在等待或排队时，清空可能先成功，随后旧 prepare 又发布工具 | 启用资源层的状态包含逐 Agent pendingOperations；清空/压缩与需要 idle 的控制提交拒绝同会话未完成操作。另一会话不被阻断；只读撤回仍可完成，并使等待中的 prepare 拒绝提交 |
| 生命周期订阅第 1～6 个事件时失败，会遗留已注册回调，且不能重新挂载 | 逐条获取/校验 disposer，注册失败按逆序释放已取得的订阅，成功后才置 mounted。单测覆盖每个失败位置及缺失 disposer；真实 Host 组合验证整层回滚后原 25 管理入口/业务视图和后续会话正常 |
| 权限或来源检查错误地返回拒绝的 Promise 时，虽然不授权，仍产生 unhandledRejection | 观察并处理 Promise 拒绝，仍要求同步明确 true；不引入异步权限支持。四种权限回调和来源权限回调均检查封闭拒绝且无未处理异常 |

新增 19 项回归；其中 15 项在对应修复前实际失败，另 4 项补齐受控 Host/HTTP 与兼容验证。首轮完整检查还发现本次状态字段修订影响了禁用返回结构，已恢复原 `{ enabled: false }` 契约，保留原测试而未放宽断言。

## 验收口径与边界

1. 预算只计本期六企业 Server 的已加载业务定义和两个常驻管理入口。初始目标不超过 1,500，加载后总预算不超过 5,000；使用 DSH 的 `JSON.stringify(...).length / 4 + 4` 口径及其实际取整。90% 只能相对同范围全量定义基线声明，不能用于整个会话、usage 或费用。
2. 既有真实目录证据为 356 个工具、186 个不同 raw name、170 个重复候选组；候选仍为未批准状态。相同 input schema 或仅 `_registration_tool` 不同不证明业务等价。离线初始两入口投影不等于真实 provider A/B。
3. 兼容会话、其他连接、手动激活语义和原治理规则不作追溯改写。拒绝指定来源时不偷偷换源；未指定来源只在当前有效权限中选择。调用失败不自动换源。
4. 本地删除、停用及治理拒绝可以立即更新工具视图；远端撤权只能在后续发现或调用失败等信号到达时识别。插件不新增或绕过 Host 审批，也不替 Host 补不存在的审批。
5. 清空替换可见会话尾部并释放准备状态，保留模式与历史日志；压缩使用核验过的原生命令，摘要不更短时允许原生命令拒绝。恢复不持久化加载状态。
6. 存储要求支持原子硬链接的本地文件系统；Windows 未证明整机断电耐久性，网络盘未验收。未知/损坏状态及不兼容定义均封闭失败。

## 本轮回归

完整检查使用 Node 22.22.1，显式选择已安装的 Host 0.2.2-rc.1 运行库，并在独立临时 profile 使用真实 JSONL 与离线适配器。模块锚点仅用于解析，不加载当前 DSH 配置、凭据或生产会话。HTTP 测试使用本地合成服务。

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<明确选择的已安装 Host package.json 绝对路径>'
$env:DSH_SMART_ACCEPTANCE_EVIDENCE_DIR = '<独立任务产物目录>'
npm run check
```

不设 Host 锚点时，相应完整 Host 契约测试会跳过；仓库已有 CI 的 Host visibility 任务只覆盖其自己的兼容矩阵，不能当作本套完整生命周期/JSONL 验证。PR CI 状态与本地带锚点结果分别记录。

PR 审阅修复后的完整 `npm run check` 退出码为 0：**1025 项，1020 通过、0 失败、5 项原有跳过**；无新增跳过。lint、中英文门禁、文档/元数据检查、教程链接及打包白名单/安全检查全部通过，发布文件仍为 141 个。相对首次收口的 1006 项新增 19 项回归，不增加功能。

最终全量运行的 54 份 Host/profile 回执覆盖 52 个不同临时 profile，结束时均已清理；本次失败复现、定向及首轮完整检查的 profile 也已清理。真实业务和模型请求为 0。每轮完整/定向 Host 组合中的既有成功/失败/取消测试执行 4 次纯本地合成业务函数。原有跳过为 Windows 环境变量大小写、独立 Web E2E，以及三项独立 SDK 启动保护夹具；本期完整 Host 契约未跳过。

首次 PR 收口的沙箱运行曾遇到本地 HTTP `EACCES`，其获准环境重跑结果为 1006 项。本次审阅新增用例保留修复前的 15 项失败、禁用结构契约失败及修复后的定向/全量日志；此前 967/1006 项结果均不替代本次 1025 项结果。

真实业务调用、真实模型调用、真实来源或只读批准、生产智能模式启用均为零。当前 DSH 的 cordis.yml、cordis.patch.yml、package.json、pnpm-lock.yaml 在本轮开始和结束 SHA-256 一致；不把这四文件未变推导成后台全部运行存储从未变化。

## 历史证据索引

- 生命周期、落盘及限制：[P1-01](SMART-MODE-LIFECYCLE-P1-01.md)、[P1-02](SMART-MODE-STORAGE-P1-02.md)、[P1-03](SMART-MODE-RESTRICTIONS-P1-03.md)。
- 来源、prepare 及资源：[P1-04](SMART-MODE-SOURCES-P1-04.md)、[P1-05](SMART-MODE-PREPARE-P1-05.md)、[P1-06](SMART-MODE-RESOURCES-P1-06.md)。
- 隔离组合与补验：[P1-07](SMART-MODE-INTEGRATION-P1-07.md)、[发现补验](SMART-MODE-DISCOVERY-FOLLOWUP.md)、[真实元数据](SMART-MODE-REAL-METADATA-ACCEPTANCE.md)、[绑定与候选修订](SMART-MODE-BINDING-CANDIDATE-FIXES.md)。
- 人工入口与浏览器受控验收：[客户端控制](SMART-MODE-CLIENT-CONTROL.md)。其中截图与手工结果来自独立合成 profile；本次审阅修复使用自动化 HTTP/Host 回归，未操作当前 DSH 主界面。
