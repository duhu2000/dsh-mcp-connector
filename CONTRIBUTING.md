# 贡献指南 / Contributing

感谢你帮助改进 `dsh-mcp-connector`。请不要在 Issue、PR、日志、截图或测试数据中提交 Token、API Key、Cookie、OAuth 凭据或真实业务数据。

Thank you for contributing. Never put tokens, API keys, cookies, OAuth credentials, or real business data in issues, pull requests, logs, screenshots, or fixtures.

## 公开材料自查 / Before pushing

公开仓库用于使用、集成和贡献指南、公开接口及可分享的示例。设计原稿、内部排期、竞品策略、候选处置和原始验收证据请保存到团队的私有工作区。混合文档先保留私有原件，公开版只写已交付的行为、适用范围和复现步骤。外部贡献者可以直接提交公开版，无需访问维护者的私有系统。

1. 暂存准备公开的文件，运行 `npm run public:check`，再用 `git diff --cached` 阅读正文，打开每张截图和附件核对内容。
2. 首次推送或更新公开分支前，先取得目标分支最新引用，再运行 `npm run public:check -- --range upstream/main HEAD`。将 `upstream/main` 换成指向目标仓库的远端引用。此命令逐个检查待推送提交；先加入、后删除的草稿仍会出现在先前提交中。
3. 若检查报错，先将内部原件存妥，整理尚未推送的提交，再次检查后推送。公开分支在推送时即可阅读。路径检查无法判断普通文件名下的正文、图片像素、PR 正文或附件，请逐份确认适合公开。

Stage the files and run `npm run public:check` before committing. Before pushing, check the full outgoing range as shown above. Review text and images yourself, including the PR description and attachments. Keep internal drafts and raw evidence private; share the public guide or a sanitized summary.

随 npm 分发的截图应在 `package.json` 的 `files` 中逐名列出；仅用于公开文档的图片可放在分发截图目录之外。检查已归档路径使用小写 Git 相对路径的 SHA-256，不需要私有仓库。发布仍按现有流程审查实际 tgz。

### 安装本地推送检查 / Install the local pre-push check

从可信的公开基线检出本项目，在每个团队或 AI 使用的克隆中执行：
```sh
git fetch origin
npm run public:hooks:install
```

如果 `origin` 是自己的 fork，先获取公开上游的 `main`，再用 `npm run public:hooks:install -- upstream/main`。安装时将检查脚本和退役路径清单复制至 Git 的 hooks 目录，关联 worktree 共用此 hook。工作区里的脚本改动不会影响已安装的检查。如果已有 `pre-push` 或自定义 hooks 目录，安装器会保留原设置。需要整合时，由现有 `pre-push` 调用受信任的检查器副本，传入 `--pre-push refs/remotes/upstream/main`（替换为实际的公开上游引用），并转交 Git 提供的标准输入。

此克隆的每次 push 都会检查，包括推向 fork。公开上游 `main` 已有的文件路径视为已登记。`docs/` 中新增的文件，以及任意目录中新出现的常见文档、图片、日志和压缩包，需确认可公开后才推送。仅登记本次要公开的精确 Git 路径：

```sh
git config --local --add dshPublic.documentPath docs/getting-started.md
```

本地登记不豁免原有退役路径、私有路径和截图清单检查。更新公开基线时先 fetch。检查器更新后，从可信版本重新安装。此 hook 检查 Git 文件路径，发布前仍需核对正文、PR 文案和附件。

Install the hook once per clone with `npm run public:hooks:install`. In a fork, fetch the public upstream and pass `upstream/main`. Register new public documents and attachments by exact Git path in local Git config after reviewing them. Review file contents and any materials you attach separately.

## 参与方式

