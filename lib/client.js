window.__ModuleLoader__.load({
	id: "dsh-mcp-connector",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

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
		 * DSH 暂未公开“打开指定设置分区”服务：只依赖稳定的 sidebar.settings
		 * slot 和可访问文本打开插件市场，不依赖构建生成的 CSS 类名。
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
					if (attempts < 20) window.setTimeout(selectMarket, 50);
				};
				window.requestAnimationFrame(selectMarket);
			}, 0);
		}

		/** 创建弹框 store（使用 DSH defineStore，与社区插件市场一致）。 */
		function createMarketViewStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
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
				if (!open) return void 0;
				closeRef.current?.focus?.();
				const onKeyDown = (event) => { if (event.key === "Escape") actions.close(); };
				window.addEventListener("keydown", onKeyDown);
				return () => { window.removeEventListener("keydown", onKeyDown); };
			}, [open, actions]);
			if (!open) return null;
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
										style: { display: "flex", alignItems: "center", gap: 10 },
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 22 }, children: "\u{1F9E9}" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { id: "mcp-connector-market-title", className: "mcpConnectorMarketTitle", style: { fontSize: 18, fontWeight: 600 }, children: "MCP连接器" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpConnectorVersion",
												title: versionStatus === null ? "正在检查插件版本" : `当前版本 v${versionStatus.installedVersion}`,
												children: versionStatus === null ? "v…" : `v${versionStatus.installedVersion}`
											}),
											versionStatus?.updateAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "mcpConnectorUpdateButton",
												title: `npm 已发布 v${versionStatus.latestVersion}`,
												onClick: () => openDshPluginMarket(actions),
												children: `前往插件市场更新到 v${versionStatus.latestVersion}`
											}),
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
