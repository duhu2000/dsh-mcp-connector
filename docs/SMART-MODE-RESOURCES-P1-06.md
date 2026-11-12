# QMCP-4963 · P1-06 预算、TTL、安全释放与在途保护

2026-11-12，Asia/Shanghai。独立分支 `codex/qmcp-4963-p1-06-resources`，基于 P1-05 `47b11e5`。

本期在 P1-05 prepare 事务上增加显式启用的资源层，并完成已安装 Native Host 的能力门验证。生产 `apply()`、当前 DSH 配置和真实来源批准流程均未接入或修改。

English: This opt-in resource layer enforces the scoped schema budget, fixed/sliding TTL, LRU and safe release. Native execution tokens, complete model batches and final outcomes protect active calls. Production remains disabled.

## 变更

| 文件 | 内容 |
| --- | --- |
| `lib/smart-mode-resources.js` | 严格资源策略、DSH 预算估算、TTL、LRU、释放计划、计时器、Host 事件和执行 token 保护 |
| `lib/smart-mode-prepare.js` | 共用每 Agent 事务队列；加载记录和资源元数据原子提交/回滚；新增 release、collect、状态和准入检查接口 |
| `lib/smart-mode-restrictions.js` | 推理准入和原生业务 guard 接入资源检查；管理维护入口可收窄过预算状态 |
| `lib/tools.js`、英文词典 | 可选 discover.release，显示回收/等待状态和预算；仍只有两个局部管理入口 |
| `lib/index.js`、`package.json` | 仅导出契约常量/估算器并加入语法检查，不挂载生产服务，不改变版本 |
| `scripts/fixtures/smart-mode-prepare.mjs` | 抽取 P1-05 共用离线夹具；原 41 项 prepare 测试保留 |
| 新资源测试、扩展 Host 联测 | 合成账号、工具、等价关系和只读审核；真实 Host 模块、独立内存会话和离线模型 |

范围继续由显式账号/grant、组和 6 条连接绑定限定，仅包含企查查企业数据 company、risk、ipr、operation、history、executive。其他账号、企查查法律、法宝、Host 工具和非 Agent 自动化沿用既有路径。

## 预算口径

- 默认硬上限 **5,000**，策略只能调低，可信比较标记也不能放宽。口径是该企业组当前模型可见业务定义 **加两个实际局部管理入口**；不把全局 25 个管理定义重复计入，不包含范围外连接器或消息历史。
- 使用 DSH token-meter 相同公式：空数组为 0，否则 `Math.ceil(JSON.stringify(tools).length / 4) + 4`。这是 UTF-16 字符长度的启发式估算，不是 UTF-8 字节，也不是模型 tokenizer 或计费 usage。
- `getBudgetSchemas(agent, names)` 必须同步提供当前 Native Host 的 canonical request schema 投影，精确包含所请求名称，不能遗漏、混入其他名称、裁剪 schema 或返回 Promise。会拒绝非 JSON 值和额外执行字段。投影与完整原始 MCP 指纹各司其职，预算投影不能代替只读审核指纹。
- 预算按拟准备集合保守计入；其他 deny 或条件注册使实际请求定义更少时可能高估，不能为了降低估算漏报本组定义。
- prepare 提交前检查预算；推理准入和后续业务 dispatch 也复核，防止管理/参数定义变化后沿用旧估算。管理常量本身超限则拒绝加载。release/status 仍可用于查看和收窄过预算状态。
- 默认最多保留 32 条记录，单次仍最多 8 个 capability、8 个来源。可选择 `reject` 或 `lru`；默认 LRU 只回收未被本次请求保护、未被活动调用或批次引用的记录，按最近成功使用时间及稳定名称排序。没有可安全回收对象时整批拒绝，不截断本次请求或扩大预算。

已安装 Host 联测将实际 canonical request 的企业组及两个管理 schema 与预算结果直接比较，数值一致。测试只证明预算算法及约束路径；不能对整个会话宣称不超过 5,000，也不据此宣称已达到真实 90% Token 降幅。

## TTL、释放和来源替换

资源默认滑动 TTL 10 分钟，也可选择固定 TTL；开发测试注入短 TTL 和受控时钟。每个 Agent 维护非递减逻辑时间，时钟回退不能自动复活已过期资源。

