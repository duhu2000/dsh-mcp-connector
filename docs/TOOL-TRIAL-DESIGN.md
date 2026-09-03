# MCP 工具试运行：官方 API 证据与安全设计

> 状态：**design blocked**  
> 复核日期：2026-09-03  
> 适用于：`dsh-mcp-connector` 详情页的交互式工具试运行，不影响模型在 DSH Agent turn 内的正常 MCP 工具调用。

本文只使用 DeepSeek Harness（DSH）官方公开的 ToolRuntime、审批、超时、Session 和 MCP Client 契约。当前结论是：DSH 已提供正式的工具执行管线，但仍缺少“从连接器详情页发起、又能进入现有 Agent turn 审批/审计链”的公开编排入口；同时官方 MCP bridge 没有把 MCP Tool annotations 传递给 ToolRuntime。在两个缺口补齐前，不实现直接试运行按钮。

## 1. 版本矩阵

| DSH 标签 | `ToolRuntime.execute()` | `allow / deny / ask` 与 Guard | 一次性审批与审计 | 取消/超时 | MCP annotations 进入 ToolRuntime | 详情页直接试运行 |
|---|---|---|---|---|---|---|
| `dsh-v0.1.1-rc.2` | 有 | 有 | 有，但仅限 open turn | 有，协作式 | 无 | 阻断 |
| `dsh-v0.1.2-alpha.1` | 有 | 有 | 有，但仅限 open turn | 有，协作式 | 无 | 阻断 |
| `dsh-v0.1.2-alpha.5` | 有 | 有 | 有，但仅限 open turn | 有，协作式 | 无 | 阻断 |

固定版本证据：

- [`ToolRuntime` 执行、策略、取消和结果事件（rc.2）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/core/tools/src/index.ts)
- [`ToolRuntime` 对应契约（alpha.1）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/core/tools/src/index.ts)
- [`ToolRuntime` 对应契约（alpha.5）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.5/packages/core/tools/src/index.ts)
- [审批服务与 open-turn 限制（alpha.5）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.5/packages/interaction/user-approval/README.md)
- [MCP Tool bridge（alpha.5）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.5/packages/mcp/mcp-client/src/tools.ts)
- [工具超时策略（alpha.5）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.5/packages/guard/timeout-policy/src/index.ts)

## 2. 已确认的官方能力

### 2.1 正式执行边界

`ctx.tools.execute()` 是公开的同进程执行入口，输入包含 `callId`、工具名、参数、可选 Agent 和必填 `AbortSignal`。它会经过同一条官方管线：

1. `tools/pre-execute`：返回 `allow`、`deny` 或 `ask`；
2. `tools.guard()`：单调拒绝，不能被后续监听器重新放行；
3. `tools/execute`：包装超时、重试或指标；
4. 工具 body；
5. `tools/post-execute`：接受、替换或拦截结果；
6. `tools/result`：观察已冻结的最终结果。

因此，未来试运行只能进入 `ctx.tools.execute()` 或 Host 在其上提供的更高层公开 API；不得直接向 MCP Server 发 `tools/call`，也不得重写官方 transport。

### 2.2 审批与审计

