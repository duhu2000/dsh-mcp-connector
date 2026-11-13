# QMCP-4963 · P1-02 独立存储与模式事务

> 历史阶段记录 / Historical evidence. 当前 PR 完成范围与剩余验收统一见 [PR 审阅入口](SMART-MODE-PR-REVIEW.md)。

2026-11-12，Asia/Shanghai。分支：`codex/qmcp-4963-p1-02-storage`，基于 P1-01 提交 `2bc8a29`。

P1-02 实现独立磁盘存储、会话首次锁定事务、账号组默认策略的 revision 条件更新，以及隔离恢复验证。生产插件仍不打开此存储、不挂载智能生命周期适配器，不迁移当前 DSH 数据。

English: This change adds explicit-profile disk storage with immutable session snapshots, compare-and-set default policies, crash recovery and offline Host integration tests. Production initialization remains unchanged. No Qichacha or real model calls are made.

## 实现与数据边界

| 文件 | 变化 |
| --- | --- |
| `lib/smart-mode-schema.js` | 共享快照版本与校验；严格默认策略 schema；只允许必要模式元数据 |
| `lib/smart-mode-store.js` | 独立 profile 存储、首次锁定、幂等与冲突、默认策略 revision、永久删除及关闭等待 |
| `lib/smart-mode-lifecycle.js` | 使用共享快照校验，保留 `policyRevision` 以核对自动选择；生命周期等待门保持原路径 |
| `lib/index.js` | 仅导出存储类；`apply()` 不打开或挂载它 |
| `test/smart-mode-store.test.mjs` | 真实临时磁盘、跨进程争写、故障注入、终止进程和恢复用例 |
| `test/smart-mode-lifecycle-host.test.mjs` | 增加磁盘写失败、Context 重建、准备集隔离、过期策略与快照冲突的 Host 验证 |
| `scripts/fixtures/smart-mode-store-worker.mjs` | 只使用父测试指定临时目录的离线子进程夹具，不进入 npm 包 |
| `package.json` | 新模块加入语法检查 |

打开存储必须传入绝对 `profileDir`。没有 `DSH_HOME`、当前目录或生产 profile 的默认回退，也没有新增配置项、存储迁移、工具入口和用户操作。

独立命名空间为 `<profileDir>/storages/mcp_connector_smart_v1`，包含 `domain.json`、`sessions`、`defaults` 和 `deleted`。会话键及账号组目录使用 SHA-256 名称；不同 profile 物理隔离，不同 grant/账号与组分别保存默认策略。同一 profile 的同一 SessionId 只能锁定一份快照，不能通过另一账号写入来合并或替换。

此处采用独立原子记录协议，没有把新数据交给 Host JSON 的整文件内存表，也没有改原存储 backend。原因是现有 Host domain 的写队列只覆盖本进程，不能提供跨进程条件写入。接口仍为版本化 zod 数据校验和异步读写；未增加依赖。原 `mcp_connector`、grant journal、OAuth、治理、Workspace、连接 `always/session` 均保持原实现。

磁盘快照只接受 SessionId、版本、模式、策略版本/revision、选择来源、必要账号组引用。默认策略只含版本、账号组、模式、策略版本及 revision。未知字段、消息、Header、凭据和准备工具列表均拒绝；生命周期归一化继续裁去非契约扩展字段。账号引用应由可信集成传入不含凭据的 grant 标识。

## 事务规则

`writeSnapshot(snapshot)` 是会话**首次锁定事务**：同一内容重试成功，不同模式、来源、策略或账号绑定发生冲突，绝不覆盖已锁定模式。本期不开放现有会话的模式切换 API；受信任切换及安全边界属于 P1-07。

`setDefaultPolicy(policy, { expectedRevision })` 按账号组比较 revision。首次写入使用 0，成功形成 revision 1；之后只接受当前 revision。相同内容、相同目标 revision 可以幂等重试，其他过期写入明确冲突。默认更新不会修改已保存的会话快照。

`lifecycleBindings({ accountRef, groupId })` 异步预读默认策略，然后提供 P1-01 所需的读、写和同步选择接口。同步缓存只在成功写入或有效刷新后更新，关闭后拒绝新事务，并等待已经接受的 I/O 结束。

首条输入的限制仍在 `claimed` 同步安装，之后等待磁盘确认。自动选择写入前重新核对账号组、策略版本、模式和 `policyRevision`，两个方向的默认切换都会检查。兼容默认的快照保留策略绑定以完成核对；旧历史兼容快照可以不绑定账号组。父会话继承使用已锁定模式，不追溯应用新的默认。

跨进程默认变化不会自动改写已经组装的工具集：缓存过期或其他进程抢先锁定不同快照时，写入失败、该次推理被阻断，输入保留，不能偷偷采用另一个模式。已成功锁定的相同快照重试不受后来默认变化影响。

未来集成必须在可信输入边界刷新跨进程默认变化，并在安全边界处理未提交候选的重新选择；本期没有启用文件监听或修改当前 Host 输入链路。P1-01 的 `retry()` 保持重试同一候选，不承担自动换模式的职责。

## 原子发布、失败与删除

