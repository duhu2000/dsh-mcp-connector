# QMCP-4963 · P1-07 受控集成与整体验收

2026-11-12，Asia/Shanghai。独立分支 `codex/qmcp-4963-p1-07-integration`，基于 P1-06 `2099cea`。

结论：**本轮授权范围内的受控工程集成验收通过；不能标记阶段 1 的全部产品、真实账号业务与模型收益验收已完成。** 本次没有启用生产智能模式，没有批准真实来源或只读清单，没有调用真实企查查业务或真实模型服务。

English: P1-01 through P1-06 are composed and tested with the installed Native Host, its real JSONL backend and isolated temporary profiles. Controlled engineering acceptance passes. Production composition, real-account business equivalence and actual provider usage/cache/cost acceptance remain unverified.

## 代码变更

| 文件 | 作用 |
| --- | --- |
| `lib/smart-mode-integration.js` | 显式 profile 校验；组合生命周期、独立存储、限制、来源选择、prepare 和资源层；可信发布/刷新、默认模式事务及整栈回滚 |
| `lib/smart-mode-schema.js`、`lib/smart-mode-store.js` | 默认策略增加可选 enabledAt，并向同步策略读视图提供该边界 |
| `lib/source-selection.js` | 同步最终结果入口，将 Host 成功结果接入来源偏好、真实错误接入失败锁定，避免下一个排队调用漏看异步状态 |
| `lib/smart-mode-lifecycle.js`、`lib/smart-mode-prepare.js`、`lib/smart-mode-resources.js` | 独立回滚预检；prepare 记录未结算事务，先检查全栈再释放任何层 |
| `lib/index.js`、`package.json` | 仅导出集成工厂和契约常量、加入语法检查；生产 apply() 和版本号不变 |
| `scripts/fixtures/smart-mode-profile.mjs` | 真实 Host JSONL、TokenMeter、BasicCompaction、离线模型及安全临时目录清理；输出无业务内容的指标凭据 |
| `test/smart-mode-integration-host.test.mjs` | 26 项受控集成测试，覆盖本次要求和组合失败路径 |

## 独立 profile 与接入边界

`createSmartModeIntegration()` 默认禁用，禁用时不读取 Host 或磁盘。启用必须显式提供绝对 profileDir、可信 Host profile 路径回调、一个账号/grant 的六 Server 绑定、已核验 Native 契约、权限、交互来源和 schema 投影接口。初始路径通过 realpath 核对，运行时继续核对 Host profile 身份，不使用 DSH_HOME 或当前 profile 默认路径。

范围仍只允许企业数据 company、risk、ipr、operation、history、executive，不能跨账号合并。当前账号授权未复制到临时 profile；所有验证使用该结构的**合成账号、定义、关系和审核**。法律、法宝、其他账号及非 Agent 自动化不纳入智能范围。

验证实际使用已安装 Host 0.2.2-rc.1 的 JSONL 后端（compression=none），将 Session、模式快照和策略分别写入独立临时 profile。没有用内存 Session 或自建 JSONL 模拟器替代落盘后端。它是显式组合 Host 服务的隔离运行时，不加载当前 DSH 配置，也没有启动或操作当前 DSH Web UI。

生产 apply() 没有调用该工厂，也没有新增默认启用的设置、RPC 或 UI 按钮。可信控制 API 已可组合和测试；完整客户端入口、实际发现订阅及生产审核维护仍不能由“工厂导出成功”替代验收。

## 发布视图与来源结果

`publishViews()` 是可信发现/维护接口，不是模型工具。它要求 expectedRevision 条件更新，将完整原始 tools/list 数据及独立只读审核复制并冻结，核对六 Server 绑定、完整指纹和 Host 注册对象；不接受裁剪缓存作为 raw 定义，不自动生成批准。原始 schema 和审核仅保留内存，关系/模式仍由独立存储负责。

原始视图携带对应 Host 注册对象身份。注册删除或替换而尚未重新发布时，本企业组的原子读视图失败关闭；不能把旧 raw 定义自动绑定到新注册对象。该保守边界可能暂时阻断组内其他来源，直到可信发现者发布完整新视图。它不改变范围外服务，也不意味着重新发布就可以跳过完整指纹只读审核。

