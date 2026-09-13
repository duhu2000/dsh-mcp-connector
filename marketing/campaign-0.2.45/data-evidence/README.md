# v0.2.45 数据源口径与场景证据

状态：**checkpoint，可审阅**  
核验时间：2026-09-12 21:52 CST（2026-09-12 13:52 UTC）  
适用版本：`dsh-mcp-connector` v0.2.45

配套材料：[`catalog-evidence.json`](catalog-evidence.json) 为机器可读统计快照；[`SCENARIO-RUNBOOK.md`](SCENARIO-RUNBOOK.md) 为三个案例的录制与验收步骤。

## 1. 可公开使用的数量口径

### 耐久版（推荐用于商店短描述）

> MCP Server 与 MCP连接器市场，收录超百个 MCP连接器并持续更新；统一发现、授权和连接管理。

### 精确版（用于 README、发版稿或带统计日期的活动页）

> 截至 2026-09-11，公共 Registry 已发布 106 个连接器；与随包卡片合并去重后，默认市场可浏览 110 张连接器卡片，覆盖 9 个业务分类。

### 三个数字必须分开表达

| 指标 | 已核实值 | 含义 |
|---|---:|---|
| 公共 Registry | 106 | `catalog.json` 中已发布的公开 Connector Descriptor；106 个 ID 均唯一。 |
| 随包已发布卡片 | 6 | 4 张企查查卡片、北大法宝、Wind。 |
| 与 Registry 重复 | 2 | 北大法宝、Wind 已同时存在于公共 Registry。 |
| 随包唯一卡片 | 4 | 仅随包提供的 4 张企查查卡片。 |
| 默认市场合并去重后 | 110 | `106 + 6 - 2 = 110`，亦即 `106 + 4 = 110`。 |
| 业务分类 | 9 | 企业数据、金融投资、法律合规、开发工具、办公协作、调研分析、设计创意、效率工具、其他。 |
| 精选卡片 | 6 | 4 张企查查卡片、北大法宝、Wind。 |

不得写成“110 个 MCP 数据”或“110 个数据集”；这里统计的是连接器卡片。目录条数也不等于用户数、连接数、调用量或下载量。

## 2. 证据链与复核方法

- GitHub Registry `main`：`f1cbed41c3277a2274bc8633953b9096b6b7b56b`
- 提交时间：2026-09-11T04:46:48Z
- v0.2.45 Release commit：`82d240601df73b8e704124100ec5771a0cd5514a`
- 线上统计：[catalog-stats.json](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/catalog-stats.json)
- 线上目录：[catalog.json](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/catalog.json)
- Registry `catalog.json` Git blob SHA：`ba7690760adcaff3e0db884053af3974c2746c2b`
- 本次读取内容 SHA-256：`bd101122a52fa7f8e20de1040203fedd2c70aff3a6a639e2c02a484ff7e0e41d`
- Registry 统计内容 SHA-256：`91a178835b4b7cce51b61cf0d7be33467e8818a304d2c7f82b63453d0eb5fb78`
- 产品随包目录：`catalog/catalog.json`，已发布 6 张；其中 `pkulaw-legal`、`wind-stock-data` 与 Registry 重复，`qcc-company`、`qcc-legal`、`qcc-tender`、`qcc-document` 为随包唯一项。
- 统计生成逻辑：Registry 的 `scripts/build-catalog-stats.mjs` 使用 `Registry 条数 + bundledUniqueConnectorIds` 计算市场数，并校验随包唯一 ID 不得出现在 Registry。

复核命令（只读）：

```bash
gh api repos/duhu2000/dsh-mcp-connector-registry/commits/main \
  --jq '.sha + "\n" + .commit.committer.date + "\n" + .commit.message'

gh api 'repos/duhu2000/dsh-mcp-connector-registry/contents/catalog-stats.json?ref=main' \
  --jq '.content' | tr -d '\n' | base64 -d
```

## 3. 授权、费用与可用性边界

- 110 是默认公开市场的去重后卡片数，不代表全部服务都已连接、全部免费或全部无需授权。
- 具体连接器可能要求 OAuth、API Key、Bearer Token/PAT、付费订阅，或 Node/npm 等本地运行环境。
- Registry 与随包缓存保证的是“目录仍可浏览”；远程服务不可达、授权过期、本地运行时缺失时，工具仍可能不可调用。
- 第三方服务的可用性、额度、价格、数据许可、地域限制和工具清单会变化，应以提供方当前文档及连接后的实时工具发现为准。
- `probeStatus: pass` 只证明记录的协议/只读验收在对应时间通过，不是永久 SLA；`unverified` 也不等于服务不可用。
- 任何写入、删除、发送反馈、创建日程或修改工作区内容的工具，都应在执行前获得用户明确同意；宣传示例默认采用只读任务。

## 4. 三个可复现宣传场景（初稿）

### A. 开发工具：SHOPLINE 开发者 MCP

