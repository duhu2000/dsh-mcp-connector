# MCP连接器 · v2 设计：左侧工作区入口 + 右侧图形化页面 + 市场运营管线

> 状态：已实现（2026-08-21 更新；顶部主导航位置已通过 P0 Desktop 验收）
> 前置：v1 MVP（P0）已跑通 —— 目录 / OAuth 一键连接 / 状态管理（对话工具面）

---

## 1. 目标

1. **形态升级**：插件安装后，在 DSH 左侧栏出现「MCP连接器」入口（与工作区/会话同级），点击后在右侧 frame 打开图形化页面。
2. **图形页面**：卡片式「市场 / 推荐 / 已安装」，每个连接器卡片可 **安装 / 卸载 / 查看详情 / 试一试 / 使用**；详情页展示该连接器的 **MCP Server 清单 + 工具清单 + 说明**。
3. **市场运营**：ops 自己挑选一批「可 OAuth 连通」的 MCP Server，经过 **连通性检测 → 合并 → 上架** 进入市场清单，并持续维护。

---

## 2. 可行性结论（已核实 DSH 插件扩展面）

DSH 是「host 插件（Cordis，Node）+ client 插件（浏览器，React）」双半结构。本次需要的全部挂载点都已存在并被现有插件使用：

| 需求 | DSH 原生能力 | 证据 |
|---|---|---|
| 左侧栏入口 | `ctx.slots.register(name:'sidebar.*')` | `ui-layout` 声明三栏框架：`root` → `sidebar` / `conversation` / `details` / `shell.overlay`；`ui-sidebar` 声明 `sidebar.header` / `sidebar.workspaces` / `sidebar.footer.action` / `sidebar.settings` |
| 右侧 frame 页面 | `ctx.betterSidebar.registerTab()` + `openTab()`；或直接注册 `details` slot | `dsh-better-sidebar` README 明示「Exposes a service for other plugins to register sidebar tabs」；`openTab({type,title,url})` 支持 url 型页签 |
| 打开/收起右栏 | `ctx.layout.openDetails()/closeDetails()/toggleSidebar()` | `ui-layout` 提供的 `ctx.layout` 跨插件面板服务 |
| host 提供 HTTP 页面与 API | `ctx.webServer.register({kind:'prefix', path, handler})` | `dsh-better-sidebar` 自身即用此注册 `/sidebar/api`、`/sidebar/file`、bundle 路由与 WebSocket |
| 页面/API 防本地越权 | `isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)`（信任围栏） | better-sidebar 的 `fence(req)` 同源实现 |
| client 打包/注入 | package.json `dsh.client.inject` + `lib/client.js`（`window.__ModuleLoader__.load`） | better-sidebar 完整先例 |

**结论**：不需要改 DSH 壳，纯插件内即可完成；右栏页签直接复用已安装的 `dsh-better-sidebar` 服务（非破坏性、作为页签并存）。

---

## 3. 总体架构（两半插件）

```
dsh-mcp-connector
├─ 主机半（host, Cordis/Node）     已有 v1 逻辑 + 新增：
│   ├─ ctx.storageDomain           连接/授权/目录持久化（已就绪）
│   ├─ ctx.loader                  动态挂载 mcp-client 条目（已就绪）
│   ├─ OAuth 客户端                RFC8414/9728 全套（已就绪）
│   ├─ ctx.webServer.register
│   │    ├─ /mcp-connector/ui/*   静态 SPA（HTML/JS/CSS，经信任围栏）
│   │    └─ /mcp-connector/api/*  JSON RPC：catalog/connect/configure/import/
│   │                              status/install/uninstall/refresh/publish/probe
│   └─ mcp_connector_* 工具        保留（语音/对话入口与服务端 API 同源）
└─ 客户端半（client, React/浏览器）  新增：
    ├─ ctx.slots.register('sidebar.footer.action', NavButton)
    │       左侧栏入口「MCP连接器」图标按钮
    ├─ ctx.betterSidebar.registerTab({id:'mcp-connector', title:'MCP连接器', single:true, render})
    │       右栏页签，渲染 <iframe src="/mcp-connector/ui/">
    └─ 点击入口 → ctx.layout.openDetails() + betterSidebar.openTab({type:'mcp-connector'})
```

