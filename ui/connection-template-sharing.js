import { t } from './locale.js';
const FORMAT = 'dsh-mcp-connector.share-template';
const VERSION = 1;
const REDACTED = '<REDACTED:REENTER>';
const INSTRUCTIONS = '导入前必须在本机重新填写所有 <REDACTED:REENTER> 值并显式确认；目录引用请回到市场重新授权或确认启动。';
const CUSTOM_NAME = '自定义 MCP 连接';
const CUSTOM_SERVER_NAME = 'custom-mcp';
const API_KEY_HEADERS = new Map([
  ['x-api-key', 'X-Api-Key'],
  ['api-key', 'Api-Key'],
  ['apikey', 'ApiKey'],
  ['x-auth-token', 'X-Auth-Token'],
]);

function isoTime(value) {
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError(t("生成时间无效"));
  return date.toISOString();
}

function identifier(value, field) {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(text)) {
    throw new TypeError(t("{field} 必须是公开目录标识", { field: field }));
  }
  return text;
}

function publicName(value) {
  const text = String(value ?? '');
  if (!text.trim() || text !== text.trim() || [...text].length > 80
    || /[\u0000-\u001f\u007f\\/]|^[A-Za-z]:|file:/i.test(text)) {
    throw new TypeError(t("名称必须是 1–80 字符的公开名称，不得包含路径或控制字符"));
  }
  return text;
}

function canonicalServerName(value) {
  const text = String(value ?? '');
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/.test(text)) {
    throw new TypeError(t("serverName 必须是已规范化的小写 ASCII 名称"));
  }
  return text;
}

function documentBase(generatedAt) {
  return {
    format: FORMAT,
    version: VERSION,
    generatedAt: isoTime(generatedAt),
    redacted: true,
    instructions: INSTRUCTIONS,
  };
}

function normalizeCatalogReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(t("公开目录引用无效"));
  }
  return Object.freeze({
    connectorId: identifier(value.connectorId, 'connectorId'),
    serverKey: identifier(value.serverKey, 'serverKey'),
    name: publicName(value.name),
    serverName: canonicalServerName(value.serverName),
  });
}

/**
 * 只从宿主注入的已审计、已发布目录引用白名单中选取。
 * 用户不能粘贴 descriptor、URL、Header、OAuth 状态或 CLI。
 */
export function createCatalogReferenceTemplate(catalogReferences, {
  connectorId,
  serverKey,
  generatedAt,
} = {}) {
  if (!Array.isArray(catalogReferences)) throw new TypeError(t("必须提供受信任的公开目录引用白名单"));
  const safeConnectorId = identifier(connectorId, 'connectorId');
  const safeServerKey = identifier(serverKey, 'serverKey');
  const matches = catalogReferences
    .map(normalizeCatalogReference)
    .filter((item) => item.connectorId === safeConnectorId && item.serverKey === safeServerKey);
  if (matches.length !== 1) throw new TypeError(t("所选 Connector 不在已审计的公开目录白名单中"));
  const reference = matches[0];
  return {
    ...documentBase(generatedAt),
    source: { kind: 'catalog', connectorId: reference.connectorId, serverKey: reference.serverKey },
    connections: [],
    catalogConnections: [{ ...reference, action: 'connect-from-catalog' }],
  };
}

/**
 * 生成不携带任何原始 URL/名称的自定义 HTTP 重填模板。
 * 用户不需要也不应该把真实凭据或端点粘贴到这个界面。
 */
export function createCustomHttpTemplate({
  authMode = 'none',
  apiKeyHeader = 'X-Api-Key',
  generatedAt,
} = {}) {
  if (!['none', 'bearer', 'api-key'].includes(authMode)) {
    throw new TypeError(t("自定义模板只支持 none、bearer 或 api-key"));
  }
  const connection = {
    name: CUSTOM_NAME,
    serverName: CUSTOM_SERVER_NAME,
    transport: 'streamable-http',
    url: REDACTED,
    headers: {},
    authMode,
    redactedFields: ['url'],
  };
  if (authMode === 'bearer') {
    connection.bearerToken = REDACTED;
    connection.redactedFields.push('bearerToken');
  }
  if (authMode === 'api-key') {
    const safeHeader = API_KEY_HEADERS.get(String(apiKeyHeader ?? '').trim().toLowerCase());
    if (!safeHeader) throw new TypeError(t("API Key Header 只能选择通用公开名称"));
    connection.apiKeyHeader = safeHeader;
    connection.apiKeyValue = REDACTED;
    connection.redactedFields.push('apiKeyValue');
  }
  return {
    ...documentBase(generatedAt),
    source: { kind: 'user-provided' },
    connections: [connection],
    catalogConnections: [],
  };
}

export function stringifySafeTemplate(value) {
  return JSON.stringify(value, null, 2);
}

