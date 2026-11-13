# QMCP-4963 · 授权排查与六 Server 真实元数据补验

2026-11-13，Asia/Shanghai。独立分支 `codex/qmcp-4963-real-metadata-baseline`，代码基线 `ba03f9d`，安装连接器 0.2.102，隔离运行时使用已安装 Host 0.2.2-rc.1。本轮只推进授权排查/恢复检查、真实目录采集及隔离验证，不实施新的产品功能。

**结论：先前的 401 当前已解除，六路真实 tools/list、完整指纹及原请求输入比对完成；历史连接缺少 serverKey 的直接接入仍被开发适配器拒绝，阶段 1 完整验收不能关闭。** 规范化映射只用于独立临时 profile，不能冒称当前原始记录已经兼容。

English: All six live metadata listings succeeded with the account's existing renewed authorization. All 356 raw input schemas match the archived real request. Isolated compatibility/smart headers and unreviewed-prepare rejection passed using a catalog-verified temporary binding view. Original historical records omit serverKey and remain rejected by the strict adapter; no production enablement or equivalence approval occurred.

## 1. 授权与 401 排查

- 内置浏览器打开用户提供的本机 DSH，连接器页面显示 0.2.102，六个企业 Server 均已连接，可用性检查通过。没有点击更新、注入模式、停用、断开、授权或发送消息按钮。
- 采集前只读核对当前账号 grant：更新时间 **2026-11-13 16:30:33 +08**，访问令牌有效期至 **17:30:33 +08**；主存储与独立 journal 的更新时间及访问凭据相同。本轮开始的文件快照时间为 **16:35:06 +08**，该授权更新早于本轮快照及目录请求。
- 因当前授权已有效，不再手动消耗 refresh token，也未发起重新授权、扩大 scope 或延长访问权限。只有现有凭据在本地请求进程内用于已配置的六个 Server。
- 当前同一组 URL 和账号绑定下，initialize 与 tools/list 均成功，证明上轮阻塞不再复现。现有证据能确认授权已更新并恢复可用，**不能精确区分旧令牌过期、撤销或其他服务端鉴权拒绝**；上轮未保留旧令牌正文/exp 或服务端拒绝日志，不能补造具体原因。

## 2. 真实目录与原请求对照

| Server | 完整原始定义数 | 页数 |
| --- | ---: | ---: |
| qcc-company | 186 | 1 |
| qcc-risk | 38 | 1 |
| qcc-ipr | 18 | 1 |
| qcc-operation | 36 | 1 |
| qcc-history | 34 | 1 |
| qcc-executive | 44 | 1 |
| 合计 | **356** | **6** |

六条连接属于同一 grant。每个 Server 经 initialize、notifications/initialized、tools/list 返回完整元数据，协议 2025-03-26，均未分配 MCP session ID。没有 tools/call；传输围栏禁止跳转到其他 URL 或通过重定向转发凭据。

本轮共执行三轮有明确目的的六路采集：第一轮暴露历史绑定兼容问题；第二轮在明确临时映射后验证隔离；第三轮定位严格候选为零的字段差异并保留最终证据。合计 **18 次 initialize、18 次 initialized 通知、18 次 tools/list**，没有 DELETE 或业务请求。每轮均为 12 个 HTTP 200 和 6 个 HTTP 202。

356 个 public name 均在阶段 0 的实际请求头中存在，**356/356 原始 inputSchema 与原请求 parameters 的规范 JSON 指纹一致**。完整 raw 指纹直接来自本轮 tools/list，包含服务端扩展字段，不使用裁剪缓存或旧模型请求头补齐 raw。

只保留工具身份、哈希、字段名、计数及审核结论。完整原始定义和调用样本没有写入交付产物；Host 离线请求投影曾进入临时 JSONL 会话，临时 profile 均已关闭并删除。原请求头属于上轮实际请求，本轮没有新的真实模型请求、usage、缓存或成本数据。

## 3. 两个新增的真实数据边界

### 历史连接没有 serverKey

六条真实连接都没有 `serverKey`。现有 `connectionRecordSchema` 允许该字段缺失，历史连接属于合法存量格式；但 `smart-mode-restrictions.js` 和 `smart-mode-discovery.js` 的严格检查要求它等于绑定的 server ID。

第一轮真实接入因此返回 `GROUP_BINDING_CHANGED`，保持拒绝状态；该失败未删除、未当成采集失败重授权，也没有写回当前连接。失败证据为 `legacy-binding-failure.json`、`legacy-binding-attempt.log`。

后两轮仅在临时运行视图补入 serverKey：逐一核对仓库既有 catalog 的 connector、serverName、精确 URL 和 serverKey，六路全部唯一匹配；保留原 connection key 和唯一 grant 绑定。catalog SHA-256 随结果记录。**这是一项受控验证映射，不是产品兼容修复；当前磁盘记录和产品检查逻辑均未改动。**

### 同名同输入不等于完整候选指纹相同

