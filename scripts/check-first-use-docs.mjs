#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PATHS = {
  oneSuccess: 'docs/tutorials/ONE-SUCCESS-CASE.md',
  sharing: 'docs/tutorials/SHARING-KIT.md',
  readmeZh: 'README.md',
  readmeEn: 'README.en.md',
  userGuide: 'docs/USER-GUIDE.md',
  growth: 'docs/GROWTH-BASELINE.md',
  entry: 'docs/tutorials/README.md',
  json: 'docs/tutorials/JSON-MIGRATION.md',
  oauth: 'docs/tutorials/OAUTH-DIAGNOSTICS.md',
  tools: 'docs/tutorials/TOOL-SEARCH-RECOVERY.md',
  scenarios: 'docs/tutorials/FIRST-SUCCESS-SCENARIOS.md',
  statusCopy: 'docs/tutorials/TRUSTED-STATUS-COPY.md',
  contribution: 'docs/FIRST-CONTRIBUTION.md',
  publicationDrafts: 'marketing/campaign-0.2.59/P1-SCENARIO-PUBLICATION-DRAFTS.md',
  publicationPack: 'marketing/P1-FIRST-SUCCESS-PUBLICATION-PACK-2026-10-16.md',
};

function requireText(path, text, expected) {
  if (!text.includes(expected)) throw new Error(`${path}: missing ${expected}`);
}

