# 贡献指南 / Contributing

感谢你帮助改进 `dsh-mcp-connector`。请不要在 Issue、PR、日志、截图或测试数据中提交 Token、API Key、Cookie、OAuth 凭据或真实业务数据。

Thank you for contributing. Never put tokens, API keys, cookies, OAuth credentials, or real business data in issues, pull requests, logs, screenshots, or fixtures.

## 参与方式

- 报告缺陷或提交功能建议：[GitHub Issues](https://github.com/duhu2000/dsh-mcp-connector/issues)
- 为公共市场增加连接器：阅读 [Connector onboarding](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)，连接器描述与插件代码分仓管理。
- 修复插件或改进文档：Fork 本仓库，从最新 `main` 创建单一目的的分支并提交 PR。
- 搭建私有目录：参考 [README 配置说明](README.md#配置) 和 [市场注册指南](docs/MARKET-REGISTRATION.md)。

## 本地开发

要求 Node.js 20 或更高版本。DSH 运行期 peer dependencies 由 Host 提供，本地安装使用：

```bash
npm install --legacy-peer-deps
npm run check
```

如果修改公共 Registry 或市场元数据，还应运行：

```bash
npm run registry:build
npm run registry:validate
npm run market:check
```

UI 可以在无真实凭据的 mock 环境中验收：

```bash
npm run dev:ui
```

## PR 要求

1. 一个 PR 解决一个明确问题，不要夹带无关重构。
2. 新增或修改行为时增加对应测试；纯文档改动也必须通过 `npm run check`。
3. 中英文用户文档应同步更新。
4. README 中的当前版本必须与 `package.json` 一致，`npm run docs:check` 会阻断版本漂移。
5. 只使用无凭据 mock 或已脱敏数据做测试与截图。

## 从 Fork 到 PR

```bash
git switch main
git pull --ff-only
git switch -c feat/<short-purpose>
npm install --legacy-peer-deps
npm run check
```

提交时说明用户问题、解决方案、测试结果与必要的手工验收步骤。
