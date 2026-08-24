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
  assert.match(uiSource, /preset\.credentialFields/);
  assert.match(uiSource, /data-credential-key=/);
  assert.match(uiSource, /field\.secret === false \? 'text' : 'password'/);
  assert.match(uiSource, /connectorId,\s*authMode,\s*credentialValues,\s*bearerToken/);
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

test('未连接且无工具快照的市场卡片不误报连接异常', () => {
  assert.match(uiSource, /if \(!d\.connected\?\.length && !d\.toolsSnapshot\?\.length\)/);
  assert.match(uiSource, /连接后查看工具/);
  assert.match(uiSource, /连接后可读取服务端工具清单/);
  assert.ok(
    uiSource.indexOf('if (!d.connected?.length && !d.toolsSnapshot?.length)') < uiSource.indexOf("const toolsResult = await call('toolsList', { connectorId })"),
  );
});

test('市场卡片区分已配置、已连接、重新授权和连接异常', () => {
  const actionSource = uiSource.match(/function actionHtml\(d\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(actionSource, /state === 'healthy'[\s\S]*?t\('connected'\)/);
  assert.match(actionSource, /state === 'configured'[\s\S]*?t\('configured'\)/);
  assert.match(actionSource, /state === 'reauth'[\s\S]*?t\('reauthorize'\)/);
  assert.match(actionSource, /state === 'unavailable'[\s\S]*?t\('connectionError'\)/);
  assert.match(uiSource, /call\('healthCheck', \{\}\)/);
});

test('市场只保留推荐与业务分类筛选', () => {
  assert.match(uiSource, /aria-label="市场分类"/);
  assert.match(uiSource, /items\.filter\(matchesMarketFilters\)/);
  assert.doesNotMatch(uiSource, /marketVendor|marketAuth|AUTH_FILTERS/);
  assert.doesNotMatch(uiSource, /market-vendor-filter|data-auth-filter|market-filter-reset/);
  assert.doesNotMatch(uiSource, /服务商<\/span>|接入方式<\/span>|全部服务商|全部接入|Key \/ Token|免密/);
});

test('市场支持分类筛选与推荐位（9 分类 + 推荐）', () => {
  assert.match(uiSource, /const CATEGORIES = \[/);
  assert.match(uiSource, /value: 'recommended', label: '推荐'/);
  for (const category of ['企业数据', '金融投资', '法律合规', '开发工具', '办公协作', '调研分析', '设计创意', '效率工具', '其他']) {
    assert.match(uiSource, new RegExp(`value: '${category}', label: '${category}'`));
  }
  assert.match(uiSource, /function normalizeCategory\(c\)/);
  assert.match(uiSource, /CATEGORY_MAP\[c\] \|\| '其他'/);
  assert.match(uiSource, /marketCategory === 'recommended' && !d\.featured/);
  assert.match(uiSource, /normalizeCategory\(d\.category\) !== marketCategory/);
  assert.match(uiSource, /data-category-filter=/);
  assert.match(uiSource, /\.category-chips/);
  assert.match(uiSource, /let marketCategory = '';/);
});

test('全部市场按分类分章节，每章默认展示 4 个并可展开', () => {
  assert.match(uiSource, /const MARKET_SECTION_PREVIEW_LIMIT = 4;/);
  assert.match(uiSource, /function groupedMarketHtml\(items\)/);
  assert.match(uiSource, /value: 'recommended', label: '推荐', items:/);
  assert.match(uiSource, /items\.slice\(0, MARKET_SECTION_PREVIEW_LIMIT\)/);
  assert.match(uiSource, /data-section-toggle=/);
  assert.match(uiSource, /查看全部 \$\{items\.length\} 个/);
  assert.match(uiSource, /filtered\.map\(cardHtml\)/, '点击分类后应展示该分类全部卡片');
  assert.doesNotMatch(uiSource, /catalogRenderLimit|id="catalog-more"/);
});

test('市场分类栏位于固定头部且不会覆盖卡片，桌面单行无横向滚动', () => {
  const headerSource = uiSource.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? '';
  assert.match(headerSource, /id="market-nav"/);
  assert.match(uiSource, /\.market-nav \{[^}]*flex: 0 0 100%;[^}]*order: 4;/);
  assert.match(uiSource, /\.market-filters \{[^}]*position: static;/);
  assert.doesNotMatch(uiSource, /\.market-filters \{[^}]*position: sticky;/);
  assert.match(uiSource, /#market-nav'\)\.addEventListener\('click'/);
  assert.match(uiSource, /\.category-chips \{[^}]*flex-wrap: nowrap;[^}]*overflow: visible;/);
  assert.match(uiSource, /@media \(max-width: 620px\) \{[\s\S]*?\.category-chips \{ flex-wrap: wrap; \}/);
  assert.doesNotMatch(uiSource, /\.category-chips \{[^}]*overflow-x: auto;/);
});

test('市场总数移入页签且正文不再显示冗余操作提示', () => {
  assert.match(uiSource, /id="market-tab-count"/);
  assert.match(uiSource, /id="installed-tab-count"/);
  assert.match(uiSource, /setTabCount\('market', items\.length\)/);
  assert.match(uiSource, /setTabCount\('installed', items\.length\)/);
  assert.doesNotMatch(uiSource, /点击卡片查看能力，点击「连接」完成授权/);
});

test('工具清单使用中文计数并标记服务商弃用工具', () => {
  assert.match(uiSource, /\$\('#tools-summary'\)\.textContent = `\$\{detailToolServers\.length\} 个服务 · \$\{totalTools\} 个工具`/);
  assert.match(uiSource, /function isDeprecatedTool\(tool\)/);
  assert.match(uiSource, /deprecated/);
  assert.match(uiSource, /已弃用\|已废弃\|不再推荐/);
  assert.match(uiSource, /<span class="tool-deprecated">已弃用<\/span>/);
  assert.match(uiSource, /Number\(isDeprecatedTool\(left\)\) - Number\(isDeprecatedTool\(right\)\)/);
});
