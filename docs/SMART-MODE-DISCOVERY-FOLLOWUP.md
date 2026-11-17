# QMCP-4963 · 版本基线与原始发现接入补验

> 历史阶段记录 / Historical evidence. 当前 PR 完成范围与剩余验收统一见 [PR 审阅入口](SMART-MODE-PR-REVIEW.md)。

2026-11-13，Asia/Shanghai。分支 `codex/qmcp-4963-real-discovery`，基于 P1-07 `2cc78fd`。

本轮推进版本对照、六 Server 原始发现发布适配器及隔离契约验证。**阶段 1 完整验收仍未闭合：真实工具目录读取在第一个 Server 的 initialize 阶段返回 HTTP 401，没有取得本轮真实 raw 定义。** 没有以缓存或上轮模型请求头替代原始定义，没有执行 OAuth 刷新或重新授权。

English: This follow-up adds an opt-in, atomic raw discovery publisher and fail-closed view invalidation. Installed/development baselines are recorded separately. Live metadata acquisition failed at initialization with HTTP 401; real-account preparation and provider benefit acceptance remain unverified.

后续状态：同日授权可用后完成六路真实目录补采，新增历史绑定和扩展字段候选边界，见 [授权排查与真实元数据补验](./SMART-MODE-REAL-METADATA-ACCEPTANCE.md)。本报告保留原时点失败记录，不追溯改写成成功。

## 版本边界

| 验证对象 | 固定结果 | 边界 |
| --- | --- | --- |
| 开发代码 | 基于 P1-07 `2cc78fd`，package 版本仍为 0.2.101 | 本次提交不安装、不发布、不修改版本号 |
| 当前安装包 | 0.2.102 | 所对照的 68 个 lib/ui/catalog/registry 文件与本地已有 `origin/release/0.2.102` 引用一致，忽略 CRLF/LF 差异；不是对全部安装文件的证明 |
| 安装 Host | 0.2.2-rc.1 | 通过显式 profile package.json 锚点解析，隔离运行时不加载该 profile 配置 |

上游从开发基线 0.2.101 到 release 引用的运行文件变化在 `lib/client.js` 和英文 client 文案，涉及客户端会话导航/草稿。开发代码与安装包另外四个差异文件为本任务修改的 Host 工具名、管理工具、入口导出及英文工具文案。完整逐文件指纹在任务产物 `version-baseline.json`。

本轮固定了“测试谁”的证据，没有将安装版与开发版混为同一份代码，也没有把旧客户端代码的测试声称为 0.2.102 客户端验收。未来合入发行线时仍须保留最新客户端修复，并复测实际启停/清空/压缩入口。

## 接入与失效规则

- 新增 `createSmartModeDiscoveryPublisher()`，默认禁用，仅通过导出供显式隔离组合使用，生产 apply() 不挂载。
- 只接受一个账号/grant 下六个 enterprise Server 的既定连接绑定。核对连接 key、connector、server、OAuth grant、启停和可用性；其他账号不被查询。每个 Server 返回完整结果后重新比较所有连接记录摘要，防止原地修改端点、凭据绑定或启停状态后发布旧结果。
- 调用方必须直接提供完整 tools/list 返回，不接受安全裁剪缓存冒充 raw。复制完整 JSON，校验原始定义指纹和同名冲突，六个 Server 成功后一次发布。适配器不注册业务工具、不调用业务工具、不批准等价或只读结论。
- 并发 refresh 共享一个事务。发现开始前通过 CAS 使旧视图失效，失败不保留可派发的旧准备状态；成功仍需重新 prepare。失效优先保证安全，本轮不承诺无变化刷新可保留已准备工具。
- `invalidateViews()` 使已准备工具在 schema、lookup、dispatch 路径不可用；兼容会话继续使用原有工具。仅发布审核数据不能解除 raw 失效，必须重新发布完整 raw。延迟结果不能覆盖较新的视图，dispose 阻止迟到发布。
- 远端异常只向上抛稳定错误码，避免远端正文/URL/凭据进入日志。原始定义留在运行内存；适配器没有磁盘缓存或自动重试、定时刷新功能。
- 现有可信 `publishViews` 审核接口继续保留，未增加模型可用的审核或授权入口。可信明确来源的客户端入口、只读审核维护流程及真实审核结论仍属后续工作，不能由本适配器替代。

