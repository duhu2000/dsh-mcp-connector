import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const uiSource = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

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
});

test('Bearer/API Key 市场卡片配置成功后显示已连接', () => {
  const actionSource = uiSource.match(/function actionHtml\(d, connected\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(actionSource, /if \(connected\)[\s\S]*?t\('connected'\)/);
  assert.ok(actionSource.indexOf('if (connected)') < actionSource.lastIndexOf("t('configure')"));
});
