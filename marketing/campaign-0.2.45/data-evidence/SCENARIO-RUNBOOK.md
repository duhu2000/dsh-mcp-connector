# v0.2.45 宣传案例录制手册

本手册用于在干净测试环境中复现“开发工具、办公协作、数据分析”三类案例。所有案例默认只读，不执行付费、发送、创建、修改或删除操作。

## 统一录制规则

1. 使用 `dsh-mcp-connector` v0.2.45，并先点击“刷新连接器目录”。
2. 截图需同时能看到连接器名称、连接状态、工具总数或工具搜索结果、提问和带来源的回答。
3. 连接前记录授权方式和运行时前置；连接后记录实时工具发现，不把 Registry 静态描述当成运行时成功证据。
4. 不展示账号、邮箱、工作区/项目真实名称、Token、授权码、Cookie、本机绝对路径、客户数据或个人信息。
5. 遇到服务不可达、授权失败、限流或工具变更时，保留错误类别和时间，不宣称产品永久可用。

## 案例 A：SHOPLINE 官方开发文档检索

### 目标

证明用户可从统一工具搜索进入 SHOPLINE 官方开发资料查询，并产出带来源的 API 结论。

### 前置

- Connector：`shopline-developer-mcp`
- 传输：stdio
- 命令：`npx -y @shoplineos/shopline-developer-mcp@1.1.0`
- 鉴权/费用：Connector 无鉴权；不因此承诺 SHOPLINE 其他业务服务免费。
- 本地要求：Node.js/npm；可访问 npm 和 SHOPLINE 官方开发文档。

### 录制步骤

1. 在市场搜索“SHOPLINE 开发者 MCP”，连接后确认发现 9 个工具。
2. 在统一工具搜索中输入 `GraphQL`，确认能找到 `get_graphql_schema`、`validate_graphql_codes`。
3. 发送：

   > 查找 SHOPLINE Storefront GraphQL 中查询商品标题、价格和库存的 schema，并生成一段可通过校验的只读查询；说明 API 版本与来源，不调用反馈工具。

4. 验收回答包含：使用的工具、官方来源链接、GraphQL 代码、校验结果和版本/时效说明。

### 安全闸门

- 不调用 `shopline_mcp_feedback`；它会把内容发送给 SHOPLINE。
- 不声称该 Connector 可读取真实店铺商品或订单；当前工具定位是开发文档、API 定义、Schema 与代码校验。
- 已有只读验收只覆盖 1.1.0；包版本升级后需重新验收。

## 案例 B：Notion 工作区只读进展汇总

### 目标

证明统一 OAuth 连接后，可搜索和读取用户授权范围内的办公知识库，同时守住“只读”边界。

### 前置

- Connector：`notion`
- 传输：官方托管 Streamable HTTP
- 端点：`https://mcp.notion.com/mcp`
- 鉴权：OAuth 2.0 PKCE
- 费用/套餐：连接器目录不承诺 Notion 全部能力免费；跨 Slack/Google Drive/Jira 的连接源搜索需要 Notion AI，高级跨数据源查询还可能要求 Enterprise/Business 等计划。
- 测试数据：专用空白工作区内准备 3 张虚构页面，例如“版本目标”“风险清单”“发布待办”。

### 录制步骤

1. 连接 Notion，OAuth 时只选择专用测试工作区。
2. 展开工具详情，确认实时发现 `notion-search` 与 `notion-fetch`；工具名前缀可能因客户端规范显示为 `search`、`fetch`。
3. 发送：

   > 使用 Notion MCP 搜索工作区中与“v0.2.45 发布”相关的页面，汇总进展、风险和待办并附页面标题；不要创建、更新、移动页面或发表评论。

4. 验收回答只引用测试页面，按进展/风险/待办分组，并未触发任何写入工具。

### 安全闸门

- 当前 Registry 卡片 `probeStatus` 为 `unverified`；完成本手册 TODO 前不得把此案例写成“DSH 已实测通过”。
- 官方 MCP 的权限等同于当前 Notion 用户在被授权工作区的权限；录制不得连接生产工作区。
- 不调用 `notion-create-pages`、`notion-update-page`、`notion-move-pages`、`notion-create-comment` 等写入工具。
- 官方速率限制与套餐规则可能变化；出现限流时减少并行搜索或稍后重试。

## 案例 C：世界银行 Data360 跨国发展指标比较

### 目标

证明免密公共 MCP 可以先发现指标、核对口径与覆盖，再获取数据和生成可核验图表方案。

### 前置

- Connector：`world-bank-data360`
- 传输：官方托管 Streamable HTTP
- 端点：`https://maimcpext.worldbank.org/ext/data360/mcp`
- 鉴权/费用：当前公共端点配置免密；不代表其他 World Bank 内部/APIM 部署免鉴权，也不代表所有衍生服务永久免费。
- 本地要求：无需 stdio 运行时；需可访问 World Bank MCP、Data360 API，生成图表 URL 时还依赖 Charts API。

### 录制步骤

1. 在市场搜索“世界银行 Data360”，连接后确认发现 15 个工具。
2. 在统一工具搜索中分别输入 `search`、`disaggregation`、`compare`、`viz`，确认能发现对应工具。
3. 发送：

   > 比较印度尼西亚、马来西亚、菲律宾、泰国和越南 2014 年至最新可用年份的人均 GDP 与国际贫困线以下贫困人口比例变化；先检索指标并核对国家与年份覆盖，再生成年度对比表并总结趋势，列出指标定义、来源、单位、方法限制和缺失值，不要猜测 database_id 或 indicator_id。

4. 验收调用顺序至少体现：`data360_search_indicators` → `data360_get_disaggregation` → `data360_get_data` 或 `data360_compare_countries`；若生成图表，再调用 `data360_get_viz_spec`。
5. 验收回答保留指标定义、来源、单位、查询/最新可得时间、缺失值与比较限制。

### 安全闸门

- 不预填或猜测 `database_id`、`indicator_id`；必须来自搜索结果。
- 不能把相关性写成因果关系，不能隐藏缺失年份或口径差异。
- “免密”只描述当前 Registry 指向的公共端点；服务限流、维护或网络故障仍会影响调用。

## 冻结判定

| 案例 | 当前证据状态 | 可否直接用于“已实测”宣传 |
|---|---|---|
| SHOPLINE | 2026-09-11 已完成 `initialize`、9 个工具发现及只读检索 | 可以，但需注明测试包版本与日期 |
| Notion | 官方文档与 Registry 卡片已核对，尚无本轮专用工作区真实验收 | 暂不可以；完成 TODO 后再升级表述 |
| Data360 | Registry 为 `pass`，官方页面列明 15 个工具和公共端点 | 可描述“官方支持/目录已收录”；录屏后再描述“本轮实测” |

