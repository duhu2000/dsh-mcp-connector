# 分享体验模块接入说明

独立模块位于 [`ui/sharing-experience.js`](../../ui/sharing-experience.js)。本文件只描述 P0 集成契约；当前模块不会自行出现在 `ui/index.html`，也不会自动读取或发布任何内容。

## 挂载接口

```js
import { mount } from './sharing-experience.js';

const dispose = mount(container, {
  openDraft: async (text) => {
    const session = await startSession();
    await host.setDraft(session, text);
  },
  showMessage: (text, type) => showMessage(text, type),
});

// 面板卸载时调用
dispose();
```

接口约束：

- `mount(container, { openDraft, showMessage })` 返回一个 `dispose()` 函数。
- `openDraft(text)` **只在用户点击“复制到会话草稿”后调用**。P0 负责复用现有 `start-session → Host setDraft` 流程；只写入输入草稿，不发送消息。
- `showMessage(text, type)` 是可选宿主提示；调用失败不会改变或发送草稿。
- 未提供 `openDraft` 时按钮禁用，预览与编辑仍可使用。
- 模块不接收会话、连接、工具缓存、工具返回、凭据或账号对象，不访问网络、storage、剪贴板或遥测接口。

## 纯函数接口

- `createSharingExperience(input)`：只接受 `task`、`versions`、`steps`、`limitations`（及固定 `schemaVersion`）。未知字段拒绝。
- `createSharingExperienceFromTemplate(templateId, versions)`：加载 `companyProfile`、`jsonMigration`、`toolRecovery` 三个公开教程模板；所有步骤默认“未测试”。
- `editSharingExperience(current, patch)`：显式编辑白名单字段，不修改原对象。
- `renderSharingExperiencePreview(draft)`：生成纯 Markdown 预览，转义用户文本。
- `createSharingCopyPayload(draft)`：返回纯文本载荷，固定 `copied: false`、`businessOutcome: unchanged`，不执行复制。
- `SHARING_AUTHOR_ASSETS`：提供案例、教程和 Mock 截图的来源/边界索引。

疑似 Bearer、API Key、Token/Secret、OAuth `code/state/token` 回调、`file:` URL，以及 macOS/Linux/Windows 用户绝对路径会被拒绝并要求先脱敏。版本字段为空时显示“未填写”；填写时必须是语义版本。

## 样式与依赖

模块无第三方依赖，不注入样式。P0 可在共享 UI 中按现有设计系统样式化以下类：

- `.sharing-experience`
- `.sharing-experience-form`
- `.sharing-experience-field`
- `.sharing-experience-steps`
- `.sharing-experience-step`
- `.sharing-experience-actions`
- `.sharing-experience-message`
- `.sharing-experience-preview`

预览节点使用 `<pre>.textContent`，不得改为把 Markdown 作为 HTML 注入。

## 测试

```bash
node --test test/sharing-experience.test.mjs
npm run check
```

专门测试覆盖模板默认状态、显式编辑、未知信号拒绝、凭据/回调/路径拒绝、Markdown 转义、素材证据分类、用户点击前不调用 `openDraft`、复制后业务状态不变、销毁监听器，以及源码无网络/storage/剪贴板/连接访问。