function field(document, labelText, role, type = 'input') {
  const label = document.createElement('label');
  label.className = 'mcp-safe-template-share__field';
  const text = document.createElement('span');
  text.textContent = labelText;
  const control = document.createElement(type);
  control.dataset.role = role;
  label.append(text, control);
  return { label, control };
}

function option(document, value, text) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = text;
  return item;
}

async function defaultCopyText(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) throw new Error(t("当前环境不支持剪贴板，请使用下载"));
  await clipboard.writeText(text);
}

function defaultDownloadText(text, filename, document) {
  if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
    throw new Error(t("当前环境不支持下载，请使用复制"));
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 纯前端安全模板生成器。只处理用户在本界面选择的公开白名单项或鉴权类型。
 * 返回 dispose 函数。
 */
export function mount(container, {
  openDraft,
  showMessage,
  copyText = defaultCopyText,
  downloadText,
  catalogReferences = [],
  now = () => Date.now(),
} = {}) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError(t("container 必须是可挂载的 DOM 元素"));
  }
  if (typeof openDraft !== 'function') throw new TypeError(t("openDraft 必须是函数"));
  if (typeof copyText !== 'function') throw new TypeError(t("copyText 必须是函数"));
  const notify = typeof showMessage === 'function' ? showMessage : () => {};
  const document = container.ownerDocument ?? globalThis.document;
  const saveText = typeof downloadText === 'function'
    ? downloadText
    : (text, filename) => defaultDownloadText(text, filename, document);
  const trustedCatalog = catalogReferences.map(normalizeCatalogReference);
  const root = document.createElement('section');
  root.className = 'mcp-safe-template-share';

  const style = document.createElement('style');
  style.textContent = `
    .mcp-safe-template-share{border:1px solid var(--mcp-border,#e5e7eb);border-radius:12px;padding:14px;display:grid;gap:12px;background:var(--mcp-card,#fff)}
    .mcp-safe-template-share h3{font-size:15px;margin:0;color:var(--mcp-text,#111827)}
    .mcp-safe-template-share p,.mcp-safe-template-share span{font-size:13px;line-height:1.6;margin:0;color:var(--mcp-muted,#667085)}
    .mcp-safe-template-share__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .mcp-safe-template-share__field{display:grid;gap:4px}
    .mcp-safe-template-share input,.mcp-safe-template-share select{min-width:0;border:1px solid var(--mcp-border,#d0d5dd);border-radius:8px;padding:8px;background:var(--mcp-card,#fff);color:var(--mcp-text,#111827)}
    .mcp-safe-template-share__actions{display:flex;gap:8px;flex-wrap:wrap}
    .mcp-safe-template-share button{border:0;border-radius:8px;padding:8px 12px;font:inherit;font-weight:600;cursor:pointer;background:var(--mcp-primary,#4f46e5);color:#fff}
    .mcp-safe-template-share button:disabled{cursor:not-allowed;opacity:.5}
    .mcp-safe-template-share button:focus-visible{outline:2px solid var(--mcp-focus,#2563eb);outline-offset:2px}
    .mcp-safe-template-share pre{max-height:260px;overflow:auto;margin:0;padding:10px;border-radius:8px;background:var(--mcp-code,#f7f8fa);white-space:pre-wrap;word-break:break-word}
    @media(max-width:640px){.mcp-safe-template-share__grid{grid-template-columns:1fr}}
  `;
  const title = document.createElement('h3');
  title.textContent = t("安全分享连接模板");
  const copy = document.createElement('p');
  copy.textContent = t("仅生成已审计公开目录引用或全重填的自定义 HTTP 模板；请勿在此粘贴 URL、Token、Header 值或业务数据。");

  const modeField = field(document, t("模板来源"), 'mode', 'select');
  modeField.control.append(option(document, 'custom', t("自定义 HTTP（URL 和凭据全部重填）")));
  if (trustedCatalog.length > 0) modeField.control.append(option(document, 'catalog', t("已审计公开 Connector 目录引用")));
  modeField.control.value = 'custom';

  const customGrid = document.createElement('div');
  customGrid.className = 'mcp-safe-template-share__grid';
  customGrid.dataset.role = 'custom-fields';
  const authField = field(document, t("鉴权类型"), 'auth-mode', 'select');
  authField.control.append(
    option(document, 'none', t("无鉴权")),
    option(document, 'bearer', 'Bearer Token'),
    option(document, 'api-key', 'API Key'),
  );
  authField.control.value = 'none';
  const headerField = field(document, 'API Key Header', 'api-key-header', 'select');
  for (const value of API_KEY_HEADERS.values()) headerField.control.append(option(document, value, value));
  headerField.control.value = 'X-Api-Key';
  headerField.label.hidden = true;
  customGrid.append(authField.label, headerField.label);

  const catalogGrid = document.createElement('div');
  catalogGrid.className = 'mcp-safe-template-share__grid';
  catalogGrid.dataset.role = 'catalog-fields';
  catalogGrid.hidden = true;
  const catalogField = field(document, t("已审计 Connector / Server"), 'catalog-reference', 'select');
  trustedCatalog.forEach((item, index) => {
    catalogField.control.append(option(document, String(index), `${item.name} · ${item.serverName}`));
  });
  catalogField.control.value = trustedCatalog.length > 0 ? '0' : '';
  catalogGrid.append(catalogField.label);

  const actions = document.createElement('div');
  actions.className = 'mcp-safe-template-share__actions';
  const previewButton = document.createElement('button');
  previewButton.type = 'button';
  previewButton.dataset.role = 'preview';
  previewButton.textContent = t("生成安全预览");
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.dataset.role = 'copy';
  copyButton.textContent = t("复制 JSON");
  copyButton.disabled = true;
  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.dataset.role = 'download';
  downloadButton.textContent = t("下载 JSON");
  downloadButton.disabled = true;
  const draftButton = document.createElement('button');
  draftButton.type = 'button';
  draftButton.dataset.role = 'draft';
  draftButton.textContent = t("带入新会话检查");
  draftButton.disabled = true;
  actions.append(previewButton, copyButton, downloadButton, draftButton);

  const output = document.createElement('pre');
  output.dataset.role = 'output';
  output.hidden = true;
  root.append(style, title, copy, modeField.label, customGrid, catalogGrid, actions, output);
  container.replaceChildren(root);

  let disposed = false;
  let previewText = '';
  let revision = 0;
  const running = new Set();
  const listeners = [];
  const on = (target, event, handler) => {
    target.addEventListener(event, handler);
    listeners.push([target, event, handler]);
  };
  const message = (text, type) => {
    if (!disposed) notify(text, type);
  };
  const setPreview = (text) => {
    previewText = text;
    output.textContent = text;
    output.hidden = !text;
    for (const button of [copyButton, downloadButton, draftButton]) button.disabled = !text;
  };
  const invalidate = () => {
    revision += 1;
    setPreview('');
  };
  const runExclusive = async (button, operation, successMessage) => {
    if (disposed || !previewText || running.has(button)) return;
    running.add(button);
    button.disabled = true;
    const operationRevision = revision;
    try {
      await operation(previewText);
      if (!disposed && operationRevision === revision) message(successMessage, 'success');
    } catch (error) {
      if (!disposed && operationRevision === revision) {
        message(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      running.delete(button);
      if (!disposed && operationRevision === revision && previewText) button.disabled = false;
    }
  };

  on(modeField.control, 'change', () => {
    const catalog = modeField.control.value === 'catalog';
    customGrid.hidden = catalog;
    catalogGrid.hidden = !catalog;
    invalidate();
  });
  on(authField.control, 'change', () => {
    headerField.label.hidden = authField.control.value !== 'api-key';
    invalidate();
  });
  on(headerField.control, 'change', invalidate);
  on(catalogField.control, 'change', invalidate);
  on(previewButton, 'click', () => {
    if (disposed) return;
    try {
      const selected = trustedCatalog[Number(catalogField.control.value)];
      const template = modeField.control.value === 'catalog'
        ? createCatalogReferenceTemplate(trustedCatalog, {
          connectorId: selected?.connectorId,
          serverKey: selected?.serverKey,
          generatedAt: now(),
        })
        : createCustomHttpTemplate({
          authMode: authField.control.value,
          apiKeyHeader: headerField.control.value,
          generatedAt: now(),
        });
      revision += 1;
      setPreview(stringifySafeTemplate(template));
      message(t("已生成本地安全预览，尚未复制、下载或带入会话。"), 'success');
    } catch (error) {
      invalidate();
      message(error instanceof Error ? error.message : String(error), 'error');
    }
  });
  on(copyButton, 'click', () => runExclusive(copyButton, copyText, t("已复制安全模板 JSON。")));
  on(downloadButton, 'click', () => runExclusive(
    downloadButton,
    (text) => saveText(text, 'mcp-connection-template.json'),
    t("已下载安全模板 JSON。"),
  ));
  on(draftButton, 'click', () => runExclusive(
    draftButton,
    openDraft,
    t("已将安全 JSON 带入新会话草稿；未自动发送。"),
  ));

  return function dispose() {
    if (disposed) return;
    disposed = true;
    revision += 1;
    for (const [target, event, handler] of listeners) target.removeEventListener(event, handler);
    running.clear();
    previewText = '';
    if (root.parentNode === container) container.replaceChildren();
  };
}

export const SAFE_TEMPLATE_FORMAT = FORMAT;
export const SAFE_TEMPLATE_VERSION = VERSION;
export const SAFE_TEMPLATE_INSTRUCTIONS = INSTRUCTIONS;
