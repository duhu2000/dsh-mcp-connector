# QMCP-4963 · P1-01 生命周期适配器交付说明

2026-11-12，Asia/Shanghai。独立分支：`codex/qmcp-4963-p1-01-lifecycle`。

P1-01 的生命周期基础可以进入 P1-02 开发。生产智能模式仍未挂载或启用；磁盘事务、完整智能工具限制层和按需发现尚未实现。

English: This change adds an opt-in, dependency-injected lifecycle adapter and offline Host contract tests. Production initialization does not mount it. Persistent storage, smart tool restrictions, discovery and rollout remain separate tasks.

## 代码与接入边界

| 文件 | 变化 |
| --- | --- |
| `lib/smart-mode-lifecycle.js` | 独立模式状态机、预组装同步安装接口、提交等待门、输入恢复、实例隔离和子会话初始化 |
| `lib/index.js` | 仅导出适配器工厂；`apply()` 不挂载、不启用适配器 |
| `package.json` | 将新增模块加入语法检查 |
| `test/smart-mode-lifecycle.test.mjs` | 21 项默认运行的状态机及失败路径测试 |
| `test/smart-mode-lifecycle-host.test.mjs` | 10 项显式选择已安装 Host 的离线集成测试 |

工厂默认 `enabled=false`，此时不读取 Host、策略或存储，不安装 restriction，也不注册事件。没有新增用户配置、智能模式 UI、管理工具或存储表。原有 `always/session`、手动激活、TTL、治理与 Workspace 控制器保持原实现。

启用测试适配器需显式声明已核验的 `SMART_MODE_HOST_CONTRACT`，并注入全部可信接口。该声明不代表自动检测任意 Host 版本；换版本必须重新运行契约测试。缺少声明或接口会在注册事件前拒绝挂载。

`installMode(agent, snapshot)` 必须同步、原子地安装限制并返回自己的 disposer；失败不能留下未归属的副作用。P1-01 测试只限制合成工具。实际企查查企业组和两个管理入口的 restriction/guard 由 P1-03 实现，本任务没有替它们提供生产实现。

`classifyInput(message, agent)` 必须由可信 Host 集成证明交互来源；适配器不会凭消息文本、模型参数、`role=user` 或单独 `source.kind=user` 判断用户身份。集成测试用进程内消息 ID 白名单模拟已核验来源；实际 RPC 来源绑定留待集成任务完成。`selectDefault(agent)` 同步选择已有可信策略，适配器本身不创建默认策略。

## 生命周期与失败规则

| 场景 | 决策与限制 |
| --- | --- |
| 新根会话或历史空白根会话复用 | 不按时间或 ID 判断新旧；检查无实质历史，在首条可信交互输入被 claimed 时锁定默认 |
| 已有有效快照 | 优先恢复快照，并为当前 Agent 实例重新安装限制；不重新应用后来改变的默认值 |
| 有用户、助手或业务调用历史，且没有快照 | 保持兼容模式 |
| 后台输入或来源不明 | 保持兼容模式，不自动选择智能模式 |
| `clear/compact` 且有快照 | 保留原模式并安装当前实例限制 |
| `clear/compact` 或未知创建来源，且无快照 | 保持兼容模式 |
| fork/subagent | 读取父模式，写入子会话自己的快照，显式安装子 Agent 限制；不复制父准备集；父模式未确定则拒绝创建 |
| 同 SessionId 的恢复实例 | 按实例保存内存状态；在读取模式前等待前一个实例尚未完成的快照写入 |
| 插件重挂载 | 只允许在现有 Agent 均空闲、旧写入已结束时进行；挂载完成前，调用者必须保持输入暂停 |
| Agent disposed / 会话归档 | disposed 只清理实例内存及本层限制；归档不删除模式快照；本任务无持久删除接口 |
| 快照读取失败、损坏或版本未知 | 拒绝初始化，不静默转成全量兼容模式 |

Host `agent/created` 的异步初始化会被等待。旧空白会话的首条输入走以下顺序：

1. 同步 `agent/inbox/claimed`：选择一次模式并安装限制。
2. Host `tools.resolve` 与 Prompt assembly：使用已安装的限制。
3. `agent/pre-step`：等待快照写入完成；仅在状态已提交且就绪时放行。
4. Host 发起模型请求。

重复通知与并发入队不会重新选择模式或重复写入快照。`status().committed` 只在写入成功后为真。