关系和默认策略通过 `refreshControl()` 从磁盘建立同步读视图；刷新票据防止迟到旧读取覆盖更新的撤销。损坏或未知版本导致视图失效，不能冻结旧批准继续用。跨进程关系变更需通知/刷新该视图，本期没有冒充即时文件监听。

Host 冻结的 `tools/result` 现同步接入当前已加载来源：成功记录本 Agent 的最近成功偏好；错误锁定该能力，后续 prepare 必须取得新的可信来源指令，不能自动换源。取消不被误当成业务来源故障。已撤权、未准备或范围外结果不会获得额外资格。

这一组合测试仅执行 4 次明确的本地合成函数，用来验证最终成功、失败和取消。真实企查查业务执行为 0；其他新增测试中的合成业务函数也不执行。

## 会话与回滚语义

- 默认智能策略写入 enabledAt。首次输入时，如果无锁定快照且会话创建时间早于该边界，则选择兼容模式；空白旧会话也不能被追溯启用。缺少 enabledAt 的旧默认策略不自动启用新智能会话。
- 锁定快照按 SessionId 持久化；默认策略变化不修改已锁定会话。fork/subagent 继承父模式/账号组，单独落盘，准备集、token、计时器和偏好不继承。
- 新 Host Context 从真实 JSONL 恢复历史及原模式，准备集为空。未知/损坏的已存在快照失败关闭，不自动扩大成兼容可见性。
- 压缩使用 Host BasicCompaction 和真实 durable compaction/start、compaction/end、surface replacement；保留 SessionId、模式及当前合法加载状态，并验证后续推理与恢复。
- 清空测试使用 Host 的 canonical conversation-surface replacement，保留受保护 system head，清除旧会话内容，再落盘、重建 Agent 并验证模式保留、准备状态为空。这验证持久化语义，**不等于已验证客户端“清空”按钮/RPC 的全链路**。P1-01 的 clear/compact 创建来源契约测试继续保留。
- 全栈 rollback 先预检 Agent 空闲、快照写入已结束、prepare 事务已结束、资源调用/step 排空。预检失败不释放任何局部入口、mask 或 guard；不能先拆一半再报告忙碌。
- 通过后仅释放本集成持有的监听、资源、局部入口、mask 和 guard，恢复原 25 个管理定义及业务注册；外部 deny 继续生效。保留独立模式/关系数据，不修改连接、授权、Workspace 或现有配置。重新挂载从已锁定模式恢复，准备状态重新为空。

enabledAt 是独立策略记录的可选新字段：本版本兼容缺字段旧记录；不声称旧智能模块能读取带新字段的严格策略记录。整体退出后既有插件路径不依赖该独立模式域，不需要把新记录重写成旧格式。

## 验证结果与证据

Node 22.22.1；显式选择安装版 Host 模块；Native 执行器；真实 JSONL、TokenMeter、BasicCompaction；离线适配器。所有模式启用仅发生在独立临时 profile。

| 检查 | 结果 |
| --- | --- |
| 新增测试 | 26 项全部通过：2 项禁用/路径隔离，24 项 Host/profile 集成；无新增跳过 |
| 新旧与继承 | 有内容旧会话、开启前空白旧会话、新会话、旧默认记录、fork、subagent、默认改变后父模式锁定通过 |
| 持久化生命周期 | 新 Host Context 恢复、清空后的恢复、BasicCompaction 真实检查点及后续推理通过 |
| 完整组合 | 356 个合成来源、170 个候选观察；无批准时保持独立；只有合成批准关系启用后才按关系选择/显示别名 |
| 变化与失败 | 当前注册对象替换、完整指纹新审核、关系撤销、迟到刷新、关系损坏、损坏快照、磁盘写失败/恢复及输入不重复通过 |
| 整体回滚 | 精确恢复定义、保留外部 deny、重挂；运行中、取消后未结算写入和异步 prepare 均阻止部分卸载；晚期挂载失败完整补偿通过 |
| 完整检查 | npm run check 通过；872 项中 867 通过、0 失败、5 项既有环境跳过；134 个发布文件通过白名单和敏感内容检查 |
| 最终运行规模 | 25 个隔离 Host Context、24 个独立临时 profile；最终运行的 profile 均已清理，无残留 |
| 外部动作 | 真实模型请求 0、真实企查查业务调用 0、真实来源/只读批准 0、生产智能模式启用 0 |

