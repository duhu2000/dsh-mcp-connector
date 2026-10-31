# 首次使用与分享模块集成验收

## 代码边界

- 首次使用区分安装、授权、工具发现与业务成功；缓存匹配只允许准备示例草稿，不自动执行。
- 分享体验来自 #185，安全模板来自 #188；保留作者提交，不把提示词当脱敏器。
- `templateCatalogReferences` 仅从 `loadBundledCatalog()` 的固定随包文件读取，经审计后返回已发布条目的 `connectorId/serverKey/name/serverName` 四字段。接口忽略用户输入，不读取 merged/remote/config catalog、已安装连接或凭据。
- 模板 UI 只接受枚举选择，生成全重填 HTTP 模板或固定目录引用。改动选择会撤销旧预览；复制、下载、会话草稿需分别点击。
- 两个模块共用 `openSharingDraft`，等待匹配 Host 回执才确认带入草稿；失败/超时不报告成功，不自动发送。
- 模态框关闭或替换清理模块；加载错误不挂载，迟到异步返回不复活面板。隐藏的 grid 字段显式保持隐藏。

## 自动化证据

本次集成全量 `npm run check`：502 tests / 494 pass / 8 skipped / 0 fail；打包白名单 99 文件通过。新增 5 项安全模板集成测试验证固定来源、四字段、参数不可注入、UI 输出与后端严格验证器兼容、失败关闭及异步失效。另有 Host ACK、分享体验及首次使用测试。

## 隔离合成 UI（不是正常 Host 验收）

使用本地 headless Chrome，网络只允许无凭据 harness：

- 分享体验：4198，1280×900 与 390×844。验证长表单滚动到预览/复制、无横向溢出、Tab/Shift+Tab 循环、Escape 清理；非法版本 latest 切换模板可纠正，0.2.81 后切换成功。
- 安全模板：4210，1280×900 与 390×900。验证无输入凭据/URL字段，预览前导出禁用，Bearer 占位符，显式复制（剪贴板桩）、实际本地下载 JSON 与预览一致、目录引用无连接配置、切换来源后预览失效、独立页面 Host 草稿失败保留预览、目录接口失败不挂载、键盘和窄屏布局。
- 无 pageerror、无外部请求；模板操作期间只有 `templateCatalogReferences` 和既有后台 `catalog/status` 只读刷新，无连接变更、业务工具调用或消息发送。
- 本地脚本：`/tmp/mcp-ui-p0-layout-acceptance.cjs`、`/tmp/mcp-safe-template-ui-acceptance.cjs`。不纳入 npm 包。

截图 SHA-256（本地保留，不自动上传）：

```text
cc77417b18b5ec0110f664cea9820f2e5d7f1422e50c6bfa53985076c56156a9  mcp-safe-template-1280.png
961423d18e8c822f74b2a97ba9c2c04ad62d5fa0896ed13f966a6be3f218245e  mcp-safe-template-390.png
bbeed4956dfd800f29b2a7b99928d1c9bee696c33a66c91542c91dcb0a1ca157  mcp-sharing-layout-1280.png
e3e3ef1d4607d5f458b9680655e9ab57ab37a02790473339326d27908f986e01  mcp-sharing-layout-390.png
```

## 未完成与合并门禁

- 已通过合并提交 628c66e 集成 #188 最终远端 head `3e8f0d2ac10de1f96d86a2607c4a8b88327c9803`，包含 catalog 序列化出口身份/名称复验修复；祖先关系已验证。最终代码全量检查及两尺寸隔离 UI 复测通过。
- 未证明正常 Host 草稿端到端、首次 OAuth、付费业务调用或当前市场排名。正常 profile 未修改。
- AutoGLM 登录和真实背景采集限制未被绕过；本轮本地隔离测试有单独授权。
- 由总控统一审阅、合并与发布，本线不 tag/npm。
