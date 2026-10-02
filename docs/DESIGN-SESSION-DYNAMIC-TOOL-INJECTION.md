# 会话级 MCP 工具动态注入设计

> 对应 Issue [#111](https://github.com/duhu2000/dsh-mcp-connector/issues/111)。Phase 0+1 已进入 `Unreleased`：支持连接级 `always/session` 模式、当前 Agent 精确工具激活、最长 30 分钟 TTL 及 Host restriction + guard 强制。本文同时保留后续阶段的设计边界。

## 0. 实现状态

| 范围 | 状态 |
| --- | --- |
| 旧连接默认 `always`；页面可改为 `session` | Phase 0+1 已实现 |
| `status/search/preview-activate/activate/deactivate` 元工具 | Phase 0+1 已实现 |
| 按 Agent 内存隔离、revision、TTL、销毁/重启清理 | Phase 0+1 已实现 |
| 精确 public tool name、Workspace/治理交集、Host 最终 Guard | Phase 0+1 已实现 |
| Server/整连接批量激活、`renew`、轮次预算、风险自动分级 | 后续阶段 |
| 页面内直接管理当前会话激活 | 等待可靠 Agent 上下文桥接 |
| 关键词自动路由 | 明确延后，等待正式模型组装前 Hook |

## 1. 背景与目标

当前已启用连接的 MCP 工具会按 Workspace 作用域与治理策略进入 Agent 的可见工具集合。连接较多时，即使当前会话并不需要这些能力，工具名称、说明和参数 schema 仍可能占用模型上下文。

本方案希望在不改变授权、连接生命周期和最终执行安全边界的前提下，增加“按会话注入”模式：

- 默认不向会话注入该连接的业务工具 schema；
- 用户或 Agent 明确选择能力后，只在当前会话激活精确的工具集合；
- 会话结束、过期或手动停用后恢复隐藏；
- 项目作用域、Connection/Server/Tool 治理规则与 Host 最终执行 Guard 始终有效；
- 为未来的关键词自动路由预留扩展点，但不在缺少可靠 Host Hook 时用前端事件或 DOM 扫描实现。

该需求属于 `dsh-mcp-connector` **运行时插件能力**，不是 Registry descriptor 或连接器上架能力。Registry 不应保存用户会话关键词、激活状态或凭据。

## 2. 非目标

首个版本不处理以下事项：

- 不按单条用户消息临时启动和停止 MCP Server；
- 不把浏览器页面、DOM、WebSocket 报文或客户端状态作为授权依据；
- 不允许关键词命中自动开启写入、删除、付款、发消息等高风险工具；
- 不让会话激活覆盖 Workspace 作用域或治理 deny；
- 不把会话正文、关键词命中内容、Token、Header 或 OAuth Grant 写入持久化存储；
- 不修改 Registry descriptor 格式来表达用户私有路由规则。

## 3. 设计原则

### 3.1 生命周期与可见性分离

连接的 `enabled` 状态继续控制 MCP Client 条目的真实生命周期。会话动态注入只控制模型能否看到和调用已启用连接的工具。

原因如下：

- OAuth、API Key、stdio 子进程和远程会话需要由现有 provision 流程统一维护；
- 按轮次频繁启停 Server 会增加延迟、资源抖动和授权状态竞争；
- “未注入 schema”并不等于“连接被禁用”，两者应在 UI 和 API 中明确区分。

### 3.2 Host 是唯一强制执行边界

页面可以展示激活状态，但不能决定工具权限。所有可见性收窄和最终执行检查必须发生在 DSH Host：

- 每个 Agent 使用 `agent.ctx.tools.restrict({ deny })` 收窄 schema、lookup 和 dispatch；
- 全局 `ctx.tools.guard()` 在执行边界再次校验；
- `agent/created` 在首轮 Prompt 组装前安装限制；
- `tools/change` 后按最新工具清单重算限制；
- 无法解析 Agent、Workspace 或会话状态时 fail closed。

### 3.3 只做单调收窄

会话激活不是新的 allow 覆盖层。有效可用工具必须同时满足所有既有约束：

```text
effective tools
  = observed MCP tools
  ∩ connection enabled
  ∩ workspace visible
  ∩ governance allowed
  ∩ session activated
```

任何上游层级拒绝后，会话层都不能重新允许。

## 4. 用户模式

每个连接增加不含凭据的注入模式：

| 模式 | 行为 | 兼容性 |
| --- | --- | --- |
| `always` | 沿用当前行为，符合其他规则时始终注入 | 旧连接和升级后的默认值 |
| `session` | 默认休眠，仅向已激活的会话注入 | 用户显式开启的实验模式 |

首版不提供 `keyword` 模式。后续只有在 DSH 提供可靠的服务端模型组装前 Hook 后，才考虑增加 `session-auto`。

连接已禁用、授权失效或 Server 离线时，无论模式和会话状态如何，工具都不可用。

## 5. 状态模型

### 5.1 状态机

```text
                  activate
  dormant ------------------------> active
     ^                                |
     | deactivate / expiry / dispose |
     +--------------------------------+

  always: 不进入会话状态机，继续使用现有规则
  disabled / reauth-required: 生命周期层强制不可用
```

### 5.2 内存状态

会话激活状态只保存在插件进程内存中，并以稳定 Agent 实例和 Workspace 为边界。建议结构：

```js
{
  agentId,
  workspaceId,
  revision,
  activations: [
    {
      connectionKey,
      serverName,
      publicToolNames,
      source: 'user' | 'agent-tool' | 'auto-rule',
      activatedAt,
      expiresAt,
      remainingTurns,
    },
  ],
}
```

约束：

- 不保存凭据、URL Header、会话正文或触发关键词；
- `agent/disposed` 时立即删除；
- 插件或 DSH 重启后回到 `dormant`；
- 默认 TTL 建议 30 分钟，并允许配置更短的轮次预算；
- 同一 Agent 的更新使用单调递增 `revision`，并发提交需携带 `expectedRevision`；
- 不用可复用的用户 id 代替 Agent/session key，避免跨会话继承。

## 6. Host 控制器

### 6.1 新增组件

建议新增 `SessionToolInjectionService` 与 Host 控制器：

- Service：规范化模式、管理内存状态、预览和提交激活、处理 TTL；
- Controller：读取 Host 已观察工具、计算会话 deny 集合、安装 restriction 与 guard；
- API facade：供页面和对话元工具调用同一套预览/提交接口。

### 6.2 限制集合的组合

当前 Workspace 作用域与治理分别维护 restriction。增加第三个控制器前，应优先抽取统一的 Agent deny 协调器：

```text
deny(agent)
  = scopeDenied(agent)
  ∪ governanceDenied(agent)
  ∪ sessionDormant(agent)
```

统一协调器应满足：

- 每个 Agent 只替换一份由本插件管理的 restriction；
- 比较排序后的工具名，集合没有变化时不重装；
- `schemas()` 或 `restrict()` 同步触发嵌套 `tools/change` 时防止永久重扫；
- 替换成功后再释放旧 restriction，异常时保留旧限制；
- Agent 消失时释放 restriction 和内存状态；
- Guard 动态读取最新快照，避免 restriction 切换竞态绕过执行检查。

当前 Phase 0+1 已根据安装的 DSH Host 契约确认多份 restriction 取交集，因此先采用独立会话控制器；回归测试覆盖了多 restriction 交集、替换/释放、工具漂移和 Guard fail-closed。如 Host 契约后续变更，再抽取统一 deny 协调器。

### 6.3 工具身份解析

激活请求只接受 Host 当前已观察到的精确 public tool name，并复用现有 Connection/Server 映射：

- 不根据显示名称或模糊前缀直接激活；
- 工具列表变化后重新解析，已消失名称标记为 stale 并从激活集合移除；
- 新增工具不自动继承当前会话激活，除非用户激活的是整个 Server 且预览明确列出该语义；
- Server 名称重叠时继续采用最长匹配并校验所属 Connection；
- 非 `mcp__` 工具不进入该控制器。

## 7. MVP 交互与 API

### 7.1 对话元工具

新增 `mcp_connector_session_tools`，它自身始终可见，但只能管理 MCP 工具的会话可见性，不能调用业务工具。建议 action：

- `status`：当前会话模式、激活项、过期时间和 Host 能力；
- `search`：在缓存的工具目录中按连接器、Server、工具名和描述检索；
- `preview-activate`：解析精确名称，返回将新增的 schema、风险等级与 revision；
- `activate`：携带 `expectedRevision` 提交；
- `deactivate`：停用指定项或清空当前会话；
- `renew`：在策略允许范围内延长 TTL（后续阶段，Phase 0+1 需重新预览并激活）。

`activate` 完成后只保证**下一次模型推理边界**使用新 schema，不声称能修改已经组装完成的当前 Prompt。

### 7.2 页面

“已安装”连接设置增加：

- 工具注入：`始终注入` / `按会话启用（实验）`；
- 简短说明：按会话模式不会断开连接，只减少默认工具 schema；
- 当前页面能确定 Agent 上下文时显示“本会话已启用 N 个工具”（后续阶段）；
- “查看”“清除本会话工具”和过期时间（后续阶段）；
- 页面获得可信 Agent 桥接后，提交同样走 preview + `expectedRevision`，不直接修改前端本地状态后冒充成功。

### 7.3 风险分级

MVP 不依赖 descriptor 新字段。可先按以下保守规则决定激活确认：

- 用户在页面或对话中明确指定精确工具：允许预览后激活；
- Agent 根据 `search` 主动申请只读工具：可以按现有 Host 审批链激活；
- 无法判定是否只读：按高风险处理；
- 写入、删除、付款、外发消息、权限管理工具：需要用户显式确认，不能由关键词规则自动激活。

风险标注后续可由本地治理策略补充，但 Registry 提交的自声明不能单独成为放宽依据。

## 8. 关键词自动路由（第二阶段）

### 8.1 前置依赖

截至本方案所依据的当前插件注入服务，仓库只使用了 `agent/created`、`agent/disposed` 和 `tools/change` 等生命周期，没有发现可在服务端、模型工具 schema 组装前读取“本轮最新用户消息”的正式 Hook。

因此自动关键词路由必须等待 DSH 提供并文档化类似能力：

```text
before-model-context / before-prompt-assembly
  input: agent, workspace, current user turn
  output: 本轮稳定且在推理开始前完成的 restriction decision
```

没有该契约时，不使用以下替代方案：

- 浏览器 DOM/输入框监听；
- 客户端拦截或重放消息；
- 延迟到模型已开始推理后再修改 restriction；
- 通过日志、历史文件或非公开内部字段猜测本轮消息。

### 8.2 规则语义

未来规则应是用户本地配置，不进入 Registry：

```js
{
  connectionKey,
  match: {
    keywords: ['查企业', '工商信息'],
    mode: 'token',
    caseSensitive: false,
  },
  activate: { serverNames: ['qcc'], toolNames: [] },
  duration: { turns: 1 },
}
```

匹配需要 Unicode 归一化、边界控制和确定性优先级。每轮生成不可变 decision snapshot；并发轮次不得互相复用临时激活。

自动规则只可激活已标记为低风险只读的工具。其他工具只能返回建议，由用户确认后进入显式激活流程。

## 9. 安全与隐私分析

必须覆盖以下威胁：

1. **提示词注入**：网页或文档内容包含触发词，不得被当作用户授权；首版无自动关键词模式。
2. **误命中**：短字符串、品牌同名、Unicode 变体和子串匹配导致错误激活。
3. **跨会话泄漏**：同一用户的两个 Agent 不得共享激活状态。
4. **跨 Workspace 泄漏**：全局连接的会话激活也不能让项目连接越界。
5. **治理绕过**：会话 allow 永远不能覆盖 Connection/Server/Tool deny。
6. **执行竞态**：restriction 更新前后，Guard 仍按最新状态拒绝休眠或过期工具。
7. **工具漂移**：Server 重连、重命名或注册新工具时不能扩大既有激活范围。
8. **高风险副作用**：写操作不能由未确认规则开启。
9. **状态恢复**：崩溃或重启不得静默恢复临时授权。
10. **信息泄露**：审计只记录连接 key、工具 public name、来源、时间和结果，不记录消息正文或凭据。

## 10. 可观测性

本地日志与诊断接口可记录：

- 激活/停用/过期次数；
- 当前 Agent 被会话层隐藏和启用的工具数量；
- 决策来源（用户、Agent 元工具、未来自动规则）；
- 拒绝原因（休眠、过期、Workspace 不可见、治理拒绝）；
- restriction 同步耗时与失败次数。

默认不上传遥测。若未来增加匿名产品统计，必须单独说明、默认关闭且不包含用户消息、关键词和工具参数。

## 11. 测试与验收

### 11.1 单元测试

- `always` 保持升级前行为；
- `session` 在无激活时隐藏该连接全部业务工具；
- preview 不写状态，revision 冲突拒绝提交；
- 精确工具、Server 和连接级激活集合计算正确；
- TTL、轮次预算、手动停用与 `agent/disposed` 清理；
- 重启后状态为 dormant；
- `tools/change` 后移除 stale 工具，新增工具不被意外激活；
- Unicode/长 Server 名称和 public name 映射稳定；
- scope deny、governance deny、session deny 的并集不受安装顺序影响；
- restriction 更新竞态下 Guard fail closed；
- 不存在 Agent 上下文的 session-only 工具调用被拒绝。

### 11.2 集成测试

- 两个并行会话只在其中一个激活，另一会话 schema 不变化；
- 两个 Workspace 使用同一全局连接时，激活状态互不继承；
- project-only 连接不能在其他 Workspace 激活；
- 已禁用、需重新授权或离线连接不能通过会话激活恢复；
- 激活后下一轮可发现并调用工具，过期后不可查找且不可 dispatch；
- 写工具在没有用户确认时不能由 Agent 自行激活；
- Desktop 与 `dsh web` 调用同一 Host API，结果一致。

### 11.3 产品验收指标

- 对配置为 `session` 的连接，休眠会话中对应工具 schema 数量为 0；
- 记录基准会话中 Prompt 工具 schema 的 Token/字节下降比例；
- 激活不重新发起 OAuth，不复制凭据，不修改连接作用域；
- 激活过程本身不调用业务 MCP 工具；
- 典型本地激活到下一推理可见的额外延迟目标小于 100 ms（不含 Server 自身重连）；
- 所有失败均显示真实状态，不把仅前端隐藏报告为安全禁用。

## 12. 分阶段实施

### Phase 0：Host 契约验证

- 为现有 restriction 叠加/释放语义补契约测试；
- 决定统一 deny 协调器还是经过证明的多 restriction 组合；
- 确认 Agent 稳定 id、首轮时序和下一轮 schema 刷新边界。

### Phase 1：显式按会话激活（建议首发）

- 增加 `always` / `session` 模式；
- 实现内存状态、Host restriction/guard 与 TTL；
- 实现对话元工具和页面状态；
- 默认关闭，仅对主动选择的连接生效。

### Phase 2：搜索与最小集合激活

- 利用缓存的工具目录进行检索和预览；
- 支持只激活一个 Tool 或一个 Server；
- 增加上下文节省统计和本地审计。

### Phase 3：自动路由（条件性）

- 仅在 DSH 提供正式服务端 pre-inference Hook 后启动；
- 先支持单轮、低风险只读工具；
- 完成提示词注入、并发轮次与高风险审批安全评审后再扩大范围。

## 13. 待确认事项

1. DSH 是否会提供服务端“本轮用户消息已确定、模型上下文尚未组装”的公开 Hook？
2. `ToolRuntime.restrict()` 多实例是否有稳定的交集及释放顺序契约？
3. Host 是否提供精确的 Prompt schema 字节或 Token 统计，还是需要本地估算？
4. Agent 的 turn 边界事件能否用于准确扣减 `remainingTurns`？
5. 高风险工具未来由 Host 审批元数据、本地治理规则还是官方 Registry 签名信息标注？

在第 1 项没有答案前，Issue #111 可以先实施 Phase 0～2，但“根据会话关键词自动注入”应保持阻塞，不能用前端扫描绕过 Host 边界。