## 真实只读尝试

读取现有存储中的六条连接和唯一 grant，仅在本地请求进程内使用凭据。传输围栏只允许相同配置 URL 的 initialize、notifications/initialized、tools/list 和临时 MCP session DELETE，禁止重定向转发凭据。没有调用 tools/call，也没有连接真实模型。

2026-11-13 16:06:45 +08，`qcc-company` 第一次 initialize 返回 **HTTP 401**，本次立即停止，没有查询另外五个 Server，也没有创建本次真实元数据的 Host 验证 profile。只读核对现有 grant journal 与主存储：更新时间及访问凭据相同，不存在可直接采用的较新 journal 凭据。401 仅证明请求凭据被拒绝，不能据此断言是过期、撤权还是其他鉴权原因。

当前结果：initialize 1 次，成功 tools/list 0 次，本轮真实 raw 定义 0 项，真实来源批准 0，真实只读审核 0，真实业务调用 0，真实模型请求 0。`real-discovery-failure.json` 保存脱敏的状态码和计数，不保存凭据或响应正文。上轮实际请求基线继续有效于其原有时间与版本，不能伪装成本轮 raw 采集结果。

复用采集脚本已经准备好；恢复该账号有效授权后，仍只做元数据采集，在临时 profile 使用不含凭据的绑定和真实 raw 定义，离线模型验证新旧会话隔离。未批准只读审核时 prepare 必须返回 `READ_ONLY_REVIEW_REQUIRED`，不会为了验收通过而添加真实审核。

## 测试与环境核对

新增 9 项发现适配器测试和 2 项真实 Host 隔离测试，11 项全部通过，无新增跳过。覆盖完整指纹、六路原子发布、并发合并、失败无部分发布、账号/端点/启停变化、同名冲突、缓存拒绝、延迟结果/CAS、dispose、失败恢复，以及 schema/lookup/dispatch 阻断、兼容会话和无审核 prepare 拒绝。测试审核与工具定义均为合成数据，业务函数未执行。

完整检查：883 项，878 通过、0 失败、5 项原有跳过；打包白名单检查通过，共 135 项。完整日志在任务产物 `npm-check-final-node22.log`。首次全量运行曾出现既有 stdio 测试的 250ms 启动超时，记录保留在 `npm-check-node22.log`；单独复核及后续全量运行通过，没有修改该测试或放宽断言。

外部元数据测试入口默认审核为空，拒绝使用合成关系批准或合成业务执行，避免真实定义接入时误套夹具的默认只读结论。该保护与独立 profile 均有契约覆盖。

本轮开始已保存当前 DSH 四个监控文件哈希；结束时逐个比较 cordis.yml、cordis.patch.yml、package.json、pnpm-lock.yaml，四个文件均未变化。当前授权存储仅执行读取，没有刷新、写回、回退、重新安装或生产智能模式启用。

## 后续顺序与验收结论

1. 先恢复当前账号的有效授权，再运行已准备的只读采集；恢复授权涉及授权存储写入，未在本轮执行。六路真实 raw 齐全后再与上轮实际请求头比较，仅保存指纹与结论。
2. 补可信明确来源及只读审核维护的客户端路径；真实只读证据需独立核验，保持来源等价候选与批准分开。未批准真实等价关系时先验收“不合并、按需加载”路径。
3. 在明确发行基线的独立 profile 验证实际客户端启停/清空/压缩，再按独立授权范围补真实 v4-pro/flash 请求、usage、缓存与成本。5,000/90% 仅指六企业 Server + 两管理入口，不指整个会话。

本轮可交付发现适配器及其隔离契约，**不能标记真实发现通过、阶段 1 全部通过或进入生产灰度**。当前限制均保持：未修改当前 DSH 配置、未调用企查查业务工具、未批准真实来源关系、未启用生产智能模式。
