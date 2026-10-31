# 数据 MCP 贡献与验收模板

## 原则

自动发现分数、`initialize`、`tools/list` 或元数据工具成功，都不等于业务数据验收通过。新卡片只能在官方证据、条款、去重、限定范围真实只读调用与具名人工批准都完成后进入 Registry PR。

## 禁止推荐清单

以 Registry `docs/DEFERRED-CONNECTORS.md` 为当前人工决策依据，本轮继续保留全部 5 项，不因自动发现命中而重新推荐：

- `dsh-qixin-insight-mcp-oauth`
- `dsh-plugin-xparse`
- `shuididata/mcp-server`（机器规则中的稳定身份为 `shuidi-enterprise-data`）
- `mcp-cnbs`
- `chinese-law-mcp`

注：`discovery-sources/exclusions.json` 当前只稳定阻断后 3 类身份；启信慧眼与 TextIn xParse 仍需在 Registry 的独立变更中补齐机器规则和回归测试。本工作线不修改 Registry。

## 候选提交字段

```text
候选名称：
提供方与国内/海外属性：
用途与数据范围：
官方页面 / 官方仓库 / Official Registry / 包或端点：
鉴权、付费与额度：
代码许可证、数据许可与服务条款：
维护状态（是否归档、最近更新、版本）：
重复关系（稳定身份、端点、上游数据、已上架卡片）：
协议验收（initialize / tools/list / 只读注解）：
业务验收（指定工具、最小参数、返回字段、来源、单位、时间范围、缺失值）：
状态：PASS / SKIP / FAIL / DEFERRED
失败或延期原因：
评分与下一步：
审核人与日期：
```

不记录凭据、完整业务响应、客户数据、个人数据或本机路径。运行证据只保留时间、版本、工具名、状态、字段摘要与脱敏哈希。

## 验收门槛

| 层级 | 通过条件 | 未通过时状态 |
|---|---|---|
| 身份与条款 | 提供方、代码/数据许可、服务条款、鉴权与费用可核对 | `DEFERRED` 或 `SKIP` |
| 去重与排除 | 与现有卡片、稳定身份及禁止清单完成对照 | `SKIP` |
| 协议 | `initialize`、`tools/list` 成功，工具的读写/破坏性边界明确 | `DEFERRED` 或 `FAIL` |
| 业务数据 | 至少一次限定范围的真实只读调用，并核对字段、来源、时间、单位与缺失值 | `DEFERRED` |
| 人工决策 | 具名批准且范围与已验收能力一致 | 不得创建正式卡片 |

## 2026-10-25 候选证据清单

最新 [Issue #17](https://github.com/duhu2000/dsh-mcp-connector-registry/issues/17) 报告扫描 3,187 条、识别 606 个数据候选，自动 `selected` 仍为 0。[Issue #19](https://github.com/duhu2000/dsh-mcp-connector-registry/issues/19) 的自动排序不替代许可、条款与真实调用验收。本轮没有可直接上架的新候选：

| 候选 | 已有证据 | 未完成 | 状态 |
|---|---|---|---|
| HKEX 上市公司公告检索（社区） | 协议可达，4 个工具，`get_server_info` 元数据调用成功 | 未执行公告检索/读取，未核对来源、字段与时间范围 | `DEFERRED` |
| UNESCO UIS 全球教育统计（社区） | 协议可达，5 个工具，`uis_list_geo_units` 元数据调用成功 | 未查询统计值，未核对单位、版本、来源与缺失值 | `DEFERRED` |
| Shumi 加密市场研究 | 协议可达，33 个工具有 `readOnlyHint` | 无授权测试 Key，业务调用、额度与条款边界未验收 | `DEFERRED` |

结论：三者都不得因协议或元数据成功而标为业务 `PASS`，不创建新卡片、不批量上架。
