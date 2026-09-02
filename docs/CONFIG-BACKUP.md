# 配置备份：脱敏导出、快照与恢复

MCP连接器提供“可携带脱敏导出”和“当前 profile 本机快照”两套能力。前者用于迁移或排障共享，后者用于撤销本机连接变更；两者的安全边界不同。

## 脱敏导出

在“已安装”页点击“配置备份”，可复制或下载 JSON；对话中可调用 `mcp_connector_export_config`。

| 配置内容 | 导出行为 |
|---|---|
| Bearer Token / API Key | 替换为 `<REDACTED:REENTER>` |
| 静态 Header 与 env 值 | 保留字段名，值替换为占位符 |
| stdio 参数 | 每个参数替换为占位符 |
| 绝对命令、本地 `cwd` | 替换为 `<REDACTED:LOCAL_VALUE>` |
| 带用户信息、查询参数或 fragment 的 URL | 整个 URL 替换为占位符 |
| OAuth Grant、Access/Refresh Token、动态客户端密钥 | 永不导出；仅记录需要从市场重新授权的连接引用 |

导出的 `connections` 仍兼容 JSON 导入。只要存在未替换的占位符，导入会在启动任何 Server 前整体拒绝；全部重填后才进入既有的批量预校验和原子连接流程。`oauthConnections` 不会被当作本机凭据导入，并会显示“需从市场重新授权”。

## 本机配置快照

连接、配置、JSON 导入、启停和断开前会先保存受影响 key 的状态；也可在页面手动创建全量当前快照，或调用 `mcp_connector_snapshot`：

- `list`：列出公开摘要；
- `create`：手动创建；
- `preview`：查看恢复与移除范围；
- `restore`：执行原子恢复。

每个 profile 最多保留 20 个快照，超过后删除最旧项。完整记录可能含本机凭据，只保存在 `mcp_connector` storage domain 的 `snapshots` 表；公开 API 只返回 id、时间、原因、key 与数量，不返回记录正文或 Grant key。

## 原子恢复

恢复只影响快照声明的目标 key：先为目标记录准备 Host 条目，再移除变更后新增的目标条目，最后写入连接存储。如果任一 Server 启动、Host 更新、删除或持久化失败，插件会恢复调用前的 Host 条目和连接记录。重复恢复同一快照保持相同结果。若恢复会移除后来新增的 OAuth 连接，预览会明确提示；连接移除成功后，只在没有其他连接共享时撤销该授权。

## OAuth 边界

快照不复制 OAuth Access/Refresh Token 或动态客户端密钥，只引用当前本机 Grant。共享 Grant 仍存在且有效时，连接记录可以恢复；如果断开最后一个引用后 Grant 已在服务端撤销、在本机删除或被标记为需重新授权，预览和恢复都会拒绝伪恢复，并要求从市场重新授权。

服务端撤销是外部状态，无法由本机快照逆转。这是明确的非目标，不属于原子恢复承诺。
