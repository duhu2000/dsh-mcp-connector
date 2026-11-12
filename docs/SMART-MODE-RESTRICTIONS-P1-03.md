# QMCP-4963 · P1-03 智能限制层与两个管理入口

2026-11-12，Asia/Shanghai。分支：`codex/qmcp-4963-p1-03-restrictions`，基于 P1-02 提交 `a5e239c`。

本期实现每 Agent 的智能工具限制与原生执行 guard，以及两个局部管理入口。默认关闭，生产 `apply()` 保持原样，模块仅增加工厂导出；不创建控制器、不注册入口、不改变当前配置或连接状态。

English: This adds an opt-in per-Agent restriction controller and two local management entries, with offline native-Host isolation and rollback tests. Production initialization remains unchanged. Preparation and source equivalence are later tasks.

## 代码与接入

| 文件 | 变化 |
| --- | --- |
| `lib/smart-mode-restrictions.js` | 账号组绑定校验、Agent 独立限制、最新权限 guard、失败阻断及资源回滚 |
| `lib/host-tool-names.js` | 新增只读 `restrictableNames/knownNames/visible` 适配，不物化 schema |
| `lib/tools.js` | 精确的 25 项管理工具归属列表、两个局部入口工厂；全局注册函数保持原默认行为 |
| `lib/i18n/locales/en/tools.js` | 新增入口的中英文描述与输出；默认中文，可信接入可注入原 Host translator |
| `lib/smart-mode-lifecycle.js` | 在等待持久化后及中间件返回后核验模式就绪；失败仍保留可恢复输入 |
| `lib/index.js` | 仅导出限制层工厂，不挂载生产模式 |
| `test/smart-mode-restrictions.test.mjs` | 隔离、权限、局部影子、错误及回滚契约 |
| `test/smart-mode-lifecycle-host.test.mjs` | 新增实际 Host 运行库的 schema、lookup、原生 dispatch、恢复及回滚测试 |
| `test/smart-mode-lifecycle.test.mjs` | 补充等待门返回前出错时的输入保留测试 |
| `scripts/fixtures/smart-mode-enterprise.mjs` | 356 项企业工具及 57 项范围外定义的合成数据；不进入发布包 |
| `package.json` | 新模块加入语法检查 |

限制层必须显式启用并声明已验证的 `SMART_RESTRICTION_HOST_CONTRACT`。Host 的 `view()` 目前是运行时可用、类型上私有的接口，集中在名称适配器中只读使用；未知 Host 不猜测兼容，不回退到 `schemas()`。

可信接入需先挂载控制器，再把 `controller.lifecycleBindings()` 连同存储绑定交给 P1-01 生命周期适配器。绑定同时包含同步 `installMode` 与 `assertModeReady`，不能只安装限制而遗漏请求等待门。模式选定时先同步安装，快照提交后才允许推理；限制刷新失败或影子冲突会阻断该次推理，并保留输入。

`getRecords`、`isRecordUsable`、`isRecordVisible`、`isToolAllowed` 必须由 Host 集成提供，权限回调必须同步返回明确的 `true` 才允许。手动模式还需要原激活状态；未提供时默认未激活。`getPreparedNames(agent)` 是未来 P1-05 的可信内存准备集接口，默认空集合，不接受模型参数来指定 Agent 或改写准备集。

## 范围与权限规则

范围必须恰好绑定当前一个 grant/账号的 `qcc-company`、`qcc-risk`、`qcc-ipr`、`qcc-operation`、`qcc-history`、`qcc-executive`。每项明确包含连接 key、连接器 ID、逻辑 Server ID 和实际 serverName；运行时重新核对原连接的 OAuth grant、Server key 和身份，不能自动吞并另一个 grant。未知、重复或身份变化会阻断，不自动换账号。

业务归属使用经过校验的完整 Server 名称前缀，不反推原始工具名。实际 serverName 限制为安全字符且最长 32 字符，以确保 Host 清洗或截断工具名时前缀仍完整；重叠或冲突命名拒绝启用。合成用例包含发生字符清洗、超长及哈希后缀的名称。

智能会话对组内未准备工具默认隐藏；准备集中的工具仍必须满足连接启用、有效授权/状态、当前 Workspace、治理和原手动激活条件。原 `always/session` 枚举及 TTL 不变。手动激活不会代替智能准备集，准备集也不会代替原手动确认。

其他账号、企查查法律、法宝及 Host 工具不自动纳入。guard 只处理本组和本插件管理入口，范围外定义不改写；兼容 Agent 和无 Agent 的旧调用不受本层业务限制。其他治理与 Workspace 层继续相交执行，不改变其规则含义。

所有限制按当前 `restrictableNames` 求交后传给 Host。刷新先安装新限制，再释放本层旧限制；读取或安装失败保留已有层并阻断推理。删除、停用和权限拒绝不被准备状态冻结；guard 在真正分派时读取最新状态。新取消、失败或准备状态不构成额外授权。

## 两个局部管理入口

不增加第 26 个全局入口，也不切换全局 `compactManagementTools`。智能 Agent 仅在自己的 scope 注册 `mcp_connector_discover` 并覆盖 `mcp_connector_session_tools`；兼容 Agent 保留原 25 项全局管理定义。如果用户原本使用全局 compact 模式，兼容会话仍保留其原有两个入口。

