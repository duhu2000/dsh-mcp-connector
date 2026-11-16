# QMCP-4963 提测清单

后续独立验收发现并修复证据回执不确定写入后的持久化确认问题，新增四项会话/权限/回滚交叉测试和两项持久化回归。当前修订后完整回归为 1097 项（1092 通过、5 项既有跳过），提测入口为 359 项；下文 1091 / 353 为原 `ce02515` 交付基线。详情与逐项结论见 [独立验收报告](SMART-MODE-INDEPENDENT-ACCEPTANCE.md)，实际提测请使用修订包。

本轮冻结新增功能。统一分支为 `codex/qmcp-4963-pr`，对应 PR #243；已汇集 P1-01～P1-07、审阅修复、正常启动/权限/界面接入和可信只读证据交付校验。合入 main `377bfe9`（0.2.109），保留主线已有修复，不创建发行版本。此前分支与阶段报告保留历史，不作为并行提测入口。

## 可测与不可据此声称的范围

- 首期产品范围仍为当前配置账号、一个明确 grant 的 `qcc-company`、`qcc-risk`、`qcc-ipr`、`qcc-operation`、`qcc-history`、`qcc-executive`。其他账号、企查查法律、法宝与其他服务不在智能组内。
- 默认兼容。只有已验证 Native Host `0.2.2-rc.1` 和完整、唯一的六服务身份才提供智能能力；未知版本/能力不足回退兼容，不宣称 PTC 或其他 Host 已验收。
- 本提测环境使用真实 Host 模块与正常插件 `apply()`、独立临时 profile、JSONL、真实浏览器身份校验；OAuth、连接存储/Loader、工作区清单与模型适配器是合成夹具。运行库锚点只解析 SDK，不读取该 profile 的配置、会话或凭据，也不运行 `dsh` CLI。
- 所有远端 MCP 元数据请求均由内存夹具响应。业务执行成功/失败/取消测试只运行纯本地合成函数；没有真实业务或模型调用。手工测试签名器仅接受 `synthetic-grant-a` 与 `fixture_*`，私钥只在进程内，合成公钥只写临时 profile；没有真实只读/来源批准或真实信任部署。
- 这是工程与界面提测，尚未验收真实账号业务语义、实际发行安装/升级、真实模型 A/B 或生产启用。测试人员不得把提测包安装到现有日用 profile。

## 环境与启动

离线回归已验证 Node 22.22.1，CI 使用 Node 24。需要已安装的完整 Host `0.2.2-rc.1` SDK。若本机没有，可在提测源码旁的独立目录安装代码依赖，不启动 DSH；安装时建议 Node ≥24.9，满足 Host CLI 包自身的 engines 声明，本工具始终不执行 CLI：

```powershell
npm install --prefix .smart-host-runtime --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.2.2-rc.1
```

在源码根目录安装测试依赖（提测 ZIP 内为 `source` 目录）：

Host 独立安装必须保留 npm 自动 peer 安装，不能加 `--legacy-peer-deps`，否则会遗漏 `dsh-scope` / `dsh-compaction` 等必要 SDK。下方插件源码安装使用该选项，避免拼装另一套不完整 Host；两个安装目录和用途不同。

```powershell
npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund
node scripts/run-smart-mode-qa.mjs check --anchor '<明确选择的 Host 安装目录/package.json>'
```

也可在提测 ZIP 根目录使用 `RUN-QA.ps1 -Mode Check -HostAnchor '<同上>' -InstallDependencies`。脚本仅在 ZIP 的 `source` 安装依赖。`--anchor` 必须指向能解析完整 Host SDK 的 package.json；缺失/版本不符直接失败，不把必要契约静默跳过。每次输出 `QA_RUN_DIR`，保留 `qa.log`、`result.json` 和无消息正文/凭据的 Host 指标回执。

界面基线与合成加载样例分别启动：

```powershell
node scripts/run-smart-mode-qa.mjs serve --anchor '<Host 安装目录/package.json>'
node scripts/run-smart-mode-qa.mjs serve --seeded --anchor '<Host 安装目录/package.json>'
```

