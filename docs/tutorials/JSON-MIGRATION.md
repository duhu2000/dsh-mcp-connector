# 把已有 `mcpServers` JSON 迁移到 MCP连接器

适用场景：你已经有其他客户端的 `mcpServers` 配置，希望在 DeepSeek Harness 中统一管理，而不是逐个重新录入。本文只演示受信任的 HTTP/stdio MCP Server；不会把普通 API 或 CLI 自动变成 MCP Server。

## 迁移前：先确认什么

1. 安装 `dsh-mcp-connector`，完全退出并重启 DSH Desktop 或 `dsh web`；确认当前使用的 profile 与安装插件的 profile 一致（例如 Web 使用 `web`，Desktop 使用其对应 profile）。
2. 核对原配置的每个 Server：远端 URL 是否为 MCP Streamable HTTP 端点；本地 `command`、`args` 和运行时是否可信且可在 **DSH 所在机器** 启动。
3. 对每个连接决定“当前项目”或“所有项目（全局）”。全局仅指当前 DSH profile，并非跨 profile 共享。
4. 在本机保存原配置的安全备份。不要把含 Token、API Key、Cookie 或本机路径的原文发到 Issue、聊天或公开仓库。

## 导入一个最小示例

打开左侧“🧩 MCP连接器”（或“设置 → 插件 → 插件配置 → MCP连接器 → 打开 MCP连接器”），点击“＋ 添加连接 → 导入 JSON”，在本机粘贴：

```json
{
  "mcpServers": {
    "example-http": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer REPLACE_LOCALLY" }
    },
    "example-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/replace/with/trusted/server.js"],
      "env": { "EXAMPLE_MODE": "readonly" }
    }
  }
}
```

以上地址、路径和凭据都是占位示例，不能直接连接。请在本机替换为服务商文档给出的值；如没有可信的本地服务，可删除 `example-local`。历史 `sse` 会被归一为 Streamable HTTP，不代表任何旧 SSE 地址都兼容。外部 URL 默认应使用 HTTPS；对私有 IP 明文 HTTP 的显式风险确认及限制见[用户手册](../USER-GUIDE.md#61-导入-mcpservers-json)。

提交前确认目标范围，提交后在“已安装”查看连接。导入和启动失败时先看诊断；不要仅凭“列表里出现配置”判断可用。自定义 HTTP 会在保存前校验 MCP `initialize`；stdio 会等待 Host 首次初始化和工具同步。

## 首次成功使用的三个验收点

| 验收点 | 在哪里看 | 通过条件 |
|---|---|---|
| 配置已保存 | “已安装”页 | 目标连接存在，名称与项目/全局范围正确 |
| 工具已发现并注册 | “工具”页与 DSH Host | 当前范围内出现预期工具和来源；必要时检查 `mcp__<serverName>__*` 注册状态 |
| 业务调用成功 | 正常 DSH 会话 | 经 Host 的权限/审批链调用一个服务商允许的只读工具，并得到可辨认结果 |

前两项不能替代第三项；工具缓存可查也不证明服务此刻能调用。涉及付费、写入、删除等操作时，不要用它们做首次验收。

## 迁移后的维护与回退

- 在“已安装 → 编辑配置”可修改**自定义或 JSON 导入**连接的标准化单连接 JSON，并保存重连。这里不会恢复原 JSON 的排版/注释，也不能改 connection key 或 `serverName`。敏感值以 `<KEEP_EXISTING>` 表示本机保留，不要把真实值复制到聊天。
- “配置备份”可导出脱敏 JSON，迁移到另一设备前需在目标设备重填占位符；OAuth Grant 不能携带，须从市场重新授权。
- 当前 profile 的本机快照可预览和恢复连接变更，但可能含凭据，不能作为可公开分享的备份；服务端已撤销的 OAuth Grant 不能靠快照恢复。
- 如果原客户端仍在管理同一 `serverName`，先确认是否会双重连接或工具名冲突，再决定停用旧配置。不要在确认新路径通过第三个验收点之前删除原配置。

更多细节见[用户手册：JSON 导入](../USER-GUIDE.md#61-导入-mcpservers-json)、[配置备份与恢复](../CONFIG-BACKUP.md)和[连接作用域](../CONNECTION-SCOPES.md)。
