# MCP连接器用户手册

本手册面向安装和使用 `dsh-mcp-connector` 的 DeepSeek Harness（DSH）用户。服务商或 MCP 原作者如需提交市场卡片，请改看独立 Registry 的[第三方连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)。

## 1. 安装、升级与重启

要求：DSH Desktop 或 `web` profile，Node.js 20 或更高版本。

```bash
dsh plugin --profile web add dsh-mcp-connector
```

也可以运行一键安装脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector/main/install.sh)
```

重复执行同一安装命令即可升级。安装或升级后必须让 DSH **完全退出并重新启动**，仅刷新浏览器页面不足以替换已经加载的插件代码。

- DSH Desktop：退出应用后重新打开。
- `dsh web`：停止原进程，再运行 `dsh web`。
- 浏览器访问：默认打开 `http://127.0.0.1:3080`。

如果重新运行 `dsh web` 出现 `EADDRINUSE 127.0.0.1:3080`，说明已有 DSH 进程正在监听 3080 端口，并不表示插件安装失败。可以直接打开现有页面；若确实要重启，先在原终端停止进程，或用下面的只读命令确认监听者，再正常结束对应 PID：

```bash
lsof -nP -iTCP:3080 -sTCP:LISTEN
kill <PID>
dsh web
```

不要同时启动两个 `dsh web` 实例。

## 2. 打开 MCP连接器

重启后，在 DSH 左侧主导航点击“🧩 MCP连接器”。入口通常位于“新会话”下方、工作区/会话列表上方；如果当前 DSH 版本没有对应的公开插槽，入口会回退到左侧底部。

页面顶部提供：

- **市场**：浏览内置目录与远程 Registry 合并后的公开连接器，页签徽标显示当前卡片数。
- **已安装**：查看已经保存到本机的连接，页签徽标显示连接数。
- **搜索**：按名称、服务商、简介和标签查找。
- **添加连接**：导入 JSON、手动配置 HTTP/stdio，或从市场描述 URL 安装。
- **版本与更新提示**：标题旁显示当前插件版本。检测到 npm 有新版本时，点击更新提示前往 DSH 插件市场执行安全升级；升级后按页面提示完全重启 DSH。
- **刷新连接器目录**：重新拉取 Registry 卡片，并更新连接健康状态；该操作不会升级 MCP连接器插件本身。

## 3. 浏览市场与分类

默认选择“全部”，页面按以下顺序分章节展示：推荐、企业数据、金融投资、法律合规、开发工具、办公协作、调研分析、设计创意、效率工具、其他。

- 推荐位固定为 6 张精选卡片；其他卡片仍会出现在各自业务分类中。
- 每个章节先展示最多 4 张卡片；数量更多时可点击“查看全部”，再点击“收起”。
- 点击某个分类标签后，只展示该分类的全部卡片。
- 分类栏固定在页面 Header 内，滚动卡片时不会遮挡内容；切换到“已安装”后自动隐藏。
- 远程目录不可用时，插件会继续使用上次缓存或随包内置目录，不影响已有连接。

## 4. 连接市场卡片

卡片右侧按钮会根据鉴权方式和当前状态变化：

| 按钮/状态 | 含义 | 操作 |
|---|---|---|
| `连接` | OAuth 或免密连接器尚未连接 | 点击后按页面提示完成授权或连通性检查 |
| `配置` | 需要 Bearer Token 或 API Key | 录入服务商签发的凭据并验证 |
| `需重新授权` | OAuth 授权过期、被撤销或不可用 | 点击后重新完成 OAuth 授权 |
| `自动重试中` | OAuth Token 刷新遇到网络或服务端暂时故障 | 无需重新授权；保持 DSH 运行，插件会按退避策略自动恢复 |
| `已配置` | 本机已有配置，尚未完成本轮健康确认 | 点击“刷新连接器目录”或进入详情检查 |
| `已连接` | 最近一次健康检查通过 | 可直接在会话中使用对应 MCP 工具 |
| `部分异常` / `连接异常` | 一个或多个 Server 未通过检查 | 打开详情查看提示，核对网络、权限和服务状态 |

Bearer/API Key 连接器会先执行 MCP `initialize` 验证。所有 Server 通过后，凭据才会保存并出现在“已安装”中；验证失败不会写入新凭据。

stdio 市场卡片也可能显示一个或多个凭据字段，例如 API Token、区域或租户标识。卡片目录只声明字段名称及其环境变量映射；提交后，真实值仅保存到 DSH 本机连接记录，并由插件注入该 stdio 进程的 `env`。市场、状态页和日志不会返回这些值。插件会等待 Host 完成首次 MCP 初始化与工具同步后再保存连接；失败或超时不会增加已安装数量，卡片也不会提前显示“已连接”。

OAuth 一键连接要求服务商支持标准 OAuth 2.1/PKCE 和公开元数据发现。动态客户端注册既支持无需客户端密钥的 `none`，也支持服务商签发密钥的 `client_secret_post` 与 `client_secret_basic`。客户端密钥仅与 OAuth Grant 一同保存在 DSH 本机，用于换取、刷新和撤销 Token；插件不会要求用户把 OAuth Token 或客户端密钥复制到聊天中。

