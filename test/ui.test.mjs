import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const normalizeLineEndings = (source) => source.replace(/\r\n?/g, '\n');
const uiSource = normalizeLineEndings(await readFile(new URL('../ui/index.html', import.meta.url), 'utf8'));
const clientSource = normalizeLineEndings(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'));
const harnessSource = normalizeLineEndings(await readFile(new URL('../scripts/ui-harness.mjs', import.meta.url), 'utf8'));

test('截图 harness 复刻产品 800px 面板并从无授权状态启动', () => {
  assert.match(clientSource, /width: "min\(800px, 90%\)"/);
  assert.match(harnessSource, /width: min\(800px, 90vw\)/);
  assert.match(harnessSource, /无凭据 Mock/);
  assert.match(harnessSource, /const connected = new Set\(\);/);
  assert.doesNotMatch(harnessSource, /new Set\(\['qcc-company'\]\)/);
});

test('界面固定为中文且不提供语言切换入口', () => {
  assert.match(uiSource, /<html lang="zh-CN">/);
  assert.doesNotMatch(uiSource, /id="locale-toggle"/);
  assert.doesNotMatch(uiSource, /mcp-connector:locale/);
  assert.doesNotMatch(uiSource, /Switch language|>EN<\/button>|Sending…/);
  assert.doesNotMatch(uiSource, /data-i18n/);
  assert.match(uiSource, /const LABELS = \{[\s\S]*?details: '详情'/);
});

test('目录刷新文案与插件升级明确区分', () => {
  assert.match(uiSource, /id="refresh" title="刷新连接器目录">刷新连接器目录<\/button>/);
  assert.match(uiSource, /call\('refreshCatalog', \{\}\)/);
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
  assert.match(uiSource, /Host 已完成 stdio 初始化，但该 Server 当前没有可展示的工具/);
});

test('连接、健康检查与工具加载均有有限超时和可重试提示', () => {
  assert.match(uiSource, /const API_TIMEOUTS = \{/);
  assert.match(uiSource, /connect: 145_000/);
  assert.match(uiSource, /toolsList: 20_000/);
  assert.match(uiSource, /healthCheck: 10_000/);
  assert.match(uiSource, /const controller = new AbortController\(\)/);
  assert.match(uiSource, /signal: controller\.signal/);
  assert.match(uiSource, /authMode === 'oauth2-pkce' \? 310_000/);
  assert.match(uiSource, /请求超时（\$\{Math\.ceil\(timeoutMs \/ 1000\)\} 秒）/);
  assert.match(uiSource, /detailNeedsReconfigure = true/);
  assert.match(uiSource, /重新检查/);
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

test('市场卡片区分状态未知、已连接、重新授权和连接异常', () => {
  const actionSource = uiSource.match(/function actionHtml\(d\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(actionSource, /state === 'healthy'[\s\S]*?t\('connected'\)/);
  assert.match(actionSource, /state === 'unknown'[\s\S]*?t\('unknown'\)/);
  assert.match(actionSource, /state === 'reauth'[\s\S]*?t\('reauthorize'\)/);
  assert.match(actionSource, /state === 'recovering'[\s\S]*?t\('recovering'\)/);
  assert.match(actionSource, /state === 'unavailable'[\s\S]*?t\('connectionError'\)/);
  assert.match(uiSource, /call\('healthCheck', \{\}\)/);
});

test('已安装列表和详情展示可解释诊断与最近成功时间', () => {
  assert.match(uiSource, /r\.diagnostic\.stageLabel \|\| r\.diagnostic\.stage/);
  assert.match(uiSource, /r\.diagnostic\.code/);
  assert.match(uiSource, /建议：/);
  assert.match(uiSource, /r\.lastSuccessfulAt/);
  assert.match(uiSource, /detailFailureState === 'unknown' \? '工具状态未知'/);
  assert.match(uiSource, /状态尚未确认/);
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

test('0 条连接时不显示社区入口', () => {
  const loadInstalledSource = uiSource.match(/async function loadInstalled\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  const emptyState = loadInstalledSource.indexOf('if (!items.length)');
  const eligibility = loadInstalledSource.indexOf('markCommunityCtaEligible();');
  assert.ok(emptyState >= 0 && eligibility > emptyState, '空状态必须在 CTA 资格标记之前返回');
  assert.match(uiSource, /if \(!communityCtaEligible \|\| communityCtaDismissed\) return '';/);
});

test('连接、配置、导入或 URL 安装成功后显示克制的社区入口', () => {
  const connectSource = uiSource.match(/async connect\(connectorId\) \{[\s\S]*?\n    \},/)?.[0] ?? '';
  const configureSource = uiSource.match(/async submitConfig\(\) \{[\s\S]*?\n    \},\n    async submitImport/)?.[0] ?? '';
  const importSource = uiSource.match(/async submitImport\(\) \{[\s\S]*?\n    \},\n    async submitUrl/)?.[0] ?? '';
  const installFromUrlSource = uiSource.match(/async submitUrl\(\) \{[\s\S]*?\n    \},\n    async migrateLegacy/)?.[0] ?? '';
  assert.match(uiSource, /function communityCtaHtml\(\)/);
  assert.match(uiSource, /function markCommunityCtaEligible\(\)/);
  assert.match(uiSource, /连接顺利？如果 MCP连接器对你有帮助/);
  assert.match(uiSource, />Star<\/a>/);
  assert.match(uiSource, />提交连接器<\/a>/);
  assert.match(uiSource, />参与贡献<\/a>/);
  assert.match(uiSource, /\$\{communityCtaHtml\(\)\}/);
  assert.match(connectSource, /if \(r\.ok\) \{\s*markCommunityCtaEligible\(\);/);
  assert.equal((configureSource.match(/call\('configure'/g) || []).length, 2, '市场配置和自定义配置都必须受测');
  assert.equal((configureSource.match(/markCommunityCtaEligible\(\);/g) || []).length, 2, '两种配置成功后都应显示 CTA');
  assert.match(importSource, /call\('importJson'[\s\S]*?if \(!r\.ok\)[\s\S]*?markCommunityCtaEligible\(\);/);
  assert.match(installFromUrlSource, /call\('installFromUrl'[\s\S]*?if \(!r\.ok\)[\s\S]*?markCommunityCtaEligible\(\);/);
  assert.doesNotMatch(uiSource, /openModal\([^\n]*连接顺利/);
});

test('关闭社区入口后在本次页面生命周期内保持隐藏', () => {
  assert.match(uiSource, /let communityCtaDismissed = false;/);
  assert.match(uiSource, /onclick="window\.__mcp\.dismissCommunityCta\(\)"/);
  assert.match(uiSource, /function dismissCommunityCta\(\) \{[\s\S]*?communityCtaDismissed = true;[\s\S]*?communityCtaEligible = false;[\s\S]*?querySelector\('\.community-cta'\)\?\.remove\(\);/);
  assert.match(uiSource, /dismissCommunityCta\(\) \{ dismissCommunityCta\(\); \}/);
});

test('工具清单使用中文计数并标记服务商弃用工具', () => {
  assert.match(uiSource, /\$\('#tools-summary'\)\.textContent = `\$\{detailToolServers\.length\} 个服务 · \$\{totalTools\} 个工具`/);
  assert.match(uiSource, /function isDeprecatedTool\(tool\)/);
  assert.match(uiSource, /deprecated/);
  assert.match(uiSource, /已弃用\|已废弃\|不再推荐/);
  assert.match(uiSource, /<span class="tool-deprecated">已弃用<\/span>/);
  assert.match(uiSource, /Number\(isDeprecatedTool\(left\)\) - Number\(isDeprecatedTool\(right\)\)/);
});
