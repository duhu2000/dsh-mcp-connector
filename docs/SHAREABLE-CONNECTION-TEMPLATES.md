# 安全可分享连接模板

## 定位

可分享模板不是完整配置备份，也不是可自动执行的安装脚本。它只保留让另一位用户理解“连什么”所必需的最小字段；凭据必须在目标本机重新填写，OAuth 和 stdio 目录项必须回到市场重新授权或确认。

## 核心契约

`lib/shareable-connection-template.js` 导出：

- `createShareableTemplateFromConnection(record, options)`：仅用于用户明确选择的连接；复用已有脱敏导出后再按白名单重建。
- `createShareableTemplateFromCatalog({connectorId, serverKey})`：只按 ID 从包内已审计、已发布目录解析；不接受用户粘贴的 descriptor。
- `assertShareableConnectionTemplate(input)`：严格白名单校验，未知字段直接拒绝，不静默过滤。
- `previewShareableConnectionTemplate(input)`：返回预览、待补字段、后续动作和 `requiresExplicitConfirmation=true`；不连接、不写入。
- `stringifyShareableConnectionTemplate(input)`：只序列化已通过上述严格校验的文档。

导入仍使用现有 `normalizeJsonImport()` 与 Host 显式确认链。凭据占位符 `<REDACTED:REENTER>` 未替换时，现有导入器会整体拒绝。本模块不提供绕过确认的执行 API。

## 允许与拒绝

| 输入 | 结果 | 原因 |
|---|---|---|
| 无额外 Header 的用户自定义 HTTP | 允许，但 URL、显示名和 serverName 都改为固定重填/公开值 | host、路径、子域名与自定义名称都可能携带租户或凭据 |
| Bearer/API Key HTTP | 允许，凭据改为占位符 | 目标用户必须在本机重填；API Key Header 只允许四个通用名称 |
| 用户自定义 URL（包括 userinfo、子域、路径、查询串、fragment、IP） | 不输出原值 | 整个 URL 改为重填占位符，不分享端点、租户或内网拓扑 |
| 自定义 Headers | 拒绝 | 不用 Header 名黑名单猜测值是否敏感 |
| 自定义 stdio | 拒绝 | 命令、参数、env、cwd 可能含凭据、本机路径或任意执行 |
| 包内已审计公开目录连接（HTTP / OAuth / stdio） | 仅输出 `connectorId/serverKey` 及 `connect-from-catalog` 引用 | 目标端从当前已审计目录重新解析；不复制 URL、Header、Grant、CLI、args 或 env |
| 用户粘贴或伪造的“公开 descriptor” | 拒绝 | `redacted=true` 不能证明 ID、名称或子域是公开信息 |
| 含未知字段的“模板” | 拒绝 | fail closed，不做过滤后继续 |

### 允许样例（节选）

```json
{
  "format": "dsh-mcp-connector.share-template",
  "version": 1,
  "redacted": true,
  "source": { "kind": "user-provided" },
  "connections": [{
    "name": "自定义 MCP 连接",
    "serverName": "custom-mcp",
    "transport": "streamable-http",
    "url": "<REDACTED:REENTER>",
    "headers": {},
    "authMode": "api-key",
    "apiKeyHeader": "X-Api-Key",
    "apiKeyValue": "<REDACTED:REENTER>",
    "redactedFields": ["url", "apiKeyValue"]
  }]
}
```

### 拒绝样例

```json
{
  "transport": "stdio",
  "command": "<LOCAL_PATH>/private-mcp",
  "args": ["--token", "secret"],
  "env": { "VENDOR_TOKEN": "secret" }
}
```

拒绝结果不回显上述值，只说明应改用经审计的公开目录模板。

## P0 前端接入

`ui/connection-template-sharing.js` 是无数据权限的纯前端 ES module。它不将安全性交给 LLM，而是在浏览器内执行确定性的白名单转换，然后由用户显式选择复制、下载或带入新会话草稿。

宿主必须把当前已审计且 `published !== false` 的目录转换为仅含 `connectorId/serverKey/name/serverName` 的 `catalogReferences`；不能将用户 JSON 当成白名单。

```js
import { mount } from '/mcp-connector/ui/connection-template-sharing.js';

const dispose = mount(container, {
  catalogReferences: publishedCatalog.flatMap((connector) =>
    connector.servers.map((server) => ({
      connectorId: connector.id,
      serverKey: server.serverKey,
      name: connector.name,
      serverName: server.serverName,
    }))),
  openDraft: async (text) => { /* start-session → Host setDraft，不发送 */ },
  showMessage: (message, type) => { /* type 为 'success' 或 'error' */ },
});

// 卸载面板时
dispose();
```

模块不读取 API、storage、真实连接、凭据或业务结果，也不提供粘贴 URL/Token/Header 值的输入框。预览本身不产生外部写入；复制、下载和 `openDraft(text)` 都要求独立点击。`openDraft` 只接收已生成的安全 JSON，文本只进入新会话草稿，不自动发送。样式在模块内按 `.mcp-safe-template-share` 作用域注入，无第三方依赖。