- Connector：`shopline-developer-mcp`，官方 stdio 包 `@shoplineos/shopline-developer-mcp@1.1.0`。
- 可发现工具：共 9 个，包括 `search_shopline_docs`、`read_full_docs`、`search_admin_rest_endpoints`、`get_admin_rest_endpoint_detail`、`get_graphql_schema`、`validate_graphql_codes` 等。
- 示例问题：`查询创建 SHOPLINE 商品所需的 Admin REST API endpoint、必填字段和示例；先搜索官方文档，再给出来源链接，不调用反馈工具。`
- 前置条件：无需业务凭据；本机需要可用的 Node.js/npm，且网络可访问 npm 与 SHOPLINE 官方开发文档。
- 已有证据：2026-09-11 的 `initialize`、`tools/list` 和只读 `search_shopline_docs` 调用通过；Server 1.1.0，MCP 协议 2025-06-18。
- 限制：结果依赖固定包版本与官方文档现状；`shopline_mcp_feedback` 会向第三方发送内容，本示例不得调用。

### B. 办公协作：Notion

- Connector：`notion`，Notion 官方托管 Streamable HTTP 端点 `https://mcp.notion.com/mcp`。
- 官方可发现工具：`notion-search`、`notion-fetch`、`notion-create-pages`、`notion-update-page`、`notion-get-comments` 等；本示例只使用搜索和读取工具。
- 示例问题：`使用 Notion MCP 搜索工作区中与“v0.2.45 发布”相关的页面，汇总进展、风险和待办并附页面标题；不要创建、更新、移动页面或发表评论。`
- 前置条件：完成 OAuth 2.0 PKCE，选择并授权目标 Notion 工作区；不需要本地 stdio 运行时。
- 限制：访问范围与当前 Notion 用户及工作区授权一致；连接器当前目录状态为 `unverified`，演示前必须在专用测试工作区完成连接和只读工具发现；Notion API 及单工具速率限制、Notion AI/套餐能力可能影响跨连接源搜索与高级查询。
- 官方资料：[Notion MCP 概览](https://developers.notion.com/guides/mcp/overview)、[支持工具](https://developers.notion.com/guides/mcp/mcp-supported-tools)、[连接说明](https://developers.notion.com/guides/mcp/get-started-with-mcp)。

### C. 数据分析：世界银行 Data360

- Connector：`world-bank-data360`，世界银行官方公共 Streamable HTTP 端点 `https://maimcpext.worldbank.org/ext/data360/mcp`。
- 官方可发现工具：15 个，包括 `data360_search_indicators`、`data360_get_metadata`、`data360_get_disaggregation`、`data360_get_data`、`data360_compare_countries`、`data360_rank_countries`、`data360_get_viz_spec` 等。
- 示例问题：`比较印度尼西亚、马来西亚、菲律宾、泰国和越南 2014 年至最新可用年份的人均 GDP 与国际贫困线以下贫困人口比例变化；先检索指标并核对国家与年份覆盖，再生成对比表，保留定义、来源、单位、方法限制和缺失值。`
- 前置条件：当前公共端点配置为免密，无本地运行时；需要网络可达世界银行 MCP 与 Data360 API。
- 限制：不得猜测 `database_id` 或 `indicator_id`；先搜索、再检查分组/年份，最后取数或生成图表。数据覆盖、更新频率和缺失值随指标而异，图表 URL 还依赖可选 Charts API。世界银行文档也说明其他托管/内部环境可能要求 Bearer 或 Azure AD，不能把“公共端点免密”泛化为所有部署。
- 官方资料：[World Bank Data360 MCP](https://worldbank.github.io/data360-mcp/)。

## 5. 新连接器贡献入口

- 推荐：向 [dsh-mcp-connector-registry](https://github.com/duhu2000/dsh-mcp-connector-registry) 提交 Connector PR。
- 不熟悉 Descriptor：提交 [Connector request issue](https://github.com/duhu2000/dsh-mcp-connector-registry/issues/new?template=connector-request.yml)；Issue 只代表收录请求，不等于自动上架。
- 完整指南：[第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)。
- PR 仅提交公开元数据和公开 URL；真实 Token、API Key、密码、Cookie、Client Secret、授权码或带值鉴权 Header 不得进入 Registry。
- 新增卡片需提交 `connectors/<id>.json`，并由维护流程补齐 `candidates/records/<id>.json`、官方资料/许可核验、人工批准和不含凭据或个人数据的运行验收摘要；本地运行 `npm ci --legacy-peer-deps`、`npm test && npm run validate && npm run assets:check`。
- PR 合并后 CI 重建目录与统计并清理 CDN 缓存；用户在市场点击“刷新”获取新卡片，无需重新发布插件 npm 包。

## 6. TODO（冻结前）

- [ ] 在专用空白 Notion 测试工作区完成 OAuth、`tools/list` 与只读搜索演示，避免把官方文档能力误写成当前客户端已验收事实。
- [ ] 为三个场景分别准备一张脱敏结果截图或短 GIF；截图中不得出现真实工作区名称、账号、Token、客户数据或个人信息。
- [ ] 发布前再次读取 `catalog-stats.json`；若数字变化，同步更新精确版，耐久短描述可继续使用“超百个”。
