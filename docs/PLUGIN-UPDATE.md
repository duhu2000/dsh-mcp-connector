# MCP连接器插件更新协议

MCP连接器把“刷新连接器目录”和“升级插件代码”视为两个独立动作：前者只重新拉取 Registry 卡片，后者必须由当前 DSH 宿主中可用的安全 Update Provider 执行。

## 分层与 Provider 适配

版本发现与更新执行彻底分离：

- MCP连接器自己的 Host 检查 npm `latest` 与 GitHub Release，所有安装方式都可显示已安装版本和新版本提示。
- 客户端通过 `UPDATE_PROVIDER_ADAPTERS` 按顺序探测 Provider。UI 只调用统一的 `probe` / `check` / `start` / `operation` / `rollback` / `restart` 能力，不持有市场私有路由。
- DSH Market API v1 是首个 Provider 适配器。后续可在不改动更新 UI 状态机的前提下增加 DSH 原生能力或其他插件市场的版本化协议适配器。

## 能力协商

每个 Provider 适配器只硬编码自己的 capabilities 入口，其余更新、任务、回滚和重启端点均从能力响应中读取。客户端只接受当前 DSH 页面的相对同源端点，拒绝跨域 URL、协议不匹配、缺少必要端点或未声明 `features.update` 的 Provider。

DSH Market 适配器从 `GET /dsh-market/api/v1/capabilities` 开始，要求 `schema: dsh-market/update-api/v1` 与 `apiVersion: 1`。未安装任何可用 Provider、接口返回 404、协议不兼容或检查失败时，页面进入下述手动升级流程，不会尝试私有更新路由。已有 Provider 的失败流程仍可通过“查看更新方式”打开宿主插件市场或 npm 页面。

## 更新流程

1. 插件自己的服务端缓存检查 npm `latest` 与 GitHub Release，只在 npm 已有可安装新版本时提示升级。
2. 选中的 Provider 再检查本 profile 中 `dsh-mcp-connector` 的实际安装版本和目标版本。
3. 用户点击“一键更新”后，Provider 立即返回 `operationId`；页面通过适配器轮询任务状态，展示排队、解析、下载和安装进度。
4. Provider 报告成功后，页面仍会独立校验 `beforeVersion`、点击时的预期版本与 `installedVersion`。降级、目标不一致或无效结果会被拒绝；Provider 保留恢复点时自动回滚，不向用户展示重启。
5. 完整性校验通过后，按 Provider 返回的激活结论展示“刷新生效”或重启提示。Web 且 Provider 明确允许进程重启时才展示“立即重启”；Desktop 等由外壳管理生命周期的宿主只提示用户重启，不自行杀进程。
6. Provider 保留恢复点时展示“回滚”。回滚仍由 Provider 执行，MCP连接器不直接修改 profile、lockfile 或 `node_modules`。

Provider 读取的是 profile 中已经落盘的插件版本，标题版本来自当前运行中的插件进程。若 Provider 报告磁盘版本高于运行版本且已无后续更新，页面会显示“已安装，重启后生效”，并按 Provider 能力展示“立即重启”或宿主重启提示；此时不再重复给出同一版本的安装命令。

失败结果使用稳定代码区分正在运行的 Agent、其他安装任务占用、发布安全等待、镜像同步、版本未变化、超时和权限拒绝，以及 `DOWNGRADE_DETECTED`、`RESOLVED_VERSION_MISMATCH`、`INVALID_UPDATE_RESULT` 三类完整性故障。`RELEASE_TOO_FRESH` 明确显示为约 24 小时的发布安全等待期，并提供“立即更新（跳过等待）”；真正的镜像同步故障保留独立提示，不再混用同一文案。

当 DSH Desktop 或其他宿主没有兼容 Update Provider 时，标题区展示绑定 npm 精确版本和当前 profile 的 CLI 命令，并提供复制按钮与 npm 页面入口。服务端每次请求只读取一次可选的 `profileContext.name`。`versionStatus.detail.profileName` 继续只返回可安全生成命令的名称或 `null`；新增的 `profileInfo` 只包含实际读取到的字符串 `detectedName`（或 `null`）和固定的 `status`，不包含本机目录、环境变量或异常原文。客户端不会根据窗口类型、网址或插件目录猜测 profile。

