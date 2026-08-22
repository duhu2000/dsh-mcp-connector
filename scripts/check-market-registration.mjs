#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  pullRequestRepository: 'awesome-dsh-plugin/awesome-dsh-plugin',
  pullRequestNumber: 2633,
  expectedName: 'dsh-mcp-connector',
  expectedRepository: 'https://github.com/duhu2000/dsh-mcp-connector',
  registrationUrl: 'https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/duhu2000__dsh-mcp-connector.yml',
  registryUrl: 'https://awesome-dsh-plugin.com/plugins.json',
};

export function normalizeRepository(value) {
  return String(value ?? '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function registryPlugins(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.plugins)) return payload.plugins;
  if (Array.isArray(payload?.registry?.plugins)) return payload.registry.plugins;
  return [];
}

export function findRegistryPlugin(payload, { expectedName, expectedRepository }) {
  const wantedRepository = normalizeRepository(expectedRepository);
  return registryPlugins(payload).find((plugin) => {
    const repository = normalizeRepository(plugin?.url ?? plugin?.repository ?? plugin?.repo);
    return plugin?.name === expectedName || repository === wantedRepository;
  });
}

function registrationHasRepository(text, expectedRepository) {
  const wanted = normalizeRepository(expectedRepository);
  const urls = String(text ?? '').match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?/g) ?? [];
  return urls.some((url) => normalizeRepository(url) === wanted);
}

function registrationHasName(text, expectedName) {
  const escaped = String(expectedName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*name:\\s*(?:[^/\\s]+/)?${escaped}\\s*$`, 'mi').test(String(text ?? ''));
}

export function assessRegistration({ pullRequest, registrationText, registry, expectedName, expectedRepository }) {
  if (pullRequest?.merged_at) {
    const registrationPresent = registrationHasName(registrationText, expectedName)
      && registrationHasRepository(registrationText, expectedRepository);
    const plugin = findRegistryPlugin(registry, { expectedName, expectedRepository });
    const directoryPresent = Boolean(plugin);
    return {
      status: registrationPresent && directoryPresent ? 'accepted' : 'awaiting-directory-sync',
      ok: registrationPresent && directoryPresent,
      pending: !registrationPresent || !directoryPresent,
      mergedAt: pullRequest.merged_at,
      checks: { pullRequestMerged: true, registrationPresent, directoryPresent },
      plugin: plugin ? {
        name: plugin.name,
        url: plugin.url ?? plugin.repository ?? plugin.repo,
        npm: plugin.npm,
      } : null,
    };
  }

  if (pullRequest?.state === 'closed') {
    return {
      status: 'closed-without-merge',
      ok: false,
      pending: false,
      checks: { pullRequestMerged: false, registrationPresent: false, directoryPresent: false },
      plugin: null,
    };
  }

  return {
    status: 'awaiting-merge',
    ok: true,
    pending: true,
    checks: { pullRequestMerged: false, registrationPresent: false, directoryPresent: false },
    plugin: null,
  };
}

async function fetchResponse(url, { token, json = false } = {}) {
  const headers = {
    accept: json ? 'application/vnd.github+json' : '*/*',
    'user-agent': 'dsh-mcp-connector-market-check',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

function summaryMarkdown(result, options) {
  const mark = (value) => value ? '✅' : '⏳';
  const lines = [
    '## DSH 外部市场自动验收',
    '',
    `- 状态：\`${result.status}\``,
    `- PR：https://github.com/${options.pullRequestRepository}/pull/${options.pullRequestNumber}`,
    `- ${mark(result.checks.pullRequestMerged)} PR 已合并`,
    `- ${mark(result.checks.registrationPresent)} 上游注册 YAML 已进入 main`,
    `- ${mark(result.checks.directoryPresent)} DSH 实际 plugins.json 已可搜索`,
  ];
  if (result.plugin) lines.push(`- 目录条目：\`${result.plugin.name}\` · ${result.plugin.url}`);
  return `${lines.join('\n')}\n`;
}

export async function runMarketRegistrationCheck({ env = process.env, args = process.argv.slice(2) } = {}) {
  const options = {
    pullRequestRepository: env.MARKET_PR_REPOSITORY || DEFAULTS.pullRequestRepository,
    pullRequestNumber: Number(env.MARKET_PR_NUMBER || DEFAULTS.pullRequestNumber),
    expectedName: env.MARKET_EXPECTED_NAME || DEFAULTS.expectedName,
    expectedRepository: env.MARKET_EXPECTED_REPOSITORY || DEFAULTS.expectedRepository,
    registrationUrl: env.MARKET_REGISTRATION_URL || DEFAULTS.registrationUrl,
    registryUrl: env.MARKET_REGISTRY_URL || DEFAULTS.registryUrl,
  };
  const strictAfterMerge = args.includes('--strict-after-merge');
  const apiUrl = `https://api.github.com/repos/${options.pullRequestRepository}/pulls/${options.pullRequestNumber}`;
  const pullRequest = await fetchResponse(apiUrl, { token: env.GITHUB_TOKEN, json: true });

  let registrationText = '';
  let registry = null;
  if (pullRequest.merged_at) {
    [registrationText, registry] = await Promise.all([
      fetchResponse(options.registrationUrl),
      fetchResponse(options.registryUrl).then((text) => JSON.parse(text)),
    ]);
  }

  const result = assessRegistration({
    pullRequest,
    registrationText,
    registry,
    expectedName: options.expectedName,
    expectedRepository: options.expectedRepository,
  });
  const markdown = summaryMarkdown(result, options);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  console.log(JSON.stringify({ ...result, pullRequest: `https://github.com/${options.pullRequestRepository}/pull/${options.pullRequestNumber}` }, null, 2));

  if (result.status === 'closed-without-merge') return 1;
  if (strictAfterMerge && pullRequest.merged_at && !result.ok) return 1;
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runMarketRegistrationCheck()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(`市场验收检查失败：${error.message}`);
      process.exitCode = 1;
    });
}
