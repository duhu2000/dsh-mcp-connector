# QMCP-4963 · 历史绑定与重复候选修订

2026-11-13，Asia/Shanghai。独立分支 `codex/qmcp-4963-binding-candidates`，基于真实元数据报告提交 `8f22574`。本轮完成此前发现的两处产品修订及回归；没有安装到当前 DSH、挂载生产 apply() 或启用生产智能模式。

**结论：历史记录缺少 serverKey 已可通过受核验的只读绑定视图接入；真实 356 个工具现识别出 170 组仅注册扩展字段不同的待核验候选。完整回归及只读真实元数据回归通过，真实等价和只读批准均保持为零。阶段 1 的客户端与真实模型收益验收仍未关闭。**

English: A shared in-memory binding view resolves historical records without serverKey using unique exact catalog evidence, without rewriting the backing records. Versioned candidate observations distinguish registration-extension differences while retaining full approval fingerprints. All 911 checks finish with 906 passes, zero failures and five existing skips; live metadata-only regression recognizes 170 unapproved groups across 356 tools.

## 变更范围

| 文件 | 修改 |
| --- | --- |
| `lib/smart-mode-bindings.js` | 规范范围校验与共享只读记录视图；历史映射核验、端点固定及 scope 校验 |
| `lib/smart-mode-restrictions.js` | 复用绑定视图；绑定失效时收紧全组 Host mask，保护 lookup；使安全失效的准备条目不能恢复后自动复活 |
| `lib/smart-mode-integration.js` | 新增可信 getConnectorDescriptors 回调，向各层共享同一个 recordView |
| `lib/smart-mode-discovery.js` | 优先复用 integration.recordView；独立使用时建立同规则视图；保留六路原子发布和在途记录复核 |
| `lib/source-relations.js` | 完整/严格指纹不变；新增注册字段差异观察指纹，输出 version=2 的分层候选 |
| `lib/source-selection.js` | 候选按 Agent 当前可发现权限过滤；候选不改变来源选择或批准规则 |
| `lib/index.js`、`package.json` | 仅新增工厂导出和语法检查，版本号与生产 apply() 不变 |
| 夹具及测试 | 透传目录证据，新增 28 项单元和实际 Host 契约测试 |

## 历史绑定修订

此前 connectionRecordSchema 允许 serverKey 缺失，而限制和发现层要求该字段已存在。本次通过 `createSmartEnterpriseRecordView()` 提供仅内存中的有效记录，当前存储不迁移、不补写字段，也不复制凭据到临时 profile。

接入方显式提供 `getRecords` 与可信 `getConnectorDescriptors`。历史记录必须匹配当前 scope 的 connection key、connector ID、完整 serverName、唯一 grant；再从唯一同 ID 目录描述符中匹配唯一 Server。其 serverKey、serverName、精确 URL 和 streamable-http transport 均须一致。没有目录证据、前缀猜测、同 key/name 的目录歧义、错误显式 serverKey、错误账号或 namespace 冲突均拒绝。

推断结果复制并冻结，包含嵌套 auth/headers，权限回调不能借其修改原记录。只对明确范围内的历史记录构建视图；其他账号记录不被修补。已存在且正确的显式 serverKey 保持此前绑定契约，不强制依赖目录；一旦某条历史记录曾由目录推断，后续即使补入显式 key，仍须重核目录。

每次读取重新核验目录。已推断的 URL/transport 在该视图生命周期内固定：记录与目录同时改成另一端点也不能继续使用旧视图，须显式重建受控集成并重新发现/审核。删除记录不会由目录重建出来。

集成、发现与限制层共用同一个 recordView，并核对其 account/group/六路绑定。限制层的 schema、lookup、dispatch 和 prepare 权限检查读同一有效视图。独立使用发现工厂时执行相同规则。

目录或本地治理变更需要经既有 tools/change 或可信 refreshControl 通知限制层重新核对；不承诺主动检测未发事件的任意外部存储修改。发现刷新开始会先阻断旧视图，再核对结果。绑定错误时，除 guard 外还尝试收紧全组 Host mask，使已准备工具不能从 lookup 继续取得；Host 本身拒绝更新 mask 时保留旧 mask，并继续阻断推理/派发，不能声称 Host 失效下 lookup 仍绝对可控。

## 候选分层修订

`definitionFingerprint` 仍对完整原始定义计算，**保留 `_registration_tool`、所有未知扩展、输入/输出 schema、annotations 等字段**。原有 candidateFingerprint 仍只忽略顶层 title/description，作为严格对照，未删除注册字段。

