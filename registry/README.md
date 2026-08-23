# 社区连接器注册表（Tier 1）

本目录是独立 `dsh-mcp-connector-registry` 仓库的可执行种子。正式拆仓前，可在这里验证 Schema、探针和 CI 流程。

上架步骤：

1. 复制 `connectors/example.sample.json` 为 `connectors/<connector-id>.json`，一条连接器一个文件。
2. 连接器描述只能包含公开元数据，禁止 token、API Key、密码和 client secret。
   `stdio` Server 使用 `command/args/env/cwd`；目录中的 `env` 只能放非敏感默认值，用户凭据必须在本机配置。
3. 执行 `npm run registry:build`，再执行 `npm run registry:validate`。
4. PR 会做离线门禁；定时任务与手动 workflow 会做公开端点连通性探针。
5. `featured` 只由维护者设置；普通社区连接器保持 `featured:false`。

探针只读取公开端点，不注册 OAuth client、不发起用户授权、不保存凭据，也绝不会执行目录中的 stdio 命令。`stdio` 在安装后交由 `dsh-mcp-client` 启动；`partial` 代表 MCP 端点可达但 OAuth 元数据或图标需人工复核；`fail` 阻断上架。
