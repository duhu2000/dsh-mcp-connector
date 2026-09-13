# 外部 PR 草稿

建议标题：

> docs: update MCP Connector description for v0.2.45

建议正文：

---

## Summary

Update only `data/plugins/duhu2000__dsh-mcp-connector.yml` so the English and Chinese descriptions reflect the features released in `dsh-mcp-connector@0.2.45`:

- cross-connection tool search;
- connection, server, and discovery-status filters;
- readable parameter details and the last successful cache time;
- per-connection diagnostics and tool rediscovery.

The Chinese description also uses the product spelling `MCP连接器`, while retaining natural references to MCP servers and connection management. URL, name, category, and install metadata are unchanged.

## Evidence

- Release: <https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.45>
- Merged implementation: <https://github.com/duhu2000/dsh-mcp-connector/commit/82d240601df73b8e704124100ec5771a0cd5514a>
- Release notes: <https://github.com/duhu2000/dsh-mcp-connector/blob/82d240601df73b8e704124100ec5771a0cd5514a/CHANGELOG.md#L7-L23>
- Tool explorer UI: <https://github.com/duhu2000/dsh-mcp-connector/blob/82d240601df73b8e704124100ec5771a0cd5514a/ui/index.html#L1216-L1265>

The existing “over one hundred” claim is unchanged in substance and was previously reviewed in #4146. This PR adds no new numerical claim.

## Scope

- [x] Changes only this plugin's YAML entry.
- [x] Does not edit generated README files.
- [x] Does not add hand-written `npm` or `version` fields.
- [x] Does not claim that cached metadata means a remote tool is currently callable.
- [x] Does not claim a default ranking improvement.

Screenshots are maintained by the plugin repository's root `screenshots.json` and are not changed by this PR.

---

## 提交前注意

- 这是申请说明草稿，不代表 PR 已提交或 CI 已运行。
- 由归口会话在用户批准后，从 awesome-dsh-plugin 最新 `main` 创建分支并应用 `awesome-dsh-plugin-description.patch`。
- 若维护者要求压缩文案，优先删除认证协议尾部，不删除 `MCP连接器`、`MCP Server`、`连接管理`、跨连接工具查找和连接排障等验收词。
- 不要把更新理由写成“提升默认排名”；应写“补齐自然搜索与同步已发布能力”。