新增 registrationCandidateFingerprint 只在候选观察层额外忽略顶层 `_registration_tool`，不忽略嵌套同名字段、其他扩展、schema 或 annotations 的变化。候选按 account/group 指纹分桶，并按 Agent 可发现权限过滤，避免跨账号或向无权限会话暴露组成员。

候选结果 version=2，分为：

- `same-contract`：严格对照也一致。
- `registration-extension-difference`：严格对照不同，但只忽略注册扩展后相同。标明 differingContractFields，保留成员各自的完整定义指纹。

两类都显式 `requiresVerification=true`、`mergeApproved=false`。扩展组覆盖其内部严格相同子组，避免一批观察重复出现；**候选不是已批准关系、canonical、别名授权、加载许可或换源依据**。来源选择仍仅使用单独批准的关系、实时权限和完整指纹。注册字段变化照常使旧关系指纹与只读审核失效。

本轮没有确认服务端 `_registration_tool` 的业务含义；只有目录观察，不能证明返回语义、费用、限流、新鲜度或只读性。真实批准仍需独立核验。

## 验证结果

新增 **28 项**：18 项绑定单元测试、4 项来源候选测试、2 项独立发现测试、4 项真实 Host 测试。覆盖缺失字段、准确目录证据、重复/冲突目录、多账号和 scope、只读复制、异步来源拒绝、端点改变与固定、权限拒绝、会话隔离、schema/lookup/dispatch、完整指纹变化、审核失效、候选不合并及整栈回滚。

Node 22.22.1 + 已安装 Host 0.2.2-rc.1，显式解析锚点，不加载当前 DSH 配置。`npm run check`：**911 项，906 通过、0 失败、5 项原有跳过**；无新增跳过。lint、文档/元数据检查及打包检查通过，136 个发布文件在白名单内且未发现凭据或本机路径。

新增 Host 测试只使用合成账号、定义和审核，拒绝派发未进入业务函数。全量既有夹具中的四次纯本地合成函数执行继续属于原有成功/失败/取消测试，均不是企查查业务请求。

真实回归只执行一轮六路 initialize、initialized 通知和 tools/list。结果仍为 company 186、risk 38、ipr 18、operation 36、history 34、executive 44，合计 **356**；356/356 输入指纹与阶段 0 原请求一致。

本次临时 profile 接收保留 serverKey 缺失状态的记录副本与原始目录描述符，**采集脚本没有手工补 serverKey**，由产品 recordView 推断。旧兼容会话保留 356 业务 + 25 管理入口；新智能会话只有两个管理入口。智能会话的 schema/lookup 没有业务工具，旧兼容会话仍有 356 项业务工具。真实 source 的 prepare 返回 `READ_ONLY_REVIEW_REQUIRED`。

分层候选为 **170 组**，全部 `registration-extension-difference`，成员 340 项，严格同合同组为 0；真实等价批准、只读审核、业务执行、真实模型请求均为 0。候选结果不进入模型常驻工具 schema。

离线 canonical 头为兼容 381 项/62,799 估算 token，新智能初始 2 项/421；这仅证明初始收窄与兼容，不是实际提供方 usage、缓存或成本验收，也不是工具准备成功后的 5,000 预算保证。

任务产物目录 `qmcp-4963-binding-candidates/` 中有完整检查日志、真实采集结果/指纹、profile 指标及前后配置哈希；不交付完整 raw 定义或业务响应样本。

## 当前环境与下一步

当前 DSH 的 cordis.yml、cordis.patch.yml、package.json、pnpm-lock.yaml 四文件前后 SHA-256 均未变化。真实采集进程内的主运行存储前后哈希一致；代码没有写入当前连接或 OAuth 授权存储。profile 清理结果见任务产物 profile-summary.json。

开发包版本仍为 0.2.101，安装包为 0.2.102；本次验证的是开发代码与明确选择的安装 Host，未将代码安装或发布到当前 DSH。旧 normalizeSmartEnterpriseScope 与 QCC_ENTERPRISE_SERVERS 的导入路径保留兼容导出。

两处修订可交付，**不等于阶段 1 完整验收通过**。下一步建议在独立分支对齐发行基线、保留已有 0.2.102 客户端修复，补可信明确来源/只读审核维护入口和实际客户端启停、恢复、清空/压缩路径；先验收不合并真实来源的按需加载，再按独立授权补 v4-pro/flash 的真实请求、usage、缓存与成本。真实等价批准及生产启用继续单独控制。
