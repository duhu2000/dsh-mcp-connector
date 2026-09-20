# Security policy / 安全报告

## Private reporting / 私密披露

Please report suspected vulnerabilities through [GitHub Private Vulnerability Reporting](https://github.com/duhu2000/dsh-mcp-connector/security/advisories/new).

疑似安全漏洞请通过上述私密入口提交，不要在公开 Issue、PR 或讨论中发布利用步骤、PoC、凭据或真实业务数据。如入口不可用，可公开提交仅说明“需要私密披露渠道”的请求，不附技术细节。

Include the affected version/commit, environment, root cause, a minimal reproduction using synthetic data, impact, and suggested remediation where available. Never include real secrets or third-party data. Test only systems you own or are authorized to test.

请提供受影响版本或提交、运行环境、根因、使用虚构数据的最小复现、影响及建议修复方式。仅测试自有或获授权的系统。

## Handling reports / 处理流程

Maintainers will assess and reproduce reports privately, add regression coverage for confirmed defects, and coordinate remediation and disclosure with the reporter. An acknowledgement does not establish that a vulnerability is confirmed. We do not promise a fixed response or remediation deadline.

维护者将私下评估和复现，对确认的问题补充回归测试，并与报告者协调修复及披露。收到报告不等于确认漏洞；暂不承诺固定响应或修复期限。

Fixes are targeted at the latest release; older versions are not guaranteed backports. Reports affecting older versions are still welcome and should identify the exact version.
