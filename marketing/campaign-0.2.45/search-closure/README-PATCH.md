# 公共文档建议文本（未应用）

日期：2026-09-13。由总体归口指定单一集成人按标题锚点应用，先核对最新内容。本文件不是已修改公共README的声明。

## README.md

在“### 工具查找与故障处理”替换现有两段为：

> 在“工具”页统一查找当前工作区可见、已启用连接的工具。输入工具名或描述，再按连接、服务和最近发现状态筛选；点击“参数详情”查看类型、必填项与嵌套结构。未选择工作区时，仅展示全局连接。
>
> 结果标注来源和最后成功缓存时间。发现失败时仍可查看已有缓存，但不代表服务当前可调用。展开“连接状态与故障处理”，按建议使用“检查连接”或“重新发现工具”。健康连接五分钟后到期，页面保持连接时后台检查到期任务；失败时退避，鉴权失败暂停自动重试。
>
> 详见[工具工作台教程](docs/USER-GUIDE.md#51-工具工作台统一查找工具)。工具页用于发现与诊断，不执行目标工具；参数摘要与原始安全缓存均有裁剪边界。

在“## 使用”的连接管理步骤之后补充：
> 连接后打开“工具”页，按工具名或描述查找能力，使用连接/服务筛选定位来源；授权、费用及正式调用仍由相应服务与Host管理。

首屏hero、营销比较表与图片顺序留给统一文案集成，不在本补丁重复覆盖。新图验收前不添加图片引用。

## README.en.md

在“### Tool discovery and troubleshooting”替换说明为：

> Search cached tools across enabled connections visible to the current workspace in the Tools tab. Filter by connection, service and latest discovery status, then open parameter details for types, required fields and nested structures. Without a selected workspace, only global connections appear.
>
> Results identify their source and last successful cache time. A cached tool is not a guarantee that the service is currently callable. Expand connection diagnostics to check the connection or rediscover tools. Healthy discovery becomes due after five minutes; while the page remains connected, background scheduling checks due tasks. Failures back off, and authentication failures pause automatic retries.
>
> Tool browsing does not execute target tools. Parameter summaries may omit complex rules; the original-schema view contains the sanitized, size-limited cached schema, not an untouched server response. See the [Chinese tool-workspace guide](docs/USER-GUIDE.md#51-工具工作台统一查找工具).

## docs/USER-GUIDE.md

在第5节末尾、现有“## 6. 添加自定义连接”之前插入：

### 5.1 工具工作台：统一查找工具

1. 先连接所需MCP服务，打开顶部“工具”页；工具发现会在后台进行，无需先打开每个连接的详情。
2. 输入工具名或描述中的关键词。精确工具名优先；同名工具仍可能来自不同连接，请核对来源。
3. 使用“连接”“服务”“发现状态”筛选缩小范围，点击“清除筛选”恢复。结果按页展示。
4. 工具页搜索的是已启用且当前范围可见连接的成功缓存，不是市场中所有未安装连接器的工具。未选择Workspace时仅显示全局连接。
5. 没有结果时先清除筛选，并确认连接已启用、范围正确且至少成功发现过一次；首次发现可能仍在等待。

### 5.2 查看参数与来源

每条结果展示连接器、连接、服务、最近发现状态和最后成功缓存时间。点击“参数详情”查看类型、必填、说明、枚举和嵌套结构。
复杂引用、组合规则或过大结构会提示摘要限制；可展开“原始 Schema（安全缓存）”继续查看。这里的原始Schema仍是安全裁剪后的缓存，不含被移除的默认值/示例，也不保证保留超限字段。此页不执行工具。

### 5.3 发现状态和最后成功缓存

“尚未发现”表示还没有当前发现状态；“Host状态未知”表示宿主状态无法确认；“最近发现成功/失败”仅代表最近一次发现，不保证随后调用的结果。
失败时已有的最后成功工具缓存仍可查看；超过24小时会提示陈旧。没有成功记录则无法提供缓存，成功空列表也不代表故障。连接改配、停用或断开可能使原结果不再可见。

### 5.4 检查连接与重新发现

展开“连接状态与故障处理”，先阅读阶段与建议。“检查连接”执行该连接的健康检查；“重新发现工具”重新获取该连接的工具元数据。两者不是目标工具试运行，也不保证自动修复。
同连接进行中的操作会合并，频繁操作有冷却；工具页操作不能绕过有效限流等待。鉴权失败请到已安装页更新凭据或重新授权。
健康后台发现五分钟后到期；页面保持SSE连接时按调度检查到期项，普通故障指数退避，限流结合Retry-After等待，鉴权失败暂停自动重试。不要把“刷新工具视图”误认为强制访问所有服务，它只刷新缓存视图。

## 集成检查

确认Markdown锚点实际渲染可跳转；中英文范围/缓存措辞一致。避免覆盖自然搜索任务的新hero；待图片验收后再改图链与素材清单。建议先补用户手册，再同步README，最后更新市场材料。

