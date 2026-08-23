import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const uiSource = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

test('界面固定为中文且不提供语言切换入口', () => {
  assert.match(uiSource, /<html lang="zh-CN">/);
  assert.doesNotMatch(uiSource, /id="locale-toggle"/);
  assert.doesNotMatch(uiSource, /mcp-connector:locale/);
  assert.doesNotMatch(uiSource, /Switch language|>EN<\/button>|Sending…/);
  assert.doesNotMatch(uiSource, /data-i18n/);
  assert.match(uiSource, /const LABELS = \{[\s\S]*?details: '详情'/);
});

test('内置 Prompt 有默认值时直接发送，无默认值才补全参数', () => {
  assert.match(uiSource, /function promptNeedsInput\(prompt\)/);
  assert.match(uiSource, /if \(!promptNeedsInput\(prompt\)\) \{\s*window\.__mcp\.sendPrompt\(renderResolvedPrompt\(prompt, \{\}\)\)/);
  assert.match(uiSource, /t\(promptNeedsInput\(prompt\) \? 'fillSend' : 'send'\)/);
});

test('参数弹框与发送提示位于详情弹框之上', () => {
  assert.match(uiSource, /\.detail-overlay \{[\s\S]*?z-index: 100;/);
  assert.match(uiSource, /\.modal-mask \{[^}]*z-index: 200;/);
  assert.match(uiSource, /\.toast \{[\s\S]*?z-index: 300;/);
});

test('JSON 导入提供缩进示例、格式化和简洁的本机安全说明', () => {
  assert.match(uiSource, /const MCP_JSON_EXAMPLE = JSON\.stringify\([\s\S]*?null, 2\)/);
  assert.match(uiSource, /formatImportJson\(silent = false\)/);
  assert.match(uiSource, /配置和凭据仅保存在 DSH 本机/);
  assert.doesNotMatch(uiSource, /JSON 导入后进入「已安装」/);
  assert.match(uiSource, />市场卡片<\/button>/);
});

test('添加连接默认打开 JSON 且首屏操作按钮保持可见', () => {
  assert.match(uiSource, /function openAddConnection\(mode = 'json'/);
  assert.match(uiSource, /#add-connection'\)\.addEventListener\('click', \(\) => openAddConnection\('json'\)\)/);
  assert.ok(uiSource.indexOf('>导入 JSON</button>') < uiSource.indexOf('>手动配置</button>'));
  assert.match(uiSource, /id="import-json" rows="8"/);
  assert.match(uiSource, /\.modal \.m-actions \{[\s\S]*?position: sticky; bottom: 0;/);
});

test('手动配置支持 stdio 并区分 URL 与本地进程字段', () => {
  assert.match(uiSource, /<option value="stdio">stdio（本地进程）<\/option>/);
  assert.match(uiSource, /id="cfg-command"/);
  assert.match(uiSource, /id="cfg-args"/);
  assert.match(uiSource, /id="cfg-env"/);
  assert.match(uiSource, /function|syncTransportFields/);
  assert.match(uiSource, /transport === 'stdio' \? 'none' : authMode/);
  assert.match(uiSource, /stdio 工具已由 DSH Host 注册；当前市场详情没有目录快照/);
});

test('凭据型市场卡片提供多 Server 一次配置表单', () => {
  assert.match(uiSource, /function openCatalogCredentialForm\(preset\)/);
  assert.match(uiSource, /一次配置 \$\{servers\.length\} 个 MCP Server/);
  assert.match(uiSource, /preset\.credentialName/);
  assert.match(uiSource, /preset\.credentialPlaceholder/);
  assert.match(uiSource, /preset\.credentialDescription/);
  assert.match(uiSource, /preset\.credentialHelpLabel/);
  assert.match(uiSource, /connectorId,\s*authMode,\s*bearerToken/);
});

test('详情页的 Bearer/API Key 连接按钮直接打开凭据表单', () => {
  const trySource = uiSource.match(/\$\('#detail-try-btn'\)\.addEventListener\('click', async \(\) => \{[\s\S]*?\n  \}\);/)?.[0] ?? '';
  assert.match(trySource, /\['bearer', 'api-key'\]\.includes\(detailConnector\.authMode\)/);
  assert.match(trySource, /openAddConnection\('manual', detailConnector\)/);
  assert.ok(trySource.indexOf("openAddConnection('manual', detailConnector)") < trySource.indexOf("call('connect'"));
  assert.match(uiSource, /configureConnect: '🔑 录入凭据并连接'/);
  assert.match(uiSource, /configuredFromDetail[\s\S]*?closeDetail\(\)/);
  assert.match(uiSource, /正在验证凭据与连接…/);
  assert.match(uiSource, /detailNeedsReconfigure[\s\S]*?reconfigureCredential/);
  assert.match(uiSource, /detailConnector\?\.connected\?\.length > 0 && !detailNeedsReconfigure/);
  assert.match(uiSource, /当前连接异常/);
  assert.match(uiSource, /授权已失效/);
  assert.match(uiSource, /重新检查/);
});

test('市场卡片区分已配置、已连接、重新授权和连接异常', () => {
  const actionSource = uiSource.match(/function actionHtml\(d\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(actionSource, /state === 'healthy'[\s\S]*?t\('connected'\)/);
  assert.match(actionSource, /state === 'configured'[\s\S]*?t\('configured'\)/);
  assert.match(actionSource, /state === 'reauth'[\s\S]*?t\('reauthorize'\)/);
  assert.match(actionSource, /state === 'unavailable'[\s\S]*?t\('connectionError'\)/);
  assert.match(uiSource, /call\('healthCheck', \{\}\)/);
});

test('市场支持服务商与接入方式组合筛选', () => {
  assert.match(uiSource, /aria-label="市场筛选"/);
  assert.match(uiSource, /id="market-vendor-filter" aria-label="按服务商筛选"/);
  assert.match(uiSource, /const AUTH_FILTERS = \[[\s\S]*?OAuth[\s\S]*?Key \/ Token[\s\S]*?免密/);
  assert.match(uiSource, /if \(marketAuth === 'credential'\) return \['bearer', 'api-key'\]\.includes\(d\.authMode\)/);
  assert.match(uiSource, /items\.filter\(matchesMarketFilters\)/);
  assert.match(uiSource, /data-auth-filter=/);
  assert.match(uiSource, /id="market-filter-reset"/);
  assert.match(uiSource, /main\.addEventListener\('change',[\s\S]*?market-vendor-filter/);
});

test('市场支持分类筛选与推荐位（9 分类 + 推荐）', () => {
  assert.match(uiSource, /const CATEGORIES = \[/);
  assert.match(uiSource, /value: 'recommended', label: '推荐'/);
  assert.match(uiSource, /value: '企业数据', label: '企业数据'/);
  assert.match(uiSource, /value: '金融投资', label: '金融投资'/);
  assert.match(uiSource, /value: '效率工具', label: '效率工具'/);
  assert.match(uiSource, /function normalizeCategory\(c\)/);
  assert.match(uiSource, /CATEGORY_MAP\[c\] \|\| '其他'/);
  assert.match(uiSource, /marketCategory === 'recommended' && !d\.featured/);
  assert.match(uiSource, /normalizeCategory\(d\.category\) !== marketCategory/);
  assert.match(uiSource, /data-category-filter=/);
  assert.match(uiSource, /\.category-chips/);
  assert.match(uiSource, /let marketCategory = '';/);
});

test('工具清单使用中文计数并标记服务商弃用工具', () => {
  assert.match(uiSource, /\$\('#tools-summary'\)\.textContent = `\$\{detailToolServers\.length\} 个服务 · \$\{totalTools\} 个工具`/);
  assert.match(uiSource, /function isDeprecatedTool\(tool\)/);
  assert.match(uiSource, /deprecated/);
  assert.match(uiSource, /已弃用\|已废弃\|不再推荐/);
  assert.match(uiSource, /<span class="tool-deprecated">已弃用<\/span>/);
  assert.match(uiSource, /Number\(isDeprecatedTool\(left\)\) - Number\(isDeprecatedTool\(right\)\)/);
});
