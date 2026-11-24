# stdio 传输支持

stdio 连接由 DSH 主机启动本地 MCP 服务进程。插件将命令、参数、环境变量和工作目录交给 Host 的官方 MCP 客户端，后者管理传输、进程生命周期和工具注册。本地命令以宿主用户的权限运行，请在导入配置前核对程序来源及参数。

## 配置一个本地 MCP 服务

手动添加时选择 stdio。通过 JSON 导入时，可以使用下列结构。将示例脚本路径换成已安装且可信的 MCP 服务入口，并确保宿主能找到 Node.js。

```json
{
  "mcpServers": {
    "local-example": {
      "type": "stdio",
      "command": "node",
      "args": ["./server.mjs"],
      "cwd": "C:/mcp/local-example"
    }
  }
}
```

| 字段 | 填写方式 |
|---|---|
| `command` | 可执行文件的路径或宿主 PATH 可解析的命令名。 |
| `args` | 字符串数组，每个参数单独填写。含空格的路径也作为一个元素传入。 |
| `cwd` | 可选的工作目录，须存在于 DSH 所在的机器上。 |
| `env` | 可选的环境变量名和值，真实凭据仅在本机配置。 |

目录描述符使用 `transport: "stdio"`。需要用户凭据的市场卡片在 `auth.credentialFields` 声明输入字段，在对应服务的 `credentialBindings` 中把环境变量名映射到字段名。用户连接时在本机填写实际值。可参考[随包的凭据绑定示例](../registry/connectors/stdio-credential.sample.json)。

## 启动、恢复与排障

主动连接时，插件等待 Host 完成初始化和首次工具同步，再保存连接。详情页依据 Host 已注册的工具显示可用状态。重启恢复已启用的 stdio 连接时，首次服务发现、初始化和工具列表的每次请求都有超时保护，最多 15 秒。恢复超时会清理本次启动的子进程，原连接保留供用户检查和重试。

- 出现 `ENOENT` 时，在 DSH 进程的运行环境中核对可执行文件和 PATH。Windows 支持 PATH/PATHEXT 中的 `.cmd` 命令。使用 `uvx` 等外部程序前，需先安装相应运行时。
- 能启动但看不到工具时，检查 `cwd`、参数、环境变量名称和服务的 MCP 握手。进程返回退出码 0 只能说明程序正常结束。
- 备份与分享使用脱敏配置。恢复到另一台机器后，在目标设备重新填写凭据和本地路径。

详细诊断见[用户手册](USER-GUIDE.md#stdio-启动失败)，导出和恢复规则见[配置备份](CONFIG-BACKUP.md)。

## 本机凭据桥接

| 入口 | 配置与范围 |
|---|---|
| 执中 | `dsh-zerone-mcp-bridge --service pe` 或 `--service base` 使用本机环境变量 `ZERONE_API_KEY`，转发到对应的固定 HTTPS 服务。两个服务分别校验权限。 |
| 聚源 | `dsh-gildata-mcp-bridge` 从本机环境变量 `GILDATA_API_KEY` 读取凭据，通过固定 HTTPS 端点的 `token` 查询参数传给服务商。 |

桥接支持初始化、工具发现与调用。凭据型卡片通过本机输入框配置密钥；公开目录、命令行、日志与问题反馈中应省略密钥及带凭据的完整 URL。
