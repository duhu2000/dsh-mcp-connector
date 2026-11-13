#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKAGE_NAME = 'dsh-mcp-connector';
const REPOSITORY_URL = 'https://github.com/duhu2000/dsh-mcp-connector';
const DEFAULT_REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json';
const DEFAULT_MARKET_PACKAGE_URL = 'https://registry.npmjs.org/dshmarket/latest';
const SEARCH_ALGORITHM = 'dsh-market field relevance + downloads-desc tie-break';
const SEARCH_CONTRACT = 'verified against dsh-market 1.73.6 and 1.73.11';

export const DEFAULT_QUERIES = [
  { id: 'mcp', query: 'mcp', maxRank: 1, required: true },
  { id: 'mcp-connector-en', query: 'mcp connector', maxRank: 1, required: true },
  { id: 'mcp-connector-zh', query: 'MCP连接器', maxRank: 1, required: true },
  { id: 'mcp-management-zh', query: 'MCP 管理', maxRank: 1, required: true },
  { id: 'connector-zh', query: '连接器', maxRank: 1, required: true },
  { id: 'model-context-protocol', query: 'model context protocol', maxRank: 1, required: false },
  { id: 'mcp-marketplace-en', query: 'mcp marketplace', maxRank: 3, required: false },
  { id: 'mcp-market-zh', query: 'MCP 市场', maxRank: 1, required: false },
  { id: 'data-market-zh', query: '数据市场', maxRank: 1, required: false },
  { id: 'mcp-server', query: 'mcp server', maxRank: 10, required: false },
];

const searchScriptBoundary = /(?:\p{Script=Han}(?=[\p{Script=Latin}\p{N}])|[\p{Script=Latin}\p{N}](?=\p{Script=Han}))/gu;

export function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(searchScriptBoundary, '$& ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function fieldRelevance(value, query, tokens, weight) {
  const text = searchText(value);
  if (text === '' || !tokens.every((token) => text.includes(token))) return 0;
  if (text === query) return weight + 300;
  if (text.includes(query)) return weight + 200;
  return weight + 150;
}

function pluginCategories(plugin) {
  const values = Array.isArray(plugin?.category) ? plugin.category : [plugin?.category];
  return [...new Set(values.filter((value) => typeof value === 'string' && value !== ''))];
}

export function pluginRelevance(plugin, rawQuery, { lang = 'zh', categories = {} } = {}) {
  const query = searchText(rawQuery);
  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length === 0) return 0;
  const descriptions = plugin?.description ?? {};
  const preferredLocale = descriptions[lang] ? lang : descriptions.en ? 'en' : null;
  const preferredDescription = descriptions[lang] || descriptions.en;
  const otherDescriptions = Object.entries(descriptions)
    .filter(([locale, value]) => locale !== preferredLocale && typeof value === 'string')
    .map(([, value]) => value);
  const categoryIds = pluginCategories(plugin);
  const categoryLabels = categoryIds.flatMap((category) => Object.values(categories?.[category] ?? {}));

  return Math.max(
    fieldRelevance(plugin?.name, query, tokens, 700),
    fieldRelevance(plugin?.npm, query, tokens, 700),
    fieldRelevance(plugin?.owner, query, tokens, 400),
    fieldRelevance(preferredDescription, query, tokens, 280),
    ...otherDescriptions.map((value) => fieldRelevance(value, query, tokens, 240)),
    ...categoryIds.map((value) => fieldRelevance(value, query, tokens, 180)),
    ...categoryLabels.map((value) => fieldRelevance(value, query, tokens, 180)),
  );
}

function compareDownloadsDescending(left, right) {
  const leftHasDownloads = typeof left?.downloads === 'number';
  const rightHasDownloads = typeof right?.downloads === 'number';
  if (leftHasDownloads && rightHasDownloads) return right.downloads - left.downloads;
  if (leftHasDownloads) return -1;
  if (rightHasDownloads) return 1;
  return (right?.stars ?? -1) - (left?.stars ?? -1);
}

export function rankedPlugins(catalog, rawQuery, { lang = 'zh' } = {}) {
  const plugins = Array.isArray(catalog) ? catalog : catalog?.plugins;
  if (!Array.isArray(plugins)) throw new Error('plugins.json has no plugins array');
  const categories = Array.isArray(catalog) ? {} : catalog?.categories ?? {};
  return plugins.flatMap((plugin, index) => {
    if (plugin?.name === 'dsh-market' || plugin?.npm === 'dshmarket') return [];
    const relevance = pluginRelevance(plugin, rawQuery, { lang, categories });
    return relevance === 0 ? [] : [{ plugin, relevance, index }];
  }).sort((left, right) => right.relevance - left.relevance
    || compareDownloadsDescending(left.plugin, right.plugin)
    || left.index - right.index);
}

