# QMCP-4963 · P1-05 prepare 按需加载

> 历史阶段记录 / Historical evidence. 当前 PR 完成范围与剩余验收统一见 [PR 审阅入口](SMART-MODE-PR-REVIEW.md)。

2026-11-12，Asia/Shanghai。独立分支 `codex/qmcp-4963-p1-05-prepare`，基于 P1-04 `97b5056`。

本期实现受控的单次 prepare：独立只读审核、加载前同步复核、当前 Agent 内存加载集和限制层提交/回滚。生产 `apply()` 未挂载这些组件；当前 DSH 配置和业务执行路径不变。

English: Opt-in preparation verifies fingerprint-bound read-only evidence, rechecks current permissions and source relations, then updates only the calling Agent. Production activation and real approvals remain disabled.

## 代码变更

| 文件 | 作用 |
| --- | --- |
| `lib/smart-mode-prepare.js` | 严格只读审核 schema、prepare 事务、并发队列、取消、加载记录失效和回滚 |
| `lib/source-selection.js` | 复用同一选择规则，增加 `selectNow/selectManyNow/validateSelectionNow` 同步提交复核路径 |
| `lib/smart-mode-restrictions.js` | 可选 prepare 回调、当前注册对象身份和实际可见性核验、限制错误读取 |
| `lib/tools.js`、英文词典 | 可选开放 discover 的 prepare action；搜索渲染 capability ID；返回下一次推理使用的精确名称 |
| `lib/index.js`、`package.json` | 只导出新工厂并加入语法检查，不改变生产装配或版本 |
| 新增 prepare 单测、只读审核夹具，扩展 Host 联测 | 仅使用合成账号、定义、关系、审核及离线模型 |

## 只读审核与来源关系分离

`getReadOnlyReviews(accountRef, groupId)` 是可信集成接口，不是模型参数。每条审核严格包含 version、账号组、sourceId、**完整原始定义指纹**、enabled、有效起止时间，以及 `effect=read-only`、证据哈希和审核时间。不接受原始定义、响应样本、Header、凭据或额外字段。

只有当前有效、未停用且精确匹配账号组、来源和完整指纹的审核才能准备该来源。审核依据由可信维护流程提供；本模块不会产生或批准证据，不从工具名称、`get_` 前缀、`readOnlyHint`、相同 schema 或来源等价结论推导只读。版本未知、重复绑定、过期或未来审核均失败关闭。

来源等价仍由 P1-04 的版本化批准关系决定；候选不自动合并。没有等价批准的独立来源，可以在各自通过只读审核后单独准备。明确比较多个来源时，每个来源都必须独立通过只读审核；比较标记不绕过任何数量限制。

本期没有新增只读证据磁盘写入或生产批准入口。测试审核均为合成记录，真实来源关系批准和真实只读批准均为零。

## prepare 流程与提交契约

1. 从可信 Host 执行上下文取得真实 Agent；校验 SessionId、已安装的智能模式快照和显式账号组范围。模型只提交 `capabilityIds`，不接受 Agent ID、来源、审核、confirmed 或任意调用参数。
2. 按当前 Agent 串行排队，调用 P1-04 选择器取得来源计划；检查单次来源数量和独立只读证据。期间未改动加载集。
3. 提交前在**没有 await 的同步区间**重新读取原始定义、来源关系、明确来源收据、权限和审核，核对完整选择计划、关系 revision、证据和 Host 注册对象身份。
4. 原子替换当前 Agent 内存记录，通过 P1-03 原生 restrict 更新本 Agent 限制；确认无刷新错误、审核仍有效，且新增来源在实际 Host view 中可见。其他插件的 deny 不能被绕过，也不能误报加载成功。
5. 任一步失败都不提交新批次；Host 更新失败时恢复之前的记录并重新协调限制。补偿失败时保持 admission/guard 阻断，恢复 Host 后再收敛。不会回退到全量注入，也不自动改选或执行其他来源。

异步发现与磁盘读取可以提前进行；**最终提交和同步 guard 必须使用可信集成已发布的当前同步读视图**。原始定义、审核、关系和意图接口只有 Promise 而没有同步当前视图时，prepare 明确拒绝；不会把一次异步检查当成授权租约，也没有静默沿用旧缓存。该视图的生产装配仍属于后续集成工作。

原始定义提供者仍须遵守 P1-04 的 raw `tools/list` 来源契约，并在 Host 注册更新时发布对应的当前原始定义。注册对象身份固定可阻断已加载对象被替换，不能独立证明一个错误接入的原始视图与 Host 定义一致；不能以已裁剪缓存或转换后的 schema 代替原始定义。

准备结果只返回精确名称、当前有效加载数量和下一次推理边界标记，不返回完整 schema 或执行结果。当前步骤已经捕获的 admitted tool set 保持原有范围；从下一次 Host resolve 开始可见。prepare 不调用 MCP 发现、业务接口或模型，也不修改全局注册定义。

## 隔离、失效与兼容边界

