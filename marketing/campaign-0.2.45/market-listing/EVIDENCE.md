# 线上收录与排名证据

## 1. 产品事实基线

本轮只采用 `v0.2.45 / 82d240601df73b8e704124100ec5771a0cd5514a`。该提交的 `CHANGELOG.md` 和界面源码确认：

- 独立“工具”页支持跨连接统一搜索、精确工具名优先、分页，以及连接/服务/发现状态筛选。
- 结果展示连接、服务、最近发现状态和最后成功缓存时间。
- 参数详情展示类型、必填、枚举、约束与可展开嵌套结构。
- 每条连接可执行“检查连接”和“重新发现工具”，并显示已有诊断建议。
- 搜索和筛选仅读取安全裁剪后的缓存，不执行目标工具，也不证明远端服务当前可调用。
- 后台发现采用有界并发与失败退避；429 遵守 `Retry-After`，鉴权失败暂停自动重试。

数量口径由 0.2.45 数据证据任务冻结：公共 Registry 106 条、随包唯一 4 条、合并去重后 110 张、覆盖 9 类、精选 6 张。市场文案使用更耐久的“超百个”，不把目录条数或 npm 下载量解释为用户数；连接器也不应被笼统描述为“全部免费”。

> 注：上一段中的产品能力应以源码/CHANGELOG 为准；“缓存可查”不等于断网或远端故障时工具仍可调用。

## 2. awesome-dsh-plugin 收录历史

| 事项 | 状态 | 合并时间 | 证据 |
|---|---|---:|---|
| 初次收录 #2633 | 已合并 | 2026-08-23 | [PR #2633](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2633) |
| 介绍优化 #3656 | 已合并 | 2026-08-29 | [PR #3656](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3656) |
| 数量表述 #4119 | 已合并；维护者曾按当时 97 条改为“近百/~100” | 2026-09-02 03:49Z | [PR #4119](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4119)，合并提交 `6e1478ff02a3838daf95c80dde9ec55bab11702b` |
| 超百表述 #4146 | 已合并；检查全部成功 | 2026-09-03 07:09Z | [PR #4146](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4146)，合并提交 `e5c464a61d62de68cf10b88c1d558601feb9f0d0` |

目标文件 `data/plugins/duhu2000__dsh-mcp-connector.yml` 的最新提交仍是 #4146 对应的 `91e2f408c7cb0abe0744db4ccd60fe90699ffe3e`；本次核对未发现更晚的条目更新。

## 3. 当前线上条目

数据源：[`plugins.json`](https://awesome-dsh-plugin.com/plugins.json)，本次读取到 `updated: 2026-09-12`、`count: 3561`。

| 字段 | 当前值 |
|---|---|
| 页面 | <https://awesome-dsh-plugin.com/zh/p/duhu2000/dsh-mcp-connector/> |
| 分类 | `tools` / 工具与能力 |
| npm | `dsh-mcp-connector` |
| 市场显示版本 | `0.2.44` |
| npm `latest` | `0.2.45` |
| 近 30 天下载量 | 10,255（排序信号，不是用户数） |
| GitHub Stars | 20（同下载量时的次级排序信号） |
| 默认位置 | 62 / 3,561 |

版本差的原因是市场公开 JSON 的构建时间早于 0.2.45 Release（Release 发布于 2026-09-12 11:16:20Z）。市场版本由 npm 探测生成，条目 YAML 不接受手填 `npm` 或 `version` 字段，因此应等待同步，不为此提交描述 PR。

## 4. 搜索与默认排序机制

官方构建脚本和页面模板给出的机制：

- 默认 `sort=dl`：有 npm 下载数据的条目按近 30 天下载量降序；下载量相同时按 Stars 降序。
- 没有 npm 数据的条目排在后面，并按 Stars 降序。
- 搜索对当前语言页面每张卡片的全部可见文本执行小写化后的字面子串匹配。
- 搜索只过滤卡片，不会按关键词相关度重新排序；命中项继续沿用当前排序。
- 描述变化可以增加某个关键词是否命中，但不会直接改变默认下载量排序。

规则来源：

- [build-site.mjs](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/build-site.mjs)
- [site/template.html](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/site/template.html)
- [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

## 5. 2026-09-12 中文 UI 实测

在 `https://awesome-dsh-plugin.com/zh/?q=mcp` 的实际页面中确认：排序控件为“下载量”，页面显示 171/3,561，目标卡片位于第 2。随后按同一 DOM 顺序对五组字面查询复核：

| 查询 | 全部命中数 | 目标位置 | 结论 |
|---|---:|---:|---|
| `mcp` | 171 | 2 | 已命中 |
| `MCP连接器` | 0 | — | 当前缺口；现有文案写作 `MCP 连接器` |
| `连接器` | 5 | 1 | 已命中 |
| `mcp server` | 17 | 1 | 已命中 |
| `连接管理` | 1 | 1 | 已命中 |
| 清空查询（默认） | 3,561 | 62 | 只记录，不设提升目标 |

英文页补充基线：`mcp` 为第 2/174，`mcp server` 为第 1/67。中文查询不应在英文页作为验收失败项。

## 6. 当前文案与 0.2.45 的差异

| 项目 | 当前市场文案 | 0.2.45 实际能力 | 建议 |
|---|---|---|---|
| 产品名关键词 | `MCP 连接器`（有空格） | 产品统一名为 `MCP连接器` | 中文描述首词使用无空格产品名；正文无需重复堆词 |
| 工具入口 | 仅“工具与 Prompt 发现” | 独立工具页、跨连接搜索、精确名称优先、分页 | 改为“跨连接工具查找” |
| 筛选 | 未提及 | 连接/服务/发现状态筛选 | 在完整市场描述中列出 |
| 参数 | 未提及 | 易读参数、约束、嵌套结构与安全 Schema | 写“易读参数”，避免声称执行工具 |
| 可观测性 | 未提及 | 来源、最后成功缓存时间、最近发现状态 | 写“最后成功缓存时间”；明确缓存不代表可调用 |
| 排障 | 仅“连接管理” | 单连接诊断、检查连接、重新发现工具 | 写“连接管理与连接排障”及“逐连接重新发现工具” |
| 后台策略 | 未提及 | 有界并发、退避、429/鉴权处理 | 不塞入短描述，可在详情/更新说明展开 |