**关键点**
- SPA 是**自包含静态页**，只通过 `/mcp-connector/api/*` 与 host 通信，不深耦合 DSS React 组件（升级/换肤不破坏）。
- 所有 API 走**信任围栏**（仅 DSH web 应用可调，杜绝本地任意页面 CSRF 读 token）。
- 服务端 API 与 `mcp_connector_*` 工具**共用同一 `api` facade**（catalog/connect/…），保证「图形页」与「对话」状态一致。

---

## 4. 图形页面信息架构

```
┌ MCP连接器（右栏页签）──────────────────────────┐
│ [市场] [推荐] [已安装]            [刷新市场]     │
│ ┌ 卡片 ─────────────────────────┐               │
│ │ ⭐ 企查查·企业工商      OAuth  │ [安装] [查看]  │
│ │ 企业数据 · 企查查            │ [试一试]       │
│ └──────────────────────────────┘               │
│ 点卡片 → 详情视图：                             │
│   · 简介 / 厂商 / 标签 / 鉴权方式 / 连通性状态   │
│   · MCP Server 清单（serverName/transport/URL） │
│   · 工具清单（mcp__<serverName>__* 逐条）       │
│   · 使用说明（授权要点 / 所需 key / 注意事项）    │
└────────────────────────────────────────────────┘
```

### 4.1 卡片动作语义

| 动作 | 行为 | 后端 |
|---|---|---|
| 安装 / 连接 | OAuth：跳授权→回调→挂载条目；api-key：弹配置表单填 key→挂载 | `api.connect` / `api.configure` |
| 卸载 / 断开 | 移除 mcp-client 条目；OAuth 按引用计数 revoke | `api.disconnect` |
| 查看详情 | 展开详情视图（server+工具清单） | `api.catalog` + `api.inspect(id)` |
| 试一试 | 免登录只读试跑：对该 server 做 `tools/list`（若 server 公开枚举）或展示示例工具/演示数据 | `api.try(id)` |
| 使用 | 确认已安装+启用，展示工具前缀与用法提示 | `api.status` |
| 刷新市场 | 重拉远程目录（ETag 缓存） | `api.refreshCatalog` |

### 4.2 工具清单来源
- 已安装：读取 `ctx.loader` 该条目的 MCP `tools/list`（mcp-client 已连接，实时枚举）。
- 未安装（市场预览）：读取 registry 里预录的 `toolsSnapshot`（探针阶段抓取，见 §6）。

---

## 5. 左侧入口的放置决策（已定）

`sidebar` 是 `single` slot（被 `ui-sidebar` 占据），不能「并排注入」而不替换整栏。可行位置：

| 方案 | 位置 | 观感 | 侵入性 |
|---|---|---|---|
| A（临时方案） | `sidebar.footer.action`（底部功能轨道） | 图标按钮「MCP连接器」，与设置同级 | 极低，纯增量 |
| B | `sidebar.header` 附加 | 顶部 logo 区旁 | 低（需读 header slot 结构） |
| C | 自实现整栏（注册 `sidebar` 低优先级 shadow） | 完全自定义左栏，含应用列表 | 高，需重写会话树，不推荐 |

> 最终产品决策：入口位于“新会话”下、“工作区/会话列表”上。DSH rc.7 没有该位置的公开子 slot，因此实现采用公开 `sidebar.footer.action` 托管生命周期，再用 React Portal 把按钮挂到稳定的 `[data-slot="sidebar.workspaces"]` 前；找不到目标时自动回退 footer。禁止依赖构建生成的 CSS 类名，也不替换整个工作区 slot。

---

## 6. 市场运营管线（检测 → 合并 → 上架）

### 6.1 候选清单
```
dsh-mcp-connector-registry/            # 新仓库（Tier 1 社区目录）
├─ candidates/<id>.json                # ops 手挑的候选（原始 URL + 期望 server 配置）
├─ probes/<id>.report.json             # 探针报告（CI 生成）
├─ catalog.json                        # 合并产物 = 插件 catalogUrl 指向
└─ .github/workflows/{probe,publish}.yml
```

