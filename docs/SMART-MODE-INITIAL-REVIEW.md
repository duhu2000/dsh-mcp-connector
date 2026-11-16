# QMCP-4963 首批真实工具核验清单与验收安排

2026-11-16，Asia/Shanghai。准备基线 `6dd18ce`，本轮只整理人工待核验材料。业务核验、独立证据整理及签发、验收决定均由用户本人负责；助手负责材料和完整性检查，不代替用户作真实批准。人工核验在插件/模型之外完成，不虚构第二位审核人。

首批选取六个 Server 各一个主入口，再补五个公司侧对照来源，共 **11 个入口、5 对重复候选**。选样依据是六服务覆盖和历史重复观察，不是实际使用频率、成功率或只读性排名。所有条目当前均为待核验，不能签发或执行。

## 你现在需要处理的材料

- [逐项登记表](reviews/QMCP-4963/review-register.json)：已填工具身份、历史指纹和你的责任角色；当前绑定、业务结论、证据摘要与有效期均留空。
- [单工具核验表](reviews/QMCP-4963/tool-review-form.md)：每个入口单独填写，不因另一来源通过而自动通过。
- [来源等价核验表](reviews/QMCP-4963/equivalence-review-form.md)：五对候选分别处理，不把只读批准当作等价批准。
- [分步验收及请求预算](reviews/QMCP-4963/acceptance-plan.md)：将元数据更新、首个真实调用、跨源比较和模型 A/B 分开，均未执行。

## 首批六个主入口

| 核验编号 | Server | 原始工具名 | 名称释义和核对重点 |
| --- | --- | --- | --- |
| QCC-RO-001 | qcc-company | `get_company_registration_info` | 企业登记信息；主体标识、同名歧义、登记字段和更新时间 |
| QCC-RO-002 | qcc-risk | `get_business_exception` | 经营异常信息；列入/移出、分页、时间、空结果的准确含义 |
| QCC-RO-003 | qcc-ipr | `get_trademark_info` | 商标信息；申请/注册标识、权利人、状态、分页 |
| QCC-RO-004 | qcc-operation | `get_administrative_license` | 行政许可；许可主体、证照类型、有效状态及数据时点 |
| QCC-RO-005 | qcc-history | `get_historical_registration` | 历史登记；历史版本/时点，区分历史值与当前值 |
| QCC-RO-006 | qcc-executive | `get_executive_positions` | 任职信息；同名识别、任职类型、当前/历史和返回范围 |

表中业务释义仅由名称推定，须由你结合真实定义及服务商资料确认。`get_` 名称不构成只读证明。新增、修改、删除业务资源及报送、订阅、消息外发、异步导出等副作用均须检查；服务端正常访问日志、计量和计费单独记录，不直接等同于业务写入。

## 五对待比较来源

| 关系编号 | 专项入口 | 公司侧入口 | 两个独立核验编号 |
| --- | --- | --- | --- |
| QCC-EQ-001 | qcc-risk / get_business_exception | qcc-company / get_business_exception | QCC-RO-002、007 |
| QCC-EQ-002 | qcc-ipr / get_trademark_info | qcc-company / get_trademark_info | QCC-RO-003、008 |
| QCC-EQ-003 | qcc-operation / get_administrative_license | qcc-company / get_administrative_license | QCC-RO-004、009 |
| QCC-EQ-004 | qcc-history / get_historical_registration | qcc-company / get_historical_registration | QCC-RO-005、010 |
| QCC-EQ-005 | qcc-executive / get_executive_positions | qcc-company / get_executive_positions | QCC-RO-006、011 |

历史观察显示这五对属于仅 `_registration_tool` 不同的候选，未批准任何关系。完整定义指纹仍包含这个字段；服务端字段含义、返回语义、计费、限流和新鲜度需要逐项确认。没有默认首选来源，也没有自动换源或合并。

## 两个必须补齐的证据缺口

**需要更新当前来源绑定。** 此次引用的目录采集于 2026-11-13，356 个定义、170 组候选，未在本轮重新请求。历史 sourceId 按当时账号、group、connection key、Server、raw name 计算；现在的生产 group 为 `qcc-enterprise-six-v1`。登记表将历史身份单独标为不可签发，当前 sourceId/完整指纹必须从选定隔离环境的受认证 inspect 与可信原始 tools/list 重新核对，不能直接复制历史值。

**缺少返回结构及业务只读证据。** 历史目录原始字段没有 outputSchema，且交付产物没有保存完整原始 schema 或业务响应样本。缺少字段不能当作空返回结构，也不能补造 schema 后当成原始定义计算指纹。须通过服务商正式字段说明、行为说明或另获授权的最小样本确定返回语义和副作用；无法确定时保留“证据不足”。

## 本轮完成和下一步

已校验 11 个入口在历史目录中各唯一存在，六个主入口覆盖六个 Server，五对来源均属于历史未批准候选；完整历史指纹逐项保留。源文件 SHA-256 为 `64564c80dcb049b61254d36ae2c0beea9e172dc913bb2822127417589e340529`。

材料不属于运行时 `trust.json` 或 `bundle.json`，没有签名、公钥、批准记录或执行许可；不会被生产校验器读取。当前真实只读批准、来源关系批准、业务调用、模型请求和公钥部署均为零。

建议先核验 **QCC-RO-001**，完成一个独立来源的流程后，再扩展到其余五个主入口；五个公司侧对照入口与等价核验可以后续推进。元数据更新、真实调用及签发部署的具体授权边界见分步验收表，不把本清单当作执行许可。

本轮不修改运行代码或当前 DSH 配置，不启用生产智能模式，不合并或发布。代码和合成回归状态仍以 [可信只读证据接入报告](SMART-MODE-READONLY-EVIDENCE.md) 为准。