当市场描述声明 `grantSharing: "issuer"` 时，同一账号下相同 issuer、scope 和客户端鉴权方式的卡片共享一组 Grant。首次授权仍只启用用户点击的卡片；之后连接同组卡片会直接复用现有授权，不再重复打开 OAuth 页面。网络、OAuth 元数据发现或服务端 5xx 等暂时故障只进入“自动重试中”，明确收到 Refresh Token/客户端失效错误时才进入“需重新授权”。

## 5. 查看详情、Prompt 与工具

点击卡片或“详情”可打开连接器详情：

1. 阅读服务说明、鉴权方式、数据范围与可能产生的费用或副作用。
2. 在“试试这样用”中选择示例 Prompt；带变量的模板会先要求补齐查询主体等信息。
3. 展开“工具详情”查看 Server 数量、工具名称与描述，并可搜索工具。
4. 点击“去试试”或 Prompt 的发送按钮，在当前工作区创建或复用空白会话并写入草稿。

连接成功后，工具按 `mcp__<serverName>__*` 前缀提供给模型。工具清单来自服务端，实际数量会随服务商权限和版本变化。

## 6. 添加自定义连接

点击“＋ 添加连接”后有三种方式。

### 6.1 导入 `mcpServers` JSON

支持 Streamable HTTP、历史 `sse` 配置和 stdio。历史 `sse` 会自动归一为 Streamable HTTP。

```json
{
  "mcpServers": {
    "my-http-server": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    },
    "my-local-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vendor/example-mcp-server"],
      "env": {
        "EXAMPLE_MODE": "readonly"
      }
    }
  }
}
```

导入前请把示例占位符替换为自己的值。凭据只应在本机导入，不要把含真实 Token、API Key、密码或 Cookie 的 JSON 提交到 Git、Issue 或聊天。

### 6.2 手动配置

- **HTTP**：填写名称、HTTPS MCP URL、可选 Header 和传输方式。
- **stdio**：填写本机命令、参数、环境变量和可选工作目录。

stdio 进程由 `@deepseek-ai/dsh-mcp-client` 管理，插件透传 `command`、`args`、`env`、`cwd`，并等待 Host 完成首次 MCP 初始化和工具同步。stdio 会以当前用户权限启动本机进程，只运行你信任的软件包和命令。手动 HTTP 配置也会在保存前执行 `initialize` 校验；验证失败时表单内容仍保留，且不会生成无效连接记录。

### 6.3 市场卡片 URL

填写一个公开的 HTTPS Connector Descriptor URL。描述文件只能携带公开元数据，不应包含任何凭据；安装后仍由用户在本机完成 OAuth 或录入 Key。

## 7. 管理已安装连接

在“已安装”中可以：

- 查看连接状态和 Server 数量；
- 启用或停用连接；
- 重新授权 OAuth，或重新录入 Token/API Key；
- 执行健康检查；
- 断开连接并删除该连接的本机配置。

OAuth 断开时，插件会尽力调用服务商的撤销端点；无撤销端点时仍会删除 DSH 本机授权记录。连接状态发生变化后，可点击“刷新连接器目录”重新检查。

## 8. 安全边界

- 凭据仅保存在 DSH storage domain，不进入市场目录、Git 仓库或对话历史。
- stdio 目录只能声明凭据字段与 env 映射，不能给出真实值；Registry 探针不会执行目录中的本地命令。
- OAuth 动态注册返回的 `client_secret` 不出现在目录、连接状态或日志中；断开连接时与 Refresh Token 一起尽力撤销并删除本机记录。
- 外部 HTTP 地址必须使用 HTTPS；仅本机回环开发地址允许 HTTP。
- Registry 健康探针不持有用户凭据，也绝不会执行目录里的 stdio 命令。
- 连接器能看到的数据和能执行的操作取决于你授予的账户权限；优先使用最小权限 Token/API Key。
- 生成、付费、写入、发布、删除、停止任务等有副作用的工具，应在执行前再次确认参数和影响。

## 9. 常见问题

### 安装后没有入口，或界面仍是旧版

确认安装目标是 `web` profile，然后完全退出并重启 DSH。浏览器强制刷新只能刷新静态页面，不能替换仍在运行的旧插件进程。

### 市场里没有最新卡片

点击“刷新连接器目录”。如果远程 Registry 暂时不可用，页面会继续显示缓存或内置目录；稍后恢复网络再刷新即可。

### Token/API Key 一直验证失败

核对凭据是否过期、是否具备目标 MCP Server 权限、Header 类型是否正确，以及服务商是否要求单独开通或付费。失败的候选凭据不会覆盖本机原有可用配置。

### stdio 启动失败

页面会在有限时间内结束等待，并区分命令不存在、进程退出、初始化失败或启动超时。先在终端确认命令本身可执行、软件包可信、Node/运行时版本满足要求，并检查 `cwd`、参数和环境变量；随后查看 Host 日志并点击“重新检查”。不要把本机凭据写入公开 Registry descriptor。

### 如何反馈问题

提交 [GitHub Issue](https://github.com/duhu2000/dsh-mcp-connector/issues) 时，请提供 DSH 版本、插件版本、连接器名称、复现步骤和已脱敏的错误信息。不要附带 Token、API Key、Cookie、授权码或包含真实凭据的配置文件。
