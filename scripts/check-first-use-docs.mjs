#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PATHS = {
  readmeZh: 'README.md',
  readmeEn: 'README.en.md',
  userGuide: 'docs/USER-GUIDE.md',
  growth: 'docs/GROWTH-BASELINE.md',
  entry: 'docs/tutorials/README.md',
  json: 'docs/tutorials/JSON-MIGRATION.md',
  oauth: 'docs/tutorials/OAUTH-DIAGNOSTICS.md',
  tools: 'docs/tutorials/TOOL-SEARCH-RECOVERY.md',
};

function requireText(path, text, expected) {
  if (!text.includes(expected)) throw new Error(`${path}: missing ${expected}`);
}

export async function checkFirstUseDocs() {
  const entries = await Promise.all(Object.entries(PATHS).map(async ([key, path]) => [key, await readFile(path, 'utf8')]));
  const docs = Object.fromEntries(entries);

  requireText(PATHS.readmeZh, docs.readmeZh, '(docs/tutorials/README.md)');
  requireText(PATHS.readmeEn, docs.readmeEn, '(docs/tutorials/README.md)');
  requireText(PATHS.userGuide, docs.userGuide, '(tutorials/README.md)');

  for (const link of ['(JSON-MIGRATION.md)', '(OAUTH-DIAGNOSTICS.md)', '(TOOL-SEARCH-RECOVERY.md)']) {
    requireText(PATHS.entry, docs.entry, link);
  }
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
  }

  for (const expected of [
    '## 7/14-day first-use review template',
    'DSH Market/search impressions | No data',
    'First successful read-only calls | No data',
    'Do not calculate an exposure-to-install, download-to-connection, or download-to-first-call conversion rate',
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