- 报告安全漏洞：请遵循 [安全报告政策](https://github.com/duhu2000/dsh-mcp-connector/blob/main/SECURITY.md)，使用 [私密报告入口](https://github.com/duhu2000/dsh-mcp-connector/security/advisories/new)，勿公开提交利用细节。
- 报告普通缺陷或提交功能建议：[GitHub Issues](https://github.com/duhu2000/dsh-mcp-connector/issues)
- 为公共市场增加连接器：阅读 [Connector onboarding](https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md)，连接器描述与插件代码分仓管理。
- 修复插件或改进文档：Fork 本仓库，从最新 `main` 创建单一目的的分支并提交 PR。
- 第一次参与：从带有 [`good first issue`](https://github.com/duhu2000/dsh-mcp-connector/labels/good%20first%20issue) 标签的任务开始，并按[首次贡献路径](docs/FIRST-CONTRIBUTION.md)完成本地校验。
- 搭建私有目录：参考 [README 配置说明](README.md#配置) 和 [市场注册指南](docs/MARKET-REGISTRATION.md)。

## 本地开发

要求 Node.js 20 或更高版本。DSH 运行期 peer dependencies 由 Host 提供，本地安装使用：

```bash
npm install --legacy-peer-deps
npm run check
```

如果修改公共 Registry 或市场元数据，还应运行：

```bash
npm run registry:build
npm run registry:validate
npm run market:check
```

UI 可以在无真实凭据的 mock 环境中验收：

```bash
npm run dev:ui
```

## PR 要求

1. 一个 PR 解决一个明确问题，不要夹带无关重构。
2. 新增或修改行为时增加对应测试；纯文档改动也必须通过 `npm run check`。
3. 中英文用户文档应同步更新。
4. README 中的当前版本必须与 `package.json` 一致，`npm run docs:check` 会阻断版本漂移。
5. 只使用无凭据 mock 或已脱敏数据做测试与截图。

准备发布时，把需要随包分发的截图逐个列入 `package.json` 的 `files`。在提交后运行
`npm run pack:reviewed -- <已有的空目录>` 核对实际的 npm 包。该命令需要 Python 3，
会核对包内文件的 Git 跟踪状态、允许路径以及归档内每个文件的 SHA-256。
发行标签的工作流发布经过这一步校验的同一个 `.tgz`。
从工作目录运行 `npm publish` 时，已跟踪文件必须与当前提交一致。若检查列出路径，请核对这些改动并从已审核的干净提交发布。

发行工作流在 npm 发布前上传受检 tgz 和发布前的 SHA-512 SRI，工件保留 90 天。精确版本元数据和下载地址分别最多请求 9 次，每个地址累计最多等待 315 秒退避。只有 HTTP 404 会重试，摘要、包身份或内容不符会使核验失败。

若 npm 已接受发布，而线上核验或 GitHub Release 步骤失败：

1. 在 Actions → Release 找到**原始标签推送运行**的编号，确认它已上传 `reviewed-npm-<运行编号>` 工件。
2. 选择 **Run workflow**，分支选 `main`，在 `source_run` 填入原始编号。默认只下载保留的受检包，与 npm 实包比对。需要补建 GitHub Release 时再勾选 `create_release`。
3. 查看 verify 作业的摘要。它记录原始运行、标签、提交、文件数和整包摘要。只有核验成功才会补建缺失的 Release；已有正式 Release 保留。恢复运行和原始运行的重跑均不会执行 npm publish。

这条恢复路径适用于已保存受检工件的发行。工件过期、缺失或标签已移动时，保留失败记录并核对原始发行证据。旧版本（含 0.2.122）的工作流未保存该工件。

## 从 Fork 到 PR

```bash
git switch main
git pull --ff-only
git switch -c feat/<short-purpose>
npm install --legacy-peer-deps
npm run check
```

提交时说明用户问题、解决方案、测试结果与必要的手工验收步骤。

## 维护者如何准备首次贡献任务

首次贡献任务应边界清楚、无需真实凭据或私有 DSH 环境，并在 Issue 中写明背景、建议修改文件、验收标准和验证命令。适合的范围包括文档示例、无凭据测试夹具、可访问性文案和小型校验器改进；涉及发布、OAuth 凭据、Registry 上架审批或大规模重构的工作不应标记为 `good first issue`。
