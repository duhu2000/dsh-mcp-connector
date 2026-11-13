# QMCP-4963 · Draft PR 范围与验收入口

本文件是本次 PR 的统一审阅入口。其他 `SMART-MODE-*.md` 保留各轮实施时的版本、结果和未完成项，属于历史证据；当前完成状态以本文件为准。冻结新增功能，本次仅做 main 对齐、差异收口和回归。

English: This draft delivers default-off smart-mode components and controlled, isolated validation for one account's six QCC enterprise servers. Production composition, real read-only/source approvals, actual provider benefit measurements and rollout are not delivered. Historical phase reports remain evidence rather than the current completion checklist.

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

| 剩余事项 | 完成条件 | 是否阻止本次 Draft PR |
| --- | --- | --- |
| 生产 Host 组合 | 明确 opt-in 接入原始发现、权限、可信操作员身份、Workspace 会话操作和能力门；验证停用/重启 | 否；阻止声称安装即可用 |
| 真实只读定义核验 | 独立业务核验证据绑定完整定义指纹；未核验时 prepare 保持拒绝 | 否；阻止相应真实工具 prepare 验收 |
| 真实来源关系核验 | 独立确认返回语义、计费、限流、数据新鲜度、有效期和逐组 kill switch | 否；阻止相应来源合并，不阻止独立来源路径 |
| 真实模型收益 A/B | 在独立 profile、明确授权次数下测 v4-pro/flash 请求、usage、缓存与成本 | 否；阻止真实收益结论 |
| 更广 Host/执行器适配 | 本地完整契约固定验证 Native Host；PTC/嵌套派发及其他版本须单独能力验收 | 否；不得扩大支持声明 |
| 审阅与发布 | 处理代码审阅、CI 结论；之后另行决定发布和受控灰度 | 是，阻止直接当作已发布功能 |

不以批准全部真实候选作为提 PR 的前提，也不以本地合成批准代替真实批准。合并 PR、发布安装包和启用生产智能模式是不同动作，本次只提交 Draft 供审阅。

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

main 对齐后的完整 `npm run check` 退出码为 0：**1006 项，1001 通过、0 失败、5 项原有跳过**；无新增跳过。lint、中英文门禁、文档/元数据检查、教程链接及打包白名单/安全检查全部通过，发布文件仍为 141 个。本轮不增加测试或功能；数量相对上一轮增加来自合入 main 的既有测试。

47 份 Host/profile 回执覆盖 45 个不同临时 profile，结束时均已清理；真实业务和模型请求为 0。既有成功/失败/取消测试共执行 4 次纯本地合成业务函数。原有跳过为 Windows 环境变量大小写、独立 Web E2E，以及三项独立 SDK 启动保护夹具；本期完整 Host 契约未跳过。

本轮首次沙箱运行遇到本地 HTTP `EACCES`，停止后在获准环境中完整重跑，保留两个日志。此前 967 项结果属于上一轮，不替代本轮结果。

真实业务调用、真实模型调用、真实来源或只读批准、生产智能模式启用均为零。当前 DSH 的 cordis.yml、cordis.patch.yml、package.json、pnpm-lock.yaml 在本轮开始和结束 SHA-256 一致；不把这四文件未变推导成后台全部运行存储从未变化。

## 历史证据索引

- 生命周期、落盘及限制：[P1-01](SMART-MODE-LIFECYCLE-P1-01.md)、[P1-02](SMART-MODE-STORAGE-P1-02.md)、[P1-03](SMART-MODE-RESTRICTIONS-P1-03.md)。
- 来源、prepare 及资源：[P1-04](SMART-MODE-SOURCES-P1-04.md)、[P1-05](SMART-MODE-PREPARE-P1-05.md)、[P1-06](SMART-MODE-RESOURCES-P1-06.md)。
- 隔离组合与补验：[P1-07](SMART-MODE-INTEGRATION-P1-07.md)、[发现补验](SMART-MODE-DISCOVERY-FOLLOWUP.md)、[真实元数据](SMART-MODE-REAL-METADATA-ACCEPTANCE.md)、[绑定与候选修订](SMART-MODE-BINDING-CANDIDATE-FIXES.md)。
- 人工入口与浏览器受控验收：[客户端控制](SMART-MODE-CLIENT-CONTROL.md)。其中截图与手工结果来自独立合成 profile；本轮只改收口说明和注释，未重复主界面点测。