写失败时保持限制，拒绝该步，把已 claimed 输入按原队列和顺序放回 Host 的持久 inbox，不自动唤醒重试。`retry(agent)` 只对空闲 Agent 重试同一快照，不能改用新的默认策略，也不会追加消息；后续 Host 唤醒可继续消费原输入。测试验证原输入只进入模型历史一次。

Prompt 组装在等待门前失败时也恢复输入。真实 Host 禁止在 `session/event` 回调内重入写日志，因此此恢复延后到当前发布结束的微任务。适配器不改写其他 Host 中间件的正常拒绝语义。用户取消可中断等待门，迟到的写入完成不会重新唤醒已取消的请求。

这些是进程内和 Host inbox 契约。模式文件的崩溃一致性、跨进程写竞争、磁盘错误恢复，以及快照与 inbox 之间的崩溃窗口必须由 P1-02/P1-07 继续验收；P1-01 不声称已解决磁盘事务。

## 验证结果与复现

验证使用 Node 22.22.1、当前已安装的 Host 0.2.2-rc.1 运行库。真实 Host 测试只加载运行库，另建内存 Context、SessionStore、AgentLoop、工具注册表和离线 LLM adapter；不加载 DSH profile loader，不读取生产会话，不调用 MCP Client 或远端模型。

| 检查 | 结果 |
| --- | --- |
| P1-01 状态机与实际 Host 生命周期 | 31/31 通过，未跳过 |
| 加上已有工具名称、可见性、治理、Workspace 和 session 注入回归 | 59/59 通过，未跳过 |
| `npm run check`（显式选择 Host） | 通过；完整测试 666 通过、0 失败、5 跳过，另含语法、文档、元数据、打包及本地链接检查 |
| 当前 DSH 配置核对 | `cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-lock.yaml` 的 SHA-256 与阶段0记录一致 |

普通 `npm test` 在没有显式 Host 路径时跳过 Host 集成项，因此不能单凭普通测试通过就声称已核验 Host。Windows PowerShell 的显式复现方式：

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<已安装 DSH profile 的 package.json 绝对路径>'
node --test test/smart-mode-lifecycle.test.mjs test/smart-mode-lifecycle-host.test.mjs test/host-tool-names.test.mjs test/visibility-host.test.mjs test/session-injection.test.mjs test/governance.test.mjs test/connection-scopes.test.mjs
npm run check
```

完整检查的 5 项跳过是既有环境门：Windows 不区分大小写的代理环境变量用例、另行选择的隔离 Web E2E，以及 3 项需要单独 MCP SDK fixture 的 stdio 验证；新增生命周期测试没有跳过。打包白名单检查通过，共 126 个发布文件；本交付说明与测试夹具不进入 npm 包。

`clear/compact` 的模式决策已通过事件载荷契约测试，本次没有操作生产 UI 执行真实清空或压缩，也没有验证其全部 UI/持久化流程；完整集成验收留在 P1-07。PTC、审批 UI、真实模型收益及企查查业务等价不属于本次通过项。

完整检查首次在受限沙箱中无法访问既有测试的临时本地 HTTP 服务；按权限流程在沙箱外重跑后通过。测试使用合成数据，未调用企查查业务工具。仓库内不保存真实请求、Header、账号引用、Token 或客户会话样本。

## P1-02 准入结论

可以继续独立存储与模式事务开发，P1-01 已提供稳定的生命周期接口与失败路径契约。P1-02 仍需实现并验收：

1. 新 profile 存储域，按 profile + SessionId 唯一保存版本化快照及账号组策略；不写原连接、OAuth、治理或当前 profile。
2. `readSnapshot/writeSnapshot` 的真实磁盘实现、幂等提交、revision/并发冲突与跨进程写入约束；以临时目录验证关闭、重建和故障恢复。
3. 损坏、未知版本、部分写入及权限错误保持阻断；失败不把未提交模式报告成功，不自动放开全量工具。
4. 归档保留、disposed 不删，永久删除只接可靠 Host 删除证据；准备集继续只放在当前 Agent 内存。
5. 增加隔离的真实磁盘恢复及快照/inbox 故障用例，再讨论后续限制层接入。

本结论只允许推进开发，不构成生产智能模式启用、配置迁移、业务 canary 或发布的批准。P1-02 本次尚未实施。
