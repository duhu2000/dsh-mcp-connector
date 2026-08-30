# 首次贡献 / First contribution

欢迎第一次参与 `dsh-mcp-connector`。优先选择带有 [`good first issue`](https://github.com/duhu2000/dsh-mcp-connector/labels/good%20first%20issue) 标签、且尚未被认领的任务；在 Issue 留言后再开始，避免重复劳动。

Welcome! Start with an unassigned [`good first issue`](https://github.com/duhu2000/dsh-mcp-connector/labels/good%20first%20issue). Leave a short comment before working on it so contributors do not duplicate effort.

## 适合第一次参与的范围

- 中英文文档示例、安装或故障排查说明。
- 不需要真实 Token、API Key 或私有服务的测试用例。
- 键盘操作、可访问性标签和小型界面文案改进。
- 元数据校验器与贡献者工具链的小改进。

新的公共连接器描述不提交到本仓库，请改走独立 Registry 的[连接器上架指南](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)。

## 从 Issue 到 PR

```bash
git switch main
git pull --ff-only
git switch -c docs/<short-purpose>
npm install --legacy-peer-deps
npm run check
```

1. 只处理 Issue 定义的单一问题；不提交真实凭据、业务数据或本机路径。
2. 中英文用户文案保持同步；行为变化需补测试。
3. PR 中链接对应 Issue，并写清问题、改动、验证结果和必要的手工检查。
4. 维护者确认验收标准后合并；版本发布由维护者统一安排。

如果任务描述不够清楚，请先在 Issue 提问。首次贡献不要求拥有 DSH 私有环境，也不要求发布 npm 包。