5 项既有跳过仍为 Windows 环境变量大小写、独立 opt-in Web E2E 和 3 项独立 MCP SDK fixture 用例。本期磁盘测试在沙箱硬链接 EPERM 后通过权限流程运行，没有为此跳过。最初失败用例留下的两个临时目录也已逐一验证绝对路径后清理。

两种模型能力的受控例（同一合成工具，准备前 → 准备后 → 释放后）：

| 离线能力配置 | 适配器实际 scoped tools 估算 | 观测 |
| --- | --- | --- |
| 无 toolUpdate | 421 → 478 → 421 | 每次完整声明当前可用工具，没有 developer 工具更新消息 |
| addition-only | 421 → 483 → 421 | 新工具带 deferLoading，准备后有一条 developer 更新；释放后不保留该工具声明 |

本例 canonical 预算门对准备后定义计为 478；addition-only 的 Host 投影增加约 5 个估算 token。5,000 的实现门限沿用已约定的 canonical header 工具数组口径，不把适配器附加字段或历史消息伪装成已覆盖。两例真实发送前适配器输入都低于 5,000；这不能替代真实模型临界预算、usage、KV 缓存和计费验收。

还验证了两种能力下更新同名工具定义：旧完整指纹不能继续 prepare，新合成只读审核发布后，新参数 schema 到达下一次离线适配器请求。模型名称仅为能力模拟，不把它们冒称为实际 v4-pro/flash 请求。测试 usage=1 是夹具输出，不是业务收益证据。

最终日志及不含 schema、参数、正文、凭据的指标位于任务产物目录 `qmcp-4963-p1-07`：`npm-check-final-node22.log`、`final-profile-evidence/` 和 `profile-evidence-summary.json`。

## 当前 DSH 环境核对

本次代码/测试写入目标为仓库、任务产物和独立临时 profile，未对当前 DSH profile 执行写入、安装、回退或启用操作。**不能声称四个监控文件均与 P1-06 相同：**

- `cordis.yml`、`cordis.patch.yml` 内容 SHA-256 与 P1-06 一致。
- `package.json` 和 `pnpm-lock.yaml` 内容 SHA-256 已不同，修改时间为本轮期间 20:17；依赖清单现声明 dsh-mcp-connector `^0.2.102`。
- 本分支创建时间为 19:57:59。本轮未在开始时另存四文件哈希；当前结论来自与 P1-06 基线及文件时间戳的核对，不能重建未捕获的逐时变更。
- 写入方尚未归因，本次保留这些文件原状，不回退它们。环境漂移与本次代码改动分开记录；不能据此宣称已验证当前安装包的生产行为。

详细 SHA-256 核对见任务产物 `config-verification.json`，不包含配置正文或凭据。

## 阶段 1 验收结论

**受控工程验收：通过。完整阶段 1 验收：尚未满足，不能作为生产启用或真实 90% 收益达成的批准。**

已完成本轮可验证的 P1-01～P1-07 模块组合、独立落盘、会话矩阵、变化/并发/失败路径和整栈回滚。要闭合完整验收，还缺：

1. 当前账号真实 raw 发现发布、可信明确来源入口、只读证据维护及实际客户端启停/清空/压缩路径的集成验收；本次只有可信 API 和隔离运行时语义测试，没有接通生产 apply()/UI。
2. 在明确版本和独立环境下，对真实 v4-pro/flash 的请求体、usage、缓存命中、成本及临界预算进行复测；5,000/90% 只能用于企业 6 Server 智能范围并计入两个常驻入口，不能用于整个会话。
3. 真实来源等价、返回语义、费用、限流和新鲜度的独立核验。候选及合成审核不能代替真实批准；本次按用户限制保持真实批准为零。
4. 当前安装依赖发生漂移后的部署版本确认；本分支测试的是本地受控代码和已选择的 Host 模块，不覆盖另一路更新的安装包。

上述项目没有通过绕过用户限制来补齐。本次没有开始生产灰度、真实业务 canary、推送或发布。

复现：

```powershell
$env:DSH_HOST_INTEGRATION_ANCHOR = '<安装版 DSH profile 的 package.json 绝对路径，仅用于模块解析>'
$env:DSH_SMART_ACCEPTANCE_EVIDENCE_DIR = '<独立任务产物目录>'
node --test test/smart-mode-integration-host.test.mjs
npm run check
```