固定 TTL 从首次成功 prepare 提交计算；滑动 TTL 只在 Host **最终成功、未取消的 `tools/result`** 后续期，并确认仍为同一加载记录、完整指纹/审核和当前权限有效。搜索、status、重复 prepare、失败或取消结果都不续期。慢调用在名义到期后成功，可以续期其仍被保护的原记录；显式 release 待回收记录不会因成功而撤回释放。

计时器和边界事件触发 collect，和 prepare/release 共用同一 Agent 队列。到期且无引用时回收；有引用时延迟到安全边界。过期条目即使因 Host 错误暂时没有物理移除，同步可见性和 guard 仍会拒绝新的无保护调用。

`discover.release` 只接受当前账号组内精确 publicNames，不接受任意调度、Agent ID 或额外授权字段。空闲记录立即回收，活动记录返回 pending，结束后自动处理，无需用户重复操作。重复释放已移除的本组名称是幂等空操作。它不撤销连接授权、不修改原手动激活或持久模式。

P1-05 的来源替换限制仅在资源层显式启用且通过能力门时放开：完整只读/权限/来源计划先通过复核，旧来源无活动引用才可原子替换；仍被引用时拒绝。新来源计划失效、预算不满足或发布失败均回滚，不自动执行新来源。没有资源层时保留 P1-05 原限制。

## Native Host 能力门与在途保护

资源层要求显式 `dsh-native-token-result-step-v1` 契约、已挂载的事件接口，以及同步确认当前执行器仍为已核验 Native 实例的回调。未挂载、未知契约、执行器变化、异步执行器判定或嵌套/PTC dispatch 均失败关闭；本期没有把验证扩展到 PTC。声明契约字符串不能替代接入方的真实 Host 验证。

保护分三层：

1. `step/start` 到完整模型响应之前，保守固定该 step 可用的准备记录，保护流式生成期间可能被模型引用的定义。
2. 完整、未中断的 `assistant/message` 确定本批工具调用后，固定**本批实际引用的所有已加载工具**，包括还没开始的排队 sibling；未引用记录可供当前 prepare 做 LRU。只读取调用 ID 和名称，不保存参数或模型文本。缺失完整清单时继续保守固定全部，不猜测未引用对象。
3. `tools/execute` 包装器使用 Host 的真实 execution token 保护实际调用；`tools/result` 的冻结最终结果才结算该 token。即使某个并行 body 已返回，其按模型顺序提交的最终结果尚未到达时仍被保护。无 session log 的直接 Native 调用也有实际调用保护；完整批次引用保护仅对已观察到的 Host step/model batch 成立。

持久事件关联严格使用 `tool/call.data.callId` 和 **`tool/result.data.message.toolCallId`**。`step/end` 只有在对应 call/result 和执行 token 排空后才解除批次固定。取消时等待已开始 body 排空，并接收 Host 为未派发调用生成的 synthetic result；不提前归零或用 turn/end 伪造成功回收。

首次 prepare 可以发生在已开始的 step 中；新工具不属于该旧 step 的 admitted set，在后续 step 开始观察批次。这一 bootstrap 路径已用离线模型真实驱动 Host 验证。恢复/子 Agent 从空资源状态重新接入，不复制父会话 token、计时器或加载记录。

事件顺序错误、关联缺失、未声明调用或无法确认批次排空时，保留保护记录并阻断后续 prepare、推理和 dispatch，报告首个协议错误；不猜测安全释放。重复的最近一条相同事件幂等。会话销毁后旧异步任务不能复活新 Agent；正常主动销毁组件要求 Agent 空闲且调用/批次排空。

**资源保护不扩大权限。** 本地停用、删除、治理拒绝、只读审核失效、未知完整定义变化或注册对象替换仍优先阻断后续调用，不能借活动 pin 保留失效授权。已经执行的业务不由本插件强制截断。远端撤权仍需 Host 先发现并更新本地状态，没有新增即时探测承诺。

## 原子性、隔离与回滚

每 Agent 的准备记录、TTL/最近成功时间、pending release 和回收计划由同一事务发布；prepare、计时器 collect、手动 release 和事件回收串行处理。同步提交期间重查状态和取消，避免排队/异步检查后的迟到写入。

