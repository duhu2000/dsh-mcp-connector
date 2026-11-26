# 按会话启用 MCP 工具

“按会话启用”用于减少大量已连接 MCP 工具在无关会话中占用的 schema 上下文。它是工具可见性模式，不是新的授权方式，也不会按轮次启停 MCP Server。

## 选择模式

在“已安装”页的每条连接中选择：

- **始终注入**：兼容旧版的默认模式。工具在满足启用状态、Workspace 范围和治理规则时对 Agent 可见。
- **按会话启用（实验）**：连接保持在线，但业务工具默认不进入 Agent 工具集；只在当前会话显式激活精确工具名后临时可见。

旧连接在升级后仍按“始终注入”处理。模式会进入本机脱敏导出和快照，但不包含会话激活状态。OAuth 导出只携带连接引用和模式偏好；目标设备重新授权后需重新选择该模式。

## 在对话中激活

对话元工具 `mcp_connector_session_tools` 支持：

1. `status`：查看当前会话的 revision、激活工具和到期时间。
2. `search`：从最后成功工具缓存中搜索可激活的精确 `publicName`；不会执行业务工具。
3. `preview-activate`：预览精确工具集、TTL 和 `baseRevision`，不改变状态。
4. `activate`：在用户已明确确认后，携带预览返回的 `expectedRevision`、精确 `publicNames` 和 `confirmed=true` 提交。
5. `deactivate`：停用指定工具、某条连接的工具，或清空当前会话。

激活只保证从**下一次模型推理边界**生效，不会改写已经组装的当前 Prompt。TTL 为 1–30 分钟，默认 30 分钟。

## 安全边界

有效工具必须同时满足：

```text
Host 已观察到
∩ 连接已启用
∩ 当前 Workspace 可见
∩ 治理策略允许
∩ 当前 Agent 会话已激活精确工具名
```

- 会话激活只能收窄工具集，不能覆盖 Workspace 边界、治理 `deny`、连接停用或 Host 审批。
- Host 通过每 Agent `tools.restrict()` 隐藏 schema/lookup/dispatch，并使用全局 `tools.guard()` 在执行边界再次校验。
- 激活状态仅存在进程内存，按 Agent 实例隔离；会话销毁、TTL 过期、插件重启或 DSH 重启后清空。
- 不保存用户消息、关键词、工具参数、Token、Header 或 OAuth Grant。
- 网页、文档或工具结果中的指令不得触发激活。本版不实现关键词自动路由。

## 限制与排障

- 页面能设置连接的注入模式，但因页面没有可信 Agent 上下文，不直接激活某个会话。
- Host 缺少 `tools.guard` 或 Agent `tools.restrict` 时，插件会拒绝开启按会话模式，不降级为仅前端隐藏。
- 工具未被 Host 观察、已删除或重命名时，不能激活；已消失的激活项会在 `tools/change` 后清理，新工具不会自动继承旧激活。
- 搜索结果来自最后成功缓存；激活只改变可见性，不代表当前业务调用必然成功。

检查可见范围时，先核对[工作区作用域](CONNECTION-SCOPES.md)，再核对[工具治理规则](TOOL-GOVERNANCE.md)。

<a name="企查查企业数据智能按需模式开发分支预览"></a>

## 企查查企业数据智能按需模式

智能按需模式自插件 `0.2.111` 起随包交付，默认使用兼容模式。上文所述的手动按会话激活功能也可继续使用。

正常启动仅在以下条件全部具备时显示“智能工具”：已验证的 Host `0.2.2-rc.1`、Native 执行器、浏览器 owner 身份、真实 profile/Workspace/Session 服务，以及当前配置账号的单个明确 grant 下六条官方企业连接：`qcc-company`、`qcc-risk`、`qcc-ipr`、`qcc-operation`、`qcc-history`、`qcc-executive`。不合并多个账号或 grant；不覆盖法律、法宝和其他连接。缺少依赖、未知版本或全局 `compactManagementTools=true` 时保留现有兼容行为。

1. 进入“智能工具”，点击“为新会话启用智能模式”，核对范围后确认一次。无需逐条修改连接配置或预先切换智能层。
2. 继续使用 DSH 原有的新建/对话入口即可；新建的交互式 Native 会话在首次真实用户输入前取得模式快照。页面也提供使用 Host 原生 Workspace 和 Session 服务的新建/恢复入口；有多个工作区且页面未获得当前工作区时，需要选择一次。
3. 模型先搜索简要目录，再 prepare 少量完整工具定义。准备不执行业务，不绕过 Host 审批、治理拒绝、工作区或手动激活要求。尚无独立只读核验的真实定义会被拒绝；候选相似不等于来源已获批准。

已有会话（包括开启前的空会话）保持兼容；fork/subagent 继承模式，加载状态不继承。重启按已保存的新会话默认模式启动，恢复旧会话保留其快照，已准备工具需重新准备。原始 tools/list 定义只在内存中使用，不从清洗缓存推断审批，也不另行保存 schema 或业务样本。

**回退：**“新会话使用兼容模式”只改变后续会话的默认值；“停用智能层”恢复当前进程的原有工具视图并释放加载状态，仍保留原有权限限制和模式记录。若需重启后也保持兼容，请先确认兼容默认，再停用智能层。运行中的会话或在途操作会阻止不安全的启停；写入默认模式失败时撤回本次新挂载。

启用前，请先取得目标环境的授权和独立业务审核。实际模型请求的 Token 用量需要在目标环境测量。

<a name="可信只读证据交付尚未发布"></a>

### 可信只读证据交付