`mcp_connector_discover` 本期提供 `status/search`：只读当前绑定企业组的缓存，返回经过权限过滤的精确名称、来源 Server、短说明及准备状态，不调用 `tools/list`、业务接口或模型，不返回完整 schema，不准备工具。被本智能层隐藏的工具仍能被发现；这是基础缓存搜索，不是 P1-04 的等价排序或 P1-05 的自动准备。

局部 `mcp_connector_session_tools` 只委托原有固定会话工具，保留动作、参数、可信执行上下文、`preview-activate`、`confirmed`、revision 和 TTL 语义及 Host 执行元数据。它不会自动填 `confirmed=true`，也不接受 `prepare` 或任意业务工具执行。输出附加智能层状态；原全局定义不修改。全局原会话入口被更换时阻断旧委托，防止继续调用过期实现。

两个入口均核验 Host 提供的真实 Agent 对象，不以模型传入的 `agentId`、workspace 或 source 声明作为身份。插件不新增或绕过 Host 审批；Host 本身没有审批的调用，本层也不会替它补充审批。

## Host 边界与回滚

Host 的 `restrict` 同时收窄正常全局业务定义的 schema、lookup、executable 与原生分派。它对当前 scope 的局部注册存在豁免，因此本插件仅局部注册管理入口，绝不注册或代理业务工具。

如果其他插件局部注册同名业务影子，Host 仍可能在直接 schema/lookup 读取中看到该影子。本层不会谎称 `restrict` 能隐藏它：请求等待门会拒绝继续推理，guard 同时拒绝其原生执行，测试验证影子函数未执行且输入保留。管理入口影子或原入口替换也阻断。这个边界不能用“schema 不可见”代替执行保护。

回滚只释放本控制器持有的确切限制、局部注册和 guard，不修改持久模式、连接、授权、治理或 Workspace。只允许在 Agent 空闲时做资源回收；已有其他 deny 层继续生效。控制器退出后现有 Agent 可以继续兼容推理。恢复或子 Agent 会重新显式安装各自的限制，不继承准备集。整套启用/退出、默认策略和 UI 操作仍由 P1-07 集成。

本期没有资源 TTL/LRU/批次回收和 PTC 验收。真实业务定义的权限可被立即收窄，资源性准备/释放及已开始调用的批次保护留在 P1-06，不用本次隔离测试替代该阶段。

## 验证结果

验证使用 Node 22.22.1 和当前安装的 Host 0.2.2-rc.1 运行库。使用独立 Context、内存会话、离线 LLM adapter、合成执行函数及既有临时磁盘夹具；没有创建真实业务 MCP Client，没有调用企查查服务或真实模型。

| 检查 | 结果 |
| --- | --- |
| 356/57 合成结构 | 智能首轮企业 schema 为 0，仅两个管理入口；57 项范围外 schema 与兼容会话逐项相同 |
| 原生执行 | 未准备、跨 Agent、权限撤销及业务影子均拒绝；仅受信任准备且仍有权限的合成函数可以执行 |
| 隔离与恢复 | 兼容会话、另账号、子 Agent、相同 SessionId 恢复均保持各自状态 |
| 事件与回滚 | 同步、microtask、immediate 通知均收敛；回滚恢复兼容推理且不解除其他 deny |
| 新增契约 | 19 项限制层、9 项隔离 Host、1 项生命周期就绪门，共 29 项全部通过；相关旧回归在完整检查中通过 |
| 完整检查 | Node 22.22.1，`npm run check` 通过；730 项中 725 通过、0 失败、5 项既有环境用例跳过；129 个发布文件通过白名单与敏感内容检查 |
| 当前 DSH 配置 | `cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-lock.yaml` 的 SHA-256 与 P1-02 一致；代码没有加载或修改当前 profile |

相关回归包含需要硬链接权限的已有磁盘用例；受限沙箱拒绝后，按权限流程在沙箱外跑完整回归，没有跳过新增测试。完整业务定义来自合成夹具；“356/57”只用于结构验收，不是客户业务等价核验或真实模型 Token 收益。

5 项既有跳过仍为 Windows 环境变量大小写、另行选择的隔离 Web E2E 和 3 项需独立 MCP SDK fixture 的用例。新增入口已补齐中英文文案与语言注入测试，未放宽未翻译文案基线。本交付说明及合成夹具不进入 npm 包。

复现时显式选择已安装 Host，然后执行相关测试及完整检查：

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<已安装 DSH profile 的 package.json 绝对路径>'
node --test test/smart-mode-restrictions.test.mjs test/smart-mode-lifecycle-host.test.mjs test/smart-mode-lifecycle.test.mjs test/smart-mode-store.test.mjs test/tools.test.mjs test/host-tool-names.test.mjs test/visibility-host.test.mjs test/session-injection.test.mjs test/governance.test.mjs test/connection-scopes.test.mjs
npm run check
```

## P1-04 准入

限制层与入口契约已通过本次退出检查，可以进入 P1-04 开发。P1-04 应只实现等价候选、版本化来源关系及每 Agent 的有效来源选择：候选与批准分开，加入原始定义指纹、有效期及逐组停用开关，覆盖部分 deny、独有工具、不同账号和明确来源例外。

本次没有批准任何真实来源关系，没有自动替代或去重业务工具；170 项历史候选仍不能当作批准白名单。没有启用生产智能模式，也不能据此宣称已达到 5,000 Token、90% 或真实 usage 优化目标。