function normalizeRepository(value) {
  return String(value ?? '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function isConnector(plugin) {
  const npmIdentity = String(plugin?.npm ?? '').trim().toLowerCase();
  const repository = plugin?.repository && typeof plugin.repository === 'object'
    ? plugin.repository.url
    : plugin?.repository ?? plugin?.url;
  const repositoryIdentity = normalizeRepository(repository);
  const expectedRepository = normalizeRepository(REPOSITORY_URL);
  const hasNpmIdentity = npmIdentity !== '';
  const hasRepositoryIdentity = repositoryIdentity !== '';
  const npmMatches = npmIdentity === PACKAGE_NAME;
  const repositoryMatches = repositoryIdentity === expectedRepository;

  // A display name is not an identity: another publisher may legitimately use
  // the same bare name. Also reject records whose declared npm/repository
  // identity contradicts the connector, even if another field happens to match.
  if ((hasNpmIdentity && !npmMatches) || (hasRepositoryIdentity && !repositoryMatches)) return false;
  return npmMatches || repositoryMatches;
}

function compactPlugin(row) {
  if (!row) return null;
  return {
    name: row.plugin?.name ?? null,
    npm: row.plugin?.npm ?? null,
    relevance: row.relevance,
    downloads: typeof row.plugin?.downloads === 'number' ? row.plugin.downloads : null,
    stars: typeof row.plugin?.stars === 'number' ? row.plugin.stars : null,
  };
}

export function assessQuery(catalog, queryConfig, options = {}) {
  const rows = rankedPlugins(catalog, queryConfig.query, options);
  const index = rows.findIndex((row) => isConnector(row.plugin));
  const rank = index < 0 ? null : index + 1;
  return {
    ...queryConfig,
    rank,
    matches: rows.length,
    passed: rank !== null && rank <= queryConfig.maxRank,
    connector: compactPlugin(index < 0 ? null : rows[index]),
    top: rows.slice(0, 5).map(compactPlugin),
  };
}

export function checkMarketSearchRank({ catalog, marketVersion = null, queries = DEFAULT_QUERIES, lang = 'zh' }) {
  const results = queries.map((query) => assessQuery(catalog, query, { lang }));
  const required = results.filter((result) => result.required);
  return {
    package: PACKAGE_NAME,
    checkedAt: new Date().toISOString(),
    registryUrl: DEFAULT_REGISTRY_URL,
    catalogUpdated: Array.isArray(catalog) ? null : catalog?.updated ?? null,
    marketVersion,
    locale: lang,
    category: 'all',
    sort: 'downloads-desc',
    algorithm: SEARCH_ALGORITHM,
    algorithmContract: SEARCH_CONTRACT,
    ok: required.every((result) => result.passed),
    queries: results,
    limitations: [
      'This is a deterministic catalog simulation, not an actual UI or conversion measurement.',
      'npm downloads are package requests, not unique users or verified installations.',
      'Optional discovery queries are reported but do not fail the required core-query gate.',
    ],
  };
}

function escapeCell(value) {
  return String(value ?? '-').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function reportMarkdown(report) {
  const lines = [
    '## DSH Market search-rank monitor',
    '',
    `- Package: \`${report.package}\``,
    `- Market package version: \`${report.marketVersion ?? 'unknown'}\``,
    `- Catalog updated: \`${report.catalogUpdated ?? 'unknown'}\``,
    `- Contract: \`${report.locale}\` · \`${report.category}\` · \`${report.sort}\``,
    `- Algorithm: ${report.algorithm} (${report.algorithmContract})`,
    '',
    '| Query | Gate | Rank | Target | Top result | Connector downloads | Connector stars |',
    '|---|---|---:|---:|---|---:|---:|',
  ];
  for (const result of report.queries) {
    const gate = result.required ? (result.passed ? '✅ required' : '❌ required') : 'ℹ️ observed';
    lines.push(`| \`${escapeCell(result.query)}\` | ${gate} | ${result.rank ?? '-'} | ≤ ${result.maxRank} | ${escapeCell(result.top[0]?.name)} | ${result.connector?.downloads ?? '-'} | ${result.connector?.stars ?? '-'} |`);
  }
  lines.push(
    '',
    `Checked: ${report.checkedAt}`,
    '',
    '> Ranking is catalog discoverability under fixed conditions. It is not installation conversion, a unique-user count, or business-call acceptance.',
  );
  return `${lines.join('\n')}\n`;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-mcp-connector-market-rank-check' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

export async function runMarketSearchRankCheck({ env = process.env, args = process.argv.slice(2), fetchImpl = fetch } = {}) {
  const registryUrl = env.MARKET_RANK_REGISTRY_URL || DEFAULT_REGISTRY_URL;
  const marketPackageUrl = env.MARKET_RANK_PACKAGE_URL || DEFAULT_MARKET_PACKAGE_URL;
  const [catalog, marketPackage] = await Promise.all([
    fetchJson(fetchImpl, registryUrl),
    fetchJson(fetchImpl, marketPackageUrl).catch(() => null),
  ]);
  const report = checkMarketSearchRank({ catalog, marketVersion: marketPackage?.version ?? null });
  report.registryUrl = registryUrl;
  const markdown = reportMarkdown(report);
  console.log(JSON.stringify(report, null, 2));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.MARKET_RANK_REPORT_PATH) writeFileSync(env.MARKET_RANK_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return args.includes('--strict') && !report.ok ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runMarketSearchRankCheck()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(`DSH Market search-rank check failed: ${error.message}`);
      process.exitCode = 1;
    });
}