记录先写入本目录的唯一临时文件、执行文件 sync 并关闭，再通过不覆盖目标的硬链接发布。会话只有一个发布槽，默认策略每个 revision 一个发布槽；争写由文件系统原子创建裁决，无锁超时抢占或整文件覆盖。相同内容重试也要完成持久化确认，不能绕过上次失败的 sync。

发布前失败时没有可见提交；发布成功后返回错误属于未确认结果，调用者仍保持未提交，恢复后可验证原记录并幂等重试。临时文件不会被当作快照恢复。损坏 JSON、版本未知、校验不符、非连续策略历史、已存在数据却缺少 domain 元数据均阻断，不降级为全量兼容模式。摘要用于发现意外损坏，不是防本机篡改的认证机制。

目录在 POSIX 上以 0700、文件以 0600 创建；Windows 继承 profile 的 ACL，本期没有更改 Windows ACL。已经验证 Windows 本地磁盘的原子硬链接与真实进程终止恢复；不支持硬链接的介质明确报错，不回退到覆盖或只存内存。POSIX 额外 sync 父目录；Windows 的 Node 接口无法提供同样的目录 sync，因此不声称完成整机断电耐久验证。网络盘、其他介质和其他平台仍需各自验收。

归档与 Agent disposed 不删除模式记录，关闭/重开也保留快照。`permanentlyDeleteSession()` 默认拒绝，只在构造时注入的可信 Host 永久删除核验回调确认后执行；没有接入生产删除事件，也不接受模型自报确认。

永久删除先发布删除标记，再移除快照及属于该会话的未发布残留。标记只保留哈希键及协议元数据，不含会话原文、账号或组；保留它是为了拒绝旧进程复活同一个 SessionId。并发首写不能越过删除标记。清理失败会报错，但读取已被阻断，后续可重试清理；不复用永久删除的 SessionId。新的进程崩溃仍可能留下未发布临时文件，它们不会恢复为会话，可信永久删除可清理对应残留。

## 验证与复现

所有存储测试使用 `mkdtemp` 返回的独立目录；故障场景通过真实文件操作边界注入 EACCES、ENOSPC、EIO 和 EPERM，不是把生产磁盘写满或修改生产 ACL。跨进程争写与发布前后终止使用真实 Node 子进程。Host 验证只加载当前安装的 0.2.2-rc.1 运行库，使用内存会话及离线模型，模式快照使用真实临时磁盘。

| 检查 | 结果 |
| --- | --- |
| 磁盘存储、生命周期与隔离 Host 组合 | 最终完整运行内 61 项全部通过，无跳过；其中 P1-02 新增 26 项磁盘测试和 4 项 Host 集成测试 |
| 工具名称、可见性、治理、Workspace、旧 session 注入相关回归 | 显式选择 Host，完整检查内全部通过 |
| 完整仓库检查 | Node 22.22.1，`npm run check` 通过；701 项中 696 通过、0 失败、5 项既有环境跳过；128 个发布文件的白名单与敏感内容检查通过 |
| 原数据隔离 | 合成旧连接、凭据、治理与 Workspace 文件逐字节不变 |
| 当前 DSH | `cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-lock.yaml` 的 SHA-256 与 P1-01 一致；不加载 profile loader、不调用企查查业务或真实模型、不启用生产智能模式 |

Windows PowerShell，选择已安装的 Host 后执行：

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<已安装 DSH profile 的 package.json 绝对路径>'
node --test test/smart-mode-store.test.mjs test/smart-mode-lifecycle.test.mjs test/smart-mode-lifecycle-host.test.mjs test/host-tool-names.test.mjs test/visibility-host.test.mjs test/session-injection.test.mjs test/governance.test.mjs test/connection-scopes.test.mjs
npm run check
```

若运行环境禁止硬链接或临时本地 HTTP 服务，必须使用具备这些测试权限的环境；不能跳过磁盘测试来报告通过。原始请求、凭据、客户会话和本机生产账号引用均不进入仓库夹具。

完整检查的 5 项跳过仍是 Windows 大小写环境变量、另行选择的隔离 Web E2E 及 3 项需独立 MCP SDK fixture 的原有环境门。新增测试没有跳过。存储测试首次在受限沙箱内被硬链接权限拒绝，按权限流程转到沙箱外执行后全部通过。

## P1-03 准入与后续边界

P1-02 的数据层已通过本次退出检查，可以进入 P1-03 开发。P1-03 应继续在隔离环境实现每 Agent 的智能 restriction 与 guard、两个管理入口、精确回滚及作用域外工具不变，首期仍只选择当前账号的企查查企业数据 6 个 Server。

本次没有实现智能限制层、发现、prepare、来源关系核验、真实业务或模型收益验收。真实 Host inbox 与模式存储不是一个跨域事务；本次验证输入在运行中的 Host 写失败后可恢复，以及模式存储自身的进程崩溃恢复，没有声称二者跨崩溃原子提交。完整 profile 会话日志、可信 RPC 来源、清空/压缩 UI、跨进程默认刷新与恢复交互仍须在 P1-07 集成验收。

这里的准入是继续受控开发，不能据此打开生产智能模式或宣称已经达到工具 Token 优化目标。