### 6.2 OAuth 连通性检测（probe）
复用 v1 `lib/oauth.js` 的发现逻辑，写成无凭据探针 `bin/probe.mjs`：

1. `POST {url}/initialize`（MCP 初始化）→ 期待 `401 + WWW-Authenticate: Bearer ... resource_metadata="…"`（RFC 9728）。
2. `GET resource_metadata` → `authorization_servers[]`、`resource`。
3. `GET /.well-known/oauth-authorization-server` → `authorization_endpoint` / `token_endpoint` / `registration_endpoint` / `revocation_endpoint` / `scopes_supported`。
4. 若存在 `registration_endpoint`：DCR 注册（`token_endpoint_auth_method:none`）拿 `client_id`（一次性，探针专用，不存用户数据）。
5. 可达性：对 `authorization_endpoint` 做 GET/HEAD（不真正走完授权流）。
6. 可选项：能枚举则抓 `toolsSnapshot`（预录工具清单，供市场「未安装预览」）。

**判定**：`pass`（元数据+AS+注册全通）/ `partial`（仅元数据，需人工补 client 注册）/ `fail`（含原因）。输出 `report.json` + 归一化后的 **descriptor 草稿**。

> 探针**无用户凭据**、只做公开元数据 + 一次性 DCR，不触发真实用户授权；「能授权成功」由 pass 判定 + 首接用户授权兜底验证。

### 6.3 合并（merge）
- 去重键：`issuer + serverUrl`（稳定幂等）。
- 优先级：`远程 registry 目录 < 用户本地 overrides`（现有 `mergeCatalog` 已支持）。
- 新字段：`probeStatus`（pass/partial/fail/unverified）、`probeCheckedAt`、`probeReportUrl`、`toolsSnapshot`。
- ops 走 PR 评审；CI 只对 `fail` 阻断合并。

### 6.4 上架（publish）
- PR 合并 → CI 重新探针 → 重新生成 `catalog.json` → 发布到 GitHub Pages/raw。
- 插件 `catalogUrl` 指向该产物；`refresh_catalog` / 页面「刷新市场」按 ETag 增量拉取。
- **健康巡检**：每周定时 CI 对全量已上架重跑探针；`fail` 自动标 `published:false` 或置 `probeStatus:fail` 待 ops 复核（下架不删已装连接）。

---

## 7. 数据模型扩展（`lib/schema.js`）

```js
// catalogRecordSchema 追加
probeStatus:      z.enum(['pass','partial','fail','unverified']).optional(),
probeCheckedAt:   z.number().optional(),   // ms epoch
probeReportUrl:   z.string().optional(),
toolsSnapshot:    z.array(z.object({ serverKey: z.string(), tools: z.array(z.object({name:z.string(), description:z.string().optional()})) })).optional(),
```

---

## 8. 阶段计划

| 里程碑 | 内容 | 产出 |
|---|---|---|
| **M7** | client 半 + host webServer + SPA 骨架（市场/已安装卡片，安装/卸载） | 左侧入口 + 右栏可交互页 |
| **M8** | SPA 全量（详情/工具清单/试一试/使用）、API 补齐、信任围栏、与对话工具同源 | 图形页 MVP 完成 |
| **M9** | 市场管线：`probe` CLI + registry 仓库 + CI（探针/合并/上架/巡检） | 市场可运营 |
| **M10** | 加固：Desktop UI mock 测试壳、鉴权/围栏测试、i18n、迁移旧 qcc 插件 | 已完成开发，实机待发版验收 |

---

## 9. 已落地的评审决策

1. **左栏入口**：已选择“新会话下、工作区上”的主导航位置；由公开 footer slot 托管生命周期，Portal 定位，目标缺失时回退 footer。
2. **主内容形态**：已选择插件自带 Overlay，不依赖 `dsh-better-sidebar`。
3. **市场范围**：M7/M8 均已完成，包含市场、已安装、详情、工具、Prompt 和连接生命周期。
4. **registry 托管**：仓库内 Tier 1 种子和 CI 已落地；是否拆分为新的公开仓库，留待发版验收时确认。
