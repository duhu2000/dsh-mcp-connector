# 把 MCP 服务上架到连接器市场

公开市场从独立的 Registry 加载卡片。如果希望其他用户能搜索并连接你的服务，请向 Registry 提交连接器描述符。若只需自己使用，可在插件中添加本机连接。两种 JSON 的格式和用途见[市场注册指南](MARKET-REGISTRATION.md)。

## 提交一张公开卡片

1. Fork [连接器 Registry](https://github.com/duhu2000/dsh-mcp-connector-registry)，将其中的 [示例描述符](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/connectors/example.sample.json) 复制为 `connectors/<id>.json`。文件名与描述符的 `id` 保持一致。
2. 按 [Registry Schema](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/schema/connector.schema.json) 填写服务提供方、分类、接入方式和鉴权要求。远程服务填写公开 HTTPS 端点，本地 stdio 服务填写官方启动命令和软件包说明。列出费用、授权范围和可能写入或删除数据的操作。示例使用虚构数据，凭据由使用者在本机配置。
3. 在 Registry 仓库根目录运行以下检查。修复报告的问题后，向 Registry 提交 PR，附上官方来源、使用条款和脱敏的验证摘要。

```sh
npm ci --legacy-peer-deps
npm test
npm run validate
npm run assets:check
```

维护者核对来源、使用许可及实际验证范围。对于数据连接器，请分别说明连接、工具发现和业务调用的结果。若仅获准以 `connection-only` 范围上架，探测状态标为 `partial`，业务运行状态标为 `not-run`。填写示例见[数据 MCP 贡献与验收模板](DATA-MCP-CONTRIBUTION-REVIEW.md)。

卡片合并并进入公共目录后，用户可在插件市场中点击「刷新」获取更新。没有准备好描述符时，也可以按 [Registry 上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md) 提交收录请求，提供官网和公开接入文档。