- 首期只接受一个显式绑定的账号/grant 下企查查企业数据 6 个 Server：company、risk、ipr、operation、history、executive。其他账号、企查查法律、法宝和 Host 工具不纳入。
- 内存状态按实际 Agent 对象分隔，另核对 SessionId 和快照实例；同 ID 的新对象、恢复会话和子 Agent 均从空加载集开始，不持久化加载状态。
- prepare 的 Host AbortSignal 被保留；异步检查或排队时取消，以及 Agent 销毁或重新安装快照，都会阻止迟到提交。失败队列不阻塞后续有效请求。
- 已加载记录继续通过同步原始指纹、当前权限、关系版本/有效期、只读证据和注册对象身份检查。发现失效后记录永久失效，恢复审核或权限不会自动复活，必须重新 prepare。无关能力变化不会单独使有效记录失效。
- 本地停用、删除和治理变化通过原有限制刷新与 guard 收窄。远端撤权仍取决于 Host 何时发现并更新本地状态；没有新增远端探测或即时撤权承诺。
- `mcp_connector_discover` 仅在注入 prepare 回调时增加该 action；否则保留原 status/search schema。仍只有两个局部管理入口。兼容会话的全局 25 个入口和原手动 preview、confirmed、revision、TTL 语义不变。
- 手动模式、未注册、明确来源被禁止、未核验指纹或未知关系均不能因 prepare 获得额外权限。插件不新增也不绕过 Host 审批，Host 原本没有的审批也不由此补建。

本期采用**单次最多 8 个 capability、最多 8 个选中来源、当前 Agent 最多保留 32 条记录**的开发期硬上限。失效记录在资源释放实现前仍占保留名额，同一来源重新核验可更新原记录。当前已加载能力若要替换成不同来源，返回 `PREPARED_SOURCE_CHANGE_REQUIRES_RELEASE`；无关 prepare 不能丢弃旧保留记录绕过此限制。可信比较可以增加来源，但不能借此移除旧来源。

这是 P1-06 安全释放和在途保护完成前的明确边界，不是 Token 预算、TTL、LRU 或生产容量策略。主动销毁 prepare 控制器只允许相关 Agent 空闲；只清除此组件的内存准备记录和局部可见性，外部 deny、原手动激活状态、持久模式和配置保持不变。

## 验证结果

环境：Node 22.22.1；显式选择本机已安装 Host 0.2.2-rc.1 的模块，独立 Cordis Context、内存会话、离线模型、合成业务定义。P1-05 新增联测只执行管理动作及拒绝路径，合成业务函数执行次数也为零；旧阶段保留的合成业务执行回归不涉及真实企查查。

| 验证项 | 结果 |
| --- | --- |
| 新增单元/契约测试 | 41 项全部通过：只读证据、完整指纹、到期、权限、账号、明确来源、批次原子性、并发、取消、替换限制、错误和回滚 |
| 新增真实 Host 模块联测 | 5 项全部通过：旧 admitted set 不扩张/下次 resolve 可见、撤销后 stale dispatch 阻断、比较审核失败保留原来源、关系变化加载前阻断、恢复/子 Agent 隔离 |
| 合成结构 | 356 个来源；按 8 个一批准备，最多保留 32 条；第 33 条被拒绝；不批准真实关系，不据此证明业务等价 |
| 完整仓库检查 | `npm run check` 通过：809 项中 804 通过、0 失败、5 项既有环境跳过；132 个发布文件通过白名单及敏感内容检查 |
| 当前 DSH | 4 个配置/依赖文件 SHA-256 与 P1-04 相同；未加载当前 profile 配置或打开生产智能存储 |
| 实际外部动作 | 真实企查查业务调用 0、真实模型请求 0、真实来源批准 0、真实只读批准 0、生产智能模式启用 0 |

5 项既有跳过仍为 Windows 环境变量大小写、另行开启的隔离 Web E2E，以及 3 项需要独立 MCP SDK fixture 的用例；新增 P1-05 测试无跳过。

完整检查覆盖语法、文档、元数据、单元/集成回归、发布内容及教程链接。磁盘历史回归使用临时目录的原子硬链接，沙箱下 EPERM 后通过权限流程执行，未跳过。最终日志与配置核对记录位于任务产物目录 `qmcp-4963-p1-05`；不保存业务响应或凭据。

复现（在本机明确选择已安装 Host，不能加载生产 profile）：

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<已安装 DSH profile 的 package.json 绝对路径>'
node --test test/smart-mode-prepare.test.mjs test/source-selection.test.mjs test/smart-mode-restrictions.test.mjs test/smart-mode-lifecycle-host.test.mjs
npm run check
```

## 下一阶段结论

**P1-05 达到本期受控开发退出条件，可以进入 P1-06；不具备生产启用或最终 Token 收益验收条件。**

P1-06 应在当前事务和失效机制上实现预算、固定/滑动 TTL、明确释放及其原子回滚。LRU、在途计数和批次结束回收须先通过真实 Host turn/step/result 顺序及恢复行为能力门，不能让资源性回收破坏已开始的调用；安全撤销仍须及时阻断。来源替换限制和失效保留记录的回收在该机制验证后再开放。

当前同步复核会扫描组内原始定义、关系和权限，还需要后续基于可信版本的性能评估及缓存失效设计；本期合成容量用例不是实际单次 prepare 延迟基线。Token 验收应沿用 DSH `JSON.stringify(...).length / 4 + 4`，5,000/90% 只对企业 6 Server 智能范围声明，并计入其常驻入口；不能据此对整个会话或范围外工具声称降幅。

真实原始定义发布视图、审核维护、可信意图 UI、profile 集成/回滚、模型请求体与 usage 复测仍需后续授权和集成验收。本次未开始 P1-06，也没有批准真实来源、业务 canary 或生产灰度。
