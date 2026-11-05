import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_QUERIES,
  assessQuery,
  checkMarketSearchRank,
  fieldRelevance,
  rankedPlugins,
  reportMarkdown,
  searchText,
} from '../scripts/check-market-search-rank.mjs';

const connector = {
  name: 'dsh-mcp-connector',
  npm: 'dsh-mcp-connector',
  owner: 'duhu2000',
  url: 'https://github.com/duhu2000/dsh-mcp-connector',
  category: 'tools',
  description: {
    zh: 'MCP连接器：DeepSeek Harness 的 MCP 管理面板，支持连接管理、授权配置、跨连接搜索工具与排障。',
    en: 'MCP Connector for DeepSeek Harness: an MCP manager panel to connect servers, search tools and troubleshoot connections.',
  },
  downloads: 29_826,
  stars: 104,
};

const windows = {
  name: 'dsh-windows-mcp',
  npm: 'dsh-windows-mcp',
  owner: 'helloHub1212',
  url: 'https://github.com/helloHub1212/dsh-windows-mcp',
  category: 'tools',
  description: {
    zh: '把 Windows MCP 桌面自动化服务器接入 DSH。',
    en: 'Bridge a Windows MCP desktop automation server into DSH.',
  },
  downloads: 32_539,
  stars: 15,
};

const searchOptimizedConnector = {
  ...connector,
  description: {
    zh: 'MCP连接器：DeepSeek Harness 的专业 MCP 市场、数据市场与 MCP 管理面板，汇聚企业、金融、法律、专利、科研和地理等 Model Context Protocol（MCP）数据源。',
    en: 'MCP Connector for DeepSeek Harness: a specialist MCP marketplace and manager panel for Model Context Protocol data sources.',
  },
};

function catalog(plugins = [connector, windows]) {
  return {
    updated: '2026-11-05',
    categories: { tools: { zh: '工具与能力', en: 'Tools' } },
    plugins,
  };
}

test('normalizes mixed Han and Latin search terms like dsh-market', () => {
  assert.equal(searchText('  MCP连接器 / OAuth2授权  '), 'mcp 连接器 oauth2 授权');
});

test('keeps exact, phrase and scattered field relevance tiers', () => {
  const query = searchText('mcp connector');
  const tokens = query.split(' ');
  assert.equal(fieldRelevance('mcp connector', query, tokens, 700), 1000);
  assert.equal(fieldRelevance('dsh mcp connector panel', query, tokens, 700), 900);
  assert.equal(fieldRelevance('connector for mcp', query, tokens, 700), 850);
  assert.equal(fieldRelevance('mcp only', query, tokens, 700), 0);
});

test('raw downloads decide the broad mcp tie and stars do not override them', () => {
  const rows = rankedPlugins(catalog(), 'mcp');
  assert.equal(rows[0].plugin.name, 'dsh-windows-mcp');
  assert.equal(rows[0].relevance, 900);
  assert.equal(rows[1].plugin.name, 'dsh-mcp-connector');
  assert.equal(rows[1].relevance, 900);
  assert.ok(rows[1].plugin.stars > rows[0].plugin.stars);
});

test('connector intent queries outrank a Windows MCP bridge', () => {
  for (const query of ['mcp connector', 'MCP连接器', 'MCP 管理', '连接器']) {
    const result = assessQuery(catalog(), { id: query, query, maxRank: 1, required: true });
    assert.equal(result.rank, 1, query);
    assert.equal(result.passed, true, query);
  }
});

test('optimized catalog copy covers adjacent marketplace discovery intents', () => {
  const optimizedCatalog = catalog([searchOptimizedConnector, windows]);
  const expectations = [
    { query: 'model context protocol', maxRank: 1 },
    { query: 'mcp marketplace', maxRank: 3 },
    { query: 'MCP 市场', maxRank: 1 },
    { query: '数据市场', maxRank: 1 },
  ];
  for (const expectation of expectations) {
    const result = assessQuery(optimizedCatalog, {
      id: expectation.query,
      query: expectation.query,
      maxRank: expectation.maxRank,
      required: false,
    });
    assert.equal(result.passed, true, expectation.query);
  }
});

test('required query drift fails while optional discovery gaps stay observational', () => {
  const queries = [
    { id: 'mcp', query: 'mcp', maxRank: 1, required: true },
    { id: 'marketplace', query: 'mcp marketplace', maxRank: 1, required: false },
  ];
  const report = checkMarketSearchRank({ catalog: catalog(), marketVersion: '1.73.11', queries, lang: 'zh' });
  assert.equal(report.ok, false);
  assert.equal(report.queries[0].rank, 2);
  assert.equal(report.queries[1].rank, null);
  assert.equal(report.queries[1].passed, false);
});

test('all required core queries pass after the connector wins the download tie-break', () => {
  const leadingConnector = { ...connector, downloads: 40_000 };
  const required = DEFAULT_QUERIES.filter((query) => query.required);
  const report = checkMarketSearchRank({ catalog: catalog([leadingConnector, windows]), queries: required, lang: 'zh' });
  assert.equal(report.ok, true);
  assert.ok(report.queries.every((query) => query.rank === 1 && query.passed));
});

test('renders fixed conditions and the no-conversion boundary in summaries', () => {
  const report = checkMarketSearchRank({
    catalog: catalog(),
    marketVersion: '1.73.11',
    queries: [{ id: 'mcp', query: 'mcp', maxRank: 1, required: true }],
    lang: 'zh',
  });
  const markdown = reportMarkdown(report);
  assert.match(markdown, /`zh` · `all` · `downloads-desc`/);
  assert.match(markdown, /\| `mcp` \| ❌ required \| 2 \| ≤ 1 \| dsh-windows-mcp/);
  assert.match(markdown, /not installation conversion/);
});

test('workflow schedules the monitor and maintains one issue', () => {
  const workflow = readFileSync(new URL('../.github/workflows/market-search-rank.yml', import.meta.url), 'utf8');
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /<!-- market-search-rank-monitor -->/);
  assert.match(workflow, /MARKET_RANK_REPORT_PATH: market-search-rank-report\.json/);
  assert.match(workflow, /steps\.rank\.outcome == 'failure'/);
});