export async function checkFirstUseDocs() {
  const entries = await Promise.all(Object.entries(PATHS).map(async ([key, path]) => [key, await readFile(path, 'utf8')]));
  const docs = Object.fromEntries(entries);

  for (const filename of ['ONE-SUCCESS-CASE.md', 'SHARING-KIT.md']) {
    requireText(PATHS.entry, docs.entry, `(${filename})`);
    for (const key of ['readmeZh', 'readmeEn']) {
      requireText(PATHS[key], docs[key], `(docs/tutorials/${filename})`);
    }
  }
  requireText(PATHS.oneSuccess, docs.oneSuccess, '本次文档更新没有新增真实调用');
  requireText(PATHS.sharing, docs.sharing, '不新增遥测');

  requireText(PATHS.readmeZh, docs.readmeZh, '(docs/tutorials/README.md)');
  requireText(PATHS.readmeEn, docs.readmeEn, '(docs/tutorials/README.md)');
  requireText(PATHS.userGuide, docs.userGuide, '(tutorials/README.md)');

  for (const link of ['(JSON-MIGRATION.md)', '(OAUTH-DIAGNOSTICS.md)', '(TOOL-SEARCH-RECOVERY.md)']) {
    requireText(PATHS.entry, docs.entry, link);
  }
  for (const link of ['(FIRST-SUCCESS-SCENARIOS.md)', '(TRUSTED-STATUS-COPY.md)']) {
    requireText(PATHS.entry, docs.entry, link);
    requireText(PATHS.readmeZh, docs.readmeZh, `docs/tutorials/${link.slice(1)}`);
    requireText(PATHS.readmeEn, docs.readmeEn, `docs/tutorials/${link.slice(1)}`);
  }
  requireText(PATHS.userGuide, docs.userGuide, '(tutorials/FIRST-SUCCESS-SCENARIOS.md)');
  requireText(PATHS.userGuide, docs.userGuide, '(tutorials/TRUSTED-STATUS-COPY.md)');
  for (const expected of [
    'dsh plugin --profile web add dsh-mcp-connector',
    'DSH Desktop 和 `dsh web` 都从本机 `web` profile 加载插件',
    '不要因为使用 Desktop 就把命令改成 `--profile desktop`',
    '设置 → 插件 → 插件配置 → MCP连接器',
    'mcp__<serverName>__<toolName>',
    '只读调用',
    'DSH Host',
    '权限',
    '费用',
    '无数据/待验收',
    'https://github.com/duhu2000/dsh-mcp-connector/stargazers',
    'https://github.com/duhu2000/dsh-mcp-connector-registry/blob/main/docs/ONBOARDING.md',
    '../../CONTRIBUTING.md',
  ]) {
    requireText(PATHS.entry, docs.entry, expected);
  }

  for (const [key, path] of [['json', PATHS.json], ['oauth', PATHS.oauth], ['tools', PATHS.tools]]) {
    requireText(path, docs[key], '(README.md)');
    for (const expected of [
      '## 授权前提、费用与数据去向',
      '## 可复现步骤与成功判据',
      '无数据/待验收',
    ]) {
      requireText(path, docs[key], expected);
    }
  }

  for (const expected of [
    '## 开始前先填一张验收卡',
    '授权前提',
    '费用',
    '数据去向',
    '通过证据',
  ]) {
    requireText(PATHS.entry, docs.entry, expected);
  }

  for (const expected of [
    '企业信息只读查询',
    '本地智能文档解析',
    '授权办公文档或日程查询',
    '本机进程 + 远程处理',
    '无证据/待用户验收',
    '(TRUSTED-STATUS-COPY.md)',
  ]) {
    requireText(PATHS.scenarios, docs.scenarios, expected);
  }

  for (const expected of [
    '账号/组织：当前连接无法确认',
    '授权状态未知',
    'Host 注册状态未知',
    '调用：无证据/待验收',
    '管理员前提：待服务商确认',
    '本机进程 + 远程处理',
    '本次费用：无法由插件确认',
    '检查时间：YYYY-MM-DD HH:mm:ss ±HH:mm',
    '缓存参数结构已变化，可能影响既有调用；使用前请核对参数，并按 Host 要求重新确认。',
    'Schema 不完整或缺少历史记录，无法判断兼容性。',
    '仅为发现缓存；调用：无证据/待验收。',
    'Schema 变化：检测到工具移除、必填参数新增、类型/枚举收窄或其他不兼容差异',
    '当前 Schema 无法确认',
    '工具副作用：服务未提供或 Host 未传递可靠标记',
    '不为文案新增隐性用户跟踪',
  ]) {
    requireText(PATHS.statusCopy, docs.statusCopy, expected);
  }

  for (const expected of [
    '仅本地/仓库草稿',
    '不得自动公开发布',
    'MCP连接器、MCP Server、连接管理、跨连接工具搜索、连接排障',
    '2026-10-02',
    '2026-10-09',
    '不从下载量推算连接或首次调用',
    '(../P1-FIRST-SUCCESS-PUBLICATION-PACK-2026-10-16.md)',
  ]) {
    requireText(PATHS.publicationDrafts, docs.publicationDrafts, expected);
  }

  for (const expected of [
    '仅仓库准备，不得自动发布',
    '发布所有权与直链登记',
    '未发布，无直链',
    'JSON-MIGRATION.md',
    'OAUTH-DIAGNOSTICS.md',
    'TOOL-SEARCH-RECOVERY.md',
    'v0.2.46 无凭据 Mock',
    '43 秒 `docs/demo.gif`',
    '1280×720',
    '800px',
    '“需重新授权”',
  ]) {
    requireText(PATHS.publicationPack, docs.publicationPack, expected);
  }

  for (const expected of [
    '#29',
    '已完成并关闭',
    'issues/156',
    '当前可认领的新手任务',
    'scripts/check-tutorial-links.mjs',
    '不发起网络请求',
  ]) {
    requireText(PATHS.contribution, docs.contribution, expected);
  }

  for (const expected of [
    '## 7/14-day first-use review template',
    'DSH Market/search impressions | No data',
    'First successful read-only calls | No data',
    'Do not calculate an exposure-to-install, download-to-connection, or download-to-first-call conversion rate',
    '### 0.2.59 scheduled first-use checkpoints',
    'T+7 = 2026-10-02',
    'T+14 = 2026-10-09',
    'Fill only after due date',
    '## Repeatable equal-window review procedure',
    '`P-7` through `P-1`',
    '`P+1` through `P+7`',
    'Call it an equal-window change, not campaign attribution or a',
  ]) {
    requireText(PATHS.growth, docs.growth, expected);
  }

  return PATHS.entry;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  checkFirstUseDocs().then((path) => {
    console.log(`首次使用文档校验通过：${path}`);
  }).catch((error) => {
    console.error(`首次使用文档校验失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