| `profileInfo.status` | 含义与界面行为 |
| --- | --- |
| `ready` | 已取得可安全生成命令的名称，沿用现有命令与复制按钮，不增加常驻说明 |
| `unavailable` | 宿主没有提供读取入口或 profile 服务，显示“宿主未提供 profile 信息” |
| `read-error` | 读取服务或名称发生异常，显示“读取当前 profile 失败” |
| `invalid-value` | 服务存在，但名称缺失、为空或不是字符串，显示“宿主未返回有效的 profile 名称” |
| `unsupported-name` | 已取得名称，但不符合自动生成命令的规则；显示名称及保留名称、首尾空白或字符规则原因，不提供默认候选命令 |

未取得有效名称时，客户可以通过“默认安装方式”选择“默认 Web（web）”或“默认 Desktop（desktop）”。初始不预选，也不显示命令；选择后才显示一条对应的候选命令与复制按钮，并注明“仅适用于默认安装；自定义部署请使用实际 profile”。这是客户选择的默认候选，不代表程序已识别当前 profile；不要依次执行两种命令。

Desktop 配套 CLI 示例：

```bash
dsh plugin --profile desktop add --config.minimumReleaseAge=0 dsh-mcp-connector@<目标版本>
```

默认 Web 示例：

```bash
dsh plugin --profile web add --config.minimumReleaseAge=0 dsh-mcp-connector@<目标版本>
```

运行时将 `<目标版本>` 替换为 npm 已发布的确切版本。自动识别的 profile 名称须满足 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，且不能是保留名称 `node_modules`；不受支持的名称只作为普通文本展示，空白和控制字符使用可见转义，不能进入命令。旧接口只有 `profileName` 时仍由客户端校验；缺失时按未取得信息处理。

未取得有效目标版本时，显示“未取得有效的目标版本，请点击‘检查更新’后重试”，不归因于 profile，也不显示命令或默认安装方式选择。手动升级诊断区保留“查看更新说明”和“查看 npm”；“查看更新说明”打开本文，不是查询客户 profile 的入口。

默认安装方式选择仅用于当前面板，不修改宿主配置。面板关闭、目标版本或诊断信息变化时清除选择；命令变化时清除“已复制”和复制失败提示，忽略旧命令迟到的复制结果。命令展示与复制使用同一字符串。

English: When the host cannot supply a usable profile name, the panel explains whether the information is unavailable, could not be read, or has an invalid value. No installation type is preselected. Choose **Default Web (web)** or **Default Desktop (desktop)** to reveal one candidate command for a default installation; custom deployments must use their actual profile. A detected but unsupported name is displayed as text with its reason and is never inserted into a command. Invalid target versions show a version-specific message. **View update instructions** opens this document; it does not look up the local profile. Closing the panel or changing the version or diagnostics clears the choice and copy feedback.

Desktop：先启动应用完成初始化，通过应用菜单“管理 dsh 命令…”注册或修复 Desktop 配套 CLI，然后完全退出应用，在新终端执行命令，完成后重新打开。[官方命令运行时说明](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/apps/desktop/README.zh.md#bundled-command-runtime)。npm 安装的 CLI 可能拒绝管理 `desktop`，不要改用 `web` 绕过限制。关闭窗口可能只会隐藏应用，请从应用或托盘菜单退出。设置了 `DSH_HOME` 时，终端必须沿用与宿主相同的值。

命令中的单次覆盖只用于用户主动跳过本次发布安全等待。Connector 仍不自行执行包管理器命令。

## 安全边界

- 所有变更请求均为浏览器同源 POST，并继续接受 Provider 自身的 Origin、环回地址和运行中任务保护。
- MCP连接器不执行 `npm`/`pnpm`、不保存回滚 Token，也不复制任何 Provider 的安装算法。
- 重启按钮完全服从能力响应；接口未声明支持时不得构造其他进程控制路径。
- 更新任务属于当前 Host 进程。Host 已更换后，旧页面的任务编号自然失效，避免把旧进度误认为新进程状态。
