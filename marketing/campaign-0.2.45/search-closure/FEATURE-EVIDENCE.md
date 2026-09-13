# 功能宣传证据检查点

日期：2026-09-13。状态：证据与草稿交付；不是新一轮真实页面验收记录。
固定版本：0.2.45，发布提交 82d240601df73b8e704124100ec5771a0cd5514a。本机开发提交 09a19e9 曾与发布提交核对代码树一致。
来源：[PR #71](https://github.com/duhu2000/dsh-mcp-connector/pull/71)、[PR #72](https://github.com/duhu2000/dsh-mcp-connector/pull/72)、[PR #73](https://github.com/duhu2000/dsh-mcp-connector/pull/73)。
发布记录：[0.2.43](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.43)、[0.2.44](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.44)、[0.2.45](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v0.2.45)。
以下代码与测试路径均相对仓库根，可在上述固定提交下核对。

| 能力/版本 | 代码与测试证据 | 可宣传的事实 | 必须保留的边界 |
|---|---|---|---|
| SSE 状态通知，0.2.43 / #71 | lib/status-events.js；test/status-events.test.mjs | 页面随状态事件更新 | 不是持续健康探针，不观测每次工具调用；事件不含凭据 |
| 最后成功缓存，0.2.43 / #71 | lib/tool-catalog-cache.js；test/plugin-flow.test.mjs 的工具缓存测试 | 发现失败仍可查上次工具元数据 | 不是离线调用；从未成功发现时没有缓存，配置变化/断开会失效 |
| 后台发现覆盖，0.2.44 / #72 | lib/index.js；test/plugin-flow.test.mjs“后台发现覆盖手动、JSON、目录连接” | 无需先打开详情即可发现 | Host 能力、服务可用性与授权仍是前提 |
| 统一工具搜索，0.2.45 / #73 | lib/index.js:2713；lib/tool-catalog-cache.js 的 browseToolCatalog；test/plugin-flow.test.mjs:206 | 当前可见且启用连接的缓存统一检索，精确名称优先、分页 | 不搜索所有未安装目录工具；无 Workspace 仅全局 |
| 连接/服务/状态筛选，0.2.45 / #73 | ui/index.html:1208；上述工具浏览 API 测试 | 按连接、服务、最近发现状态缩小结果 | 状态不是实时调用成功保证；搜索与筛选不请求目标服务 |
| 易读参数，0.2.45 / #73 | ui/index.html:996；test/ui.test.mjs“参数摘要保留必填、嵌套与约束” | 类型、必填、枚举、约束及嵌套摘要 | 复杂规则摘要非完整规则；原始 Schema 指安全缓存而非未经裁剪原文 |
| 来源/缓存时间，0.2.45 / #73 | ui/index.html:1231–1232；工具浏览 API 测试 | 展示连接器、连接、服务和最后成功时间 | 超24小时标陈旧；缓存清单有容量上限 |
| 单连接诊断与重新发现，0.2.45 / #73 | lib/index.js:2736；工具浏览 API 测试 | 检查连接、重新发现工具及诊断建议 | 不执行目标工具，不保证自动修复；五秒冷却、在途合并 |
| 后台退避，0.2.45 / #73 | lib/discovery-policy.js；test/discovery-policy.test.mjs；lib/index.js:3158 起 | 最多两条后台任务并发；健康五分钟到期；失败退避 | 页面 SSE 连接时每30秒检查到期项；不是精确定时或永久后台轮询 |

## 退避精确口径

普通失败从30秒指数增长，局部上限15分钟；429从一分钟起并结合 Retry-After。Retry-After 解析上限24小时，不能声称无限制严格遵守任意值。鉴权失败暂停自动重试，需更新凭据/重新授权或检查恢复。工具页手动操作不能绕过有效限流等待；不能推而广之声称所有旧接口均禁止手动重试。

## 已有验证与未完成项

0.2.45 发布前：248项测试、Linux Node20/22/24、Windows Node24、候选包检查通过；72个发布文件通过白名单与敏感内容扫描。浏览器验收为无凭据 harness 的6个模拟服务/750个模拟工具，不是真实工具数量。六条健康连接十分钟126到18次是确定性调度模型，不是生产性能测量。
用户已确认部署；本检查点没有重新测试其真实 profile。TODO：新三张宣传图、真实 DSH 新版工具页逐项验收。

目录口径引用总账冻结快照：Registry106、随包6、重复2、合并110、随包唯一4、9类、精选6。该数据来自数据证据子任务，不冒充本任务当日在线测量；发布时重新确认。Notion 实测仍为 TODO。

