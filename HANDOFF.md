# MCP连接器插件移交文档

> 更新：2026-08-20  
> 源码：`/Users/qcc/Documents/DuHu/QCC/beichacha_doc/云聚接口/MCP/MCP/workspace/mcp-connector-plugin`  
> Desktop 安装副本：`/Users/qcc/.dsh/profiles/web/node_modules/dsh-mcp-connector`

## 1. 产品目标

为 DeepSeek Harness Desktop 提供类似 WorkBuddy 的通用 MCP 连接器入口和市场。用户应在“新会话”下、“工作区/会话列表”上看到“🧩 MCP连接器”，完成浏览、授权、查看能力和快速发起对话。

插件不等同于企查查专用 OAuth 插件：企查查是首批内置目录，长期目标是支持任意符合描述规范的 MCP Server。

## 2. 当前实现

- 目录：内置、远程 registry、配置注入、URL 动态安装、本地上下架覆盖。
- 连接：OAuth 2.0 Authorization Code + PKCE、自定义 Bearer/API Key/无鉴权、`mcpServers` JSON 导入。
- 管理：storage domain 持久化、重启恢复、启停、断开、OAuth 刷新与撤销。
- UI：市场/已安装、搜索、4 个企查查连接器、包内 QCC Logo、详情弹框。
- 详情：精选 Prompt 在上，工具默认折叠；按 Server 分组，含描述、搜索和 300px 独立滚动区。
- Prompt：iframe 通过同源 `postMessage` 请求 Client，随后 `connectWorkspace → setDraft → sessions.open`。
- 入口：插件仍在公开 `sidebar.footer.action` 注册；组件运行后用 React Portal 插入 `[data-slot="sidebar.workspaces"]` 前。若目标缺失或 `react-dom` 不可用，保留 footer 入口作为降级。

## 3. P0 状态

| 节点 | 状态 |
|---|---|
| 入口、弹框、详情、Logo、Prompt 发送 | 已完成开发 |
| 左上角目标位置自动测试 | 已通过 |
| 左上角目标位置 Desktop 实机验收 | 已通过（2026-08-20 用户确认） |
| lint + 单元/集成测试 | 通过，29/29 |
| npm 发布包校验 | 已配置，25 个白名单文件；含敏感内容与本机路径扫描 |
| GitHub Actions CI/Release | 已配置并通过（CI #1、Release #1） |
| 本地 Git 仓库与首个基线提交 | 已完成 |
| GitHub 远端建仓、push、`v0.1.0`、Release | 已完成 |
| npm `dsh-mcp-connector@0.1.0` | 已公开发布并完成全新安装验证 |

## 4. Desktop 验收清单（已通过）

2026-08-20 已完成 Desktop 实机验证，后续版本继续按以下项目回归：

1. 展开侧栏：MCP连接器位于新会话下、工作区上，社区插件市场仍在底部。
2. 收起侧栏：显示单独的 🧩 圆形入口，不挤压其他入口。
3. 展开/收起、切换工作区、新建会话后入口不消失、不重复。
4. 点击入口可打开市场，二级详情蒙层和关闭按钮正常。
5. 点击示例 Prompt 可打开新会话并写入草稿。
6. 若人为模拟找不到 `sidebar.workspaces`，底部入口仍可点击。

## 5. 开发与同步

```bash
cd /Users/qcc/Documents/DuHu/QCC/beichacha_doc/云聚接口/MCP/MCP/workspace/mcp-connector-plugin
npm run check
```

开发副本修改后需同步到 Desktop 安装副本，并完全重启 DSH Desktop。同步必须保持文件内容一致，不要只改安装目录。

关键文件：

- `lib/client.js`：侧栏入口、Portal、市场 Overlay、Prompt 新会话桥接。
- `ui/index.html`：市场 SPA 与详情交互。
- `lib/index.js`：Host API、连接生命周期、目录与工具枚举。
- `catalog/catalog.json`：内置连接器和 Prompt。
- `test/client.test.mjs`：Client 入口与 Prompt 桥接回归。
- `.github/workflows/`、`scripts/verify-pack.mjs`：发布门禁。
- `CHANGELOG.md`：首发能力与后续版本变更记录。

## 6. 首发结果

1. GitHub：https://github.com/duhu2000/dsh-mcp-connector
2. CI：https://github.com/duhu2000/dsh-mcp-connector/actions/runs/32384979218
3. Release：https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.1.0
4. npm：https://www.npmjs.com/package/dsh-mcp-connector
5. npm `latest`：`0.1.0`；从 registry 全新安装后 `lib/client.js`、`ui/index.html`、`CHANGELOG.md` 均存在。

发布工作流会校验 Tag 必须等于 `v` + `package.json.version`；本次 npm 使用本机已认证账号直接发布，Tag 工作流负责 GitHub Release。

## 7. 已知限制与风险

- DSH rc.7 没有目标位置的公开插槽，顶部入口依赖稳定 `data-slot` + Portal；已提供 footer 降级，但 DSH 大版本升级后应复测。
- Prompt 示例仍含固定企业名，参数化列入 P1。
- 首版目录只有企查查连接器，通用 registry 与多厂商生态列入 P1。
- stdio MCP 不在首版范围；支持 streamable-http 与 SSE。
