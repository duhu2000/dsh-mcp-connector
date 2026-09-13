# MCP Connector 0.2.45 市场上架优化交付

状态：草稿已就绪，等待总账会话集成与用户批准后再对外提交。

固定基线：

- 产品版本：`dsh-mcp-connector@0.2.45`
- 合并提交：`82d240601df73b8e704124100ec5771a0cd5514a`
- 核对时间：`2026-09-12T21:56:47+08:00`
- 目标市场：[awesome-dsh-plugin](https://awesome-dsh-plugin.com/zh/)
- 本轮只生成证据和草稿；未修改公共 README、`package.json`、`marketing/metadata.json` 或 `screenshots.json`，未提交外部 PR。

## 结论

1. 该插件已收录。初次收录 PR #2633、介绍优化 PR #3656、数量表述 PR #4119 和 #4146 均已合并；目标 YAML 在 #4146 后没有新的提交。
2. 线上目录于本次核对时有 3,561 个条目，目标条目按默认“近 30 天 npm 下载量”排序位于第 62。文案不参与默认排序，因此本次更新不能承诺提升默认名次。
3. 中文页现有搜索表现：`mcp` 第 2/171、`连接器` 第 1/5、`mcp server` 第 1/17、`连接管理` 第 1/1；`MCP连接器`（无空格）为 0 个结果。建议文案把产品名统一为无空格的 `MCP连接器`，补齐唯一明确的关键词缺口。
4. 当前市场文案没有覆盖 0.2.45 的统一工具搜索、连接/服务/发现状态筛选、易读参数、最后成功缓存时间、单连接诊断和重新发现工具。建议提交一次“仅修改自有 YAML 描述”的更新 PR。
5. 当前 4 张市场截图仍标注 `v0.2.37`，且没有展示 0.2.45 的独立“工具”页、筛选、参数详情或连接排障。截图应先在产品仓库更新；awesome-dsh-plugin 会从本仓库 `screenshots.json` 夜间自动采集，不需要为截图单独修改外部目录。
6. 线上目录 API 仍显示版本 `0.2.44`，而 npm `latest` 已为 `0.2.45`。版本字段由市场自动探测，YAML 没有可手填版本字段；等待下一轮探测后复验即可。

## 交付文件

- [EVIDENCE.md](EVIDENCE.md)：线上条目、PR 历史、排序机制、当前搜索基线和版本同步差。
- [MARKET-COPY.md](MARKET-COPY.md)：中英文长短文案、关键词顺序和禁止表达。
- [SCREENSHOT-ORDER.md](SCREENSHOT-ORDER.md)：0.2.45 截图缺口、推荐顺序和素材验收规则。
- [ACCEPTANCE-CHECKLIST.md](ACCEPTANCE-CHECKLIST.md)：发布后五组搜索及默认排序复验表。
- [awesome-dsh-plugin-description.patch](awesome-dsh-plugin-description.patch)：只改目标 YAML 的外部 PR 补丁草案。
- [PR-BODY.md](PR-BODY.md)：外部 PR 标题与说明草案。

## 建议执行顺序

1. 等待搜索闭环任务交付并验收 0.2.45 三张新截图。
2. 由总账会话统一决定是否更新产品仓库 `screenshots.json`；本任务不直接修改。
3. 用户批准后，由归口会话应用描述补丁并向 awesome-dsh-plugin 提交一个更新 PR。
4. PR 合并且市场重建后，按验收清单记录五组查询；默认名次只记录，不设提升目标。
5. 等待市场 npm 探测把展示版本同步到 0.2.45；这与描述 PR 是否成功分开判断。

