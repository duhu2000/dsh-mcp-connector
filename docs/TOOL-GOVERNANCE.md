# MCP 连接、Server 与 Tool 治理

本说明描述 MCP连接器的三层治理模型、DSH Host 强制执行边界、预览/回滚流程，以及工具增删时的安全语义。

## 1. 策略层级与优先级

策略作用于当前 DSH profile，默认允许。存在多层显式规则时，越具体的规则优先：

1. Tool：一个 MCP Server 下的单个工具；
2. Server：一个连接器下的单个 `serverName`；
3. Connection：同一 `connectorId` 的全部 Server；
4. 默认允许。

例如，Connection 设置为拒绝、某个 Server 设置为允许、该 Server 下一个写入 Tool 再设置为拒绝，最终只有这个 Tool 被拒绝，Server 的其他 Tool 仍允许。

“已安装”页的启停是连接生命周期控制，会让对应 Server 的官方 MCP Client 条目下线。生命周期停用高于所有治理 allow，不能用 Tool/Server allow 重新启用一个已停用连接。

## 2. Host 强制执行

治理不是前端隐藏：

- 插件通过 DSH 官方 `ToolRuntime.restrict()`，为每个 Agent 收窄模型可见 schema、工具查找与 dispatch；
- 插件同时通过官方 `ToolRuntime.guard()` 安装全局、单调拒绝的最终执行 Guard；
- `agent/created` 保证新 Agent 在首轮 Prompt 组装前得到 restriction；
- `tools/change` 在 MCP Server 新增、删除或重新注册工具时同步更新所有存活 Agent；
- Guard 动态读取当前规则，因此即使可见性同步发生竞争，拒绝规则仍不能被调用绕过。

如果 Host 没有 `tools.guard`，插件会拒绝保存新的 deny 规则，不会把只能隐藏页面、无法阻止执行的状态报告为“已禁用”。

## 3. 预览、提交与回滚

页面每次修改 Connection、Server 或 Tool 策略时，先调用只读预览：

- 返回当前 `baseRevision`；
- 统计 Host 已观察工具中将新增拒绝、恢复允许和总变化数量；
- 用户确认后才用同一 revision 提交；
- 如果期间策略已经变化，提交失败并要求重新预览。

每次有效提交都会保存上一 revision 的规则快照，最多保留 20 份。页面“撤销最近变更”或 `mcp_connector_policy` 的 `rollback` 操作可以恢复历史内容；回滚本身生成一个新的 revision，不改写历史。

## 4. 工具增删、重命名与未知状态

Tool 规则同时保存 MCP 原始工具名和 Host 实际注册的 public name。复杂名称按官方 MCP Client 的公开命名契约规范化并加 SHA-256 短哈希，避免从截断后的名称反推原名。

- 新增工具：自动继承其 Server/Connection 规则，并在注册事件内同步到 Agent restriction；
- 删除或重命名：旧规则只会匹配旧 public name，不会误伤新工具；成功观察到最新清单后标记为 `stale`；
- Server 暂时离线或 Host 未提供工具清单：规则标记为 `unobserved`，而不是误报“已禁用”或“健康”；
- 目标连接已经删除：规则标记为 `orphaned`，不会匹配后来由其他连接器创建的同名 Server。

## 5. 页面与对话工具

连接器详情的“工具详情”区域提供：

- Connection 策略：一次覆盖该连接器的全部 Server；
- Server 策略：覆盖单个 Server；
- Tool 策略：覆盖单个 Tool；
- 每个已观察 Tool 的最终状态、策略来源和继承关系；
- revision 与最近一次策略回滚入口。

对话中使用 `mcp_connector_policy`：

- `action=list`：列出规则、状态、Host 能力和历史 revision；
- `action=preview`：只读预览；
- `action=apply`：带 `expectedRevision` 提交；
- `action=rollback`：恢复指定 `rollbackRevision`。

正式 MCP 工具执行仍由 DSH Host 与官方 MCP Client 负责；本插件不从浏览器直接调用 MCP 工具，也不绕过 Host 的权限或审批链。
