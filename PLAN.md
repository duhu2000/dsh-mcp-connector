# MCP连接器项目计划

> 基线日期：2026-08-21
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
- 自动化：语法检查、39 项测试、36 个 npm 包白名单文件；CI 覆盖 Node 20/22/24，Tag 发布覆盖 npm 与 GitHub Release。

## P0：首发基线收口

| 项目 | 状态 | 发布门禁 |
|---|---|---|
| P0-0 左上角目标位置 | 已完成并通过 Desktop 验收 | 展开/收起均在新会话下、工作区上；无重复入口；点击正常 |
| P0-1 产品与文档基线 | 已完成 | README、PLAN、HANDOFF 与实际实现一致 |
| P0-2 发布工程 | 已完成 | `npm run check` 通过；包内容仅白名单；CI/Release 工作流就绪 |
| P0-3 GitHub 首发 | 已完成 | 公开仓库、main、CI、Tag `v0.1.0`、GitHub Release 均已验证 |
| P0-4 npm 首发 | 已完成 | `dsh-mcp-connector@0.1.0` 已公开发布并完成 registry 全新安装 |

P0 完成定义已满足：Desktop 验收通过、GitHub main/Tag/Release 可访问、GitHub Actions 通过、npm 页面可安装、registry 全新安装冒烟通过。

## P1：通用市场能力

| 项目 | 状态 | 验收门禁 |
|---|---|---|
| 多厂商目录模型 | 已完成开发 | 厂商/探针/工具快照/参数 Prompt；id 与 serverName 唯一校验 |
| Tier 1 registry 工程 | 已完成仓库种子 | `registry/` 一连接器一文件、JSON Schema、确定性构建、PR 门禁 |
| 连通性探针与巡检 | 已完成开发 | Schema/密钥/URL/MCP/OAuth/图标；每周 workflow 上传报告 |
| 图形化三通道接入 | 已完成开发 | 手动、JSON、描述 URL；失败保留表单并给修复建议 |
| Prompt 参数化 | 已完成开发 | 发送前填写主体；目录不再硬编码小米/华为/雷军 |
| 独立 registry GitHub 仓库 | 待外部发布 | 从当前种子拆分并配置 Pages/raw `catalogUrl` |

## P2：体验与质量

| 项目 | 状态 | 验收门禁 |
|---|---|---|
| 自动测试 | 已完成开发 | 单元/集成测试 + 本地 UI mock 测试壳 |
| Desktop E2E | 自动资产完成，实机待验收 | `docs/DESKTOP-E2E.md`；真实 OAuth/重启/侧栏发版前回归 |
| 可访问性与主题 | 已完成开发 | Dialog、焦点、Escape、Tab 循环、深浅主题、基础中英文 |
| 大目录性能 | 已完成开发 | 连接器每批 60；工具每批 50；搜索重置批次 |
| 旧插件迁移 | 已完成开发，执行待确认 | 显式扫描/迁移，幂等且不删除源凭据 |
| 安全加固 | 已完成开发 | 大小上限、原始 JSON 密钥审计、安全响应头、URL 白名单 |

## 当前发布决策

- 包名与仓库名：`dsh-mcp-connector`。
- 首发版本：`0.1.0`（npm 尚无历史版本，不人为跳号）。
- 许可证：MIT，公开仓库。
- P0 首发已于 2026-08-20 完成，后续进入 P1 通用市场能力建设。
- P1/P2 位于 `feat/p1-p2-completion`；不修改 `0.1.0` Tag，不在验收前发布新 npm 版本。
