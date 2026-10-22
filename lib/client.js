window.__ModuleLoader__.load({
	id: "dsh-mcp-connector",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");

		/** 客户端所需服务：槽位、工作区、会话及对话输入机。 */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"conversation"
		];

		/**
		 * 客户端文案国际化。契约与 `lib/i18n` 完全一致：**msgid 就是中文原文**。
		 * 中文路径不查表，msgid 原样返回，因此默认中文界面逐字不变；缺译文时也
		 * 回退中文原文，不会出现空白或英文 key 漏到界面上。
		 *
		 * 客户端 bundle 是预编译产物，不能可靠地 import 服务器侧模块，所以这里
		 * 内置一份映射；`lib/i18n/locales/en/client.js` 保存同一批 msgid，让共享
		 * 英文词典保持完备（两份清单一一对应）。
		 */
		const MESSAGES_EN = Object.freeze({
			"MCP连接器": "MCP Connector",
			"控制侧边栏入口和快捷打开方式。": "Control how the MCP Connector is opened.",
			"在侧边栏显示 MCP连接器": "Show MCP Connector in the sidebar",
			"关闭后只隐藏入口，不影响已连接的 MCP Server 和工具。": "Turning this off only hides the shortcut. Connected MCP servers and tools remain available.",
			"侧边栏入口当前显示。": "The sidebar shortcut is visible.",
			"入口已隐藏，仍可从这里打开 MCP连接器。": "The shortcut is hidden. You can still open MCP Connector here.",
			"当前设置页只读。": "This settings page is read-only.",
			"正在保存…": "Saving…",
			"设置未保存，请重试。": "The setting was not saved. Please try again.",
			"恢复默认": "Reset",
			"打开 MCP连接器": "Open MCP Connector",
			"展开 MCP连接器设置": "Expand MCP Connector settings",
			"收起 MCP连接器设置": "Collapse MCP Connector settings",
			"{label} 更新接口版本不兼容": "{label} update API version is incompatible",
			"{label} 未返回更新任务编号": "{label} did not return an update operation id",
			"{label} 不支持回滚": "{label} does not support rollback",
			"{label} 不支持重启": "{label} does not support restart",
			"更新任务排队中…": "Update queued…",
			"正在更新 {percent}%": "Updating {percent}%",
			"正在更新：{phase}": "Updating: {phase}",
			"正在更新…": "Updating…",
			"有任务正在运行，请结束后重试": "A task is still running. Try again once it finishes.",
			"插件市场正在处理其他任务": "The plugin marketplace is busy with another task.",
			"新版本处于发布安全等待期（约 24 小时）": "The new release is in its 24-hour safety hold.",
			"镜像尚未同步完整安装包": "The mirror has not synced the complete package yet.",
			"下载后版本未变化": "The version did not change after download.",
			"已阻止版本降级": "The downgrade was blocked.",
			"下载版本与预期不一致": "The downloaded version does not match the expected version.",
			"更新服务未返回有效版本": "The update service did not return a valid version.",
			"更新超时": "The update timed out.",
			"更新请求被拒绝": "The update request was rejected.",
			"无法执行本次更新": "This update could not be performed.",
			"更新失败": "Update failed",
			"更新服务报告成功，但未返回有效的已安装版本": "The update service reported success but returned no valid installed version.",
			"更新服务将插件从 v{before} 降级到 v{installed}": "The update service downgraded the plugin from v{before} to v{installed}.",
			"预期安装 v{expected}，更新服务实际安装了 v{installed}": "Expected v{expected}, but the update service installed v{installed}.",
			"Prompt 不能为空": "Prompt cannot be empty",
			"请先选择一个工作空间，再使用示例 Prompt": "Select a workspace before using a sample prompt",
			"当前 DSH 版本没有可用的工作区会话创建能力，请升级 DSH 后重试": "This DSH version cannot create workspace sessions. Upgrade DSH and try again.",
			"DSH 对话服务尚未就绪，请稍后重试": "The DSH conversation service is not ready yet. Try again shortly.",
			"无效的 Prompt 请求": "Invalid prompt request",
			"已带入新会话": "Added to a new session",
			"正在启动更新…": "Starting the update…",
			"暂时无法读取进度，正在重试": "Progress is temporarily unavailable. Retrying…",
			"立即更新（跳过等待）": "Update now (skip the wait)",
			"强制重试": "Force retry",
			"重试更新": "Retry update",
			"检测到异常版本，正在自动回滚…": "An unexpected version was detected. Rolling back automatically…",
			"查看更新方式": "See update options",
			"已回滚": "Rolled back",
			"已阻止异常版本并回滚": "Blocked the unexpected version and rolled back",
			"已安装 v{version}": "Installed v{version}",
			"回滚失败": "Rollback failed",
			"正在重启…": "Restarting…",
			"立即重启": "Restart now",
			"重启由 {managedBy} 管理": "Restart is managed by {managedBy}",
			"宿主": "the Host",
			"请重启 DSH Desktop": "Restart DSH Desktop",
			"请重启 DSH": "Restart DSH",
			"刷新生效": "Refresh to apply",
			"正在回滚…": "Rolling back…",
			"重试回滚": "Retry rollback",
			"回滚": "Roll back",
			"更新服务调用失败": "The update service call failed",
			"正在准备更新…": "Preparing the update…",
			"由 {provider} 安全更新到 v{version}": "Update safely to v{version} via {provider}",
			"更新服务": "the update service",
			"一键更新到 v{version}": "Update to v{version}",
			"v{version} 已安装，重启后生效": "v{version} is installed and takes effect after a restart",
			"已复制": "Copied",
			"复制升级命令": "Copy upgrade command",
			"无法写入剪贴板，请点击上方命令全选后手动复制": "Could not write to the clipboard. Click the command above to select it, then copy it manually.",
			"查看 npm": "View on npm",
			"正在检查插件版本": "Checking the plugin version",
			"当前版本 v{version}": "Current version v{version}",
			"上次检查：{time}": "Last checked: {time}",
			"尚未完成版本检查": "No version check has run yet",
			"正在检查更新…": "Checking for updates…",
			"检查更新": "Check for updates",
			"插件 API 不可用，请检查 DSH 宿主兼容性或服务日志": "The plugin API is unavailable. Check DSH host compatibility or the service log.",
			"暂时无法确认 npm 最新版本，请重试": "Cannot confirm the latest npm version right now. Please try again.",
			"GitHub Release 已发布，等待 npm 同步后即可更新": "The GitHub release is published. Updating becomes available once npm syncs.",
			"v{version} 正在同步": "Syncing v{version}",
			"返回会话": "Back to session",
			"关闭 MCP连接器": "Close MCP Connector",
		});
		const DEFAULT_LOCALE = "zh-CN";
		/** 当前生效语言：`apply()` 时解析一次，缺省中文。 */
		let activeLocale = DEFAULT_LOCALE;

		/**
		 * 归一化语言标签：`zh` / `zh_CN` / `zh-Hans-CN` → `'zh-CN'`，
		 * `en` / `en-US` / `EN` → `'en'`；其它一律返回 undefined（由调用方回退）。
		 *
		 * @param {unknown} value 待归一化的标签
		 * @returns {"zh-CN"|"en"|undefined} 支持的语言 id
		 */
		function normalizeLocale(value) {
			if (typeof value !== "string") return undefined;
			const tag = value.trim().toLowerCase();
			if (tag === "") return undefined;
			const [primary] = tag.split(/[-_]/);
			if (primary === "zh") return "zh-CN";
			if (primary === "en") return "en";
			return undefined;
		}

		/**
		 * `{name}` 占位符插值，行为与 `lib/i18n` 的 `interpolate()` 一致：只替换
		 * 调用方显式提供的字段，缺失的占位符保持字面量，便于测试断言漏传参数。
		 *
		 * @param {string} template 含 `{name}` 的模板
		 * @param {Record<string, unknown>} [params] 插值字段
		 * @returns {string} 插值结果
		 */
		function interpolate(template, params) {
			if (typeof template !== "string" || template === "") return "";
			if (params === void 0 || params === null || typeof params !== "object") return template;
			return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => {
				const value = params[name];
				return value === void 0 || value === null ? token : String(value);
			});
		}

		/**
		 * 翻译函数。
		 *
		 * @param {string} msgid 中文原文
		 * @param {Record<string, unknown>} [params] `{name}` 插值字段
		 * @returns {string} 当前语言文案；缺译文回退中文原文
		 */
		function t(msgid, params) {
			const key = typeof msgid === "string" ? msgid : String(msgid ?? "");
			const template = activeLocale === DEFAULT_LOCALE
				? key
				: Object.hasOwn(MESSAGES_EN, key) ? MESSAGES_EN[key] : key;
			return interpolate(template, params);
		}

		/**
		 * 读取 DSH 的 `locale` 服务。该服务是**可选**依赖（见
		 * docs/DESIGN-issue-63-sidebar-visibility.md §6.6）：缺失或抛错时返回
		 * undefined，插件照常加载并回退中文，绝不把本地化变成硬依赖。
		 *
		 * @param {any} ctx 客户端上下文
		 * @returns {"zh-CN"|"en"|undefined} 服务报告的语言
		 */
		function localeFromService(ctx) {
			try {
				// 必须用 ctx.reflect.get(name)：`locale` 是可选的嵌套服务，并未写进
				// 本 bundle 的 inject 列表，而 Cordis 的上下文代理在读取未注入的属性时
				// 会直接抛 `cannot get property "locale" without inject`——可选链拦不住。
				// reflect.get 是官方「不要求 inject」的读取入口，服务缺失时返回 undefined，
				// 正好符合 §6.6「本地化不能成为硬依赖」。
				const service = ctx?.reflect?.get?.("locale");
				const active = typeof service?.getLocale === "function" ? service.getLocale()?.active : undefined;
				return normalizeLocale(active);
			} catch (error) {
				console.warn("[mcp-connector] locale service unavailable:", error);
				return undefined;
			}
		}

		/**
		 * 生效语言：只认宿主语言服务。服务缺失或抛错时回退中文默认——本地化
		 * 能力不能成为 bundle 的硬依赖（docs/DESIGN-issue-63-sidebar-visibility.md §6.6）。
		 * 由于参数缺失时默认值就是中文，面板 iframe 的 URL 也会保持既有字面量
		 * `/mcp-connector/ui/`，不带查询串。
		 *
		 * @param {any} ctx 客户端上下文
		 * @returns {"zh-CN"|"en"} 生效语言
		 */
		function resolveLocaleId(ctx) {
			return localeFromService(ctx) ?? DEFAULT_LOCALE;
		}

		/**
		 * 面板 URL：只有非默认语言才追加 `?locale=`，中文保持既有字面量
		 * `/mcp-connector/ui/`（面板自身也回退中文）。
		 *
		 * @param {unknown} locale 语言（可传未归一化的标签）
		 * @returns {string} iframe 地址
		 */
		function marketIframeSrc(locale) {
			const base = window.location.origin + "/mcp-connector/ui/";
			const normalized = normalizeLocale(locale);
			return normalized === void 0 || normalized === DEFAULT_LOCALE
				? base
				: `${base}?locale=${encodeURIComponent(normalized)}`;
		}

		const PROMPT_REQUEST_TYPE = "mcp-connector:start-session";
		const PROMPT_RESULT_TYPE = "mcp-connector:start-session-result";
		const WORKSPACE_CONTEXT_REQUEST_TYPE = "mcp-connector:workspace-context-request";
		const WORKSPACE_CONTEXT_RESULT_TYPE = "mcp-connector:workspace-context";
		const VERSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
		const VERSION_CHECK_RETRY_MS = 5 * 60 * 1e3;
		const NPM_PACKAGE_URL = "https://www.npmjs.com/package/dsh-mcp-connector";
		const PLUGIN_PACKAGE_NAME = "dsh-mcp-connector";
		const CONNECTOR_SETTINGS_NAMESPACE = "mcp-connector";
		const SHOW_SIDEBAR_ENTRY_FIELD = "showSidebarEntry";
		const CONNECTOR_MODAL_Z_INDEX = 1100;
		const UPDATE_PROVIDER_OPERATION_POLL_MS = 1e3;
		const UPDATE_PROVIDER_ADAPTERS = Object.freeze([
			createHttpUpdateProviderAdapter({
				id: "dsh-market-v1",
				label: "DSH Market",
				schema: "dsh-market/update-api/v1",
				apiVersion: 1,
				capabilitiesUrl: "/dsh-market/api/v1/capabilities"
			})
		]);

		/**
		 * DSH 0.1.x 的 sidebar.footer.action 兼容入口样式。新版宿主使用
		 * sidebar.panellist 原生行，不会安装本段 CSS。兼容适配器只样式化
		 * 本插件节点，不改写公共槽位或其它插件子项（#124）。
		 */
		const SIDEBAR_STYLE_ID = "dsh-mcp-connector-sidebar";
		const sidebarCss = `
.mcpConnectorLauncher {
	flex: none;
	display: flex;
	align-items: center;
	box-sizing: border-box;
	width: 100%;
	height: 42px;
	margin: 4px 0;
	padding: 0 var(--dsh-sidebar-inline-padding, 12px);
	gap: 8px;
	justify-content: flex-start;
	overflow: hidden;
	border: 0;
	border-radius: 12px;
	background: transparent;
	color: inherit;
	font: inherit;
	white-space: nowrap;
	cursor: pointer;
}

.mcpConnectorLauncher[data-placement="footer"] {
	flex: 1 1 0;
	width: auto;
	min-width: 0;
	max-width: 100%;
}

.mcpConnectorLauncher:hover {
	background: rgba(127, 127, 127, 0.12);
	outline: none;
}

.mcpConnectorLauncher:focus-visible {
	background: rgba(127, 127, 127, 0.12);
	outline: 2px solid currentColor;
	outline-offset: -2px;
}

.mcpConnectorLauncherIcon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 20px;
	width: 20px;
	height: 20px;
	color: inherit;
}

.mcpConnectorLauncherIcon > svg {
	display: block;
	width: 18px;
	height: 18px;
}

.mcpConnectorLauncherLabel {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mcpConnectorLauncher[data-wide="false"] {
	flex: none;
	width: 36px;
	height: 36px;
	margin: 8px 0 10px;
	padding: 0;
	justify-content: center;
	border-radius: 50%;
}

.mcpConnectorTopMount {
	flex: none;
	min-width: 0;
	width: 100%;
}

.mcpConnectorTopEntry {
	box-sizing: border-box;
	width: 100%;
	padding-right: var(--dsh-sidebar-inline-padding, 12px);
}

.mcpConnectorTopEntry .mcpConnectorLauncher {
	width: 100%;
	margin: 0 0 8px;
}

.mcpConnectorTopEntry[data-wide="false"] {
	width: 36px;
	padding-right: 0;
}

.mcpConnectorTopEntry[data-wide="false"] .mcpConnectorLauncher {
	margin: 0 0 8px;
}
`;
		const OVERLAY_STYLE_ID = "dsh-mcp-connector-overlay";
		const overlayCss = `

.mcpConnectorMarketPanel { background: #ffffff; color: #111827; }
.mcpConnectorMarketHeader { border-color: #e5e7eb; }
.mcpConnectorMarketTitle { color: #111827; }
.mcpConnectorMarketIcon {
	display: inline-flex;
	align-items: center;
	color: inherit;
}
.mcpConnectorMarketIcon > svg {
	display: block;
	width: 18px;
	height: 18px;
}
.mcpConnectorVersion {
	color: #6b7280;
	background: #f3f4f6;
	border-radius: 999px;
	padding: 2px 8px;
	font-size: 12px;
	font-weight: 600;
}
.mcpConnectorUpdateButton {
	color: #4338ca;
	background: #eef2ff;
	border: 1px solid #c7d2fe;
	border-radius: 8px;
	padding: 5px 9px;
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}
.mcpConnectorUpdateButton:hover,
.mcpConnectorUpdateButton:focus-visible {
	background: #e0e7ff;
	outline: 2px solid #6366f1;
	outline-offset: 1px;
}
.mcpConnectorUpdateButton:disabled {
	opacity: 0.65;
	cursor: wait;
}
.mcpConnectorUpdateControls {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}
.mcpConnectorManualUpdate {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	flex: 1 1 360px;
}
.mcpConnectorManualCommand {
	box-sizing: border-box;
	min-width: 0;
	max-width: 430px;
	overflow-x: auto;
	padding: 5px 8px;
	color: #374151;
	background: #f9fafb;
	border: 1px solid #d1d5db;
	border-radius: 8px;
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	font-size: 11px;
	line-height: 1.35;
	white-space: nowrap;
	user-select: text;
}
.mcpConnectorUpdateStatus {
	max-width: 240px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: #166534;
	background: #f0fdf4;
	border-radius: 999px;
	padding: 3px 8px;
	font-size: 12px;
	font-weight: 600;
}
.mcpConnectorUpdateStatus[data-tone="error"] {
	color: #b91c1c;
	background: #fef2f2;
}
.mcpConnectorUpdateSecondary {
	color: #4b5563;
	background: transparent;
	border-color: #d1d5db;
}
.mcpConnectorMarketClose { color: #6b7280; }
.mcpConnectorMarketClose:hover,
.mcpConnectorMarketClose:focus-visible {
	background: #f3f4f6 !important;
	color: #111827;
	outline: 2px solid #6366f1;
	outline-offset: 1px;
}

@media (prefers-color-scheme: dark) {
	.mcpConnectorMarketPanel { background: #1b1e25; color: #f3f4f6; }
	.mcpConnectorMarketHeader { border-color: #30343d; }
	.mcpConnectorMarketTitle { color: #f3f4f6; }
	.mcpConnectorVersion { color: #d1d5db; background: #30343d; }
	.mcpConnectorUpdateButton { color: #c7d2fe; background: #312e81; border-color: #4f46e5; }
	.mcpConnectorUpdateButton:hover,
	.mcpConnectorUpdateButton:focus-visible { background: #3730a3; }
	.mcpConnectorUpdateStatus { color: #bbf7d0; background: #14532d; }
	.mcpConnectorUpdateStatus[data-tone="error"] { color: #fecaca; background: #7f1d1d; }
	.mcpConnectorManualCommand { color: #e5e7eb; background: #111827; border-color: #4b5563; }
	.mcpConnectorUpdateSecondary { color: #d1d5db; background: transparent; border-color: #4b5563; }
	.mcpConnectorMarketClose { color: #c4c8d0; }
	.mcpConnectorMarketClose:hover,
	.mcpConnectorMarketClose:focus-visible { background: #30343d !important; color: #ffffff; }
}
`;
		const SETTINGS_STYLE_ID = "dsh-mcp-connector-settings";
		const settingsCss = `
.mcpConnectorSettingsCard {
	border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
	background: var(--dsw-alias-bg-layer-3, transparent);
	border-radius: 12px;
	list-style: none;
}
.mcpConnectorSettingsCard[data-open="true"] {
	background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.06));
	border-color: var(--dsw-alias-label-dimmed, rgba(127, 127, 127, 0.5));
}
.mcpConnectorSettingsHeader {
	appearance: none;
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	padding: 14px 16px;
	border: 0;
	border-radius: 12px;
	color: inherit;
	background: transparent;
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.mcpConnectorSettingsHeader:focus-visible,
.mcpConnectorSettingsButton:focus-visible,
.mcpConnectorSettingsSwitch:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
	outline-offset: 2px;
}
.mcpConnectorSettingsHeadText {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.mcpConnectorSettingsName {
	color: var(--dsw-alias-label-primary, inherit);
	font-size: 15px;
	font-weight: 600;
	line-height: 1.4;
}
.mcpConnectorSettingsDescription,
.mcpConnectorSettingsHint,
.mcpConnectorSettingsState {
	color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.9));
	font-size: 13px;
	line-height: 1.5;
}
.mcpConnectorSettingsChevron {
	flex: none;
	color: var(--dsw-alias-label-tertiary, currentColor);
	font-size: 16px;
	transition: transform 0.16s;
}
.mcpConnectorSettingsCard[data-open="true"] .mcpConnectorSettingsChevron {
	transform: rotate(180deg);
}
.mcpConnectorSettingsBody {
	margin: 0 16px;
	padding: 14px 0 10px;
	border-top: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
}
.mcpConnectorSettingsRow {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 18px;
}
.mcpConnectorSettingsLabel {
	display: block;
	color: var(--dsw-alias-label-primary, inherit);
	font-size: 14px;
	font-weight: 600;
}
.mcpConnectorSettingsHint {
	display: block;
	margin-top: 5px;
}
.mcpConnectorSettingsSwitch {
	position: relative;
	appearance: none;
	width: 42px;
	height: 24px;
	margin: 0;
	border: 0;
	border-radius: 999px;
	background: var(--dsw-alias-fill-secondary, rgba(127, 127, 127, 0.35));
	cursor: pointer;
	transition: background 0.16s;
}
.mcpConnectorSettingsSwitch::after {
	position: absolute;
	top: 3px;
	left: 3px;
	width: 18px;
	height: 18px;
	border-radius: 50%;
	background: #ffffff;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
	content: "";
	transition: transform 0.16s;
}
.mcpConnectorSettingsSwitch:checked {
	background: var(--dsw-alias-state-success, #16a34a);
}
.mcpConnectorSettingsSwitch:checked::after {
	transform: translateX(18px);
}
.mcpConnectorSettingsSwitch:disabled {
	cursor: default;
	opacity: 0.55;
}
.mcpConnectorSettingsFooter {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 14px;
	padding-top: 12px;
	border-top: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
}
.mcpConnectorSettingsState {
	flex: 1 1 210px;
	margin: 0;
}
.mcpConnectorSettingsState[data-tone="error"] {
	color: var(--dsw-alias-label-error, #b91c1c);
}
.mcpConnectorSettingsButton {
	appearance: none;
	padding: 6px 12px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
	border-radius: 8px;
	color: var(--dsw-alias-label-secondary, inherit);
	background: transparent;
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}
.mcpConnectorSettingsButton[data-primary="true"] {
	border-color: transparent;
	color: var(--dsw-alias-bg-layer-3, #ffffff);
	background: var(--dsw-alias-label-primary, #111827);
}
.mcpConnectorSettingsButton:disabled {
	cursor: default;
	opacity: 0.45;
}
@media (max-width: 520px) {
	.mcpConnectorSettingsRow { grid-template-columns: 1fr; }
	.mcpConnectorSettingsFooter .mcpConnectorSettingsButton { flex: 1 1 140px; }
}
`;
		const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]';
		const TOP_MOUNT_SELECTOR = '[data-mcp-connector-top-mount="true"]';

		function installStyles(id, css) {
			if (document.querySelector(`style[data-plugin="${id}"]`) !== null) return () => {};
			const style = document.createElement("style");
			style.dataset.plugin = id;
			style.textContent = css;
			document.head.append(style);
			return () => { style.remove(); };
		}

		function installSidebarStyles() {
			return installStyles(SIDEBAR_STYLE_ID, sidebarCss);
		}

		function installOverlayStyles() {
			return installStyles(OVERLAY_STYLE_ID, overlayCss);
		}

		function installSettingsStyles() {
			return installStyles(SETTINGS_STYLE_ID, settingsCss);
		}

		/**
		 * DSH rc.7 没有公开的「新会话与工作区之间」插槽。插件仍注册在公开的
		 * footer list slot 中保证生命周期与降级可用，再把实际按钮 Portal 到
		 * sidebar.workspaces 前。只依赖稳定的 data-slot，不依赖构建生成的 CSS 类名。
		 */
		function ensureTopLauncherMount() {
			const workspaceSlot = document.querySelector(SIDEBAR_WORKSPACES_SELECTOR);
			const parent = workspaceSlot?.parentElement;
			if (workspaceSlot === null || parent === null || parent === void 0) return null;
			let mount = parent.querySelector(TOP_MOUNT_SELECTOR);
			if (mount === null) {
				mount = document.createElement("div");
				mount.dataset.mcpConnectorTopMount = "true";
				mount.className = "mcpConnectorTopMount";
			}
			if (mount.nextSibling !== workspaceSlot) parent.insertBefore(mount, workspaceSlot);
			return mount;
		}

		async function fetchVersionStatus(force = false) {
			const response = await window.fetch("/mcp-connector/api", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ method: "versionStatus", params: { force } })
			});
			const result = await response.json();
			if (!response.ok || result.ok !== true || result.detail === void 0) {
				throw new Error(result.message ?? `HTTP ${response.status}`);
			}
			return result.detail;
		}

		/**
		 * 更新 Provider 只能广告当前 DSH 页面的同源端点。这个边界既避免
		 * Connector 跨域传递安装指令，也使后续市场适配器可复用同一客户端。
		 */
		function sameOriginProviderEndpoint(value) {
			if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
			try {
				const url = new URL(value, window.location.origin);
				if (url.origin !== window.location.origin || url.search !== "" || url.hash !== "") return null;
				return url.pathname;
			} catch {
				return null;
			}
		}

		/**
		 * 把一个版本化的同源 HTTP 更新协议适配为 Connector 内部通用能力。
		 * UI 不接触供应商路由或响应封装；新市场只需新增适配器。
		 */
		function createHttpUpdateProviderAdapter(options) {
			const { id, label, schema, apiVersion, capabilitiesUrl } = options;
			async function readResponse(response) {
				let result;
				try {
					result = await response.json();
				} catch {
					result = null;
				}
				if (!response.ok) {
					const error = new Error(result?.error ?? result?.failure?.message ?? `HTTP ${response.status}`);
					error.code = result?.failure?.code ?? `HTTP_${response.status}`;
					error.retryable = result?.failure?.retryable === true;
					throw error;
				}
				if (result?.schema !== schema) throw new Error(t("{label} 更新接口版本不兼容", { label }));
				return result;
			}

			async function post(path, body) {
				return readResponse(await window.fetch(path, {
					method: "POST",
					headers: { accept: "application/json", "content-type": "application/json" },
					body: JSON.stringify(body)
				}));
			}

			return Object.freeze({
				id,
				label,
				async probe() {
					const response = await window.fetch(capabilitiesUrl, { headers: { accept: "application/json" } });
					if (response.status === 404) return null;
					const result = await readResponse(response);
					if (result.apiVersion !== apiVersion || result.features?.update !== true) return null;
					const endpoints = {
						updates: sameOriginProviderEndpoint(result.endpoints?.updates),
						operations: sameOriginProviderEndpoint(result.endpoints?.operations),
						rollback: sameOriginProviderEndpoint(result.endpoints?.rollback),
						restart: sameOriginProviderEndpoint(result.endpoints?.restart)
					};
					if (endpoints.updates === null || endpoints.operations === null) return null;
					if (result.features?.rollback === true && endpoints.rollback === null) return null;
					if (result.restart?.supported === true && endpoints.restart === null) return null;
					return {
						providerId: id,
						providerLabel: label,
						runtime: result.runtime,
						features: result.features,
						restart: result.restart,
						endpoints
					};
				},
				async check(capabilities, packageName, force = false) {
					const query = new URLSearchParams({ name: packageName });
					if (force) query.set("force", "1");
					const result = await readResponse(await window.fetch(`${capabilities.endpoints.updates}?${query}`, {
						headers: { accept: "application/json" }
					}));
					return result.package;
				},
				async start(capabilities, packageName, force = false) {
					const result = await post(capabilities.endpoints.updates, {
						packageName,
						...(force ? { force: true } : {})
					});
					if (typeof result.operation?.operationId !== "string") {
						throw new Error(t("{label} 未返回更新任务编号", { label }));
					}
					return result.operation;
				},
				async operation(capabilities, operationId) {
					const query = new URLSearchParams({ operationId });
					const result = await readResponse(await window.fetch(`${capabilities.endpoints.operations}?${query}`, {
						headers: { accept: "application/json" }
					}));
					return result.operation;
				},
				async rollback(capabilities, operationId) {
					if (capabilities.endpoints.rollback === null) throw new Error(t("{label} 不支持回滚", { label }));
					const result = await post(capabilities.endpoints.rollback, { operationId });
					return result.operation;
				},
				async restart(capabilities) {
					if (capabilities.endpoints.restart === null) throw new Error(t("{label} 不支持重启", { label }));
					return post(capabilities.endpoints.restart, {});
				}
			});
		}

		async function discoverUpdateProvider(packageName, force = false) {
			for (const provider of UPDATE_PROVIDER_ADAPTERS) {
				try {
					const capabilities = await provider.probe();
					if (capabilities === null) continue;
					const update = await provider.check(capabilities, packageName, force);
					return { provider, capabilities, update };
				} catch (error) {
					console.warn(`[mcp-connector] ${provider.id} update provider unavailable:`, error);
				}
			}
			return null;
		}

		function updateProgressLabel(operation) {
			if (operation?.state === "queued") return t("更新任务排队中…");
			const percent = operation?.progress?.percent;
			if (typeof percent === "number") return t("正在更新 {percent}%", { percent });
			const phase = operation?.progress?.phase;
			if (typeof phase === "string" && phase !== "") return t("正在更新：{phase}", { phase });
			return t("正在更新…");
		}

		function updateFailureLabel(failure) {
			const labels = {
				AGENTS_RUNNING: t("有任务正在运行，请结束后重试"),
				OPERATION_BUSY: t("插件市场正在处理其他任务"),
				RELEASE_TOO_FRESH: t("新版本处于发布安全等待期（约 24 小时）"),
				MIRROR_SYNC_PENDING: t("镜像尚未同步完整安装包"),
				VERSION_UNCHANGED: t("下载后版本未变化"),
				DOWNGRADE_DETECTED: t("已阻止版本降级"),
				RESOLVED_VERSION_MISMATCH: t("下载版本与预期不一致"),
				INVALID_UPDATE_RESULT: t("更新服务未返回有效版本"),
				UPDATE_TIMEOUT: t("更新超时"),
				UPDATE_FORBIDDEN: t("更新请求被拒绝"),
				UPDATE_REJECTED: t("无法执行本次更新")
			};
			return labels[failure?.code] ?? failure?.message ?? t("更新失败");
		}

		function manualUpgradeCommand(version) {
			const parsed = parseClientVersion(version);
			if (parsed === null) return null;
			return `dsh plugin --profile web add --config.minimumReleaseAge=0 ${PLUGIN_PACKAGE_NAME}@${parsed.normalized}`;
		}

		/** 尝试写入剪贴板；失败时调用方把命令展示在页面内，不退回原生 prompt。 */
		async function copyManualUpgradeCommand(command) {
			const clipboard = window.navigator?.clipboard;
			if (typeof clipboard?.writeText !== "function") return false;
			try {
				await clipboard.writeText(command);
				return true;
			} catch (error) {
				// 桌面壳里原生弹窗关闭后不会把键盘焦点还给页面，所以这里只记录失败，
				// 由调用方改用页面内提示 + 可一键选中的命令。
				console.warn("[mcp-connector] clipboard write failed:", error);
				return false;
			}
		}

		function parseClientVersion(value) {
			if (typeof value !== "string") return null;
			const normalized = value.trim().replace(/^v/i, "");
			if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) return null;
			const [withoutBuild] = normalized.split("+");
			const [core, prerelease] = withoutBuild.split("-", 2);
			return { normalized, core: core.split(".").map(Number), prerelease: prerelease?.split(".") ?? [] };
		}

		function compareClientVersions(left, right) {
			const a = parseClientVersion(left);
			const b = parseClientVersion(right);
			if (a === null || b === null) return null;
			for (let index = 0; index < 3; index += 1) {
				if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
			}
			if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
			if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
			const length = Math.max(a.prerelease.length, b.prerelease.length);
			for (let index = 0; index < length; index += 1) {
				const aPart = a.prerelease[index];
				const bPart = b.prerelease[index];
				if (aPart === void 0) return -1;
				if (bPart === void 0) return 1;
				if (aPart === bPart) continue;
				const aNumeric = /^\d+$/.test(aPart);
				const bNumeric = /^\d+$/.test(bPart);
				if (aNumeric && bNumeric) return Number(aPart) - Number(bPart);
				if (aNumeric) return -1;
				if (bNumeric) return 1;
				return aPart.localeCompare(bPart);
			}
			return 0;
		}

		/**
		 * Provider 读取 profile 磁盘版本，versionStatus 来自当前运行中的插件进程。
		 * 当磁盘版本更高且 Provider 已无后续更新时，说明安装已经完成、只差重启激活。
		 */
		function pendingActivationVersion(versionStatus, providerUpdateCheck) {
			if (providerUpdateCheck?.updateAvailable !== false) return null;
			const running = parseClientVersion(versionStatus?.installedVersion);
			const installed = parseClientVersion(providerUpdateCheck?.installedVersion);
			if (running === null || installed === null) return null;
			return compareClientVersions(installed.normalized, running.normalized) > 0
				? installed.normalized
				: null;
		}

		/** Independently verify a provider's terminal success before asking the user to restart. */
		function completedUpdateIntegrityFailure(operation, expectedVersion) {
			if (operation?.state !== "succeeded") return null;
			const installed = parseClientVersion(operation.installedVersion);
			if (installed === null) {
				return {
					code: "INVALID_UPDATE_RESULT",
					message: t("更新服务报告成功，但未返回有效的已安装版本"),
					retryable: false
				};
			}
			const before = parseClientVersion(operation.beforeVersion);
			if (before !== null && compareClientVersions(installed.normalized, before.normalized) < 0) {
				return {
					code: "DOWNGRADE_DETECTED",
					message: t("更新服务将插件从 v{before} 降级到 v{installed}", { before: before.normalized, installed: installed.normalized }),
					retryable: false
				};
			}
			const expected = parseClientVersion(expectedVersion);
			if (expected !== null && compareClientVersions(installed.normalized, expected.normalized) !== 0) {
				return {
					code: "RESOLVED_VERSION_MISMATCH",
					message: t("预期安装 v{expected}，更新服务实际安装了 v{installed}", { expected: expected.normalized, installed: installed.normalized }),
					retryable: true
				};
			}
			return null;
		}

		/**
		 * DSH 暂未公开“打开指定设置分区”服务：只依赖稳定的 sidebar.settings
		 * slot 和可访问文本打开插件市场。Desktop 可能根本没有市场分区，
		 * 轮询结束后必须回退到 npm 安装说明，不能把用户留在普通设置页。
		 */
		function openDshPluginMarket(actions) {
			const settingsHost = document.querySelector('[data-slot="sidebar.settings"]');
			const settingsTrigger = settingsHost?.querySelector?.('button[aria-haspopup="dialog"]');
			if (settingsTrigger === null || settingsTrigger === void 0) {
				window.open(NPM_PACKAGE_URL, "_blank", "noopener,noreferrer");
				return;
			}
			actions.close();
			window.setTimeout(() => {
				settingsTrigger.click();
				let attempts = 0;
				const selectMarket = () => {
					const marketButton = [...document.querySelectorAll('[role="dialog"] nav button')].find((button) => {
						const label = button.textContent?.trim() ?? "";
						return /^(\u63d2\u4ef6\u5e02\u573a|Plugin Market|Plugin Marketplace)$/i.test(label);
					});
					if (marketButton !== void 0) {
						marketButton.click();
						return;
					}
					attempts += 1;
					if (attempts < 20) {
						window.setTimeout(selectMarket, 50);
						return;
					}
					window.open(NPM_PACKAGE_URL, "_blank", "noopener,noreferrer");
				};
				window.requestAnimationFrame(selectMarket);
			}, 0);
		}

		/**
		 * 创建符合 DSH Slot Store contract 的本地状态句柄。
		 * 只依赖 getSnapshot/subscribe/actions，避免不同 Host 版本的 Store
		 * 包名或客户端模块到达顺序让整个 Desktop 进入 Safe Mode。
		 */
		function createMarketViewStore() {
			let sidebarVisible = true;
			const liveActions = new Set();
			const visibilityListeners = new Set();
			const spec = {
				init: () => ({ open: false, detailOpen: false, sidebarVisible }),
				actions: {
					open: (draft) => { draft.open = true; },
					close: (draft) => { draft.open = false; draft.detailOpen = false; },
					detailOpened: (draft) => { draft.detailOpen = true; },
					detailClosed: (draft) => { draft.detailOpen = false; },
					setSidebarVisible: (draft, visible) => { draft.sidebarVisible = visible !== false; }
				}
			};
			return {
				spec,
				getSidebarVisible() {
					return sidebarVisible;
				},
				subscribeSidebarVisible(listener) {
					visibilityListeners.add(listener);
					return () => { visibilityListeners.delete(listener); };
				},
				syncSidebarVisible(visible) {
					const next = visible !== false;
					if (sidebarVisible === next) return;
					sidebarVisible = next;
					for (const actions of liveActions) actions.setSidebarVisible(sidebarVisible);
					for (const listener of visibilityListeners) listener(sidebarVisible);
				},
				create() {
					let state = spec.init();
					const listeners = new Set();
					const actions = {};
					for (const [name, mutate] of Object.entries(spec.actions)) {
						actions[name] = (...params) => {
							const draft = { ...state };
							mutate(draft, ...params);
							state = draft;
							for (const listener of listeners) listener();
						};
					}
					liveActions.add(actions);
					return {
						actions,
						getSnapshot: () => state,
						subscribe(listener) {
							listeners.add(listener);
							return () => { listeners.delete(listener); };
						},
						clearPersisted() {
							liveActions.delete(actions);
							listeners.clear();
						}
					};
				}
			};
		}

		function resolveSidebarVisible(snapshot) {
			return snapshot?.status === "ready"
				? snapshot.value?.[SHOW_SIDEBAR_ENTRY_FIELD] !== false
				: true;
		}

		/** 设置卡片文案：中英文都来自同一份 msgid 词典。 */
		function connectorSettingsCopy() {
			return {
				title: t("MCP连接器"),
				description: t("控制侧边栏入口和快捷打开方式。"),
				show: t("在侧边栏显示 MCP连接器"),
				hint: t("关闭后只隐藏入口，不影响已连接的 MCP Server 和工具。"),
				visible: t("侧边栏入口当前显示。"),
				hidden: t("入口已隐藏，仍可从这里打开 MCP连接器。"),
				readOnly: t("当前设置页只读。"),
				saving: t("正在保存…"),
				failed: t("设置未保存，请重试。"),
				reset: t("恢复默认"),
				open: t("打开 MCP连接器"),
				expand: t("展开 MCP连接器设置"),
				collapse: t("收起 MCP连接器设置")
			};
		}

		function ConnectorSettingsCard(props) {
			const { settingsScope, actions } = props;
			const copy = connectorSettingsCopy();
			const snapshot = (0, react.useSyncExternalStore)(
				(listener) => settingsScope.subscribe(listener),
				() => settingsScope.getSnapshot()
			);
			const [open, setOpen] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			if (snapshot.status !== "ready") return null;
			const visible = resolveSidebarVisible(snapshot);
			const writable = snapshot.writable === true;
			const overridden = snapshot.user !== null
				&& typeof snapshot.user === "object"
				&& Object.prototype.hasOwnProperty.call(snapshot.user, SHOW_SIDEBAR_ENTRY_FIELD);

			const save = async (next) => {
				setSaving(true);
				setFailed(false);
				try {
					await settingsScope.set(SHOW_SIDEBAR_ENTRY_FIELD, next);
					const confirmed = settingsScope.getSnapshot();
					setFailed(confirmed.status !== "ready" || resolveSidebarVisible(confirmed) !== next);
				} catch (error) {
					console.error("[mcp-connector] sidebar setting update failed:", error);
					setFailed(true);
				} finally {
					setSaving(false);
				}
			};

			const reset = async () => {
				setSaving(true);
				setFailed(false);
				try {
					await settingsScope.unset(SHOW_SIDEBAR_ENTRY_FIELD);
					const confirmed = settingsScope.getSnapshot();
					const stillOverridden = confirmed.user !== null
						&& typeof confirmed.user === "object"
						&& Object.prototype.hasOwnProperty.call(confirmed.user, SHOW_SIDEBAR_ENTRY_FIELD);
					setFailed(confirmed.status !== "ready" || stillOverridden);
				} catch (error) {
					console.error("[mcp-connector] sidebar setting reset failed:", error);
					setFailed(true);
				} finally {
					setSaving(false);
				}
			};

			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "mcpConnectorSettingsCard",
				"data-open": open,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "mcpConnectorSettingsHeader",
						"aria-expanded": open,
						"aria-label": open ? copy.collapse : copy.expand,
						onClick: () => { setOpen(!open); },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "mcpConnectorSettingsHeadText",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "mcpConnectorSettingsName", children: copy.title }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "mcpConnectorSettingsDescription", children: copy.description })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "mcpConnectorSettingsChevron", "aria-hidden": true, children: "⌄" })
						]
					}),
					open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorSettingsBody",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mcpConnectorSettingsRow",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										htmlFor: "mcp-connector-show-sidebar-entry",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "mcpConnectorSettingsLabel", children: copy.show }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "mcpConnectorSettingsHint", children: copy.hint })
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "mcp-connector-show-sidebar-entry",
										className: "mcpConnectorSettingsSwitch",
										type: "checkbox",
										role: "switch",
										"aria-checked": visible,
										checked: visible,
										disabled: !writable || saving,
										onChange: (event) => { void save(event.target.checked); }
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mcpConnectorSettingsFooter",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "mcpConnectorSettingsState",
										"data-tone": failed ? "error" : "normal",
										role: failed ? "alert" : "status",
										children: failed ? copy.failed : saving ? copy.saving : !writable ? copy.readOnly : visible ? copy.visible : copy.hidden
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "mcpConnectorSettingsButton",
										disabled: !writable || saving || !overridden,
										onClick: () => { void reset(); },
										children: copy.reset
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "mcpConnectorSettingsButton",
										"data-primary": true,
										"aria-haspopup": "dialog",
										onClick: () => { actions.open(); },
										children: copy.open
									})
								]
							})
						]
					}) : null
				]
			});
		}

		function installClientSettings(ctx, marketView) {
			if (typeof ctx.inject !== "function") return;
			ctx.inject(["settingsScope"], (settingsCtx) => {
				if (typeof settingsCtx?.settingsScope?.bind !== "function") return;
				const settingsScope = settingsCtx.settingsScope.bind({
					namespace: CONNECTOR_SETTINGS_NAMESPACE,
					decode(value) {
						if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
						return typeof value[SHOW_SIDEBAR_ENTRY_FIELD] === "boolean"
							? { [SHOW_SIDEBAR_ENTRY_FIELD]: value[SHOW_SIDEBAR_ENTRY_FIELD] }
							: void 0;
					}
				});
				if (typeof settingsScope?.getSnapshot !== "function"
					|| typeof settingsScope?.subscribe !== "function") return;
				settingsCtx.effect(() => {
					const sync = () => { marketView.syncSidebarVisible(resolveSidebarVisible(settingsScope.getSnapshot())); };
					sync();
					const unsubscribe = settingsScope.subscribe(sync);
					return () => {
						unsubscribe();
						marketView.syncSidebarVisible(true);
					};
				}, "mcp-connector: sidebar visibility setting");
				settingsCtx.effect(() => installSettingsStyles(), "mcp-connector: settings styles");
				settingsCtx.slots.inject("settings.plugin.item", () => settingsCtx.slots.register({
					name: "settings.plugin.item",
					key: CONNECTOR_SETTINGS_NAMESPACE,
					store: marketView,
					inject: () => ({ settingsScope })
				}, ConnectorSettingsCard));
			});
		}

		/**
		 * 用 DSH 自身的工作区/会话/输入机把示例 Prompt 带入新会话。
		 * connectWorkspace 与 DSH 的「新会话」按钮同源：优先复用当前工作区的
		 * 空白会话，没有时创建一个；返回时 binding 已就绪，可在导航前写入草稿。
		 */
		function currentWorkspaceContext(ctx) {
			const workspace = ctx.workspaces.list.getSnapshot();
			const current = ctx.sessions.list.getSnapshot().current;
			const selected = current === void 0
				? void 0
				: workspace.items.find((item) => item.sessionIds.includes(current));
			const targetWorkspaceId = selected?.workspaceId ?? workspace.recentWorkspaceId;
			const target = workspace.items.find((item) => item.workspaceId === targetWorkspaceId);
			return targetWorkspaceId === void 0 ? null : {
				workspaceId: targetWorkspaceId,
				title: target?.title ?? String(targetWorkspaceId)
			};
		}

		function availableWorkspaceContexts(ctx) {
			const items = ctx.workspaces.list.getSnapshot()?.items;
			if (!Array.isArray(items)) return [];
			const workspaces = new Map();
			for (const item of items) {
				if (typeof item?.workspaceId !== "string" || item.workspaceId === "") continue;
				workspaces.set(item.workspaceId, {
					workspaceId: item.workspaceId,
					title: item.title ?? String(item.workspaceId)
				});
			}
			return [...workspaces.values()];
		}

		async function startPromptSession(ctx, promptText) {
			if (typeof promptText !== "string" || promptText.trim() === "") {
				throw new Error(t("Prompt 不能为空"));
			}
			const targetWorkspaceId = currentWorkspaceContext(ctx)?.workspaceId;
			if (targetWorkspaceId === void 0) {
				throw new Error(t("请先选择一个工作空间，再使用示例 Prompt"));
			}
			// DSH 0.1.2 将跨 Controller 的导航能力从 workspaces 移到
			// uiWorkspace；0.1.1 Desktop 仍暴露旧方法。优先使用当前公开能力，
			// 再兼容旧版，最后以 sessions.create 保证未来移除桥接方法时仍能
			// 在目标 Workspace 创建原生会话。
			const uiWorkspace = typeof ctx.get === "function"
				? ctx.get("uiWorkspace")
				: ctx.uiWorkspace;
			let sessionId;
			if (typeof uiWorkspace?.connectWorkspace === "function") {
				sessionId = await uiWorkspace.connectWorkspace(targetWorkspaceId);
			} else if (typeof ctx.workspaces?.connectWorkspace === "function") {
				sessionId = await ctx.workspaces.connectWorkspace(targetWorkspaceId);
			} else if (typeof ctx.sessions?.create === "function") {
				sessionId = await ctx.sessions.create({ workspaceId: targetWorkspaceId });
			} else {
				throw new Error(t("当前 DSH 版本没有可用的工作区会话创建能力，请升级 DSH 后重试"));
			}
			const conversation = ctx.get("conversation");
			if (conversation === void 0) {
				throw new Error(t("DSH 对话服务尚未就绪，请稍后重试"));
			}
			conversation.input.shell(sessionId).setDraft(promptText);
			ctx.sessions.open(sessionId);
			return sessionId;
		}

		/** 市场主体：原生 main 面板与设置页快捷弹框共用。 */
		function MarketOverlay(props) {
			const {
				wide,
				useStore,
				actions,
				presentation = "modal",
				closePanel = null,
				startPromptSession: launchPromptSession,
				workspaceContext = () => null,
				workspaceOptions = () => [],
				iframeLocale = DEFAULT_LOCALE
			} = props;
			const modalOpen = useStore((state) => state.open);
			const open = presentation === "panel" || modalOpen;
			const closeView = () => {
				if (presentation === "panel") closePanel?.();
				else actions.close();
			};
			const detailOpen = useStore((state) => state.detailOpen);
			const [versionStatus, setVersionStatus] = (0, react.useState)(null);
			const [updateProviderState, setUpdateProviderState] = (0, react.useState)("checking");
			const [updateProviderSelection, setUpdateProviderSelection] = (0, react.useState)(null);
			const [providerUpdateCheck, setProviderUpdateCheck] = (0, react.useState)(null);
			const [expectedUpdateVersion, setExpectedUpdateVersion] = (0, react.useState)(null);
			const [updateOperation, setUpdateOperation] = (0, react.useState)(null);
			const [updateError, setUpdateError] = (0, react.useState)(null);
			const [updateStarting, setUpdateStarting] = (0, react.useState)(false);
			const [rollbackRunning, setRollbackRunning] = (0, react.useState)(false);
			const [restarting, setRestarting] = (0, react.useState)(false);
			const [manualCommandCopied, setManualCommandCopied] = (0, react.useState)(false);
			const [manualCommandVisible, setManualCommandVisible] = (0, react.useState)(false);
			const [versionCheckRequest, setVersionCheckRequest] = (0, react.useState)(0);
			const [versionCheckBusy, setVersionCheckBusy] = (0, react.useState)(false);
			const [versionCheckFailed, setVersionCheckFailed] = (0, react.useState)(false);
			const frameRef = (0, react.useRef)(null);
			const closeRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const sendWorkspaceContext = () => {
					frameRef.current?.contentWindow?.postMessage({
						type: WORKSPACE_CONTEXT_RESULT_TYPE,
						workspace: workspaceContext(),
						workspaces: workspaceOptions()
					}, window.location.origin);
				};
				const onMessage = (event) => {
					if (event.origin !== window.location.origin) return;
					if (event.source !== frameRef.current?.contentWindow) return;
					if (event.data?.type === "mcp-connector:detail-state") {
						if (event.data.open === true) actions.detailOpened();
						else actions.detailClosed();
						return;
					}
					if (event.data?.type === WORKSPACE_CONTEXT_REQUEST_TYPE) {
						sendWorkspaceContext();
						return;
					}
					if (event.data?.type !== PROMPT_REQUEST_TYPE) return;
					const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
					const prompt = event.data.prompt;
					const reply = (ok, message) => {
						frameRef.current?.contentWindow?.postMessage({
							type: PROMPT_RESULT_TYPE,
							requestId,
							ok,
							message
						}, window.location.origin);
					};
					if (requestId === "" || typeof prompt !== "string") {
						reply(false, t("无效的 Prompt 请求"));
						return;
					}
					Promise.resolve(launchPromptSession(prompt)).then(() => {
						reply(true, t("已带入新会话"));
						window.requestAnimationFrame(closeView);
					}, (error) => {
						const message = error instanceof Error ? error.message : String(error);
						console.error("[mcp-connector] start prompt session failed:", error);
						reply(false, message);
					});
				};
				window.addEventListener("message", onMessage);
				return () => { window.removeEventListener("message", onMessage); };
			}, [actions, closePanel, launchPromptSession, presentation, workspaceContext]);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				let disposed = false;
				let pollTimer;
				const schedule = (delayMs) => {
					window.clearTimeout(pollTimer);
					pollTimer = window.setTimeout(check, Math.max(1e3, delayMs));
				};
				const check = (force = false) => {
					setVersionCheckBusy(true);
					fetchVersionStatus(force).then((status) => {
						if (disposed) return;
						setVersionStatus(status);
						setVersionCheckBusy(status.checking === true);
						setVersionCheckFailed(!status.checking && status.sources?.npm?.ok !== true ? "npm" : false);
						if (status.checking) {
							schedule(1e3);
							return;
						}
						const nextCheckAt = Date.parse(status.nextCheckAt ?? "");
						const delay = Number.isFinite(nextCheckAt)
							? Math.min(VERSION_CHECK_INTERVAL_MS, nextCheckAt - Date.now())
							: VERSION_CHECK_INTERVAL_MS;
						schedule(delay);
					}, (error) => {
						console.warn("[mcp-connector] plugin update check failed:", error);
						if (!disposed) {
							setVersionCheckBusy(false);
							setVersionCheckFailed("api");
							schedule(VERSION_CHECK_RETRY_MS);
						}
					});
				};
				check(true);
				return () => {
					disposed = true;
					window.clearTimeout(pollTimer);
				};
			}, [open, versionCheckRequest]);
			(0, react.useEffect)(() => {
				if (open) setManualCommandCopied(false);
			}, [open, versionStatus?.latestVersion]);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				let disposed = false;
				setUpdateProviderState("checking");
				discoverUpdateProvider(PLUGIN_PACKAGE_NAME, true).then((selection) => {
					if (disposed) return;
					if (selection === null) {
						setUpdateProviderSelection(null);
						setProviderUpdateCheck(null);
						setUpdateProviderState("unavailable");
						return;
					}
					setUpdateProviderSelection(selection);
					setProviderUpdateCheck(selection.update);
					setUpdateProviderState("ready");
				}).catch((error) => {
					console.warn("[mcp-connector] update provider discovery failed:", error);
					if (disposed) return;
					setUpdateProviderSelection(null);
					setProviderUpdateCheck(null);
					setUpdateProviderState("unavailable");
				});
				return () => { disposed = true; };
			}, [open, versionCheckRequest]);
			(0, react.useEffect)(() => {
				const operationId = updateOperation?.operationId;
				const provider = updateProviderSelection?.provider;
				const capabilities = updateProviderSelection?.capabilities;
				if (!open || provider === void 0 || capabilities === void 0
					|| typeof operationId !== "string" || !["queued", "running"].includes(updateOperation.state)) {
					return void 0;
				}
				let disposed = false;
				let timer;
				const poll = () => {
					provider.operation(capabilities, operationId).then((operation) => {
						if (disposed) return;
						setUpdateError(null);
						const integrityFailure = completedUpdateIntegrityFailure(operation, expectedUpdateVersion);
						if (integrityFailure !== null) {
							const failedOperation = { ...operation, state: "failed", failure: integrityFailure };
							setUpdateOperation(failedOperation);
							const canRollback = capabilities.features?.rollback === true
								&& operation.outcome?.rollback?.available === true
								&& capabilities.endpoints.rollback !== null;
							if (!canRollback) return;
							setRollbackRunning(true);
							provider.rollback(capabilities, operationId).then((rolledBackOperation) => {
								if (disposed) return;
								setRollbackRunning(false);
								setUpdateOperation({ ...rolledBackOperation, integrityFailure });
							}, (error) => {
								console.error("[mcp-connector] automatic rollback failed:", error);
								if (disposed) return;
								const detail = error instanceof Error ? error.message : String(error);
								setRollbackRunning(false);
								setUpdateOperation({
									...failedOperation,
									outcome: {
										...failedOperation.outcome,
										rollback: { available: true, state: "failed", detail }
									}
								});
							});
							return;
						}
						setUpdateOperation(operation);
						if (["queued", "running"].includes(operation.state)) {
							timer = window.setTimeout(poll, UPDATE_PROVIDER_OPERATION_POLL_MS);
							return;
						}
						if (operation.state === "succeeded") {
							provider.check(capabilities, PLUGIN_PACKAGE_NAME, true).then(setProviderUpdateCheck, () => {});
						}
					}, (error) => {
						console.warn("[mcp-connector] update operation polling failed:", error);
						if (disposed) return;
						setUpdateError(error instanceof Error ? error.message : String(error));
						timer = window.setTimeout(poll, UPDATE_PROVIDER_OPERATION_POLL_MS * 2);
					});
				};
				timer = window.setTimeout(poll, UPDATE_PROVIDER_OPERATION_POLL_MS);
				return () => {
					disposed = true;
					window.clearTimeout(timer);
				};
			}, [open, updateOperation?.operationId, updateProviderSelection?.provider?.id, expectedUpdateVersion]);
			(0, react.useEffect)(() => {
				if (!open || presentation === "panel") return void 0;
				const opener = document.activeElement;
				closeRef.current?.focus?.();
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					closeView();
				};
				// Capture at window before the underlying Settings dialog receives
				// Escape on document; only the topmost connector dialog should close.
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
					if (opener?.isConnected !== false) opener?.focus?.();
				};
			}, [open, actions, closePanel, presentation]);
			if (!open) return null;
			const updateRunning = updateStarting || updateOperation !== null && ["queued", "running"].includes(updateOperation.state);
			const startUpdate = (force = false) => {
				const provider = updateProviderSelection?.provider;
				const capabilities = updateProviderSelection?.capabilities;
				if (updateRunning || provider === void 0 || capabilities === void 0) return;
				setUpdateError(null);
				setUpdateStarting(true);
				setExpectedUpdateVersion(providerUpdateCheck?.latestVersion ?? versionStatus?.latestVersion ?? null);
				provider.start(capabilities, PLUGIN_PACKAGE_NAME, force).then((operation) => {
					setUpdateStarting(false);
					setUpdateOperation(operation);
				}, (error) => {
					console.error("[mcp-connector] update start failed:", error);
					setUpdateStarting(false);
					if (error?.retryable === true) {
						setUpdateOperation({
							state: "failed",
							failure: {
								code: error.code ?? "UPDATE_FAILED",
								message: error instanceof Error ? error.message : String(error),
								retryable: true
							},
							outcome: { rollback: { available: false, state: "unavailable" } }
						});
					} else {
						setUpdateError(error instanceof Error ? error.message : String(error));
					}
				});
			};
			const rollbackUpdate = () => {
				const provider = updateProviderSelection?.provider;
				const capabilities = updateProviderSelection?.capabilities;
				if (rollbackRunning || provider === void 0 || capabilities === void 0
					|| typeof updateOperation?.operationId !== "string") return;
				setUpdateError(null);
				setRollbackRunning(true);
				provider.rollback(capabilities, updateOperation.operationId).then((operation) => {
					setRollbackRunning(false);
					setUpdateOperation(operation);
				}, (error) => {
					console.error("[mcp-connector] rollback failed:", error);
					setRollbackRunning(false);
					setUpdateError(error instanceof Error ? error.message : String(error));
				});
			};
			const restartHost = () => {
				const provider = updateProviderSelection?.provider;
				const capabilities = updateProviderSelection?.capabilities;
				if (restarting || provider === void 0 || capabilities === void 0) return;
				setRestarting(true);
				setUpdateError(null);
				provider.restart(capabilities).catch((error) => {
					console.error("[mcp-connector] restart failed:", error);
					setRestarting(false);
					setUpdateError(error instanceof Error ? error.message : String(error));
				});
			};
			const renderUpdateControls = () => {
				const activationPendingVersion = updateProviderState === "ready"
					? pendingActivationVersion(versionStatus, providerUpdateCheck)
					: null;
				if (!versionStatus?.updateAvailable
					&& !(updateProviderState === "ready" && providerUpdateCheck?.updateAvailable === true)
					&& activationPendingVersion === null
					&& updateOperation === null && updateError === null) return null;
				if (updateRunning) {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								disabled: true,
								children: updateStarting ? t("正在启动更新…") : updateProgressLabel(updateOperation)
							}),
							updateError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								title: updateError,
								children: t("暂时无法读取进度，正在重试")
							})
						]
					});
				}
				if (updateOperation?.state === "failed") {
					const force = ["RELEASE_TOO_FRESH", "VERSION_UNCHANGED"].includes(updateOperation.failure?.code);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								title: updateOperation.failure?.message ?? t("更新失败"),
								children: updateFailureLabel(updateOperation.failure)
							}),
							updateOperation.failure?.retryable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								onClick: () => startUpdate(force),
								children: updateOperation.failure?.code === "RELEASE_TOO_FRESH"
									? t("立即更新（跳过等待）")
									: force ? t("强制重试") : t("重试更新")
										}),
							rollbackRunning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								children: t("检测到异常版本，正在自动回滚…")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								onClick: () => openDshPluginMarket(actions),
								children: t("查看更新方式")
							})
						]
					});
				}
				if (["succeeded", "rolled-back"].includes(updateOperation?.state)) {
					const rolledBack = updateOperation.state === "rolled-back";
					const restartRequired = updateOperation.outcome?.restartRequired === true;
					const refreshRequired = updateOperation.outcome?.refreshRequired === true;
					const rollbackFailed = updateOperation.outcome?.rollback?.state === "failed";
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								children: rolledBack
									? updateOperation.integrityFailure === void 0 ? t("已回滚") : t("已阻止异常版本并回滚")
									: t("已安装 v{version}", { version: updateOperation.installedVersion ?? versionStatus?.latestVersion })
							}),
							rollbackFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								title: updateOperation.outcome.rollback.detail ?? t("回滚失败"),
								children: t("回滚失败")
							}),
						restartRequired && updateProviderSelection?.capabilities?.restart?.supported === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								disabled: restarting,
								onClick: restartHost,
								children: restarting ? t("正在重启…") : t("立即重启")
							}),
						restartRequired && updateProviderSelection?.capabilities?.restart?.supported !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mcpConnectorUpdateStatus",
							title: t("重启由 {managedBy} 管理", { managedBy: updateProviderSelection?.capabilities?.restart?.managedBy ?? t("宿主") }),
							children: updateProviderSelection?.capabilities?.runtime === "desktop" ? t("请重启 DSH Desktop") : t("请重启 DSH")
							}),
							!restartRequired && refreshRequired && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								onClick: () => window.location.reload(),
								children: t("刷新生效")
							}),
							updateOperation.outcome?.rollback?.available === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								disabled: rollbackRunning,
								onClick: rollbackUpdate,
								children: rollbackRunning ? t("正在回滚…") : rollbackFailed ? t("重试回滚") : t("回滚")
							})
						]
					});
				}
				if (updateError !== null) {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								title: updateError,
								children: t("更新服务调用失败")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								onClick: () => openDshPluginMarket(actions),
								children: t("查看更新方式")
							})
						]
					});
				}
				if (updateProviderState === "checking") {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mcpConnectorUpdateButton",
						disabled: true,
						children: t("正在准备更新…")
					});
				}
				if (updateProviderState === "ready" && providerUpdateCheck?.updateAvailable === true) {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mcpConnectorUpdateButton",
						title: t("由 {provider} 安全更新到 v{version}", {
							provider: updateProviderSelection?.provider?.label ?? t("更新服务"),
							version: providerUpdateCheck.latestVersion
						}),
						onClick: () => startUpdate(false),
						children: t("一键更新到 v{version}", { version: providerUpdateCheck.latestVersion })
					});
				}
				if (activationPendingVersion !== null) {
					const canRestart = updateProviderSelection?.capabilities?.restart?.supported === true;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								// 两条分支同源：中文走 msgid 原样返回（不查表），英文走插值译文。
								// 不再用 `activeLocale === DEFAULT_LOCALE` 预先把中文写死，避免出现
								// 「英文界面里仍显示中文」的分支。
								children: t("v{version} 已安装，重启后生效", { version: activationPendingVersion })
							}),
							canRestart
								? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "mcpConnectorUpdateButton",
									disabled: restarting,
									onClick: restartHost,
									children: restarting ? t("正在重启…") : t("立即重启")
								})
								: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "mcpConnectorUpdateStatus",
									title: t("重启由 {managedBy} 管理", { managedBy: updateProviderSelection?.capabilities?.restart?.managedBy ?? t("宿主") }),
									children: updateProviderSelection?.capabilities?.runtime === "desktop"
										? t("请重启 DSH Desktop")
										: t("请重启 DSH")
								})
						]
					});
				}
				const command = manualUpgradeCommand(versionStatus?.latestVersion);
				if (command !== null) {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorManualUpdate",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: "mcpConnectorManualCommand",
								title: command,
								// 点击即全选，方便手动复制（剪贴板不可用时的回退路径）。
								onClick: (event) => window.getSelection?.()?.selectAllChildren?.(event.currentTarget),
								children: command
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								onClick: () => {
									copyManualUpgradeCommand(command).then((copied) => {
										// 剪贴板不可用时给出页面内提示，让用户直接选中上面的命令，
										// 不再退回原生 prompt：桌面壳里原生弹窗关闭后不会把键盘
										// 焦点还给页面。成功时顺带撤掉失败提示，避免留在界面上。
										setManualCommandCopied(copied);
										setManualCommandVisible(!copied);
									});
								},
								children: manualCommandCopied ? t("已复制") : t("复制升级命令")
							}),
							manualCommandVisible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								children: t("无法写入剪贴板，请点击上方命令全选后手动复制")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								onClick: () => window.open(NPM_PACKAGE_URL, "_blank", "noopener,noreferrer"),
								children: t("查看 npm")
							})
						]
					});
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "mcpConnectorUpdateButton",
					onClick: () => openDshPluginMarket(actions),
					children: t("查看更新方式")
				});
			};
			// `iframeLocale` 可以是取值函数：语言服务晚于 apply() 就绪时，
			// 这里每次渲染都能读到最新语言，而不是注册时的快照。
			const src = marketIframeSrc(typeof iframeLocale === "function" ? iframeLocale() : iframeLocale);
			const titleId = presentation === "panel"
				? "mcp-connector-native-title"
				: "mcp-connector-modal-title";
			const marketPanel = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorMarketPanel",
						role: presentation === "panel" ? "region" : "dialog",
						"aria-modal": presentation === "panel" ? void 0 : true,
						"aria-labelledby": titleId,
						style: {
							borderRadius: presentation === "panel" ? 0 : 16,
							width: presentation === "panel" ? "100%" : "min(800px, 90%)",
							height: presentation === "panel" ? "100%" : "min(800px, 85%)",
							display: "flex",
							flexDirection: "column",
							boxShadow: presentation === "panel" ? "none" : "0 20px 60px rgba(0,0,0,0.15)",
							overflow: "hidden"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mcpConnectorMarketHeader",
								style: {
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "20px 24px",
									borderBottom: "1px solid",
									flexShrink: 0,
									filter: detailOpen ? "brightness(0.5)" : "none",
									pointerEvents: detailOpen ? "none" : "auto",
									transition: "filter 0.2s ease"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0, flex: 1 },
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorMarketIcon",
												"aria-hidden": true,
												children: (0, react_jsx_runtime.jsxs)("svg", {
													viewBox: "0 0 16 16",
													fill: "none",
													"aria-hidden": "true",
													children: [
														(0, react_jsx_runtime.jsx)("path", { d: "M6 2V4.5", stroke: "currentColor", strokeLinecap: "round" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M10 2V4.5", stroke: "currentColor", strokeLinecap: "round" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M3.5 4.5H12.5V8.25C12.5 10.7353 10.4853 12.75 8 12.75C5.51472 12.75 3.5 10.7353 3.5 8.25V4.5Z", stroke: "currentColor", strokeLinejoin: "round" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M8 12.75V14.5", stroke: "currentColor", strokeLinecap: "round" })
													]
												})
											}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { id: titleId, className: "mcpConnectorMarketTitle", style: { fontSize: 18, fontWeight: 600 }, children: t("MCP连接器") }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorVersion",
												title: versionStatus === null
													? t("正在检查插件版本")
													: t("当前版本 v{version}", { version: versionStatus.installedVersion }),
													children: versionStatus === null ? "v…" : `v${versionStatus.installedVersion}`
											}),
											renderUpdateControls(),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "mcpConnectorUpdateButton",
												disabled: versionCheckBusy || updateRunning,
												title: versionStatus?.checkedAt
													? t("上次检查：{time}", { time: new Date(versionStatus.checkedAt).toLocaleString() })
													: t("尚未完成版本检查"),
													onClick: () => setVersionCheckRequest((value) => value + 1),
												children: versionCheckBusy ? t("正在检查更新…") : t("检查更新")
											}),
											versionCheckFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorUpdateStatus",
												"data-tone": "error",
												children: versionCheckFailed === "api"
													? t("插件 API 不可用，请检查 DSH 宿主兼容性或服务日志")
													: t("暂时无法确认 npm 最新版本，请重试")
													}),
											versionStatus?.releasePending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorVersion",
												title: t("GitHub Release 已发布，等待 npm 同步后即可更新"),
												children: t("v{version} 正在同步", { version: versionStatus.release.version })
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										ref: closeRef,
										className: "mcpConnectorMarketClose",
										type: "button",
										"aria-label": presentation === "panel" ? t("返回会话") : t("关闭 MCP连接器"),
										onClick: closeView,
										style: {
											background: "transparent",
											border: "none",
											fontSize: 22,
											cursor: "pointer",
											padding: "4px 8px",
											borderRadius: 6,
											lineHeight: 1
										},
										children: "\u00D7"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
								ref: frameRef,
								src,
								onLoad: () => frameRef.current?.contentWindow?.postMessage({
									type: WORKSPACE_CONTEXT_RESULT_TYPE,
									workspace: workspaceContext()
								}, window.location.origin),
								title: t("MCP连接器"),
								style: {
									flex: 1,
									width: "100%",
									border: "none",
									background: "transparent",
									colorScheme: "light dark"
								}
							})
						]
					});
			if (presentation === "panel") return marketPanel;
			const modal = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.4)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: CONNECTOR_MODAL_Z_INDEX
				},
				onClick: (event) => { if (event.target === event.currentTarget) closeView(); },
				children: marketPanel
			});
			// shell.overlay lives inside a z-index:20 stacking context, while DSH
			// Settings is a root-level z-index:1000 modal. Portal to body so the
			// quick-open action can reliably place this dialog above Settings.
			if (document.body !== null && document.body !== void 0
				&& typeof react_dom.createPortal === "function") {
				return react_dom.createPortal(modal, document.body);
			}
			return modal;
		}

		/** DSH 0.1.x 兼容入口：仅在原生面板席位不完整时挂载。 */
		function LegacySidebarEntry(props) {
			const { wide, useStore, actions } = props;
			const open = useStore((state) => state.open);
			const visible = useStore((state) => state.sidebarVisible !== false);
			const [topMount, setTopMount] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!visible) {
					setTopMount(null);
					return void 0;
				}
				const removeStyles = installSidebarStyles();
				let disposed = false;
				const ownedMounts = new Set();
				const syncMount = () => {
					if (disposed) return;
					const mount = ensureTopLauncherMount();
					if (mount !== null) ownedMounts.add(mount);
					setTopMount((current) => current === mount ? current : mount);
				};
				syncMount();
				let observer = null;
				if (typeof window.MutationObserver === "function" && document.body !== null) {
					observer = new window.MutationObserver(syncMount);
					observer.observe(document.body, { childList: true, subtree: true });
				}
				return () => {
					disposed = true;
					observer?.disconnect();
					for (const mount of ownedMounts) mount.remove();
					removeStyles();
				};
			}, [visible]);
			if (!visible) return null;
			const launcher = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "mcpConnectorLauncher",
				"data-wide": wide,
				"data-placement": topMount === null ? "footer" : "top",
				"aria-label": t("MCP连接器"),
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				onClick: () => { try { actions.open(); } catch (error) { console.error('[mcp-connector] open failed:', error); } },
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: "mcpConnectorLauncherIcon",
						"aria-hidden": true,
						children: (0, react_jsx_runtime.jsxs)("svg", {
							viewBox: "0 0 16 16",
							fill: "none",
							"aria-hidden": "true",
							children: [
								(0, react_jsx_runtime.jsx)("path", { d: "M6 2V4.5", stroke: "currentColor", strokeLinecap: "round" }),
								(0, react_jsx_runtime.jsx)("path", { d: "M10 2V4.5", stroke: "currentColor", strokeLinecap: "round" }),
								(0, react_jsx_runtime.jsx)("path", { d: "M3.5 4.5H12.5V8.25C12.5 10.7353 10.4853 12.75 8 12.75C5.51472 12.75 3.5 10.7353 3.5 8.25V4.5Z", stroke: "currentColor", strokeLinejoin: "round" }),
								(0, react_jsx_runtime.jsx)("path", { d: "M8 12.75V14.5", stroke: "currentColor", strokeLinecap: "round" })
							]
						})
					}),
					wide ? (0, react_jsx_runtime.jsx)("span", { className: "mcpConnectorLauncherLabel", children: t("MCP连接器") }) : null
				]
			});
			if (topMount === null || typeof react_dom.createPortal !== "function") return launcher;
			return react_dom.createPortal(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mcpConnectorTopEntry",
				"data-wide": wide,
				children: launcher
			}), topMount);
		}

		/** 新版 DSH 会渲染整行按钮；插件只提供随 size/currentColor 变化的字形。 */
		function NativeSidebarIcon(props) {
			const size = Number.isFinite(props?.size) ? props.size : 16;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				"aria-hidden": "true",
				style: { display: "block" },
				children: [
					(0, react_jsx_runtime.jsx)("path", { d: "M6 2V4.5", strokeLinecap: "round" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M10 2V4.5", strokeLinecap: "round" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M3.5 4.5H12.5V8.25C12.5 10.7353 10.4853 12.75 8 12.75C5.51472 12.75 3.5 10.7353 3.5 8.25V4.5Z", strokeLinejoin: "round" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M8 12.75V14.5", strokeLinecap: "round" })
				]
			});
		}

		/**
		 * 面板宿主与设置弹框共用的运行时 props（含面板语言）。
		 *
		 * 语言取自 `apply()` 解析并随可选 `locale` 注入更新的模块状态，而不是在
		 * 语言取自 `apply()` 解析并随可选注入更新的模块状态，不在这里重新读服务。
		 */
		function marketRuntimeProps(ctx) {
			return {
				startPromptSession: (promptText) => startPromptSession(ctx, promptText),
				workspaceContext: () => currentWorkspaceContext(ctx),
				workspaceOptions: () => availableWorkspaceContexts(ctx),
				iframeLocale: () => activeLocale
			};
		}

		/**
		 * 原生 main + sidebar.panellist 优先；两个席位未同时就绪时才启用
		 * DSH 0.1.x footer/Portal 兼容适配器。席位可以延迟声明，因此状态不依赖 DOM 探测。
		 */
		function installSidebarSlots(ctx, marketView) {
			let mainReady = false;
			let panelListReady = false;
			let footerReady = false;
			let nativeEntryDispose = null;
			let fallbackEntryDispose = null;

			const layout = () => typeof ctx.get === "function" ? ctx.get("layout") ?? ctx.layout : ctx.layout;
			const leaveNativePanel = () => {
				const controller = layout();
				try {
					if (controller?.panelInfo?.getSnapshot?.().activePanelId === "mcp-connector") {
						controller.selectPanel(null);
					}
				} catch (error) {
					console.warn("[mcp-connector] failed to leave native panel:", error);
				}
			};
			const disposeNativeEntry = () => {
				if (nativeEntryDispose === null) return;
				leaveNativePanel();
				nativeEntryDispose();
				nativeEntryDispose = null;
			};
			const disposeFallbackEntry = () => {
				if (fallbackEntryDispose === null) return;
				fallbackEntryDispose();
				fallbackEntryDispose = null;
			};
			const syncEntries = () => {
				const visible = marketView.getSidebarVisible();
				const nativeReady = mainReady && panelListReady;
				if (nativeReady) {
					disposeFallbackEntry();
					if (visible && nativeEntryDispose === null) {
						nativeEntryDispose = ctx.slots.register({
							name: "sidebar.panellist",
							id: "mcp-connector",
							order: 40,
							// 传函数而不是字符串：槽位在**每次投影**时重新读取，侧边栏文案
							// 因此跟随当前语言，不必等重新注册（字符串会在注册时被固化，
							// 语言晚于 apply 就绪时永远停在旧文案）。
							label: () => t("MCP连接器")
						}, NativeSidebarIcon);
					} else if (!visible) {
						disposeNativeEntry();
					}
					return;
				}
				disposeNativeEntry();
				if (footerReady && visible && fallbackEntryDispose === null) {
					fallbackEntryDispose = ctx.slots.register({
						name: "sidebar.footer.action",
						id: "mcp-connector",
						order: 0,
						store: marketView
					}, LegacySidebarEntry);
				} else if (!visible) {
					disposeFallbackEntry();
				}
			};

			ctx.effect(() => {
				const unsubscribe = marketView.subscribeSidebarVisible(syncEntries);
				return () => {
					unsubscribe();
					disposeNativeEntry();
					disposeFallbackEntry();
				};
			}, "mcp-connector: sidebar entry visibility");

			// main 必须先于 panellist 行就绪，否则宿主会拒绝选中缺页面的行。
			ctx.slots.inject("main", () => {
				const disposeMain = ctx.slots.register({
					name: "main",
					key: "mcp-connector",
					store: marketView,
					inject: () => ({
						...marketRuntimeProps(ctx),
						presentation: "panel",
						closePanel: () => layout()?.selectPanel?.(null)
					})
				}, MarketOverlay);
				mainReady = true;
				syncEntries();
				return () => {
					leaveNativePanel();
					mainReady = false;
					syncEntries();
					disposeMain();
				};
			});

			ctx.slots.inject("sidebar.panellist", () => {
				panelListReady = true;
				syncEntries();
				return () => {
					panelListReady = false;
					syncEntries();
				};
			});

			ctx.slots.inject("sidebar.footer.action", () => {
				footerReady = true;
				syncEntries();
				return () => {
					footerReady = false;
					disposeFallbackEntry();
				};
			});
		}

		/**
		 * 语言服务通过**可选嵌套注入**接入：宿主没有 `locale` 服务时不注册回调，
		 * 插件照常加载并保持中文（§6.6）；服务晚于 apply 就绪时再切换。
		 */
		function installLocale(ctx) {
			if (typeof ctx.inject !== "function") return;
			try {
				ctx.inject(["locale"], (localeCtx) => {
					activeLocale = localeFromService(localeCtx) ?? DEFAULT_LOCALE;
				});
			} catch (error) {
				console.warn("[mcp-connector] optional locale injection failed:", error);
			}
		}

		function apply(ctx) {
			console.log('[mcp-connector] client apply() called');
			try {
				const marketView = createMarketViewStore();
				activeLocale = resolveLocaleId(ctx);
				installLocale(ctx);
				ctx.effect(() => installOverlayStyles(), "mcp-connector: overlay styles");
				installClientSettings(ctx, marketView);

				// 弹框：注册到 shell.overlay（类似社区插件市场）
				ctx.slots.inject("shell.overlay", () => {
					console.log('[mcp-connector] registering shell.overlay slot');
					return ctx.slots.register({
						name: "shell.overlay",
						id: "mcp-connector",
						order: 100,
						store: marketView,
						inject: () => marketRuntimeProps(ctx)
					}, MarketOverlay);
				});

				installSidebarSlots(ctx, marketView);
				console.log('[mcp-connector] client apply() completed');
			} catch (error) {
				console.error('[mcp-connector] client apply() failed:', error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