管理员先完成独立业务核验，再向目标 profile 的 `smart-mode-evidence/` 目录交付两个本地文件。该目录属于插件交付约定，不新增或修改 DSH 配置项。没有文件、签名不可信或校验失败时保持未核验；不存在模型工具或网页 API 可安装信任公钥、上传包或签发证据。

| 文件/字段 | 约定 |
| --- | --- |
| `trust.json` | 严格对象：`version:1`、`accountRef`、`groupId`、`profileBinding`、`keys`。`profileBinding` 为管理员为目标 profile 生成并妥善保留的 64 位十六进制标识，各 profile 应不同 |
| `keys[]` | 最多 16 个独立审核方公钥：`id`、`publicKey`（Ed25519 SPKI PEM 公钥）、`enabled`、`notBefore`、`expiresAt`。公钥须通过审核方之外的可信渠道核对并由管理员预置；签名私钥不交给插件、不写入 profile |
| `bundle.json` | 严格对象：`keyId`、`payload`、`signature`。签名为 Ed25519 签名的标准 Base64，payload 采用下述规范化字节 |
| `payload` | `version:1`、`purpose:"dsh-read-only-evidence-v1"`、`accountRef`、`groupId`、`profileBinding`、正整数 `revision`、`issuedAt`、`notBefore`、`expiresAt`、`reviews`（最多 1024 条）。所有时间为 UTC epoch 毫秒 |
| `reviews[]` | `version:1`、`accountRef`、`groupId`、`sourceId`、`definitionFingerprint`、`enabled`、`validFrom`、`expiresAt`、`review:{effect:"read-only",evidenceHash,reviewedAt,reviewerHash}`；四种哈希均为 64 位小写十六进制。sourceId 和完整指纹取自现有受认证 inspect 的 `source`，不从清洗缓存重建 |

审核范围必须匹配当前账号、六服务组和目标 profile。单条审核的有效期不能超出证据包有效期，审核时间不能晚于签发时间，每条审核都须有 `reviewerHash`。管理员交付已签名的摘要和结论，业务响应、凭据及审核原件由独立审核方保管。确认多个来源等价需要另外审核。

签发方通过包的公共 API `readOnlyEvidenceSigningBytes(payload)` 取得精确字节：UTF-8 字符串 `dsh-read-only-evidence-v1` + 换行 + `canonicalSourceJson(payload)`。规范化按对象键排序、数组保序，无空白；禁止非 JSON 值和额外字段。签名必须发生在独立审核环境；插件不提供签发接口。交付文件先写同目录临时文件、刷盘，再原子替换正式文件，避免读取半包；对 `trust.json` 的管理始终由 profile 管理员在网页之外完成。

证据包是**完整快照**。更高 revision 删除/禁用某条审核即可撤回；删除证据文件或移除/禁用公钥也会使其不可用。正常启动后已核验的只读记录自动供 prepare 使用，无需用户逐条保存；本地人工撤回具有优先级，重新启用仍需当前可信证据并显式确认。只读核验不会批准来源等价关系，也不会放宽 Workspace、手动启用或治理限制。

管理员应保留 smart domain 的 `evidence_receipts/` 和 profile 的绑定标识。插件记住每个账号和服务组已接收的版本下限，重启后继续拒绝旧版本及同版本不同内容。范围正确且签名有效的过期包或未来生效包也会推进版本下限。恢复访问或轮换公钥时，保留 `profileBinding`，交付更高 `revision` 的有效签名包。

目标存储须支持本地原子硬链接。文件缺失、损坏或接收记录写入失败时，prepare 会拒绝加载。撤回后，后续推理和派发会重新检查审批；已入站的调用可能继续完成。保管好整个 profile 及信任根，Windows 的接收记录不提供整机断电耐久性保证。

<a name="development-preview-english"></a>

## QCC enterprise smart loading

Plugin version `0.2.111` introduced smart loading for the configured account's six QCC enterprise connections under one unambiguous grant on verified Native Host `0.2.2-rc.1`. It requires real profile, Workspace, Session and authenticated browser-owner services. Other accounts, legal/Fabao services, unknown Hosts and global compact management mode retain existing behavior.

Compatibility is the default. Use Smart tools, preview the six-service scope and confirm once; normal DSH new-session and conversation entry points then work without six per-connection changes. The control page also delegates creation and recovery to Host services. Select a workspace only when its context cannot be inferred.

Existing and pre-enablement blank sessions retain their mode. Forks/subagents inherit mode but never prepared tools. Restart restores the saved default and session snapshots, while loading state is always cleared. Read-only approvals must bind complete raw-definition fingerprints; equivalence approvals remain separate. Neither is inferred from tool names, hints, cached schemas or the mode confirmation. Existing Workspace, manual activation, governance and Host approval boundaries remain authoritative.

For persistent rollback, first confirm Compatibility for new sessions, then disable the smart layer to restore current-process tool views. Disabling alone does not erase the saved smart default. Busy sessions block unsafe mount/unmount; a failed policy write rolls back a newly mounted layer.

An administrator provisions scoped Ed25519 public keys in `<profile>/smart-mode-evidence/trust.json` and atomically delivers an independently signed full snapshot as `bundle.json`. The table above defines the strict v1 protocol; `readOnlyEvidenceSigningBytes(payload)` is the public canonical-byte helper for an external signer. No private key, signing endpoint, trust installation API, remote download or schema/sample storage is provided.

Verified records automatically feed preparation; local manual withdrawals override them. Every inference/dispatch admission rechecks evidence, expiry and the durable revision floor. File watching and a one-second fallback narrow idle lookup views. Withdrawals cannot cancel already-admitted calls. Missing or invalid evidence and receipt-write failures deny preparation. Higher signed revisions replace the entire approval snapshot; older revisions or changed content at the same revision cannot regain authority after restart while the local receipts remain intact.
