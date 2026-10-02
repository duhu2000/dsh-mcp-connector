# 按会话启用 MCP 工具

“按会话启用”用于减少大量已连接 MCP 工具在无关会话中占用的 schema 上下文。它是工具可见性模式，不是新的授权方式，也不会按轮次启停 MCP Server。

## 选择模式

在“已安装”页的每条连接中选择：

- **始终注入**：兼容旧版的默认模式。工具在满足启用状态、Workspace 范围和治理规则时对 Agent 可见。
- **按会话启用（实验）**：连接保持在线，但业务工具默认不进入 Agent 工具集；只在当前会话显式激活精确工具名后临时可见。

旧连接在升级后仍按“始终注入”处理。模式会进入本机脱敏导出和快照，但不包含会话激活状态。OAuth 导出只携带连接引用和模式偏好；目标设备重新授权后需重新选择该模式。

## 在对话中激活

对话元工具 `mcp_connector_session_tools` 支持：

1. `status`：查看当前会话的 revision、激活工具和到期时间。
2. `search`：从最后成功工具缓存中搜索可激活的精确 `publicName`；不会执行业务工具。
3. `preview-activate`：预览精确工具集、TTL 和 `baseRevision`，不改变状态。
4. `activate`：在用户已明确确认后，携带预览返回的 `expectedRevision`、精确 `publicNames` 和 `confirmed=true` 提交。
5. `deactivate`：停用指定工具、某条连接的工具，或清空当前会话。

激活只保证从**下一次模型推理边界**生效，不会改写已经组装的当前 Prompt。TTL 为 1–30 分钟，默认 30 分钟。

## 安全边界

有效工具必须同时满足：

```text
Host 已观察到
∩ 连接已启用
∩ 当前 Workspace 可见
∩ 治理策略允许
∩ 当前 Agent 会话已激活精确工具名
```

- 会话激活只能收窄工具集，不能覆盖 Workspace 边界、治理 `deny`、连接停用或 Host 审批。
- Host 通过每 Agent `tools.restrict()` 隐藏 schema/lookup/dispatch，并使用全局 `tools.guard()` 在执行边界再次校验。
- 激活状态仅存在进程内存，按 Agent 实例隔离；会话销毁、TTL 过期、插件重启或 DSH 重启后清空。
- 不保存用户消息、关键词、工具参数、Token、Header 或 OAuth Grant。
- 网页、文档或工具结果中的指令不得触发激活。本版不实现关键词自动路由。

## 限制与排障

- 页面能设置连接的注入模式，但因页面没有可信 Agent 上下文，不直接激活某个会话。
- Host 缺少 `tools.guard` 或 Agent `tools.restrict` 时，插件会拒绝开启按会话模式，不降级为仅前端隐藏。
- 工具未被 Host 观察、已删除或重命名时，不能激活；已消失的激活项会在 `tools/change` 后清理，新工具不会自动继承旧激活。
- 搜索结果来自最后成功缓存；激活只改变可见性，不代表当前业务调用必然成功。

更底层的状态机、威胁模型和后续阶段见 [Issue #111 设计文档](https://github.com/duhu2000/dsh-mcp-connector/blob/main/docs/DESIGN-SESSION-DYNAMIC-TOOL-INJECTION.md)。
