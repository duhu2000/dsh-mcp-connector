# MCP 连接的 project/global 作用域

本说明定义 MCP连接器的 Workspace 项目范围、profile 全局范围、Host 强制执行边界，以及复制、移动和回滚的安全语义。

## 1. 两级范围与继承

- **项目（project/workspace）**：绑定 DSH 的稳定 `workspaceId`，只向该 Workspace 内的 Agent 展示并允许执行。
- **全局（profile/global）**：在当前 DSH profile 的所有 Workspace 中可见。这不是操作系统级全局，也不会跨 profile 共享。

全局连接由所有 Workspace 继承。项目连接可绑定一个或多个 Workspace；同一连接也可保留项目绑定同时提升为全局。

## 2. 新建连接

Desktop 和 Web 使用同一个 Host API：

1. 市场从父级 DSH 客户端读取当前 Workspace；
2. OAuth、免密、Bearer/API Key、JSON 导入和 URL 安装都会在提交前显示目标范围；
3. 已选择 Workspace 时页面默认为“当前项目”，也可显式选择“所有项目（全局）”；
4. 项目范围只在 Host 支持最终执行 Guard，且目标 Workspace 仍存在时才能保存。

对话工具的 `scope` 可传 `project` 或 `global`；`project` 同时要求 `workspaceId`。旧版客户端未传作用域时，新连接按兼容规则归为当前 profile 全局。

## 3. Host 强制执行

项目隔离不是页面过滤：

- 插件使用 Workspace Registry 将 Agent 的 session/cwd 解析为稳定 `workspaceId`；
- 通过每 Agent `tools.restrict()` 从 schema、lookup 和 dispatch 中隐藏其他项目的工具；
- 通过全局 `tools.guard()` 在正式执行边界再次检查；
- 没有 Agent 上下文的 project-only 工具调用会 fail closed；
- 工具注册变化或作用域提交后，存活 Agent 的 restriction 会重新同步。

连接、Server、Tool 三层 allow/deny 治理与作用域同时生效：只有当前 Workspace 可见且治理规则允许的工具才能执行。

## 4. 复制、移动、预览与回滚

“已安装”页的“范围”操作提供两种变更：

- `copy`：增加目标绑定，保留现有范围；
- `move`：用一个目标替换现有范围。

每次变更都先返回受影响的连接、Server 和已观察/快照工具，只读预览不写入存储。用户确认后使用预览返回的 `baseRevision` 提交；并发变更会被拒绝并要求重新预览。

作用域文档保留最近 20 个历史 revision。回滚恢复整份作用域文档，并产生新 revision；不修改连接配置或服务端授权。

## 5. 凭据、冲突与失败边界

- 作用域文档只保存 connection key、全局布尔值、Workspace id 和 revision 历史；不保存 URL、Header、Token、API Key、OAuth Grant、stdio 参数或本地路径。
- `copy`/`move` 只改变绑定，连接和凭据仍只存储一份；重新授权或重新配置在没有显式新范围时保留原绑定。
- 不同连接试图管理同一 `serverName` 时直接拒绝，不会用新凭据或新范围静默覆盖旧连接。
- 新连接提交时先持久化作用域，再使连接对 Host 可见；后续持久化或 Host 启动失败时作用域自动回滚。
- 断开后可保留不含凭据的孤立绑定，用于本机快照恢复；同 key 新建连接会按新选择重置范围。
- Workspace 被删除后，指向它的 project-only 连接不会泄漏到其他项目；可在已安装页把它移动到当前项目或全局。
- 仅“从未存在作用域文档/绑定”按旧版全局连接兼容；已存在文档读取失败或绑定损坏时插件 fail closed，不会把项目连接降级为全局。

## 6. 对话工具

`mcp_connector_scope` 支持：

- `action=context`：读取 Workspace、Host 能力和 revision；
- `action=preview`：预览 `copy`/`move` 及 Server/工具影响；
- `action=apply`：带 `expectedRevision` 提交；
- `action=preview-rollback`：预览恢复历史 revision 将影响的 Server/工具；
- `action=rollback`：使用预览时的 `expectedRevision` 恢复指定 `rollbackRevision`。

页面和对话工具调用同一 API 门面与 Host 控制器，Desktop 与 `dsh web` 没有另外的前端作用域实现。