`tools/pre-execute` 的 `ask` 会交给 `ctx.approval.request()`。审批结果为 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`，缺少审批通道时 fail closed。每次请求在 Agent Session 中成对记录 `approval/asked` 和 `approval/decided`。

这条官方审批链的硬性前提是：必须携带 Agent，且该 Agent Session 当前处于已打开但尚未结束的 turn。没有 Agent 的 `ask` 会被拒绝；从详情页闲置时刻直接调用 `approval.request()` 会在写审计日志前抛错。

`tools/pre-execute` 的默认终点是 `allow`，是否进入 `ask` 取决于 Host 已组合的监听器和 Guard。当前官方 MCP Client 没有注册 MCP 专用的读写风险分类或审批策略；在 annotations 又未被桥接的情况下，插件不能把“经过 ToolRuntime”误当成“已经完成权限判定”。

### 2.3 取消、超时和结果

- 调用方必须提供 `AbortSignal`；执行前取消返回 `ABORTED_BEFORE_DISPATCH`，body 已开始后取消返回 `ABORTED`。
- 取消是协作式的：Host 不会丢弃已开始的 Promise，工具必须转发并遵守 `exec.signal`。
- 当 `ToolDefinition.timeoutMs` 存在时，Host 超时策略通过 `tools/execute` 包装器融合 signal，结果码为 `TOOL_TIMEOUT`；当前官方 MCP bridge 并未为映射后的 Tool definition 设置该字段。
- 官方 MCP Client 另行把 `exec.signal` 传给 MCP SDK，并为每次 `tools/call` 使用连接配置的请求超时（默认 60 秒）。这属于 MCP 请求层超时，不能等同于 Host 的 `TOOL_TIMEOUT` 策略结果。
- `ctx.tools.execute()` 返回一个最终 `ToolExecutionResult` Promise；`tools/result` 也是最终结果事件。当前没有面向详情页直接调用的逐块工具结果流契约。

## 3. 为什么仍然阻断实现

### 3.1 缺少“用户从页面发起工具调用”的 Host 编排 API

连接器详情页通过插件的 Client→Host JSON 方法调用后端，并不天然处在任何 Agent turn 内。插件若自行伪造 `turn/start`、直接写 Session event，或调用 Host API Proxy 的私有实现，都会绕开 Host 拥有的提交、回放、取消和审批不变式。

目前安全的替代是现有“去试试”：把用户选择的 Prompt 写入新会话草稿，由 Agent 在正常 turn 内决定工具调用。这不是工具参数级的直接试运行，但完整保留 Host 执行、审批和审计链。

### 3.2 缺少可靠的副作用分类输入

MCP SDK 的 Tool 定义可包含 `readOnlyHint`、`destructiveHint`、`idempotentHint` 和 `openWorldHint`，但官方 `@deepseek-ai/dsh-mcp-client` 当前只把 name、description、input/output schema 和 task-support 映射成 ToolRuntime definition，没有传递 annotations。

即使未来传递，Server 提供的 hint 也只能是展示和默认策略信号，不能作为跳过审批的信任边界。未知或缺失 annotations 的工具必须按可有副作用处理。

### 3.3 审批请求本身不携带参数

官方审批请求只携带 Agent、工具名、可选 call id、reason 和 signal。参数依赖 call id 关联已在 Session 中展示的 tool call。这再次意味着审批不能独立于正常 turn 和工具调用展示流程之外安全复用。

## 4. 解除阻断的官方契约

只有 DSH 官方公开契约同时满足下列条件时，才进入实现：

1. **用户发起的 tool turn**：由 Host 创建或绑定 Agent/Session/open turn，分配 call id，并负责提交或回滚。
2. **完整执行管线**：该入口明确经过 `pre-execute`、Guard、approval、around/post hooks 和 `tools/result`，不存在快捷旁路。
3. **审批展示与审计**：用户能看到工具名和本次参数；`approval/asked` / `approval/decided` 与 call id 持久关联。
4. **取消与超时**：Client 能取消一个指定 call，Host 转发 signal，并暴露稳定的 abort/timeout 结果码。
5. **结果传输**：至少有 pending、approval-pending、completed/failed/cancelled 状态；若宣称流式，必须有官方逐块结果或 progress 契约。
6. **MCP 安全元数据**：官方 bridge 传递 Tool annotations 或提供等价查询 API；缺失时 fail closed 为需要审批。
7. **Desktop/Web 一致**：两个 profile 使用同一 Host 契约与错误码，只允许展示层差异。

## 5. 解除阻断后的目标架构

```text
详情页参数表单
  → 插件 Host API（只校验连接、治理策略、schema 和参数）
  → DSH 官方“user tool turn”编排入口
  → ToolRuntime.execute
  → pre-execute / governance guard / approval / timeout / post-execute
  → DSH Session 事件与审计日志
  → Client 按 call id 展示状态并提供取消
```

插件只负责：

- 展示官方 Tool schema 并完成参数表单校验；
- 确认目标工具已被 Host 观察、当前连接可用且治理策略允许；
- 调用 Host 官方编排入口，展示 Host 返回的结果和稳定错误码；
- 对页面输入、输出和日志中的凭据/敏感值做现有脱敏处理。

插件不负责：创建私有 Session 事件、代替 Host 做审批、绕过治理 Guard、伪造 Agent，或直接调用 MCP transport。

## 6. 后续实现的必备测试

| 类别 | 必备场景 |
|---|---|
| 读取工具 | 成功、参数校验失败、Server 错误、连接中断 |
| 副作用工具 | 允许一次、明确拒绝、审批通道缺失、审批期间取消 |
| 治理 | Connection/Server/Tool deny 都在 Host Guard 阶段拒绝，页面不得越权 |
| 取消 | dispatch 前取消、body 后取消、工具不遵守 signal 时仍等待收敛 |
| 超时 | Host 策略超时、MCP 请求超时、外层取消早于超时 |
| 动态工具 | 试运行前删除/重命名、Server 重连后 schema 变更 |
| 审计 | asked/decided 成对、call id 一致、结果回放、凭据不进入日志 |
| 客户端 | Desktop 与 web profile 同一状态机，重连后恢复 pending/approval 状态 |

## 7. 结论

DSH 官方执行管线已足以证明“不需要、也不应该重写 MCP 执行”。但直接工具试运行所需的 out-of-turn 用户编排、参数可见的审批关联、MCP 副作用元数据和面向 Client 的结果状态契约尚未同时具备。

因此，在本文第 4 节门槛满足前，保留现有“去试试”会话入口，不增加直接试运行按钮。
