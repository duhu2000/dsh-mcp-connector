# QMCP-4963 · PR #243 统一提测范围

独立验收后续：已修复证据回执“链接已发布但持久化确认失败”后过早接受同版证据的问题，保留每次签名/期限/head 校验，新增首次确认与重试确认。四项会话/权限/回滚交叉场景和两项持久化回归已补齐；修订后完整回归 1097 项（1092 通过、5 项既有跳过），提测入口为 359 项。下文 1091 / 353 记录原交付基线；当前结果与边界以 [独立验收报告](SMART-MODE-INDEPENDENT-ACCEPTANCE.md) 及修订包 manifest 为准。

冻结新增功能，当前完整成果已统一到 `codex/qmcp-4963-pr`。该分支沿已有提交历史汇入正常生产接入、可信只读证据接入和真实元数据核验材料，并合入 main `377bfe9d9ceec9303726987b7fc4dc3e44a15eb1`（0.2.109）；不逐个重复合并历史任务分支，不创建发行版本。最终提测 commit、制品摘要和远端检查以 PR #243 与提测包 MANIFEST 为准。

English: This PR delivers session-isolated discovery/prepare, verified-source selection, resource protection, normal Host startup/UI wiring, and signed read-only evidence verification for one account's six QCC enterprise servers. It is default-compatible and validated with real Host modules in isolated synthetic profiles. Real tool/source approvals, real trust deployment, provider A/B, release installation acceptance and production rollout remain outside this delivery. Ready for review and QA does not authorize merge or deployment.

## 已完成

| 范围 | 最终行为与审阅位置 |
| --- | --- |
| 生命周期和落盘 | `Agent.id`/SessionId 快照、历史会话兼容、fork/subagent 继承模式不继承加载、恢复重新准备；独立磁盘存储 revision/CAS、并发、写失败恢复。`smart-mode-lifecycle/schema/store.js` |
| 会话限制和权限 | schema / lookup / dispatch 同时按 Agent 收窄；智能两入口、兼容原 25 入口；保留连接状态、Workspace、治理、手动激活和 Host 审批语义。`smart-mode-restrictions.js`、`host-tool-names.js` |
| 原始目录与候选 | tools/list 清洗前捕获完整原始定义于内存，完整指纹绑定账号/组/连接；候选与批准分开，多账号不合并；删除、撤权信号与定义变化复核。`smart-mode-discovery/bindings.js`、`source-relations/selection.js` |
| prepare 与来源 | 独立只读核验绑定完整定义指纹，加载前重新检查权限及来源关系；明确来源拒绝不换源，失败不自动换源，prepare 不执行业务。`smart-mode-prepare.js` |
| 预算、TTL 和回退 | 两入口计入组内预算；固定/滑动 TTL、LRU、在途及批次保护、并发取消与失败回滚；层停用恢复兼容工具视图。`smart-mode-resources/integration.js` |
| 正常插件接入 | `apply()` 接入真实 Host 版本/Native 能力门、当前账号唯一六服务组、权限控制、SessionController/Workspace、浏览器 owner + CSRF 和中英文控制页。一次预览/确认启用新会话默认，旧会话不追溯。`smart-mode-host/production/control*.js`、`lib/index.js`、`ui/smart-mode.*` |
| 可信证据交付校验 | profile/account/group/完整指纹绑定的离线 Ed25519 证据、摘要与期限、密钥失信、撤回、防回放 revision floor、原子持久化与文件/期限监控；页面/模型不能安装信任或签名。`read-only-evidence.js` |
| 独立提测交付 | 正常启动临时 profile、离线 Host 契约入口、合成加载界面样例、Linux/Windows 的固定 Host 契约 CI、包安全门禁、测试清单和可校验的本地提测包。夹具及签发器不进入 runtime npm 包 |

此前 PR 审阅发现的四类问题已修复并保留回归：兼容快照跨账号/组访问、prepare 排队与清空竞争、部分生命周期订阅失败的遗留回调、拒绝的异步权限 Promise 未处理。没有为收口增加产品能力。

## 明确边界

1. 首期只绑定当前配置账号与一个明确 grant 的六企业 Server：`qcc-company`、`qcc-risk`、`qcc-ipr`、`qcc-operation`、`qcc-history`、`qcc-executive`。法律、法宝、其他账号及其他连接维持现有语义，不宣称整个会话降低 90%。缺少成员或多完整 grant 时不猜测身份。
2. 默认兼容。完整生产组合只核验了 Native Host `0.2.2-rc.1`；未知版本/能力不足不乐观启用。PTC、其他执行器和新 Host 版本须独立契约验收。正常启动代码已经接好，但尚未安装到日用 DSH 或进行发行安装验收。
3. 真实只读定义、真实来源关系批准均为零，真实公钥未部署。没有有效签名证据时真实工具 prepare 仍拒绝；没有来源关系批准时重复候选不合并。此次只交付受控工程测试，不以“名称看起来只读”替代核验。
4. 组内预算使用 DSH `JSON.stringify(...).length / 4 + 4` 与实际取整，包含两入口；初始目标 ≤1,500，加载后 ≤5,000。只对同一六服务组全量定义比较，不能据此声称真实请求、usage、缓存或费用收益已验收。
5. 本地停用、删除、治理拒绝收到事件后可失效；远端撤权只能在后续发现/失败等信号到达后识别。插件不新增或绕过 Host 审批，也不替 Host 补不存在的审批。
6. 兼容定义变化保留仍有效选择；未知/不兼容变化、撤权及过期封闭失败。清空保留历史/模式并释放加载，压缩走 Host 原生命令；恢复不持久化准备状态。
7. 独立存储依赖本地文件系统原子硬链接；Windows 整机断电耐久性、网络盘未验收。证据监控有文件事件与 1 秒兜底，执行/推理边界同步重新核验；已入站在途调用不追溯取消。

