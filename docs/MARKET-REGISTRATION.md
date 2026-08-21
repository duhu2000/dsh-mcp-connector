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

Bearer/API Key 型连接器可在卡片上点「配置」，一次填写凭据后批量连接该卡片的所有 Server。

## 3. 提交公共市场

1. 在 `registry/connectors/<id>.json` 新增一个描述文件，一个连接器一个文件。
2. 运行 `npm run registry:build` 和 `npm run registry:validate`。
3. 提交 PR。CI 会检查 Schema、重复 id/serverName、密钥、URL、MCP initialize、OAuth 元数据和图标。
4. 合并后生成远程 `catalog.json`；客户端刷新目录后可见。

公开 registry 独立仓库未拆分前，先向 `duhu2000/dsh-mcp-connector` 开发分支提交描述；拆分后流程不变。

## 4. OAuth 一键授权要求

`auth.mode: "oauth2-pkce"` 不是将现有 Bearer Token 改个名称。厂商服务端必须支持：

- OAuth Authorization Code + PKCE S256；
- MCP Protected Resource Metadata（RFC 9728）；
- Authorization Server Metadata（RFC 8414）；
- `authorization_endpoint`、`token_endpoint`、`registration_endpoint`、`revocation_endpoint`；
- Dynamic Client Registration，且支持 loopback callback URI；
- Refresh Token 和撤销。

符合上述条件的最小描述：

```json
{
  "schemaVersion": 1,
  "id": "vendor-legal",
  "name": "厂商·法律数据",
  "vendor": "厂商名称",
  "category": "法律数据",
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

## 5. 北大法宝当前适配结论

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