真实目录有 **186 个不同 raw name，170 组重复 raw name（340 个条目）**；170 组的 inputSchema 均完全相同。逐字段比对发现，这些重复组的原始定义只在 **`_registration_tool`** 扩展字段上不同。

目前候选指纹只排除顶层 title/description，仍纳入 `_registration_tool`，所以严格算法产出 **0 个候选组**。这不意味着没有重复能力，也不能据此认定该扩展字段可忽略。完整定义指纹必须继续保留它；本轮仅记录“同名同输入、扩展字段不同”的待核验观察。

本轮 raw 字段为 name、title、description、inputSchema、annotations、`_registration_tool`，未提供 outputSchema。目录一致性不能证明返回语义、计费、限流、新鲜度或只读性。**真实等价关系批准数、真实只读审核数均为 0。**

## 4. 隔离 profile 验证结果

在上述明确临时映射下，使用开发基线与实际安装 Host、真实 JSONL 后端、离线模型适配器验证：

| 场景 | 观察结果 | 结论边界 |
| --- | --- | --- |
| 默认开启前创建的兼容会话 | 六路业务 356 + 原管理入口 25，共 381 项；估算 62,799 token | 开发代码的离线 canonical 头，不是新提供方请求 |
| 临时 profile 开启默认后新建智能会话 | 只有两个管理入口；估算 421 token | 仅验证零业务工具准备的初始状态 |
| 对真实 source ID 执行 prepare | `READ_ONLY_REVIEW_REQUIRED`；已准备业务工具 0 项 | 没有用前缀、annotations 或候选相似度生成审核 |
| 凭据与执行 | 临时 profile 不含 OAuth 凭据；业务函数执行 0、真实模型请求 0 | 没有远端业务 canary |
| 落盘与清理 | 三个临时 profile；两次成功运行各保留两个离线 Session；四个离线请求；三个 profile 全部删除 | 第一轮失败 profile 也已关闭清理 |

估算统一为 `ceil(JSON.stringify(tools).length / 4) + 4`。阶段 0 的实际六路加管理入口估算为 62,767；本轮离线头由开发版管理工具和 Host 投影生成，不能将两者差额当作提供方 token 或费用变化。421 只证明初始工具头可收窄，**不等于真实使用场景已满足 5,000/90% 或阶段 1 最终验收**。

## 5. 配置、交付与复现边界

本轮当前 DSH 的 `cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-lock.yaml` 四个监控文件，前后 SHA-256 全部一致。没有修改产品代码、安装包、当前连接记录、注入模式或生产智能设置；只新增报告和任务产物中的采集/分析脚本。

`mcp_connector.json` 整体哈希与开始时不同。浏览器中观察到现有 Host 持续更新可用性时间；本轮未保存开始时的存储正文，不能把所有字段变化逐一归因。两个成功采集进程各自的存储前后哈希一致，grant 更新时间始终是 16:30:33。本轮未执行对当前存储的写入，也没有用“配置未变”冒称整个运行存储未变。

证据目录为当前任务产物中的 `qmcp-4963-auth-metadata-recheck/`：

- `auth-status.json`：无凭据的授权时间和 journal 核对。
- `raw-discovery-fingerprints.json`、`real-discovery-results.json`：356 项指纹、重复差异、临时映射边界及两类会话指标。
- `legacy-binding-failure.json`：原始历史记录被严格检查拒绝的证据。
- `real-discovery-final.log`：六路采集和离线验证计数。
- `profile-summary.json`、`before.json`、`after.json`：清理及文件哈希核对。
- `validate-real-discovery.mjs`：仅元数据请求、无业务执行、无真实审核、无真实推理的复用脚本。

本轮没有改产品代码，因此没有重复运行整套 883 项回归；实际运行的是上述三轮真实元数据验证。上一轮 878 通过、0 失败、5 原有跳过的记录仍只代表其原有代码与验证范围。

## 6. 建议的下一轮步骤（本轮未实施）

1. **先修复历史绑定兼容。** 为缺少 serverKey 的合法存量记录建立只读有效绑定视图，必须同时核对 connector、唯一 catalog server、精确 URL/transport、grant 和 connection key；存在冲突或显式错误 serverKey 时继续拒绝。发现、schema、lookup、dispatch 使用同一视图，不回写当前配置；补多账号、端点变化、歧义及真实元数据回归。
2. **补候选分层。** 保持完整 raw 指纹包含 `_registration_tool`；将仅该字段不同的观察列为明确待核验候选，并确认服务端字段语义。候选不得生成已批准关系、canonical 合并或自动换源。
3. 上述修订验证后，再推进可信明确来源、只读审核维护的客户端路径，并按独立授权补真实模型收益验收。真实业务、真实等价批准与生产启用继续单独控制。

**本轮第 1、2 项排查与真实目录补采已完成；产品历史记录兼容和候选识别边界已明确暴露，尚未修复。阶段 1 完整验收及生产灰度仍未获通过。**
