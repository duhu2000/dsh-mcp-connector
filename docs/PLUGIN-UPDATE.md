# MCP连接器插件更新协议

MCP连接器把“刷新连接器目录”和“升级插件代码”视为两个独立动作：前者只重新拉取 Registry 卡片，后者必须由当前 DSH 宿主中可用的安全 Update Provider 执行。

## 分层与 Provider 适配

版本发现与更新执行彻底分离：

- MCP连接器自己的 Host 检查 npm `latest` 与 GitHub Release，所有安装方式都可显示已安装版本和新版本提示。
- 客户端通过 `UPDATE_PROVIDER_ADAPTERS` 按顺序探测 Provider。UI 只调用统一的 `probe` / `check` / `start` / `operation` / `rollback` / `restart` 能力，不持有市场私有路由。
- DSH Market API v1 是首个 Provider 适配器。后续可在不改动更新 UI 状态机的前提下增加 DSH 原生能力或其他插件市场的版本化协议适配器。

## 能力协商

每个 Provider 适配器只硬编码自己的 capabilities 入口，其余更新、任务、回滚和重启端点均从能力响应中读取。客户端只接受当前 DSH 页面的相对同源端点，拒绝跨域 URL、协议不匹配、缺少必要端点或未声明 `features.update` 的 Provider。

DSH Market 适配器从 `GET /dsh-market/api/v1/capabilities` 开始，要求 `schema: dsh-market/update-api/v1` 与 `apiVersion: 1`。未安装任何可用 Provider、接口返回 404、协议不兼容或检查失败时，页面不会尝试私有更新路由，而是显示“查看更新方式”。页面会先尝试打开当前宿主的插件市场；设置入口不可用，或 DSH Desktop 设置中实际没有插件市场分区时，打开 npm 包页面与安装命令说明。

## 更新流程

1. 插件自己的服务端缓存检查 npm `latest` 与 GitHub Release，只在 npm 已有可安装新版本时提示升级。
2. 选中的 Provider 再检查本 profile 中 `dsh-mcp-connector` 的实际安装版本和目标版本。
3. 用户点击“一键更新”后，Provider 立即返回 `operationId`；页面通过适配器轮询任务状态，展示排队、解析、下载和安装进度。
4. Provider 报告成功后，页面仍会独立校验 `beforeVersion`、点击时的预期版本与 `installedVersion`。降级、目标不一致或无效结果会被拒绝；Provider 保留恢复点时自动回滚，不向用户展示重启。
5. 完整性校验通过后，按 Provider 返回的激活结论展示“刷新生效”或重启提示。Web 且 Provider 明确允许进程重启时才展示“立即重启”；Desktop 等由外壳管理生命周期的宿主只提示用户重启，不自行杀进程。
6. Provider 保留恢复点时展示“回滚”。回滚仍由 Provider 执行，MCP连接器不直接修改 profile、lockfile 或 `node_modules`。

Provider 读取的是 profile 中已经落盘的插件版本，标题版本来自当前运行中的插件进程。若 Provider 报告磁盘版本高于运行版本且已无后续更新，页面会显示“已安装，重启后生效”，并按 Provider 能力展示“立即重启”或宿主重启提示；此时不再重复给出同一版本的安装命令。

失败结果使用稳定代码区分正在运行的 Agent、其他安装任务占用、发布安全等待、镜像同步、版本未变化、超时和权限拒绝，以及 `DOWNGRADE_DETECTED`、`RESOLVED_VERSION_MISMATCH`、`INVALID_UPDATE_RESULT` 三类完整性故障。`RELEASE_TOO_FRESH` 明确显示为约 24 小时的发布安全等待期，并提供“立即更新（跳过等待）”；真正的镜像同步故障保留独立提示，不再混用同一文案。

当 DSH Desktop 或其他宿主没有兼容 Update Provider 时，标题区直接展示绑定 npm 精确版本的 CLI 命令，例如 `dsh plugin --profile web add --config.minimumReleaseAge=0 dsh-mcp-connector@<目标版本>`，并提供复制按钮与 npm 页面入口。运行时会把 `<目标版本>` 替换为 npm 已发布的确切版本；命令中的单次覆盖只用于用户主动跳过本次发布安全等待。Connector 仍不自行执行包管理器命令。

## 安全边界

- 所有变更请求均为浏览器同源 POST，并继续接受 Provider 自身的 Origin、环回地址和运行中任务保护。
- MCP连接器不执行 `npm`/`pnpm`、不保存回滚 Token，也不复制任何 Provider 的安装算法。
- 重启按钮完全服从能力响应；接口未声明支持时不得构造其他进程控制路径。
- 更新任务属于当前 Host 进程。Host 已更换后，旧页面的任务编号自然失效，避免把旧进度误认为新进程状态。
