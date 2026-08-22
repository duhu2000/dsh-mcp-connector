# MCP Connector Marketplace 外部市场注册移交文档

> 更新：2026-08-21
> 当前版本：`dsh-mcp-connector@0.2.7`
> GitHub：https://github.com/duhu2000/dsh-mcp-connector
> npm：https://www.npmjs.com/package/dsh-mcp-connector

## 1. 产品定位

`dsh-mcp-connector` 是面向 DeepSeek Harness 的通用 MCP Connector Marketplace。企查查团队是项目发起方、维护方和首批连接器提供方，但产品不限定企查查或单一厂商。

对外说明必须遵守以下口径：

- 产品名称使用 “MCP Connector Marketplace” 或“MCP 连接器市场”；
- 可以注明“由企查查团队发起并维护”；
- 强调不同厂商 MCP 服务的统一发现、授权、试用和连接管理；
- 不使用“企查查专用市场”“仅连接企查查”等限定性表述；
- 不在市场描述中写会频繁变化的工具或 Prompt 数量。

## 2. 当前可核验基线

| 项目 | 结果 |
|---|---|
| npm 当前版本 | `0.2.7`，通过 GitHub OIDC Trusted Publishing 发布 |
| 自动化测试 | 69 项 |
| 随包市场 | 6 张已发布卡片、20 个 Server、44 个 Prompt |
| 独立远程 Registry | 4 张第三方卡片、12 个 Server、16 个 Prompt |
| 合并后市场 | 8 张已发布卡片；北大法宝和 Wind 由远程同 ID 卡片覆盖更新 |
| Git 提交数 | 已超过 10 个，满足外部目录要求 |
| GitHub Topics | 已增加 `dsh-plugin`、`deepseek-harness`、`mcp`、`mcp-connector`、`oauth` |
| awesome-dsh-plugin | [PR #2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633) 已提交；分支提交 `88985578`，README 生成、站点构建与 lint 已通过；PR check 成功且当前可合并 |

随包第 1–4 张为企查查连接器，第 5 张为北大法宝，第 6 张为 Wind。远程 Registry 还提供盈米和 QVeris，合并后市场共 8 张已发布卡片。新增远程卡片不再依赖重新发布 npm。

## 3. 可对外描述的能力

- DeepSeek Harness 主侧栏入口和图形化市场；
- OAuth 2.0 Authorization Code + PKCE；
- Bearer/API Key、无鉴权 URL 和自定义 Header 配置；
- Claude/Cursor 常见 `mcpServers` JSON 批量导入；
- 无凭据 Connector Descriptor URL 安装；
- MCP initialize 预检、动态工具发现和按 Server 展示；
- 示例 Prompt 写入 DSH 新会话草稿；
- 持久化、启停、断开、OAuth 刷新与撤销；
- 内置目录、独立远程 Registry、缓存和离线回退。

连接入口应概括为“三条主要路径：OAuth、Key/URL、JSON；另支持描述 URL”，避免把描述 URL 遗漏或将四种能力误写成互斥模式。

## 4. 0.2.2 文档与元数据收口

### 必须完成

- [x] README 恢复通用产品名，并说明由企查查团队发起和维护；
- [x] 新增 `README.en.md`；
- [x] package description 改为通用能力描述；
- [x] keywords 保留 `cordis`、`mcp`、`oauth`、`pkce`；
- [x] keywords 增加 `dsh-plugin`、`mcp-client`、`oauth2`、`qichacha`、`enterprise-data`；
- [x] awesome-dsh-plugin YAML 使用通用、可验证且无易过期数量的描述；
- [x] HANDOFF 测试数量由 55 修正为当前 59 项；
- [x] CHANGELOG 记录 0.2.2 文档和元数据变更；
- [x] `npm run check` 全部通过（59/59）；
- [x] npm 发布包为 43 个白名单文件，不含测试、规划文档、凭证或本机路径；
- [x] 推送 `v0.2.2` 标签并由 GitHub OIDC Trusted Publishing 自动发布；
- [x] npm latest、Provenance、GitHub Release 和全新下载包均已验证。

### 明确不做

- 未确认发布主体前不添加 `author`；
- GitHub Sponsors 未启用时不添加 `funding`；
- 外部市场 PR 合并前不添加“registered”徽章；
- 不使用无法由代码、目录或测试证明的“领先”“最大”“官方市场”等营销词。

## 5. npm 关键词策略

通用能力优先，厂商品牌作为可搜索入口保留但不支配产品定位：

```json
[
  "deepseek-harness",
  "dsh",
  "dsh-plugin",
  "cordis",
  "mcp",
  "mcp-client",
  "mcp-connector",
  "connector",
  "marketplace",
  "oauth",
  "oauth2",
  "pkce",
  "json-import",
  "enterprise-data",
  "qichacha",
  "qcc",
  "tools",
  "prompts"
]
```

## 6. awesome-dsh-plugin 注册

### 上游要求与本仓库状态

| 要求 | 状态 |
|---|---|
| 一个插件一个 YAML | 使用 `data/plugins/duhu2000__dsh-mcp-connector.yml` |
| 仓库至少 1 天 | 2026-08-21 23:14:05（北京时间）后满足 |
| 至少 10 个提交 | 已满足，23 个提交 |
| GitHub Topic `dsh-plugin` | 已添加，并补充 4 个相关 Topic |
| `package.json` 声明 `dsh.bundle` | 已满足 |
| DSH 官方包使用 peerDependencies | 已满足 |
| 分类合法 | `tools` |
| 生成中英文 README | 提交 PR 前在上游执行 |

截至 2026-08-21 23:17（北京时间），fork 分支
`duhu2000:add-dsh-mcp-connector` 已重基到上游 `main@a45b85d2`，远端提交为
`88985578`。分支相对上游只包含两个生成 README 的索引行和
`data/plugins/duhu2000__dsh-mcp-connector.yml`，已通过：

- `npm ci`；
- `node scripts/generate-readme.mjs --check`；
- `SKIP_PUBLISH_CHECKS=1 node scripts/build-site.mjs`；
- `npx awesome-lint`（0 error；44 个 warning 均来自上游现有条目）。

PR 已创建为 [awesome-dsh-plugin#2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633)，
GitHub PR check 已通过，`mergeable_state` 为 `clean`。后续若维护者要求调整，在同一分支
提交修复即可，无需重开 PR。

建议 GitHub Topics：

```text
dsh-plugin
deepseek-harness
mcp
mcp-connector
oauth
```

仓龄门槛已于北京时间 **2026-08-21 23:14:05** 满足，PR 于门槛后提交。

### 注册文件

本仓库根目录的 `duhu2000__dsh-mcp-connector.yml` 应复制到上游：

```text
data/plugins/duhu2000__dsh-mcp-connector.yml
```

分类使用 `tools`。描述只写通用、已实现能力，不写工具数、Prompt 数或“官方市场”。

### 上游验证命令

```bash
npm ci
node scripts/generate-readme.mjs
git diff --check
```

必须提交 YAML 和生成后的 README 变更，并以实际上游 CI 为最终准入标准。

### PR 模板

```markdown
## Add dsh-mcp-connector

- Repository: https://github.com/duhu2000/dsh-mcp-connector
- npm: https://www.npmjs.com/package/dsh-mcp-connector
- Category: `tools`

`dsh-mcp-connector` is a general-purpose MCP Connector Marketplace for
DeepSeek Harness. It supports OAuth 2.0 PKCE, API key and URL configuration,
`mcpServers` JSON import, dynamic tool discovery, prompt-to-session workflows,
and connection lifecycle management.

The project was initiated and is maintained by the Qichacha team, while the
connector architecture and marketplace are provider-neutral.

### Checks

- [x] Repository is public and older than one day
- [x] Repository has at least 10 commits
- [x] `dsh-plugin` GitHub topic is present
- [x] `dsh.bundle` is declared in `package.json`
- [x] Official DSH packages are peer dependencies
- [x] `npm ci` succeeds
- [x] Generated READMEs are updated
```

## 7. 发布方法

0.2.1 起 npm 已启用 Trusted Publishing。不要手工运行 `npm publish`，也不使用长期 `NPM_TOKEN`。

```bash
npm run check
git add <0.2.2 files>
git commit -m "docs: prepare marketplace registration for v0.2.2"
git push origin main
git tag v0.2.2
git push origin v0.2.2
```

`v0.2.2` 标签会触发 `.github/workflows/release.yml`，工作流会核对 Tag 与 `package.json` 版本、运行发布门禁、通过 GitHub OIDC 发布 npm，并创建 GitHub Release。

## 8. 验收清单

- [x] GitHub Topics 已添加；
- [x] README 中文、英文定位一致；
- [x] npm description/keywords 已在 0.2.2 生效；
- [x] npm 0.2.2 含 Provenance 且可全新下载；
- [x] GitHub Release v0.2.2 已生成；
- [x] awesome-dsh-plugin PR #2633 已提交且 CI 通过；
- [ ] PR 合并后 `awesome-dsh-plugin.com/plugins.json` 可检索到仓库；
- [ ] dsh-market 同步后可检索到插件；
- [ ] 合并完成后再决定是否增加外部市场徽章。

## 9. 后续推广（非 P0）

- 补充不含凭据的市场、详情、已安装页面截图；
- 录制 30–60 秒通用接入演示，至少覆盖一种第三方连接器；
- 根据用户反馈完善 Registry 贡献模板和供应商接入文档；
- 仅在外部目录合并、下载数据真实产生后添加相应徽章和指标。