## 当前回归与提测入口

合并后 Node 22.22.1 + 显式 Host `0.2.2-rc.1`：`npm run check` **1,091 项，1,086 通过，0 失败，0 取消，5 项原有跳过**；lint、文档/元数据、教程、本地包白名单与安全检查通过，runtime 文件仍为 144 个。跳过分别是 Windows 环境变量大小写、独立 Web E2E、三项独立 SDK 启动保护，不包含本期完整 Host 契约。

新的 `node scripts/run-smart-mode-qa.mjs check --anchor <Host package.json>`：**353 项通过，0 跳过**。它会核对固定版本，拒绝必要契约静默跳过。完整智能 Host CI 新增 Linux / Windows 两个平台，原有 Host visibility 矩阵及主线回归保留。

最新 main 的代理/client/config/settings 合并敏感路径另以 Node 26.13.0 补测：137 项，136 通过、1 项 Windows 环境变量大小写跳过、零失败；不将此定向结果扩大为完整 Node 26 验收。

新增 CI 实际发现并修正了 Host 测试安装漏装 peer，以及 Linux 故障注入期间 `state` 也会因 `ENOTDIR` 拒绝读取的跨平台测试假设。现在故障存在时验证真实工具视图回滚，修复磁盘布局后再验证策略/重试；存储损坏封闭规则未放宽。两平台门禁独立跑完。

临时 Host 浏览器回归通过 8 组流程：真实 cookie 准入、三种会话视图、四个未合并候选、合成只读撤回、清空/压缩、模式预览取消/确认、Workspace、整层回退、中英文及匿名拒绝。页面错误 0，外部请求 0，正常停止后临时 profile 删除。首次人工驻留因浏览器开始前超时而清理，未计为通过；连续启动/浏览器/停止复测通过。

回归只使用真实 Host 代码及本地合成服务/离线适配器。真实业务和模型调用、真实批准、真实公钥部署、生产模式启用、PR 合并与发布均未执行。四个日用 DSH 配置文件在本轮前后比较 SHA-256；不以四文件未变推断后台所有运行存储都未变化。

操作、预期、环境、停止清理与剩余验收详见 [提测清单](SMART-MODE-QA-CHECKLIST.md)。提测包包含 runtime tgz、同一提交的源码/测试夹具、入口脚本、MANIFEST 与 SHA256SUMS；runtime 仅打包、不发布、不安装到现有 profile。

## 尚未完成及下一道门

| 未完成项 | 完成标准 |
| --- | --- |
| 独立测试人员验收 | 使用本次固定 commit / 提测包执行清单、记录缺陷并完成回归；工程自动化通过不能代替独立 QA |
| 真实业务只读核验 | 用户审核首项 `get_company_registration_info` 的副作用、返回语义、计费限流与有效期，补齐证据并另行批准；登记表保持待核验 |
| 真实来源等价核验 | 返回语义、费用、限流、新鲜度、权限例外、期限和逐关系 kill switch 独立核验；只读签名不授予来源等价 |
| 真实交付与收益 | 获得后续授权后交付真实公钥/证据，在独立 profile 限定调用，测 v4-pro / flash 的请求、usage、缓存和成本；当前没有新增真实 A/B |
| 发行安装与灰度 | 独立 profile 的安装/升级/重启/回退、维护者审阅与审批，再分别决定合并、发布和小范围生产启用 |

## 证据索引

[生命周期](SMART-MODE-LIFECYCLE-P1-01.md)、[存储](SMART-MODE-STORAGE-P1-02.md)、[限制](SMART-MODE-RESTRICTIONS-P1-03.md)、[来源](SMART-MODE-SOURCES-P1-04.md)、[prepare](SMART-MODE-PREPARE-P1-05.md)、[资源](SMART-MODE-RESOURCES-P1-06.md)、[集成](SMART-MODE-INTEGRATION-P1-07.md)、[生产接入](SMART-MODE-PRODUCTION-WIRING.md)、[可信证据接入](SMART-MODE-READONLY-EVIDENCE.md)、[当前元数据材料](SMART-MODE-CURRENT-METADATA-REVIEW.md)、[首项业务核验材料](reviews/QMCP-4963/get-company-registration-info-review.md)。这些报告记录各自阶段时点，当前提测范围以本文件为准。
