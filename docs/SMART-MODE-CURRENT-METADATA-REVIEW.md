# QMCP-4963 当前六服务原始元数据与首项审核材料

采集完成时间：2026/11/16 11:11:47，Asia/Shanghai。当前状态：**六路原始 tools/list 采集成功，人工只读审核仍未完成**。独立分支 codex/qmcp-4963-current-metadata-review；核验人和签发人仍为用户本人。

## 当前结果

| Server | 实际结果 | 定义数 |
| --- | --- | ---: |
| qcc-company | 完整 tools/list 已取得 | 186 |
| qcc-risk | 完整 tools/list 已取得 | 38 |
| qcc-ipr | 完整 tools/list 已取得 | 18 |
| qcc-operation | 完整 tools/list 已取得 | 36 |
| qcc-history | 完整 tools/list 已取得 | 34 |
| qcc-executive | 完整 tools/list 已取得 | 44 |

本轮定义总数 356，未批准候选组 170。11 项登记已更新到生产组 qcc-enterprise-six-v1 下的新来源身份；完整指纹来自未经清洗的原始 tools/list。旧 sourceId 仅保留为历史观察。

356/356 完整指纹与 2026-11-13 的原始目录摘要一致；356 项 sourceId 差异均可由旧 group enterprise-six 切换到 qcc-enterprise-six-v1 精确解释。身份通过产品同一 indexRawToolSources 算法与当前本地绑定计算，未启用生产智能层，也不把这次元数据核对当作生产 Host 注册/派发或真实 prepare 验收。全部 356 项均未提供 outputSchema。

首次只读探测在 2026/11/16 11:06:02 的 initialize 阶段收到 HTTP 401，随后停止其余五路；用户告知已启动 DSH Web 后，主存储和日志出现更新且未过期的现有凭据。再次采集时凭据更新时间为 2026/11/16 11:09:01，到期为 2026/11/16 12:09:01。采集器没有刷新/授权方法，未执行凭据更新；不能把这次外部更新进一步归因为手动重授权或某个具体后台刷新路径。

本轮累计元数据方法计数：initialize=7，notifications/initialized=6，tools/list=6。成功轮为 12 个 HTTP 200、6 个 HTTP 202；首次失败请求另记 HTTP 401。真实业务与模型请求、只读/来源批准、公钥部署和生产启用均为零。

## 登记表与首项材料

[11 项登记](reviews/QMCP-4963/review-register.json) 已补当前身份与指纹；结论、独立审核摘要及签发字段仍为空。五对等价关系继续未审核、未批准。

[get_company_registration_info 首项材料](reviews/QMCP-4963/get-company-registration-info-review.md) 已列出原始定义声明及待人工确认项，完整原始副本保存在本地任务产物。

## 执行与保存边界

复用已测试的 MCP 客户端，只允许精确六端点的 initialize、initialized 通知、单页 tools/list 及必要的会话关闭；禁止重定向转发、自动重试、续页和非元数据方法。原始 tools/list 的本地审核副本不进入 Git 或 npm；凭据与业务样本均不保存。凭据仅存在请求进程内，临时 profile 无凭据、无公钥、无启用策略，结束时已核对路径/标记并删除。

运行代码未改动；元数据传输/范围/绑定契约 31 项通过。文档、登记完整性、敏感内容和打包检查另行记录；本轮不重复运行无变更的整个功能回归。当前 DSH 四个监控配置的前后哈希核对见任务产物，不把局部配置检查扩大为所有后台运行存储未变化。

## 下一步

请用户优先审核 QCC-RO-001 的副作用、返回语义、计费/限流和有效期；元数据字段或只读提示不是业务结论。独立审核材料齐备后，再单独处理真实签发和隔离交付，仍不执行真实业务/模型或启用生产。
