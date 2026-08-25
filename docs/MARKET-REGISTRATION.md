# MCP 连接器市场注册指南

## 1. 先区分两种 JSON

| 类型 | 用途 | 是否含凭据 | 显示位置 |
|---|---|---|---|
| `mcpServers` 配置 | 为当前用户直接创建 MCP 连接 | 可以包含 Bearer/API Key | 「已安装」 |
| `ConnectorDescriptor` | 定义可浏览、可授权的市场卡片 | **不得包含任何凭据** | 「市场」 |

`mcpServers` 只有运行连接所需的 URL/Header，不包含厂商、Logo、产品说明、鉴权流程和示例 Prompt，因此导入后不会自动上架市场。

## 2. 先安装到本机市场

1. 按 `registry/schema/connector.schema.json` 编写无密钥的 ConnectorDescriptor。
2. 将 JSON 托管在 HTTPS URL（本机调试可使用 loopback HTTP）。
3. 在插件中选择「添加连接 → 市场卡片」，粘贴 URL。
4. Schema/密钥审计通过后，卡片会持久化到本机市场。

Bearer/API Key 型连接器可在卡片上点「配置」，一次填写凭据后批量连接该卡片的所有 Server。stdio 卡片可通过 `auth.credentialFields` 声明多个输入，并用 `servers[].credentialBindings` 映射到本地进程环境变量；描述文件仍不得包含真实值。

## 3. 提交公共市场

