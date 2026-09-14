# MCP Connector 0.2.45 宣传与使用引导总账

更新时间：2026-09-14（Asia/Shanghai）

## 目标与边界

本轮更新已经发布功能的宣传证据、使用引导、市场文案、截图素材规范和增长复盘口径，不增加产品功能。`0.2.45` 是活动事实基线，当前线上部署版本已推进到 `0.2.46`。

固定表达边界：

- 不承诺默认排名提升，不把缓存描述为断网仍可调用，不把 Registry 条数、npm 下载量或 clone 数解释为用户数，不宣称全部第三方连接器免费。
- 工具搜索读取最后成功的安全缓存，不执行目标 MCP 工具；缓存可见不等于服务当前可调用。
- 历史截图必须标注来源版本；无凭据 harness 的目录、连接和工具数量不得当作生产统计。

## 四任务状态

| 子任务 | 会话 | 独占产物目录 | 当前状态 |
|---|---|---|---|
| 搜索闭环 | `01a051f7-eeba-7742-a353-7d8aa086ea31` | `marketing/campaign-0.2.45/search-closure/` | 已完成：功能证据、教程补丁、验收步骤和三张宣传素材验收条件齐备；三张素材已于 2026-09-14 落库 |
| 自然搜索转化 | `01a051f8-b966-77a2-94ea-ab0e538724e0` | `marketing/campaign-0.2.45/natural-search/` | 已完成开发与素材：双语首屏、元数据、43 秒演示、三张新图已集成；D+7/D+14 复盘按日期待执行 |
| 插件市场上架优化排名 | `01a051ec-d92f-7e00-a0d6-ffb185584bb4` | `marketing/campaign-0.2.45/market-listing/` | 已完成描述更新和上线复验；核心四词当前第 1，`mcp server` 为第 15，列为后续相关性优化 |
| 数据源 MCP 自动发现 | `01a051f9-1a95-7980-820e-95943e80872b` | `marketing/campaign-0.2.45/data-evidence/` | 已完成本轮 README、机器快照和三场景 runbook；Notion 专用空白工作区实测仍无证据，不写成已验收 |

## 已上线集成

- 产品文档与元数据：Connector [PR #74](https://github.com/duhu2000/dsh-mcp-connector/pull/74)，2026-09-13 合并，提交 `2abf622d422a458b50b6d5111cb57b65c6cc120a`。
- 正式发布：Connector [PR #75](https://github.com/duhu2000/dsh-mcp-connector/pull/75)，2026-09-13 合并并发布 [`v0.2.46`](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.46)，提交 `862ec2f4a7c3e179160d05618651178a9ba48aff`。
- awesome-dsh-plugin 描述：[PR #4982](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4982)，2026-09-13 合并，提交 `44483edfb835af0d217398deb7c42bc619fd2974`；公开条目已同步到 `0.2.46`。
- npm 与 GitHub About 的短简介、版本、关键词和 Topics 已通过 `npm run marketing:check:live` 一致性检查。
- 公开 Registry 截至 2026-09-11：106 条；与 4 张随包唯一卡片合并后市场 110 张、9 类、精选 6 张。动态数量以刷新后的客户端徽标和 `catalog-stats.json` 为准。

## 2026-09-14 搜索复验

环境：实际本机 DSH Web，`dshmarket@1.46.1`，发现页“全部”分类，约 3.6k 条目。

| 查询 | 当前位置 | 结论 |
|---|---:|---|
| `mcp` | 1 | 核心词通过 |
| `mcp连接器` | 1 | 产品名通过 |
| `连接器` | 1 | 中文类目词通过 |
| `连接管理` | 1 | 高意图功能词通过 |
| `mcp server` | 15 | 从 `dshmarket@1.38.1` 基线第 5 回落；索引正常，需单独优化英文相关性，不阻塞当前素材上线 |

默认排序由下载量等市场信号决定，不承诺靠文案直接提升。

## 素材完成情况

- 已新增 `docs/screenshots/05-unified-tool-search.png`：跨连接搜索、来源、发现失败与最后成功缓存。
- 已新增 `docs/screenshots/06-tool-parameters.png`：必填、类型、枚举、嵌套结构与安全 Schema。
- 已新增 `docs/screenshots/07-connection-diagnostics.png`：连接状态、失败原因、建议与两个恢复动作。
- 已重制 `docs/demo.gif`：43 秒、960×540，顺序展示市场、详情、工具、统一搜索、参数和诊断。
- `01`–`04` 继续作为 `v0.2.37` 历史市场快照保留；`05`–`07` 和 GIF 来自 `v0.2.46` 当前 harness。来源与哈希均登记在 `docs/screenshots/assets.json`。

## 指标与复盘

D0（2026-09-12）基线：npm 近 30 天下载 10,991（非用户数）；GitHub 20 Stars、3 Forks、1 Watcher；14 天 views 2,361 / 1,161 unique，clones 1,294 / 240 unique。

2026-09-14 滚动观察：GitHub 22 Stars、3 Forks、1 Watcher；截至 2026-09-12 的滚动 traffic 为 views 2,415 / 1,202 unique、clones 1,394 / 259 unique。该观察不替代固定窗口复盘。

| 复盘 | 到期日 | 当前状态 | 执行要求 |
|---|---|---|---|
| D+7 | 2026-09-19 | 未到期 | 使用与 D0 相同口径抓取 npm/GitHub/traffic，计算净变化，并登记渠道变更 |
| D+14 | 2026-09-26 | 未到期 | 重复同口径复盘，并区分累计下载、窗口下载、页面浏览和首次贡献 |

## 外部分发与媒体登记

- 外部目录仍有版本/来源漂移，统一由 [Issue #69](https://github.com/duhu2000/dsh-mcp-connector/issues/69) 去重跟踪；未完全收敛前不关闭。
- 公开报道已由用户确认存在，但仓库此前没有保存 CSDN、搜狐、腾讯新闻等文章的规范 URL。新增 [`PUBLICATION-REGISTER.md`](PUBLICATION-REGISTER.md) 作为版本、图片和文案同步入口；URL 未登记前不能声称所有媒体正文均已更新。
- Notion 场景缺少专用空白工作区实测证据，仍是非阻断运营 TODO。

## 当前退出状态

- [x] 四个子任务的可开发产物已完成并集成。
- [x] 双语 README、npm/GitHub 元数据与 awesome-dsh-plugin 描述已发布到 `0.2.46`。
- [x] 三张新宣传截图与 43 秒演示已生成、脱敏并登记。
- [x] 当前 DSH Market 四个核心高意图词复验为第 1。
- [x] `npm run check` 全部通过：250 项测试、75 个发布文件；npm/GitHub 线上营销元数据一致。
- [ ] `mcp server` 从第 5 回落到第 15，需作为下一轮搜索相关性优化，而不是伪报通过。
- [ ] 外部目录 [Issue #69](https://github.com/duhu2000/dsh-mcp-connector/issues/69) 尚未收敛。
- [ ] D+7（2026-09-19）与 D+14（2026-09-26）尚未到期执行。
- [ ] 媒体文章 URL 尚待登记；登记后才能逐篇核对版本、截图和安装文案。
