# Issue #129：原生侧栏面板与旧版兼容

## 决策

0.2.x 采用“原生优先、旧版回退”：

- DSH `>=0.2.0-rc.2`：使用 root-scoped keyed `main` 和 `sidebar.panellist`。
- DSH `0.1.x`：仅在上述两个席位未同时就绪时，使用 `sidebar.footer.action` + Portal 兼容适配器。
- 计划在 0.3.0 明确将最低 DSH 提高到 `>=0.2.0-rc.2` 后删除兼容适配器。

## 生命周期

1. 先向 `main` 注册 `key: "mcp-connector"` 的市场面板。
2. `main` 与 `sidebar.panellist` 均就绪后，才注册 `id: "mcp-connector"` 的行。
3. 原生行注册前原子注销旧版入口；原生席位移除后恢复旧版入口。
4. 行本身、选中态、折叠 tooltip 和无障碍名称由宿主所有；插件只渲染 `size` + `currentColor` 图标。
5. `showSidebarEntry=false` 时注销行。如果 `ctx.layout.panelInfo` 显示当前面板被选中，先调用 `ctx.layout.selectPanel(null)`。

## 市场视图

`MarketOverlay` 提供同一份标题栏、版本/更新 Provider 状态和市场 iframe：

- `presentation="panel"`：填满原生 `main` 面板，关闭动作返回会话。
- `presentation="modal"`：保留 `shell.overlay` 与 body Portal，供设置页快捷打开。

两种展示共用 Store 规格、Workspace/Prompt 注入与业务逻辑，但使用独立标题 ID，避免设置弹框覆盖原生面板时产生重复 DOM ID。

## 验收

- 新宿主只有一个原生行，不安装旧版侧栏 CSS，不创建 Portal 挂载点或 `MutationObserver`。
- 旧宿主仅有一个兼容入口。
- 席位延迟到达、移除、隐藏和恢复均不产生双入口或无入口的死面板。
- 设置页快捷弹框、连接状态、工具发现和 Prompt 发送行为不变。
