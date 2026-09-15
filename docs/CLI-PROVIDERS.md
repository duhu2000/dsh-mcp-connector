# 受控 CLI Provider

MCP 连接器原生支持 Streamable HTTP 和 stdio MCP。对于钉钉 `dws` 这类面向人类与 Agent、但本身不是 MCP Server 的官方 CLI，插件通过独立的 CLI→MCP 桥接进程暴露经过审核的结构化工具。

## 安全边界

- Provider 在代码中显式登记，市场卡片和工具参数均不能指定任意可执行文件。
- 子进程通过 `spawn(command, args, { shell: false })` 启动，不解析 Shell 表达式。
- 首个 `dingtalk-dws` Provider 仅登记只读命令；创建、发送、审批、拒绝、删除、更新和上传均不暴露。
- 每个工具只接受 JSON Schema 声明过的字段，参数作为独立 argv 传递。
- stdout/stderr 均受大小限制，执行有超时；错误中的 Token 和 Secret 在返回 Host 前脱敏。
- MCP 客户端枚举工具前执行官方 `dws auth status` 预检；只有 JSON 明确返回 `success: true` 且 `authenticated: true` 才列出工具。退出码为 0 不代表已登录；未授权或响应异常时拒绝连接并提供登录提示。预检不代表全部业务权限已获批，具体工具仍由官方 CLI 校验权限。
- 首次登录请在运行 DSH 的同一电脑、同一系统用户下执行 `npx -y dingtalk-workspace-cli@1.0.61 auth login`（无浏览器环境加 `--device`），完成后重新连接。不会自动替用户登录或读取聊天记录。
- Authentication readiness requires both `success === true` and `authenticated === true`; a successful status query alone is insufficient. Invalid responses fail closed without exposing identity or tokens. Run the login command above as the same OS user running DSH, then reconnect. Per-tool permissions are still enforced by the official CLI.
- 登录、Token 刷新、企业管理员授权、租户隔离和 API 审计由官方 CLI 与开放平台负责。

## 钉钉前置条件

1. 市场卡片固定使用已审核的 `dingtalk-workspace-cli@1.0.61`，无需全局安装 `dws`。
2. 首次连接前，在普通终端执行 `npx -y dingtalk-workspace-cli@1.0.61 auth login`；无浏览器环境加 `--device`。
3. 企业管理员需在钉钉开发者平台开启 CLI 访问。
4. 多组织用户可在工具参数里传稳定的 `corpId:userId` profile；不传时使用当前 profile。

授权信息保存在钉钉官方 CLI 的用户配置和系统 Keychain 中，不写入 Connector 配置。后续升级 `dws` 需先复核官方命令、权限和输出 Schema，然后通过 Registry PR 更换固定版本。

启动 MCP 桥接：

```json
{
  "mcpServers": {
    "dingtalk-workspace": {
      "command": "npx",
      "args": [
        "-y",
        "--legacy-peer-deps",
        "--package",
        "dsh-mcp-connector@0.2.48",
        "--package",
        "dingtalk-workspace-cli@1.0.61",
        "dsh-mcp-cli-bridge",
        "--provider",
        "dingtalk-dws"
      ]
    }
  }
}
```

## 首批只读能力

- 当前用户、通讯录搜索与用户详情
- 日程列表与日程详情
- 待办列表与待办详情
- 文档搜索
- 待处理 OA 审批列表
- 收到的日志和日志模板

后续增加 Provider 或命令时，必须同时提供：官方来源、固定命令路径、输入 Schema、风险级别、只读/写入分类、脱敏策略和单元测试。写入命令不得混入只读 Provider。
