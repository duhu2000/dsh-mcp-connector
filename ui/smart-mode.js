import EN from './smart-mode-en.js';
const english = new URL(window.location.href).searchParams.get('uiLocale') === 'en';
document.documentElement.lang = english ? 'en' : 'zh-CN';
const t = (text, params = {}) => (english ? EN[text] ?? text : text).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (all, key) => params[key] ?? all);
if (english) {
  document.title = t(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const key = node.textContent.trim();
    if (Object.hasOwn(EN, key)) node.textContent = node.textContent.replace(key, EN[key]);
  }
  for (const input of document.querySelectorAll('[placeholder]')) input.placeholder = t(input.placeholder);
}
const $ = (id) => document.getElementById(id);
let state, inspected, capabilityId, pending;
const nonce = document.querySelector('meta[name="control-nonce"]').content;
async function rpc(method, params = {}) {
  const response = await fetch('./api', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mcp-control-nonce': nonce }, body: JSON.stringify({ method, params }) });
  const value = await response.json();
  if (!response.ok || value.ok !== true) throw new Error(value.code ?? '请求失败');
  return value.result;
}
const message = (text, error = false) => { $('notice').textContent = text; $('notice').dataset.error = String(error); };
const errors = { NATIVE_COMPACT_FAILED: '压缩未完成，结果已记录在会话日志中。请检查当前上下文后重试。',
  CONTROL_PREVIEW_EXPIRED: '预览已过期或已使用，请重新预览。', CONTROL_PREVIEW_STALE: '定义或会话已变化，请重新核对。',
  READ_ONLY_APPROVAL_REQUIRED: '未通过服务端独立只读核验，记录未启用。', CONTROL_REQUIRES_IDLE_AGENT: '会话正在处理任务，请等待结束后重试。' };
const run = (fn) => async () => { try { await fn(); } catch (error) { message(t(errors[error.message] ?? error.message), true); } };
const selected = () => ({ sessionId: $('session').value });
async function refresh() {
  const previous = $('session').value;
  state = await rpc('state'); $('scope').textContent = t(state.scopeLabel);
  $('mode').textContent = t('当前默认：{mode} · 智能层{status}', { mode: t(state.defaultMode === 'smart' ? '智能模式' : '兼容模式'), status: t(state.mounted ? '已启用' : '已停用') });
  $('layer').textContent = t(state.mounted ? '停用智能层' : '恢复智能层');
  $('session').replaceChildren(...state.sessions.map((entry) => {
    const option = document.createElement('option'); option.value = entry.sessionId;
    option.textContent = `${entry.title} · ${entry.mode} · ${t('已准备 {count}', { count: entry.preparedCount })}`; return option;
  }));
  if (state.sessions.some((entry) => entry.sessionId === previous)) $('session').value = previous;
  inspected = undefined; $('inspection').hidden = true; $('sources').replaceChildren();
}
async function preview(method, params) {
  pending = await rpc(method, params); const summary = { ...pending.summary };
  if (summary.scope) summary.scope = t(summary.scope);
  $('preview-text').textContent = JSON.stringify(summary, null, 2); $('preview').showModal();
}
$('enable').onclick = run(() => preview('previewMode', { mode: 'smart', expectedRevision: state.policyRevision }));
$('disable').onclick = run(() => preview('previewMode', { mode: 'compat', expectedRevision: state.policyRevision }));
$('confirm').onclick = run(async () => { const value = pending; pending = undefined; $('preview').close(); await rpc('commit', { previewId: value.previewId }); message(t('变更已保存')); await refresh(); });
$('cancel').onclick = () => { pending = undefined; $('preview').close(); };
$('layer').onclick = run(async () => { await rpc('layer', { enabled: !state.mounted }); message(t('智能层状态已更新')); await refresh(); });
for (const method of ['create', 'resume', 'compact']) $(method).onclick = run(async () => {
  const result = await rpc(method, method === 'create' ? {} : selected()); await refresh();
  if (result?.sessionId) $('session').value = result.sessionId; message(t('会话操作已完成'));
});
$('clear').onclick = run(async () => { if (!window.confirm(t('清空可见上下文并释放已准备工具？历史日志仍保留。'))) return;
  await rpc('clear', selected()); await refresh(); message(t('可见上下文已清空，历史日志保留')); });
$('session').onchange = () => { inspected = undefined; $('inspection').hidden = true; $('sources').replaceChildren(); };
$('search').onclick = run(async () => {
  const result = await rpc('search', { ...selected(), query: $('query').value }); $('sources').replaceChildren();
  for (const item of result.items) {
    for (const source of [item, ...item.aliases ?? []]) {
    const row = document.createElement('div'); row.className = 'row';
    const button = document.createElement('button'); button.textContent = t('{name} · 查看', { name: source.publicName });
    button.onclick = run(async () => {
      inspected = await rpc('inspect', { ...selected(), sourceId: source.sourceId }); capabilityId = item.capabilityId;
      $('inspection').hidden = false; $('tool-name').textContent = source.publicName;
      $('fingerprint').textContent = t('定义指纹：{fingerprint}', { fingerprint: inspected.source.definitionFingerprint });
      $('definition').textContent = JSON.stringify(inspected.definition, null, 2);
      $('review-state').textContent = inspected.persistedReview ? t('记录版本 {revision} · {status}', { revision: inspected.persistedReview.revision,
        status: t(inspected.persistedReview.review.enabled ? '已启用' : '已撤回') }) : t('当前定义没有持久化只读核验');
    }); row.append(button);
    if (source.sourceId !== item.sourceId) {
      const compare = document.createElement('button'); compare.textContent = t('本会话比较此来源与首选');
      compare.onclick = run(() => preview('previewSource', { ...selected(), capabilityId: item.capabilityId,
        kind: 'compare', sourceIds: [item.sourceId, source.sourceId] })); row.append(compare);
    }
    $('sources').append(row);
    }
  }
  message(t('找到 {count} 项能力', { count: result.total }));
});
$('source').onclick = run(() => preview('previewSource', { ...selected(), capabilityId, kind: 'source', sourceIds: [inspected.source.sourceId] }));
for (const [id, enabled] of [['review', true], ['revoke', false]]) $(id).onclick = run(() => preview('previewReview', {
  ...selected(), sourceId: inspected.source.sourceId, enabled,
  evidenceHash: enabled ? $('evidence').value : inspected.persistedReview?.review.review.evidenceHash ?? $('evidence').value,
  validForMs: Number($('hours').value) * 3600000, expectedRevision: inspected.persistedReview?.revision ?? 0,
}));
await run(refresh)();