Host 限制更新、实际可见性确认或计时器安装失败时，恢复之前的加载记录与资源元数据，再协调旧限制。补偿也失败时，原生 guard/准入继续阻断，保留诊断；不放开全量工具。自动回收失败写入 maintenanceError，未来维护可重试；到期和安全权限检查不依赖定时器成功。

所有状态按实际 Agent 对象保存，另核对 SessionId、账号组和已安装快照。相同 ID 的新对象不共享资源；Host 唯一活动 SessionId 契约被破坏时拒绝按该 ID 投递资源事件。局部限制、外部 deny、原有手动 preview/confirmed/revision/TTL、兼容会话的 25 个管理入口和全局定义保持原语义。

生产装配还必须将 `assertResourceReady` 接入限制层的准入/guard 回调，将 resourceStatus、release、getPreparedNames 接到同一 prepare 实例，并提供可信同步原始视图、预算投影及 Native 身份判断。测试夹具已按此完整组合；仅导出工厂不构成生产接入。

## 验证结果

Node 22.22.1；显式选择已安装 Host 0.2.2-rc.1 的模块，独立 Cordis Context、内存 Session 和离线模型。新增 Host 测试执行的是合成工具 body，未连接真实 MCP 或模型服务；真实企查查业务调用、来源批准和只读批准均为零。

| 检查 | 结果 |
| --- | --- |
| 新资源单元/契约测试 | 29 项全部通过：口径、超限、动态 schema 变化、TTL、最终成功、固定/在途、LRU、来源切换、并发、取消、隔离、事件错误、计时器/挂载/限制失败回滚 |
| 新 Host 能力门测试 | 8 项全部通过：模型首轮 prepare、canonical 预算、并行/按序结果/排队 sibling、取消排空、滑动成功/失败、在途容量、模型 step 内 LRU、安全撤销、恢复/子 Agent 隔离 |
| 完整检查 | `npm run check` 通过：846 项中 841 通过、0 失败、5 项既有环境跳过；133 个发布文件通过白名单和敏感内容检查 |
| 当前 DSH | 4 个配置/依赖文件 SHA-256 与 P1-05 相同；未加载或修改当前 profile 配置、未打开生产智能存储 |
| 实际外部动作 | 真实模型请求 0，真实企查查业务调用 0，真实来源/只读批准 0，生产智能模式启用 0；未推送或发布 |

5 项既有跳过仍为 Windows 环境变量大小写、独立 opt-in Web E2E 和 3 项独立 MCP SDK fixture 用例；本期新增测试无跳过。历史磁盘/子进程回归通过权限流程运行临时目录硬链接用例，未为此跳过。

复现：

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<已安装 DSH profile 的 package.json 绝对路径>'
node --test test/smart-mode-resources.test.mjs test/smart-mode-prepare.test.mjs test/smart-mode-lifecycle-host.test.mjs
npm run check
```

任务产物目录 `qmcp-4963-p1-06` 保存最终检查日志和配置哈希核对，不保存真实业务响应、凭据或真实请求 Header。

## P1-07 准入结论

**达到 P1-06 受控开发退出条件，可以进入 P1-07 集成与整体验收；本次不具备生产启用或最终 Token 收益验收条件。**

P1-07 应先在独立临时 profile 组合生命周期、独立存储、限制、来源选择、prepare 和资源层，验证新/历史会话、fork/subagent、恢复、清空/压缩、失败补偿及完整卸载回滚；验证生产原始视图发布、可信意图、只读证据维护和执行器能力检查的真实接入。当前版本仍不自动为真实工具产生批准。

之后才是受控模型请求体、usage、缓存和成本复测：区分 v4-pro 的无 toolUpdate 与 flash 的 addition-only 行为，5,000/90% 仅用于企业 6 Server 智能范围并计入两个常驻入口。范围外定义、历史消息与 provider 缓存成本必须单独列明。当前同步复核仍会扫描原始定义、权限和关系，真实性能与版本缓存失效也须在该阶段验收。

本次未开始 P1-07，未更改当前 DSH 配置，未批准真实关系、业务 canary、生产灰度或发布。
