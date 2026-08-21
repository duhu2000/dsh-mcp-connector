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
- Desktop 市场 UI：市场/已安装、前 4 个企查查卡片、第 5 个北大法宝第三方卡片、详情二级弹框、工具描述/搜索/滚动、精选 Prompt。
- Prompt 发送链路：创建或复用当前工作区空白会话、写入草稿、打开新会话，含同源校验、超时和重复点击保护。
- 入口兼容：公开 `sidebar.footer.action` 负责生命周期，React Portal 挂载到 `sidebar.workspaces` 前；目标不存在时自动回退到底部。
- 自动化：语法检查、62 项测试、43 个 npm 包白名单文件；CI 覆盖 Node 20/22/24，Tag 发布覆盖 npm 与 GitHub Release。
- 市场运营资产：独立远程 Registry 已上线；4 张无凭据 UI 截图和约 30 秒演示 GIF 已纳入中英文 README。

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
| 图形化三通道接入 | 已完成开发 | 手动、格式化 JSON、市场卡片 URL；失败保留表单并给修复建议 |
| 凭据型市场卡片 | 已完成开发 | Bearer/API Key 一次填写，批量连接卡片下所有 Server；凭据不进目录 |
| Prompt 参数化 | 已完成开发 | 内置示例有默认值时直接发送；社区 Prompt 缺少必填值时才置顶显示参数补全弹框 |
| 独立 registry GitHub 仓库 | 已完成 | `duhu2000/dsh-mcp-connector-registry` 已公开；Raw `catalogUrl`、CI 与每周巡检已启用 |
| 市场截图与演示 | 已完成 | 4 张 16:9 核心界面截图；约 30 秒演示 GIF；中英文 README 可直接预览 |
| 第三方自助上架闭环 | 已完成 | Registry 提供贡献指南、Connector request、PR 模板、CODEOWNERS、文件名/ID 门禁与自动测试 |
| 中国市场单语言界面 | 已完成 | 运行界面固定中文，移除 EN 按钮、英文 UI 字典及语言偏好持久化 |

## P2：体验与质量

| 项目 | 状态 | 验收门禁 |
|---|---|---|
| 自动测试 | 已完成开发 | 单元/集成测试 + 本地 UI mock 测试壳 |
| 连接健康状态 | 已完成开发 | 已配置/已连接/需重新授权/部分异常/连接异常/已停用；OAuth 与 Key 均支持 initialize 检查 |
| Desktop E2E | 0.2.4 实机回归已通过 | 完全重启、入口与中文市场视觉验收；刷新后“已连接/需要重新授权/配置”状态与真实结果一致，19 条连接和 4 组授权记录保留 |
| 可访问性与主题 | 已完成开发 | Dialog、焦点、Escape、Tab 循环、深浅主题、固定中文界面 |
| 大目录性能 | 已完成开发 | 连接器每批 60；工具每批 50；搜索重置批次 |
| 旧插件迁移 | 已完成开发并实机执行 | 用户明确确认后扫描到 2 组旧授权；对应目标连接均已存在并幂等跳过，待迁移数 0，源凭据与现有连接均保留 |
| 安全加固 | 已完成开发 | 大小上限、原始 JSON 密钥审计、安全响应头、URL 白名单 |

## 当前发布决策

- 包名与仓库名：`dsh-mcp-connector`。
- 当前公开版本：`0.2.5`，通过 npm Trusted Publishing 发布。
- 许可证：MIT，公开仓库。
- P0 首发已于 2026-08-20 完成；P1 核心市场能力和独立 Registry 已并入 `main`。
- 下一 P0 是在仓库满一天后提交 `awesome-dsh-plugin` 外部市场 PR；随后跟踪 CI、合并和下游市场同步。已有版本 Tag 不回写。
