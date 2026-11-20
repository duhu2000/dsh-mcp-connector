# 大智慧嵌套参数排查与本地回归

2026-11-20。以下本地结果不代替大智慧生产业务验收，不表示卡片已上架。

## 已观察事实

- 用户已连接并发现 17 个工具。
- 两次经单独授权的 `getCompanyProfile` 请求实际参数分别为
  `{"param":true,"stockCode":true}` 与 `{"param":false,"stockCode":false}`，
  服务端均报告 CompanyParam 不能从布尔值反序列化。
- 已显示的 Schema 要求 `param` 为对象、`param.stockCode` 为字符串。
  最小正确形状为 `{"param":{"stockCode":"SH601519"}}`。
- 本地安装的 Host MCP bridge 将入参直接传入 `tools/call`；它创建的原始
  ToolDefinition 未使用 defineTool 的入参校验。不能据此断言模型为什么生成布尔值。

## 修复范围

为本插件管理的 MCP 工具添加 Host 执行 guard，从实时工具定义读取 Schema，
校验明确声明的类型、必填字段、嵌套对象及数组元素。错误请求在 MCP 分发前拒绝，
反馈字段路径与预期类型，不输出参数值，不自动补参数、转换布尔值或重试。
可选布尔字段的 false 原样保留。现有工具拒绝策略仍生效。

这是保守的结构校验，不是完整 JSON Schema 校验器。引用、组合及条件 Schema
不猜测展开；不支持 guard/get 的旧 Host 会给出能力告警，不能宣称具有拦截保障。
校验不保证模型下一次一定生成正确参数，也不证明服务端业务或费用正确。

## 本地验证

```sh
DSH_HOST_INTEGRATION_ANCHOR=/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json \
  node --test test/tool-input-guard.test.mjs test/tool-input-guard-host.test.mjs
```

测试只加载 Host 代码，在 127.0.0.1 随机端口启动合成 Streamable HTTP MCP；
不加载用户配置、凭据或模型。使用真实 ToolRuntime 与 MCP bridge。

- 修复前：模拟服务收到原样布尔值，复现缺少校验。
- 修复后：true/false 两个错误输入均被拦截，新增业务 HTTP 请求为 0。
- 正确嵌套对象及含可选 false/二层对象的参数均按原样到达模拟服务。
- 既有 deny 策略不能被校验绕过；卸载时清理 guard。
- 本地真实大智慧业务调用次数：0。

本地已验证 Host tools 0.1.2-rc.1；专项 4 项全部通过，无跳过。
基于插件主分支 94be71b（0.2.117）的 `npm run check` 通过：
1050 项通过、0 失败、120 项需要显式环境的测试跳过；打包与文档检查通过。
新 Host 0.2.2-rc.1 的回环测试已加入 CI，结果需以该次运行记录为准。

## 后续验收

先将修复部署到用户运行的 Host，确认 guard 已启用并核对实际工具 Schema。
此前两次真实调用额度已使用；如需第三次，应先获得新的单次费用授权。
只调用一次 `getCompanyProfile`，不自动重试；保存脱敏实际入参和返回状态。
真实业务未成功前保持候选 DEFERRED，不把本地模拟结果写成生产 PASS。
