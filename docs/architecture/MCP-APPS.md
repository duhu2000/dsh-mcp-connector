# DSH-MCP-APPS-001：通用 MCP Apps 接入决策

状态：开发中，未启用、未发布；2026-11-25。

## 已核验基线

- 起点 origin/main ebb3990，插件 0.2.120。独立分支 feat/mcp-apps-host。
- 本机 DSH 0.1.2-rc.1 的原生 MCP Client 初始化没有 UI 扩展能力，工具注册不传递 `_meta.ui`，工具结果没有 UI `_meta`。
- 公开接口 `output.presentationMeta`、`tool.call.toolview` 和 `connection.rpc` 可作为集成入口；已有本地实验，不代表本任务验收完成。
- 在途 PR #264 修改资源读取、#287 修改带凭据请求安全、#291 整理文档；本任务不覆盖它们。

## 决策

1. 在连接器内实现通用 Host 模块及独立编译的 AppBridge Renderer，使用官方 SDK；不修改安装目录，不读取会话数据库。
2. 每条连接仅有一个工具注册方。启用 Apps 的连接由自有适配器负责连接和注册，不能与原生 Client 同时注册同一命名空间。未启用仍使用原路径。OAuth 及刷新仍由原 ConnectionStore/GrantStore 驱动。
3. 工具元数据用于识别资源和 model/app visibility；不硬编码充值工具作为渲染条件。普通工具继续原展示。
4. UI 完整结果与 `_meta` 只保存在 Host 有界短期内存中。持久化展示信息只含随机视图句柄和会话/调用绑定，不含 UI 内容、凭据或交易会话。重启后旧卡片失效并要求重新打开，绝不重放原调用。
5. 每次 App 回调重新校验连接代次、账号、会话、调用、工具 visibility、当前治理策略和参数。使用原客户端，不让 App 指定 URL、服务或凭据。模型回合结束不撤销仍有效的视图。
6. 默认禁止外部网络与额外浏览器权限；资源 CSP 声明不能扩大 Host 允许域。使用 sandbox allow-scripts，不加 allow-same-origin。写回调必须经过 Host 用户确认及串行防重；HTTP 重试不自动重放 tools/call。
7. 上线门槛：真实 DSH 对话证据、两个通用 fixture、企查查只读资源检查、模拟充值状态机及四智能体回归。不得先发布“支持”再补验收。

## 待验收矩阵

| 环境 | 状态 |
| --- | --- |
| DSH 0.1.2-rc.1 | API 已审查，通用集成待实测 |
| DSH 0.2.2-rc.5（npm latest） | 已核对版本，待隔离安装验证 |
| QCC production resource | 上游任务书已记录只读成功，本分支待复核 |
| 模拟充值/普通第二卡片 | 待集成 |

参考：https://modelcontextprotocol.io/extensions/apps/overview ，https://github.com/modelcontextprotocol/ext-apps 。

## 2026-11-25 开发记录

已实现协议策略、内存视图与单注册方适配器，8 项 Node 测试通过。
这些模块尚未接入生产 provision 路径，因此当前发布版本仍不具备本任务的通用 Apps 能力。

下一步必须完成：

- 原连接生命周期接入、治理与 Workspace 范围检查，禁止创建第二套 OAuth grant。
- 官方 AppBridge Renderer、公开 RPC 与真实会话身份关联、Host 侧用户确认。
- 两种 fixture 在真实 DSH 对话中展示与模型回合结束后的回调。
- QCC 原资源及模拟交易测试、两宿主版本/四智能体共存回归。
- 通过后再进入 release/tag/npm；当前不 bump version。