二者只需运行一个。ZIP 根入口分别为 `-Mode Serve`、`-Mode Seeded`。先在浏览器打开输出的 `UI_QA_OPEN`，交换一次临时 Host 浏览器身份，再打开 `UI_QA_CONTROL`；`?uiLocale=en` 切换英文。令牌、cookie 均不打印或写报告。

基线初始为 compat / 智能层停用，不预置批准。seeded 仅在临时环境预建一个旧 compat 会话、两个 smart 会话，为 `fixture_*` 自动生成合成只读签名证据，并只在输出标记为 `prepared` 的会话 prepare 一项；`isolated` 保持零加载。该样例启动后的默认 smart 仅属于临时 profile，不表示生产启用；没有来源等价批准。

页面不是完整聊天前端。正常模式快照在首次可信交互输入前确定；页面新建的空会话暂为兼容是预期。首次输入、fork/subagent、恢复与实际工具视图由自动化契约验证；seeded 为手工检查提供已输入的样例。

**正常停止：** 在第二个终端对输出的 `QA_STOP_FILE` 执行 `New-Item -ItemType File -Path '<该文件>'`，等待 `QA_RESULT` 与进程退出。会关闭服务并删除临时 profile；日志目录保留。驻留上限 30 分钟，超时会清理并以失败退出，不能把超时当作通过。不要依赖关闭窗口或强杀进程完成清理。

## 测试项与通过标准

| 编号 | 操作 / 自动化位置 | 通过标准 |
| --- | --- | --- |
| QA-01 环境隔离 | 运行 `check`；检查输出的临时 profile 回执 | 必要契约全部执行、零跳过；配置未加载，真实业务/模型为 0，退出后临时 profile 不存在 |
| QA-02 兼容启动 | 基线 `serve` 打开页面；生产 Host 回归 | 默认 compat / 层停用；原 25 管理工具与既有业务视图保留；没有可信证据不能 prepare |
| QA-03 一次启用与取消 | 预览启用后取消，再预览确认；`smart-mode-production-host.test.mjs` | 取消不写策略；确认先预检、再落盘；只影响新会话，开启前及空会话兼容；写盘失败完整撤回 |
| QA-04 新旧会话隔离 | seeded 样例切换 compat / prepared / isolated | 旧 compat 保留模式；prepared 为 1，isolated 为 0；schema、lookup、dispatch 都不能跨会话加载 |
| QA-05 Host 生命周期 | `smart-mode-lifecycle-host.test.mjs`、`smart-mode-integration-host.test.mjs` | fork/subagent 继承模式不继承加载；恢复保留模式但重新 prepare；新旧、未知/损坏快照和重复事件按既定契约处理 |
| QA-06 权限与多账号 | restrictions / bindings / source-selection / production-host 回归 | 连接状态、Workspace、治理、手动激活同时生效；多 grant 不猜测或合并；明确来源被拒绝不换源；模型不能伪造用户明确来源 |
| QA-07 候选与指纹 | seeded 查找 `fixture`、查看完整定义；source-relations 回归 | 四个未经等价批准的来源保持分离；完整原始定义参与指纹，缓存清洗不改变证据；未知/不兼容变化、过期和 kill switch 及时拒绝 |
| QA-08 按需准备 | `smart-mode-prepare.test.mjs` 与 evidence-host 回归 | 无核验拒绝；签名核验绑定账号/组/profile/完整指纹；加载前重新查权限和来源；prepare 不执行业务；失败、撤权及竞争回滚 |
| QA-09 证据安全 | read-only-evidence / evidence-host 回归；seeded 撤回核验 | 篡改、缺失、过期、失信密钥、回放、写失败都封闭；局部撤回优先于签名；模型和页面不能安装信任或签名；撤回后加载归零 |
| QA-10 预算 / TTL / 在途 | smart-mode-resources 与 lifecycle-host 回归 | 两入口计入组内预算；固定/滑动 TTL、LRU、批次和在途保护、并发/取消及忙碌回滚按契约；不影响另一会话 |
| QA-11 清空 / 压缩 / 冷恢复 | seeded 确认清空、执行压缩；integration-host / production-host 回归 | 清空释放本会话加载，保留历史/模式；压缩走 Host 原生命令与离线适配器；新 Host 从 JSONL 恢复不复活旧加载 |
| QA-12 整层回退 | 页面改默认 compat，停用层；自动化冷启动 | 现有会话模式不追溯修改；层停用恢复兼容工具视图且保留其他权限；重新挂载仍复核证据，不恢复加载 |
| QA-13 身份 / 界面 | 未登录、伪造 cookie、错误 Origin、签名 API operator；中英文 / Workspace | 未授权均 403；管理入口需真实浏览器 owner + CSRF；工作区选择保留，预览确认/取消明确，中英文无页面异常 |
| QA-14 打包与交付 | SHA256SUMS、MANIFEST、npm verify-pack、ZIP 启动回归 | commit / main / 包摘要一致；源码不含 .git、node_modules、真实原始定义或凭据；runtime 包不含夹具、签发器和工程报告 |

