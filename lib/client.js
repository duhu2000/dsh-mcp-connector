window.__ModuleLoader__.load({
	id: "dsh-mcp-connector",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let defineStore;
		try {
			({ defineStore } = require("@deepseek-ai/dsh-client-store"));
		} catch (storeError) {
			try {
				({ defineStore } = require("@deepseek-ai/dsh-client-runtime/client"));
			} catch (runtimeError) {
				throw new AggregateError(
					[storeError, runtimeError],
					"mcp-connector: DSH client store is unavailable"
				);
			}
		}

		/** 客户端所需服务：槽位、工作区、会话及对话输入机。 */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"conversation"
		];
		const PROMPT_REQUEST_TYPE = "mcp-connector:start-session";
		const PROMPT_RESULT_TYPE = "mcp-connector:start-session-result";
		const VERSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
		const VERSION_CHECK_RETRY_MS = 5 * 60 * 1e3;
		const NPM_PACKAGE_URL = "https://www.npmjs.com/package/dsh-mcp-connector";
		const PLUGIN_PACKAGE_NAME = "dsh-mcp-connector";
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
		 * Desktop 内置的社区插件市场也注册在 sidebar.footer.action。
		 * 该 list slot 的宿主容器默认横排，会把两个本应占满侧边栏宽度的
		 * launcher 挤在同一行。覆盖 SlotOutlet 的 display: contents，让所有
		 * footer action 在 Web 与 Desktop 中都按独立行纵向排列。
		 */
		const SIDEBAR_STYLE_ID = "dsh-mcp-connector-sidebar";
		const sidebarCss = `
[data-slot="sidebar.footer.action"] {
	display: flex !important;
	flex-direction: column;
	min-width: 0;
	width: 100%;
}

.mcpConnectorLauncher {
	flex: none;
	box-sizing: border-box;
	width: calc(100% + 4px);
	height: 42px;
	margin: 4px -2px;
	padding: 0 10px 0 8px;
	justify-content: flex-start;
	overflow: hidden;
	border-radius: 12px;
	white-space: nowrap;
}

.mcpConnectorLauncher[data-wide="false"] {
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

.mcpConnectorMarketPanel { background: #ffffff; color: #111827; }
.mcpConnectorMarketHeader { border-color: #e5e7eb; }
.mcpConnectorMarketTitle { color: #111827; }
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
		const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]';
		const TOP_MOUNT_SELECTOR = '[data-mcp-connector-top-mount="true"]';

		function installSidebarStyles() {
			if (document.querySelector(`style[data-plugin="${SIDEBAR_STYLE_ID}"]`) !== null) return () => {};
			const style = document.createElement("style");
			style.dataset.plugin = SIDEBAR_STYLE_ID;
			style.textContent = sidebarCss;
			document.head.append(style);
			return () => { style.remove(); };
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

		async function fetchVersionStatus() {
			const response = await window.fetch("/mcp-connector/api", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ method: "versionStatus", params: {} })
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
				if (result?.schema !== schema) throw new Error(`${label} 更新接口版本不兼容`);
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
						throw new Error(`${label} 未返回更新任务编号`);
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
					if (capabilities.endpoints.rollback === null) throw new Error(`${label} 不支持回滚`);
					const result = await post(capabilities.endpoints.rollback, { operationId });
					return result.operation;
				},
				async restart(capabilities) {
					if (capabilities.endpoints.restart === null) throw new Error(`${label} 不支持重启`);
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
			if (operation?.state === "queued") return "更新任务排队中…";
			const percent = operation?.progress?.percent;
			if (typeof percent === "number") return `正在更新 ${percent}%`;
			const phase = operation?.progress?.phase;
			if (typeof phase === "string" && phase !== "") return `正在更新：${phase}`;
			return "正在更新…";
		}

		function updateFailureLabel(failure) {
			const labels = {
				AGENTS_RUNNING: "有任务正在运行，请结束后重试",
				OPERATION_BUSY: "插件市场正在处理其他任务",
				RELEASE_TOO_FRESH: "新版本处于发布安全等待期（约 24 小时）",
				MIRROR_SYNC_PENDING: "镜像尚未同步完整安装包",
				VERSION_UNCHANGED: "下载后版本未变化",
				DOWNGRADE_DETECTED: "已阻止版本降级",
				RESOLVED_VERSION_MISMATCH: "下载版本与预期不一致",
				INVALID_UPDATE_RESULT: "更新服务未返回有效版本",
				UPDATE_TIMEOUT: "更新超时",
				UPDATE_FORBIDDEN: "更新请求被拒绝",
				UPDATE_REJECTED: "无法执行本次更新"
			};
			return labels[failure?.code] ?? failure?.message ?? "更新失败";
		}

		function manualUpgradeCommand(version) {
			const parsed = parseClientVersion(version);
			if (parsed === null) return null;
			return `dsh plugin --profile web add --config.minimumReleaseAge=0 ${PLUGIN_PACKAGE_NAME}@${parsed.normalized}`;
		}

		async function copyManualUpgradeCommand(command) {
			if (typeof window.navigator?.clipboard?.writeText === "function") {
				await window.navigator.clipboard.writeText(command);
				return true;
			}
			window.prompt?.("请复制以下升级命令", command);
			return false;
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
					message: "更新服务报告成功，但未返回有效的已安装版本",
					retryable: false
				};
			}
			const before = parseClientVersion(operation.beforeVersion);
			if (before !== null && compareClientVersions(installed.normalized, before.normalized) < 0) {
				return {
					code: "DOWNGRADE_DETECTED",
					message: `更新服务将插件从 v${before.normalized} 降级到 v${installed.normalized}`,
					retryable: false
				};
			}
			const expected = parseClientVersion(expectedVersion);
			if (expected !== null && compareClientVersions(installed.normalized, expected.normalized) !== 0) {
				return {
					code: "RESOLVED_VERSION_MISMATCH",
					message: `预期安装 v${expected.normalized}，更新服务实际安装了 v${installed.normalized}`,
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

		/** 创建弹框 store（使用 DSH defineStore，与社区插件市场一致）。 */
		function createMarketViewStore() {
			return defineStore({
				init: () => ({ open: false, detailOpen: false }),
				actions: {
					open: (draft) => { draft.open = true; },
					close: (draft) => { draft.open = false; draft.detailOpen = false; },
					detailOpened: (draft) => { draft.detailOpen = true; },
					detailClosed: (draft) => { draft.detailOpen = false; }
				}
			});
		}

		/**
		 * 用 DSH 自身的工作区/会话/输入机把示例 Prompt 带入新会话。
		 * connectWorkspace 与 DSH 的「新会话」按钮同源：优先复用当前工作区的
		 * 空白会话，没有时创建一个；返回时 binding 已就绪，可在导航前写入草稿。
		 */
		async function startPromptSession(ctx, promptText) {
			if (typeof promptText !== "string" || promptText.trim() === "") {
				throw new Error("Prompt 不能为空");
			}
			const workspace = ctx.workspaces.list.getSnapshot();
			const current = ctx.sessions.list.getSnapshot().current;
			const currentWorkspaceId = current === void 0
				? void 0
				: workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
			const targetWorkspaceId = currentWorkspaceId ?? workspace.recentWorkspaceId;
			if (targetWorkspaceId === void 0) {
				throw new Error("请先选择一个工作空间，再使用示例 Prompt");
			}
			const sessionId = await ctx.workspaces.connectWorkspace(targetWorkspaceId);
			const conversation = ctx.get("conversation");
			if (conversation === void 0) {
				throw new Error("DSH 对话服务尚未就绪，请稍后重试");
			}
			conversation.input.shell(sessionId).setDraft(promptText);
			ctx.sessions.open(sessionId);
			return sessionId;
		}

		/** 弹框组件：居中显示市场 SPA（浅色主题）。 */
		function MarketOverlay(props) {
			const { wide, useStore, actions, startPromptSession: launchPromptSession } = props;
			const open = useStore((state) => state.open);
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
			const frameRef = (0, react.useRef)(null);
			const closeRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const onMessage = (event) => {
					if (event.origin !== window.location.origin) return;
					if (event.source !== frameRef.current?.contentWindow) return;
					if (event.data?.type === "mcp-connector:detail-state") {
						if (event.data.open === true) actions.detailOpened();
						else actions.detailClosed();
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
						reply(false, "无效的 Prompt 请求");
						return;
					}
					Promise.resolve(launchPromptSession(prompt)).then(() => {
						reply(true, "已带入新会话");
						window.requestAnimationFrame(() => { actions.close(); });
					}, (error) => {
						const message = error instanceof Error ? error.message : String(error);
						console.error("[mcp-connector] start prompt session failed:", error);
						reply(false, message);
					});
				};
				window.addEventListener("message", onMessage);
				return () => { window.removeEventListener("message", onMessage); };
			}, [actions, launchPromptSession]);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				let disposed = false;
				let pollTimer;
				const schedule = (delayMs) => {
					window.clearTimeout(pollTimer);
					pollTimer = window.setTimeout(check, Math.max(1e3, delayMs));
				};
				const check = () => {
					fetchVersionStatus().then((status) => {
						if (disposed) return;
						setVersionStatus(status);
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
						if (!disposed) schedule(VERSION_CHECK_RETRY_MS);
					});
				};
				check();
				return () => {
					disposed = true;
					window.clearTimeout(pollTimer);
				};
			}, [open]);
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
			}, [open]);
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
				if (!open) return void 0;
				closeRef.current?.focus?.();
				const onKeyDown = (event) => { if (event.key === "Escape") actions.close(); };
				window.addEventListener("keydown", onKeyDown);
				return () => { window.removeEventListener("keydown", onKeyDown); };
			}, [open, actions]);
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
				if (!versionStatus?.updateAvailable && activationPendingVersion === null
					&& updateOperation === null && updateError === null) return null;
				if (updateRunning) {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								disabled: true,
								children: updateStarting ? "正在启动更新…" : updateProgressLabel(updateOperation)
							}),
							updateError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								title: updateError,
								children: "暂时无法读取进度，正在重试"
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
								title: updateOperation.failure?.message ?? "更新失败",
								children: updateFailureLabel(updateOperation.failure)
							}),
							updateOperation.failure?.retryable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								onClick: () => startUpdate(force),
								children: updateOperation.failure?.code === "RELEASE_TOO_FRESH" ? "立即更新（跳过等待）" : force ? "强制重试" : "重试更新"
							}),
							rollbackRunning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								children: "检测到异常版本，正在自动回滚…"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								onClick: () => openDshPluginMarket(actions),
								children: "查看更新方式"
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
									? updateOperation.integrityFailure === void 0 ? "已回滚" : "已阻止异常版本并回滚"
									: `已安装 v${updateOperation.installedVersion ?? versionStatus?.latestVersion}`
							}),
							rollbackFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								"data-tone": "error",
								title: updateOperation.outcome.rollback.detail ?? "回滚失败",
								children: "回滚失败"
							}),
						restartRequired && updateProviderSelection?.capabilities?.restart?.supported === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								disabled: restarting,
								onClick: restartHost,
								children: restarting ? "正在重启…" : "立即重启"
							}),
						restartRequired && updateProviderSelection?.capabilities?.restart?.supported !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mcpConnectorUpdateStatus",
							title: `重启由 ${updateProviderSelection?.capabilities?.restart?.managedBy ?? "宿主"} 管理`,
							children: updateProviderSelection?.capabilities?.runtime === "desktop" ? "请重启 DSH Desktop" : "请重启 DSH"
							}),
							!restartRequired && refreshRequired && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								onClick: () => window.location.reload(),
								children: "刷新生效"
							}),
							updateOperation.outcome?.rollback?.available === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								disabled: rollbackRunning,
								onClick: rollbackUpdate,
								children: rollbackRunning ? "正在回滚…" : rollbackFailed ? "重试回滚" : "回滚"
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
								children: "更新服务调用失败"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								onClick: () => openDshPluginMarket(actions),
								children: "查看更新方式"
							})
						]
					});
				}
				if (updateProviderState === "checking") {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mcpConnectorUpdateButton",
						disabled: true,
						children: "正在准备更新…"
					});
				}
				if (updateProviderState === "ready" && providerUpdateCheck?.updateAvailable === true) {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mcpConnectorUpdateButton",
						title: `由 ${updateProviderSelection?.provider?.label ?? "更新服务"} 安全更新到 v${providerUpdateCheck.latestVersion}`,
						onClick: () => startUpdate(false),
						children: `一键更新到 v${providerUpdateCheck.latestVersion}`
					});
				}
				if (activationPendingVersion !== null) {
					const canRestart = updateProviderSelection?.capabilities?.restart?.supported === true;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorUpdateControls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpConnectorUpdateStatus",
								children: `v${activationPendingVersion} 已安装，重启后生效`
							}),
							canRestart
								? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "mcpConnectorUpdateButton",
									disabled: restarting,
									onClick: restartHost,
									children: restarting ? "正在重启…" : "立即重启"
								})
								: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "mcpConnectorUpdateStatus",
									title: `重启由 ${updateProviderSelection?.capabilities?.restart?.managedBy ?? "宿主"} 管理`,
									children: updateProviderSelection?.capabilities?.runtime === "desktop"
										? "请重启 DSH Desktop"
										: "请重启 DSH"
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
								children: command
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton",
								onClick: () => {
									copyManualUpgradeCommand(command).then((copied) => {
										if (copied) setManualCommandCopied(true);
									}, (error) => {
										console.warn("[mcp-connector] copy upgrade command failed:", error);
										window.prompt?.("请复制以下升级命令", command);
									});
								},
								children: manualCommandCopied ? "已复制" : "复制升级命令"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpConnectorUpdateButton mcpConnectorUpdateSecondary",
								onClick: () => window.open(NPM_PACKAGE_URL, "_blank", "noopener,noreferrer"),
								children: "查看 npm"
							})
						]
					});
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "mcpConnectorUpdateButton",
					onClick: () => openDshPluginMarket(actions),
					children: "查看更新方式"
				});
			};
			const src = window.location.origin + "/mcp-connector/ui/";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.4)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 1000
				},
				onClick: (event) => { if (event.target === event.currentTarget) actions.close(); },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpConnectorMarketPanel",
						role: "dialog",
						"aria-modal": true,
						"aria-labelledby": "mcp-connector-market-title",
						style: {
							borderRadius: 16,
							width: "min(800px, 90%)",
							height: "min(800px, 85%)",
							display: "flex",
							flexDirection: "column",
							boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
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
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 22 }, children: "\u{1F9E9}" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { id: "mcp-connector-market-title", className: "mcpConnectorMarketTitle", style: { fontSize: 18, fontWeight: 600 }, children: "MCP连接器" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorVersion",
												title: versionStatus === null ? "正在检查插件版本" : `当前版本 v${versionStatus.installedVersion}`,
												children: versionStatus === null ? "v…" : `v${versionStatus.installedVersion}`
											}),
											renderUpdateControls(),
											versionStatus?.releasePending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorVersion",
												title: "GitHub Release 已发布，等待 npm 同步后即可更新",
												children: `v${versionStatus.release.version} 正在同步`
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										ref: closeRef,
										className: "mcpConnectorMarketClose",
										type: "button",
										"aria-label": "关闭 MCP连接器",
										onClick: () => actions.close(),
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
								title: "MCP连接器",
								style: {
									flex: 1,
									width: "100%",
									border: "none",
									background: "transparent",
									colorScheme: "light dark"
								}
							})
						]
					})
				]
			});
		}

		/** 左栏入口按钮：使用 DSH Button 组件，与社区插件市场一致。 */
		function SidebarEntry(props) {
			const { wide, useStore, actions } = props;
			const open = useStore((state) => state.open);
			const [topMount, setTopMount] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
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
				};
			}, []);
			const launcher = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				className: "mcpConnectorLauncher",
				"data-wide": wide,
				"aria-label": "MCP连接器",
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				onClick: () => { try { actions.open(); } catch (error) { console.error('[mcp-connector] open failed:', error); } },
				children: wide ? "🧩 MCP连接器" : "🧩"
			});
			if (topMount === null || typeof react_dom.createPortal !== "function") return launcher;
			return react_dom.createPortal(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mcpConnectorTopEntry",
				"data-wide": wide,
				children: launcher
			}), topMount);
		}

		function apply(ctx) {
			console.log('[mcp-connector] client apply() called');
			try {
				const marketView = createMarketViewStore();
				ctx.effect(() => installSidebarStyles(), "mcp-connector: sidebar styles");

				// 弹框：注册到 shell.overlay（类似社区插件市场）
				ctx.slots.inject("shell.overlay", () => {
					console.log('[mcp-connector] registering shell.overlay slot');
					return ctx.slots.register({
						name: "shell.overlay",
						id: "mcp-connector",
						order: 100,
						store: marketView,
						inject: () => ({
							startPromptSession: (promptText) => startPromptSession(ctx, promptText)
						})
					}, MarketOverlay);
				});

				// 左栏：公开 footer slot 托管生命周期；组件会 Portal 到工作区列表上方。
				ctx.slots.inject("sidebar.footer.action", () => {
					console.log('[mcp-connector] registering sidebar.footer.action slot');
					return ctx.slots.register({
						name: "sidebar.footer.action",
						id: "mcp-connector",
						order: 0,
						store: marketView
					}, SidebarEntry);
				});
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