1. Fork 公开仓库 [`duhu2000/dsh-mcp-connector-registry`](https://github.com/duhu2000/dsh-mcp-connector-registry)，在 `connectors/<id>.json` 新增一个描述文件，一个连接器一个文件。
2. 运行 `npm install --legacy-peer-deps` 和 `npm run check`。
3. 提交 PR。CI 会检查 Schema、重复 id/serverName、密钥、URL、MCP initialize、OAuth 元数据和图标。
4. 合并后 CI 重建根目录 `catalog.json`；客户端点击“刷新”后可见，无需重新发布 `dsh-mcp-connector` npm 包。

插件默认通过 `https://cdn.jsdelivr.net/gh/duhu2000/dsh-mcp-connector-registry@main/catalog.json` 读取目录；主源失败时依次尝试 GitHub raw 备用源、上次缓存和随包内置目录。jsDelivr 的分支 URL 存在缓存延迟，合并后的新卡片可能不会秒级出现。

## 4. DSH 外部插件市场验收

`dsh-mcp-connector` 在 `awesome-dsh-plugin` 的注册 PR 为 [#2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633)。仓库每小时自动执行 `.github/workflows/market-registration.yml`：

1. PR 未合并时记录为 `awaiting-merge`，不误报构建失败；
2. PR 合并后检查上游 `data/plugins/duhu2000__dsh-mcp-connector.yml` 已进入 `main`；
3. 继续检查 DSH Market 实际使用的 `https://awesome-dsh-plugin.com/plugins.json`；
4. YAML 与线上目录均生效后状态为 `accepted`，否则在合并后明确报告目录同步未完成。

本地可运行 `npm run market:check`查看状态；CI 使用 `--strict-after-merge` 让“已合并但尚未可搜索”成为可见的验收信号。此检查仅需 GitHub Actions 默认的只读 `GITHUB_TOKEN`，不需要新增长期密钥。

## 5. OAuth 一键授权要求

`auth.mode: "oauth2-pkce"` 不是将现有 Bearer Token 改个名称。厂商服务端必须支持：

- OAuth Authorization Code + PKCE S256；
- MCP Protected Resource Metadata（RFC 9728）；
- Authorization Server Metadata（RFC 8414）；
- `authorization_endpoint`、`token_endpoint`、`registration_endpoint`；`revocation_endpoint` 建议提供，但按标准属于可选能力；
- Dynamic Client Registration，且支持 loopback callback URI；
- DCR 的 `token_endpoint_auth_method` 可为 `none`、`client_secret_post` 或 `client_secret_basic`；后两者的注册响应必须返回 `client_secret`；
- Refresh Token；如提供撤销端点，插件会在断开/清理授权时撤销 Refresh Token，否则只删除 DSH 本机授权记录。

DCR 返回的 `client_secret` 由插件与 Access/Refresh Token 一同保存在 DSH 本机 Grant 中，只用于 Token 交换、刷新和撤销，不会出现在目录、状态输出或日志。描述文件只填写服务端支持的 `tokenEndpointAuthMethod`，不得预置客户端密钥。

插件优先读取 RFC 8414 Authorization Server Metadata；若动态注册或撤销端点缺失，会再读取 OIDC Discovery 并仅补齐缺失字段。OAuth 元数据中的授权、Token 等标准端点始终优先。

符合上述条件的最小描述：

```json
{
  "schemaVersion": 1,
  "id": "vendor-legal",
  "name": "厂商·法律数据",
  "vendor": "厂商名称",
  "category": "法律合规",
  "summary": "法规与案例检索",
  "published": true,
  "auth": {
    "mode": "oauth2-pkce",
    "issuer": "https://auth.vendor.example",
    "scope": "mcp:tools",
    "clientName": "DeepSeek Harness - MCP 连接器",
    "tokenEndpointAuthMethod": "none"
  },
  "servers": [
    {
      "serverKey": "law",
      "url": "https://mcp.vendor.example/law",
      "serverName": "vendor-law",
      "transport": "streamable-http"
    }
  ]
}
```

### 5.1 需要本机环境变量的 stdio 卡片

目录只声明字段和映射，示例见 `registry/connectors/stdio-credential.sample.json`：

```json
{
  "auth": {
    "mode": "api-key",
    "credentialFields": [
      { "key": "apiToken", "label": "API Token", "required": true, "secret": true },
      { "key": "region", "label": "区域", "required": true, "secret": false }
    ]
  },
  "servers": [{
    "serverKey": "main",
    "serverName": "vendor-local-service",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@vendor/example-mcp-server"],
    "env": { "LOG_LEVEL": "info" },
    "credentialBindings": {
      "VENDOR_API_TOKEN": "apiToken",
      "VENDOR_REGION": "region"
    }
  }]
}
```

`credentialBindings` 的 key 必须是合法环境变量名，value 必须引用已声明的字段。不要在 `env`、`credentialFields` 或其他目录字段中填写 Token、Secret、API Key、密码或 Cookie。

## 6. 北大法宝当前适配结论

北大法宝当前公开文档的主路径是在控制台生成 Access Token，然后通过 `Authorization: Bearer ...` 访问多个 MCP Server。因此：

- JSON 导入：可直接使用，显示在「已安装」；
- 公共市场：**技术评估为“有条件通过（Tier 1 / 第三方）”**。可用 `auth.mode: "bearer"` 注册，用户一次填写 Token 后批量连接所有 Server；
- 真正 OAuth 一键授权：需北大法宝提供第 4 节所列的标准端点，或与 DSH 进行预注册客户端集成；仅凭当前 `mcpServers` JSON 无法自动获得此能力。

正式发布公共卡片前还需完成以下门槛：

- 由北大法宝确认可公开使用的产品名称、Logo、描述和支持地址；未确认前必须标识为“第三方/非官方收录”；
- 描述文件不得内置 Token，并明确提示用户需自行注册、购买或开通相应服务；
- 对官网列出的全部 Server 执行 Schema、HTTPS、MCP initialize 和共享 Token 批量连接验证；
- 如要宣称“OAuth 一键授权”，必须补齐并验证标准发现元数据、Authorization Code + PKCE、动态客户端注册、刷新与撤销流程。

因此当前建议是：**可以准备并提交 Bearer 型公共市场卡片；暂不作为“官方精选”或“OAuth 一键授权”卡片发布。**

参考：

- https://mcp.pkulaw.com/docs?doc=authentication
- https://mcp.pkulaw.com/docs?doc=mcp-integration

## 7. Wind 股票数据当前适配结论

万得 AIFin Market 的“万得股票数据服务”详情页公开了标准 MCP 手工配置：

- MCP URL：`https://mcp.wind.com.cn/vserver_stock_data/mcp/`；
- 鉴权：`Authorization: Bearer YOUR_WIND_KEY`；
- 响应协商：`Accept: application/json, text/event-stream`；
- 当前公开能力范围：公司档案、股本与股东、行情报价、技术指标、基本面财务、公司事件、风险与波动性，共 10 个工具。

因此该服务可按 **Tier 1 / 第三方 Bearer 连接器**上架市场：用户填写一次 Wind Key 后建立一条股票数据连接。卡片只描述官网当前公开的股票 MCP 能力，不扩展宣称基金、债券、新闻或宏观数据；实际数据权限以用户的万得账户开通范围为准。

当前公开页面没有展示可由通用客户端自动发现的 OAuth Authorization Code + PKCE 流程，因此本卡片不标注“OAuth 一键授权”。如万得后续开放标准 OAuth 元数据，可再升级为 OAuth 连接器。

参考：

- https://aifinmarket.wind.com.cn/#/market?tab=mcps&detailType=mcp&detailId=wind_stock_data-0

## 8. QVerisMCP 适配结论

QVeris Hosted MCP 提供单一 Streamable HTTP 端点 `https://mcp.qveris.ai/mcp`，
通过 `Authorization: Bearer <QVERIS_API_KEY>` 鉴权，与本插件现有的 Bearer
凭据表单、持久化前 `initialize` 校验和 Streamable HTTP 传输完全兼容。

2026-08-22 使用真实 API Key 完成只读 `tools/list` 验收，QVeris 托管端实际返回
8 个 MCP 工具：`discover`、`inspect`、`call`、`usage_history`、
`credits_ledger`，以及 3 个兼容旧客户端的弃用别名 `search_tools`、
`get_tools_by_ids`、`execute_tool`。当前运行时没有官网文档所列的 `probe`；
市场快照以实际端点为准。官方宣传的上万项能力是经 `discover` 找到的下游能力，
不写成上万个 MCP 工具。

由于 `call` 可能消耗 Credits，且查询内容可能由第三方服务商处理，
该卡片保持 `featured: false`，并执行以下产品约束：

- Prompt 默认只执行 `discover`/`inspect` 和用量审计工具；
- 未经用户明确确认，不执行可能消耗 Credits 的 `call` 或弃用别名 `execute_tool`；
- 卡片明确提醒用户不要提交未获授权的个人信息、商业秘密或敏感业务数据；
- 市场使用用户指定的 QVeris 官方 Logo；由于官网原图返回
  `Cross-Origin-Resource-Policy: same-origin`，在 DSH Desktop 中直链会被浏览器拦截，
  Registry 因此保留官方原图像素并自托管于
  `assets/qveris-logo.png`，对外提供可跨域嵌入的 Raw GitHub URL。

公共无凭据探针已确认端点可达并正确返回 HTTP 401；使用 DSH 本机自有 API Key
执行完整 `initialize → notifications/initialized → tools/list` 后，服务返回
`Mcp-Session-Id`、协议版本 `2025-03-26` 和 8 个工具。验收未执行 `call` 或
`execute_tool`，没有产生付费能力调用。

参考：

- https://qveris.ai/hosted-mcp
- https://qveris.ai/docs/mcp-server
- https://qveris.ai/pricing
- https://qveris.ai/privacy
- https://qveris.ai/terms

## 9. 八爪鱼云采集 OAuth 适配结论

八爪鱼公开 MCP 服务 `https://mcp.bazhuayu.com/` 已验证支持标准远程 MCP OAuth 发现链路：

- Protected Resource Metadata 指向 `https://identity.bazhuayu.com`；
- Authorization Code + PKCE S256；
- Dynamic Client Registration，公共客户端使用 `token_endpoint_auth_method: none`；
- Scope：`openid profile offline_access`；
- OAuth Metadata 发布授权与 Token 端点，OIDC Discovery 补充动态注册和撤销端点。

因此可以作为本市场首个完整的第三方 OAuth 一键授权示例。连接器不复用 WorkBuddy 的 `client_id` 或私有回调协议，而是由 DSH 插件为本机 loopback callback 动态注册独立公共客户端；授权结果只保存在 DSH storage domain。

市场卡片使用八爪鱼官网 favicon 的像素副本并由 Registry 自托管。官方文档基线列出 10 个工具；2026-08-23 Desktop 真实授权后服务端实际返回 12 个工具，新增 `get_task_status` 与 `describe_ecommerce_dataset`，Registry 快照已按运行时结果校正。`list_platforms` 只读调用成功并返回 902 个平台。涉及启动/停止云任务的 Prompt 必须先征求用户确认，实际云采集配额、费用、平台范围与数据使用责任以用户账户和八爪鱼官方规则为准。

参考：

- https://www.bazhuayu.com/ai-open-platform
- https://www.bazhuayu.com/docs/zh/mcp
- https://mcp.bazhuayu.com/.well-known/oauth-protected-resource
- https://identity.bazhuayu.com/.well-known/oauth-authorization-server
- https://identity.bazhuayu.com/.well-known/openid-configuration
