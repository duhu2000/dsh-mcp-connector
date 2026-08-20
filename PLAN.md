# MCP连接器项目计划

> 基线日期：2026-08-20  
> 首发目标：GitHub `duhu2000/dsh-mcp-connector` + npm `dsh-mcp-connector@0.1.0`

## 项目目标

把 MCP Server 接入从“开发者手工配置”变成普通用户可完成的连接器体验：在 DSH Desktop 左侧主导航进入市场，完成授权/配置，查看能力并用示例 Prompt 快速开始对话；同时保留通用目录、三通道接入和连接生命周期管理。

目标导航顺序：

```text
品牌 / Logo
新会话
MCP连接器
工作区 / 会话列表
…
社区插件市场
设置
```

## 当前完成节点

- 通用 Host 能力：目录合并、OAuth PKCE、自定义配置、JSON/URL 导入、持久化恢复、启停/断开、远程 registry。
- Desktop 市场 UI：市场/已安装、4 个企查查卡片、统一 Logo、详情二级弹框、工具描述/搜索/滚动、精选 Prompt。
- Prompt 发送链路：创建或复用当前工作区空白会话、写入草稿、打开新会话，含同源校验、超时和重复点击保护。
- 入口兼容：公开 `sidebar.footer.action` 负责生命周期，React Portal 挂载到 `sidebar.workspaces` 前；目标不存在时自动回退到底部。
- 自动化：语法检查、29 项测试、npm 包白名单；CI 覆盖 Node 20/22/24，Tag 发布覆盖 npm 与 GitHub Release。

## P0：首发基线收口

| 项目 | 状态 | 发布门禁 |
|---|---|---|
| P0-0 左上角目标位置 | 已完成并通过 Desktop 验收 | 展开/收起均在新会话下、工作区上；无重复入口；点击正常 |
| P0-1 产品与文档基线 | 已完成 | README、PLAN、HANDOFF 与实际实现一致 |
| P0-2 发布工程 | 已完成 | `npm run check` 通过；包内容仅白名单；CI/Release 工作流就绪 |
| P0-3 GitHub 首发 | 本地 Git/基线提交已完成，远端待执行 | 新建公开仓库、push main、CI 通过、Tag `v0.1.0` |
| P0-4 npm 首发 | 待执行 | npm 登录或仓库 `NPM_TOKEN` 可用，发布 `dsh-mcp-connector@0.1.0` |

P0 完成定义：Desktop 验收通过、GitHub main/Tag 可访问、GitHub Actions 通过、npm 页面可安装、全新 profile 冒烟测试通过。

## P1：通用市场能力

- 从“首版 4 个企查查连接器”扩展到多厂商目录。
- 建立 registry 仓库、Schema 校验、连通性探针、上下架与健康巡检。
- 补充自定义配置/JSON 导入的图形化入口与错误引导。
- Prompt 模板参数化，避免示例公司名硬编码。

## P2：体验与质量

- Desktop E2E：展开/收起、切工作区、重建侧栏、重启、OAuth 回调。
- 可访问性、键盘操作、深浅主题与多语言。
- 大规模连接器/工具目录的性能与虚拟列表。
- 从两个旧企查查专用 OAuth 插件平滑迁移连接与凭证。

## 当前发布决策

- 包名与仓库名：`dsh-mcp-connector`。
- 首发版本：`0.1.0`（npm 尚无历史版本，不人为跳号）。
- 许可证：MIT，公开仓库。
- 顶部入口 Desktop 验收已通过；当前发布阻断项只剩 GitHub 远端建仓/CI 与 npm 发布凭据。
