import { t } from './locale.js';
const STATUS_LABELS = Object.freeze({
  success: t('成功'),
  failed: t('失败'),
  untested: t('未测试'),
});

const ROOT_FIELDS = ['schemaVersion', 'task', 'versions', 'steps', 'limitations'];
const VERSION_FIELDS = ['dsh', 'plugin', 'host'];
const STEP_FIELDS = ['name', 'status'];

const SENSITIVE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\b(?:api[_ -]?key|token|secret|authorization)\s*[:=]\s*[^\s]{8,}/i,
  /https?:\/\/[^\s]*[?&](?:code|state|token)=[^\s&]+/i,
  /file:\/\/[^\s]+/i,
  /(?:\/Users\/[^\s]+|\/home\/[^\s]+|\/private\/var\/[^\s]+|[A-Za-z]:\\Users\\[^\s]+)/,
];

export const SHARING_EXPERIENCE_SCHEMA_VERSION = 1;
export const SHARING_STEP_STATUSES = Object.freeze(Object.keys(STATUS_LABELS));

export class SharingExperienceError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'SharingExperienceError';
    this.code = code;
    this.path = path;
  }
}

export const SHARING_CASE_TEMPLATES = Object.freeze({
  companyProfile: Object.freeze({
    task: '查询一家企业的简介',
    steps: Object.freeze([
      Object.freeze({ name: '安装并确认插件版本', status: 'untested' }),
      Object.freeze({ name: '确认连接与授权范围', status: 'untested' }),
      Object.freeze({ name: '发现并核对 get_company_profile', status: 'untested' }),
      Object.freeze({ name: '完成一次获准的只读业务调用', status: 'untested' }),
    ]),
    limitations: Object.freeze([
      '2026-10-16 的历史记录只证明当时已有连接的一次只读调用成功，不代表当前版本或首次授权已经验收。',
    ]),
  }),
  jsonMigration: Object.freeze({
    task: '迁移一条已有 mcpServers JSON 配置',
    steps: Object.freeze([
      Object.freeze({ name: '保存脱敏备份并导入单条配置', status: 'untested' }),
      Object.freeze({ name: '核对范围、工具发现与 Host 注册', status: 'untested' }),
      Object.freeze({ name: '完成一次获准的只读业务调用', status: 'untested' }),
    ]),
    limitations: Object.freeze([
      '仓库已有导入逻辑与隔离测试，但没有获授权环境中“导入真实配置后完成业务调用”的当前端到端证据。',
    ]),
  }),
  toolRecovery: Object.freeze({
    task: '在发现失败后定位工具并恢复发现',
    steps: Object.freeze([
      Object.freeze({ name: '核对范围、来源与最后成功缓存', status: 'untested' }),
      Object.freeze({ name: '按诊断检查连接或重新发现工具', status: 'untested' }),
      Object.freeze({ name: '完成一次获准的只读业务调用', status: 'untested' }),
    ]),
    limitations: Object.freeze([
      '隔离测试覆盖失败保留缓存与恢复后重新发现；尚无不改动既有真实连接的当前业务调用验收。',
    ]),
  }),
});

export const SHARING_AUTHOR_ASSETS = Object.freeze([
  Object.freeze({
    id: 'one-success-case',
    label: t("企业简介首次成功案例"),
    href: 'docs/tutorials/ONE-SUCCESS-CASE.md',
    provenance: 'historical-real-readonly-summary',
    note: t("仅摘录 2026-10-16 已有连接的一次真实只读调用结论；不是当前版本全流程验收。"),
  }),
  Object.freeze({
    id: 'json-migration',
    label: t("mcpServers JSON 迁移教程"),
    href: 'docs/tutorials/JSON-MIGRATION.md',
    provenance: 'procedure-with-isolated-tests',
    note: t("流程与代码测试可复核；当前真实迁移后的业务调用仍未验收。"),
  }),
  Object.freeze({
    id: 'tool-recovery',
    label: t("工具查找与发现恢复教程"),
    href: 'docs/tutorials/TOOL-SEARCH-RECOVERY.md',
    provenance: 'procedure-with-isolated-tests',
    note: t("缓存与恢复链路有隔离测试；不等于真实连接或业务工具调用成功。"),
  }),
  Object.freeze({
    id: 'storefront-screenshots',
    label: t("界面截图与 GIF"),
    href: 'docs/screenshots/README.md',
    provenance: 'credential-free-mock',
    note: t("必须保留逐资产版本和 Mock 标记，不得作为真实业务成功证据。"),
  }),
]);

function assertPlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SharingExperienceError('INVALID_TYPE', path, t("{path} 必须是对象", { path: path }));
  }
}

function assertAllowedFields(value, allowed, path) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new SharingExperienceError(
      'UNSUPPORTED_FIELD',
      path,
      t("{path} 包含不支持的字段：{p0}", { path: path, p0: unknown.join(', ') }),
    );
  }
}

function normalizeText(value, { path, maxLength, required = false }) {
  const text = value == null ? '' : String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (required && !text) {
    throw new SharingExperienceError('REQUIRED', path, t("{path} 不能为空", { path: path }));
  }
  if (text.length > maxLength) {
    throw new SharingExperienceError('TOO_LONG', path, t("{path} 最多 {maxLength} 个字符", { path: path, maxLength: maxLength }));
  }
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new SharingExperienceError(
      'SENSITIVE_TEXT',
      path,
      t("{path} 可能包含凭据、授权回调或本机用户路径，请先脱敏", { path: path }),
    );
  }
  return text;
}

function normalizeVersions(value = {}) {
  assertPlainObject(value, 'versions');
  assertAllowedFields(value, VERSION_FIELDS, 'versions');
  const dsh = normalizeText(value.dsh, { path: 'versions.dsh', maxLength: 80 });
  const plugin = normalizeText(value.plugin, { path: 'versions.plugin', maxLength: 80 });
  for (const [path, version] of [['versions.dsh', dsh], ['versions.plugin', plugin]]) {
    if (version && !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new SharingExperienceError('INVALID_VERSION', path, t("{path} 必须是语义版本，例如 0.2.81 或 0.2.1-rc.2", { path: path }));
    }
  }
  return Object.freeze({
    dsh,
    plugin,
    host: normalizeText(value.host, { path: 'versions.host', maxLength: 80 }),
  });
}

function normalizeSteps(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new SharingExperienceError('INVALID_STEPS', 'steps', t("steps 必须包含 1–12 项"));
  }
  return Object.freeze(value.map((step, index) => {
    const path = `steps[${index}]`;
    assertPlainObject(step, path);
    assertAllowedFields(step, STEP_FIELDS, path);
    const status = String(step.status || 'untested');
    if (!SHARING_STEP_STATUSES.includes(status)) {
      throw new SharingExperienceError('INVALID_STATUS', `${path}.status`, t("{path}.status 必须是 success、failed 或 untested", { path: path }));
    }
    return Object.freeze({
      name: normalizeText(step.name, { path: `${path}.name`, maxLength: 120, required: true }),
      status,
    });
  }));
}

function normalizeLimitations(value = []) {
  if (!Array.isArray(value) || value.length > 12) {
    throw new SharingExperienceError('INVALID_LIMITATIONS', 'limitations', t("limitations 必须是最多 12 项的数组"));
  }
  return Object.freeze(value.map((item, index) => normalizeText(item, {
    path: `limitations[${index}]`,
    maxLength: 400,
    required: true,
  })));
}

export function createSharingExperience(input) {
  assertPlainObject(input, 'draft');
  assertAllowedFields(input, ROOT_FIELDS, 'draft');
  if (input.schemaVersion != null && input.schemaVersion !== SHARING_EXPERIENCE_SCHEMA_VERSION) {
    throw new SharingExperienceError('INVALID_SCHEMA_VERSION', 'schemaVersion', t("不支持的体验草稿版本"));
  }
  return Object.freeze({
    schemaVersion: SHARING_EXPERIENCE_SCHEMA_VERSION,
    task: normalizeText(input.task, { path: 'task', maxLength: 160, required: true }),
    versions: normalizeVersions(input.versions),
    steps: normalizeSteps(input.steps),
    limitations: normalizeLimitations(input.limitations),
  });
}

export function createSharingExperienceFromTemplate(templateId, versions = {}) {
  const template = SHARING_CASE_TEMPLATES[templateId];
  if (!template) {
    throw new SharingExperienceError('UNKNOWN_TEMPLATE', 'templateId', t("未知体验模板：{templateId}", { templateId: templateId }));
  }
  return createSharingExperience({ ...template, versions });
}

export function editSharingExperience(current, patch) {
  const base = createSharingExperience(current);
  assertPlainObject(patch, 'patch');
  assertAllowedFields(patch, ROOT_FIELDS, 'patch');
  return createSharingExperience({
    task: patch.task ?? base.task,
    versions: patch.versions ? { ...base.versions, ...patch.versions } : base.versions,
    steps: patch.steps ?? base.steps,
    limitations: patch.limitations ?? base.limitations,
  });
}

