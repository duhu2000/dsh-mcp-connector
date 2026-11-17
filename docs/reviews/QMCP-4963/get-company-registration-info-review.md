# QCC-RO-001 企业登记信息待审核材料

核验/签发责任人：用户本人。当前状态：**原始元数据已取得，待人工只读核验**。本材料不是批准、签名包或调用授权。

## 来源身份

| 字段 | 当前证据 |
| --- | --- |
| Server / raw name | qcc-company / get_company_registration_info |
| public name | mcp__qcc-company__get_company_registration_info |
| 当前生产 group | qcc-enterprise-six-v1 |
| account / 连接 | default；连接身份见登记表 currentBinding |
| endpoint | https://agent.qcc.com/mcp/company/stream |
| transport | streamable-http |
| 本轮状态时间 | 2026/11/16 11:11:47 +08:00 |
| 当前 sourceId | d22944a41f8e2eb540033339b57b8444afa6424f23fae8eb227fe96cc0905def |
| 当前完整指纹 | c211ad8e819fa4467026c84a7cf89a0724923df7ef21e9c13e09d06cf16a2c52 |

## 原始定义材料

本地原始副本：get_company_registration_info.review-only.json；完整六路副本：raw-tools-list.review-only.json，均位于本轮私有任务产物目录，不进 Git/npm。完整副本包含服务端原始扩展字段，未经参数摘要或缓存清洗；登记指纹已与原始定义重算核对。

服务端原始字段：`description`、`inputSchema`、`name`、`title`。inputSchema 已提供；outputSchema 未提供，不能按空返回结构处理。

输入字段摘要：searchKey（type="string"，必填）。这不是参数取值建议或完整定义替代品。

### 本项服务端声明与证据缺口

| 项目 | 原始元数据事实 |
| --- | --- |
| 标题 | 企业工商信息 |
| 输入对象 | type=object；唯一声明的属性 searchKey 为 string，且为必填 |
| searchKey 的服务端说明 | 企业名称或统一社会信用代码；未在本轮选择任何真实主体或填写实际参数值 |
| 其他输入限制 | 未声明长度、pattern、枚举或 additionalProperties 限制；不替提供方补造约束 |
| 描述的业务用途 | 提供方声明用于核心登记信息查询，可返回主体名称、统一标识、法定代表人、资本、成立时间、登记状态和地址等；尚未用真实业务响应验证 |
| 更新频率 | 描述宣称 T+0，来源指向国家企业信用信息公示系统；本轮未独立核验来源链和实际时效 |
| outputSchema | 未提供；返回字段仅有描述性声明，不等于结构化返回契约 |
| annotations / readOnlyHint | 本项未提供 annotations，也未提供 readOnlyHint；不能从查询用途自动作只读批准 |
| 注册扩展 | 本项未提供 _registration_tool；完整指纹保留实际存在的字段，不补入空字段 |

## 请用户逐项确认

| 核验事项 | 当前结论 |
| --- | --- |
| 参数如何识别企业、必填字段、同名歧义及边界 | 待结合当前完整定义核验 |
| 是否创建/修改/删除业务资源或触发报送/订阅/导出等动作 | 未核验；名称和 annotations 不作证明 |
| 返回字段、空结果、历史/当前口径与更新时间 | 未核验；需提供方说明或另获授权的证据 |
| 计费、扣量、限流及失败/分页行为 | 未核验，不用只读结论替代费用确认 |
| 权限、Workspace、治理及手动激活边界 | 保留既有规则；本轮未运行真实业务验收 |
| 独立审核材料摘要、reviewerHash、核验日期和有效期 | 均待用户填写 |
| 真实测试主体、精确参数、次数和费用上限 | 未指定、未授权，不根据字段名编造输入 |

完整人工记录使用[单工具核验表](tool-review-form.md)。只读结论仍为空，signingReady=false，executionAuthorized=false；不生成真实签名、公钥或来源关系。