## 验收计量与本轮结果

预算仅包含六企业 Server 的本期工具定义和两个管理入口，使用 DSH `JSON.stringify(...).length / 4 + 4` 及实际取整；初始目标 ≤1,500，加载后 ≤5,000。90% 只能对同一六服务范围的全量定义声明，不能推广到其他连接、完整请求、usage 或费用。真实目录 356 个工具 / 186 个不同 raw name / 170 个候选重复条目仍只是元数据证据，未批准等价关系。

本轮 Node 22.22.1 合并后 `npm run check`：**1,091 项，1,086 通过、0 失败、0 取消、5 项原有跳过**；包括 lint、文档/元数据、教程及 npm 包白名单/安全校验，发布文件仍为 144 个。五项跳过是 Windows 环境变量大小写、独立 Web E2E 和三项独立 SDK 启动保护；不含本期 Host 契约。

新的提测命令 `check`：**353 项全部通过、零跳过**。驻留入口与自动化浏览器：8 组流程通过，页面异常 0、外部请求 0，正常停止后 profile 删除。首次驻留验证因浏览器开始前超过上限而清理，未计为通过；后以启动/浏览器/停止的连续流程完成复测。

最新主线合并敏感路径另在 Node 26.13.0 验证 catalog 代理、client、config 与 settings：137 项，136 通过、1 项 Windows 大小写跳过、零失败。该补测不扩展生产 Host 版本或 Node 的完整验收声明。

全新环境补验发现并修正两项测试交付问题：Host 安装遗漏必需 peer；Linux 写盘故障期间的 `state` 读同样会因 `ENOTDIR` 封闭失败。后者改为故障仍在时核对实际 Host 已恢复 25 入口/业务视图，移除障碍后再核对模式/revision 与重试，不放宽存储损坏的生产保护。两平台独立完成门禁，避免首个平台失败取消另一平台。

本清单是工程提测基线，不替代测试人员的独立结果。CI 的 Linux/Windows 完整智能 Host 契约与 PR 包构建在同一 head 上核对；远端状态和最终制品摘要见提测包附带 MANIFEST 与 PR #243，后续结果不得由旧阶段报告推断。

## 真实可用前的剩余事项

1. 用户审核 `get_company_registration_info` 的副作用、返回语义、计费/限流与有效期，补充可核查的业务证据；[核验材料](reviews/QMCP-4963/get-company-registration-info-review.md)和[登记表](reviews/QMCP-4963/review-register.json)保持未批准。
2. 获得后续明确授权后，独立交付真实只读签名证据及真实公钥，再进行限定次数的真实 prepare/调用与收益 A/B。只读批准不自动批准来源等价；来源关系需单独核验。
3. 测试人员完成本清单与单独的发行安装/升级/重启/回退验收，维护者审阅通过后，再分别决定合并、发布、受控灰度。当前不执行这些动作。