function escapeMarkdown(value) {
  return value.replace(/([\\`*_{}\[\]<>#])/g, '\\$1');
}

function displayValue(value) {
  return value ? escapeMarkdown(value) : t("未填写");
}

export function renderSharingExperiencePreview(input) {
  const draft = createSharingExperience(input);
  const lines = [
    t("# MCP连接器使用体验（草稿）"),
    '',
    t("> 本草稿只包含用户主动填写的任务、版本、步骤状态与限制；复制草稿不代表连接或业务调用成功。"),
    '',
    t("- 任务：{p0}", { p0: displayValue(draft.task) }),
    t("- DSH 版本：{p0}", { p0: displayValue(draft.versions.dsh) }),
    t("- 插件版本：{p0}", { p0: displayValue(draft.versions.plugin) }),
    t("- 宿主：{p0}", { p0: displayValue(draft.versions.host) }),
    '',
    t("## 步骤"),
    '',
    ...draft.steps.map((step, index) => `${index + 1}. [${STATUS_LABELS[step.status]}] ${escapeMarkdown(step.name)}`),
    '',
    t("## 限制"),
    '',
    ...(draft.limitations.length > 0
      ? draft.limitations.map((item) => `- ${escapeMarkdown(item)}`)
      : [t("- 未填写")]),
    '',
  ];
  return lines.join('\n');
}

export function createSharingCopyPayload(input) {
  return Object.freeze({
    text: renderSharingExperiencePreview(input),
    mimeType: 'text/plain;charset=utf-8',
    copied: false,
    businessOutcome: 'unchanged',
  });
}

function makeElement(document, tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text) element.textContent = options.text;
  if (options.type) element.type = options.type;
  return element;
}

function addLabeledInput(document, parent, labelText, value) {
  const label = makeElement(document, 'label', { className: 'sharing-experience-field' });
  const caption = makeElement(document, 'span', { text: labelText });
  const input = makeElement(document, 'input');
  input.value = value;
  label.append(caption, input);
  parent.append(label);
  return input;
}

export function mount(root, { openDraft, showMessage } = {}) {
  if (!root || typeof root.replaceChildren !== 'function' || !root.ownerDocument) {
    throw new SharingExperienceError('INVALID_ROOT', 'root', t("root 必须是可挂载的 DOM 元素"));
  }
  const document = root.ownerDocument;
  let draft = createSharingExperienceFromTemplate('companyProfile');

  const container = makeElement(document, 'section', { className: 'sharing-experience' });
  container.setAttribute('aria-label', t("分享使用体验草稿"));
  const heading = makeElement(document, 'h2', { text: t("分享使用体验") });
  const intro = makeElement(document, 'p', {
    text: t("只整理你主动填写的内容；不会读取对话、工具返回或真实连接。"),
  });
  const form = makeElement(document, 'div', { className: 'sharing-experience-form' });
  const templateLabel = makeElement(document, 'label', { className: 'sharing-experience-field' });
  templateLabel.append(makeElement(document, 'span', { text: t("任务模板") }));
  const template = makeElement(document, 'select');
  for (const [value, item] of Object.entries(SHARING_CASE_TEMPLATES)) {
    const option = makeElement(document, 'option', { text: item.task });
    option.value = value;
    template.append(option);
  }
  let activeTemplateId = 'companyProfile';
  template.value = activeTemplateId;
  templateLabel.append(template);
  form.append(templateLabel);
  const task = addLabeledInput(document, form, t("任务"), draft.task);
  const dshVersion = addLabeledInput(document, form, t("DSH 版本"), draft.versions.dsh);
  const pluginVersion = addLabeledInput(document, form, t("插件版本"), draft.versions.plugin);
  const host = addLabeledInput(document, form, t("宿主"), draft.versions.host);
  const steps = makeElement(document, 'div', { className: 'sharing-experience-steps' });
  const limitationsLabel = makeElement(document, 'label', { className: 'sharing-experience-field' });
  limitationsLabel.append(makeElement(document, 'span', { text: t("限制（每行一项）") }));
  const limitations = makeElement(document, 'textarea');
  limitations.value = draft.limitations.join('\n');
  limitationsLabel.append(limitations);
  form.append(steps, limitationsLabel);

  const actions = makeElement(document, 'div', { className: 'sharing-experience-actions' });
  const previewButton = makeElement(document, 'button', { type: 'button', text: t("生成预览") });
  const copyButton = makeElement(document, 'button', { type: 'button', text: t("复制到会话草稿") });
  copyButton.disabled = typeof openDraft !== 'function';
  const message = makeElement(document, 'p', { className: 'sharing-experience-message' });
  message.setAttribute('role', 'status');
  const preview = makeElement(document, 'pre', { className: 'sharing-experience-preview' });
  actions.append(previewButton, copyButton);
  container.append(heading, intro, form, actions, message, preview);

  function notify(text, type = 'info') {
    message.textContent = text;
    if (typeof showMessage === 'function') {
      try {
        showMessage(text, type);
      } catch {
        // Host notification failures must not mutate or auto-send the draft.
      }
    }
  }

  function renderStepControls() {
    steps.replaceChildren();
    draft.steps.forEach((step, index) => {
      const row = makeElement(document, 'div', { className: 'sharing-experience-step' });
      const name = addLabeledInput(document, row, t("步骤 {p0}", { p0: index + 1 }), step.name);
      name.dataset.stepName = String(index);
      const label = makeElement(document, 'label', { className: 'sharing-experience-field' });
      label.append(makeElement(document, 'span', { text: t("状态") }));
      const select = makeElement(document, 'select');
      select.dataset.stepStatus = String(index);
      for (const value of SHARING_STEP_STATUSES) {
        const option = makeElement(document, 'option', { text: STATUS_LABELS[value] });
        option.value = value;
        option.selected = value === step.status;
        select.append(option);
      }
      label.append(select);
      row.append(label);
      steps.append(row);
    });
  }

  function readDraft() {
    const nextSteps = draft.steps.map((step, index) => ({
      name: steps.querySelector(`[data-step-name="${index}"]`).value,
      status: steps.querySelector(`[data-step-status="${index}"]`).value,
    }));
    return createSharingExperience({
      task: task.value,
      versions: { dsh: dshVersion.value, plugin: pluginVersion.value, host: host.value },
      steps: nextSteps,
      limitations: limitations.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    });
  }

  function updatePreview() {
    try {
      draft = readDraft();
      preview.textContent = renderSharingExperiencePreview(draft);
      notify(t("预览已更新；尚未复制、发送或发布。"));
      return draft;
    } catch (error) {
      notify(error instanceof SharingExperienceError ? error.message : t("无法生成预览"), 'error');
      throw error;
    }
  }

  function handleTemplateChange() {
    const requestedTemplateId = template.value;
    try {
      const versions = { dsh: dshVersion.value, plugin: pluginVersion.value, host: host.value };
      const nextDraft = createSharingExperienceFromTemplate(requestedTemplateId, versions);
      draft = nextDraft;
      activeTemplateId = requestedTemplateId;
      task.value = draft.task;
      limitations.value = draft.limitations.join('\n');
      renderStepControls();
      preview.textContent = renderSharingExperiencePreview(draft);
      notify(t("已载入公开教程模板；所有步骤保持“未测试”，请按实际情况编辑。"));
    } catch (error) {
      template.value = activeTemplateId;
      const reason = error instanceof SharingExperienceError ? error.message : t("无法载入所选模板");
      notify(t("{reason}；模板未切换，请纠正后重试。", { reason: reason }), 'error');
    }
  }

  function handlePreviewClick() {
    try {
      updatePreview();
    } catch {
      // The status message already gives the user a bounded correction path.
    }
  }

  async function handleCopyClick() {
    try {
      const current = updatePreview();
      const payload = createSharingCopyPayload(current);
      if (typeof openDraft !== 'function') {
        throw new SharingExperienceError('OPEN_DRAFT_UNAVAILABLE', 'openDraft', t("当前宿主无法打开会话草稿"));
      }
      await openDraft(payload.text);
      notify(t("草稿已带入会话输入框但尚未发送；这不代表连接、工具发现或业务调用成功。"), 'success');
    } catch (error) {
      notify(error instanceof SharingExperienceError ? error.message : t("无法打开会话草稿，请保留当前预览"), 'error');
    }
  }

  template.addEventListener('change', handleTemplateChange);
  previewButton.addEventListener('click', handlePreviewClick);
  copyButton.addEventListener('click', handleCopyClick);

  renderStepControls();
  preview.textContent = renderSharingExperiencePreview(draft);
  root.replaceChildren(container);

  return function dispose() {
    template.removeEventListener('change', handleTemplateChange);
    previewButton.removeEventListener('click', handlePreviewClick);
    copyButton.removeEventListener('click', handleCopyClick);
    if (container.parentNode === root) root.replaceChildren();
  };
}
