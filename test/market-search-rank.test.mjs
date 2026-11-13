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
    en: 'MCP Connector for DeepSeek Harness: a specialist MCP marketplace and MCP manager panel for Model Context Protocol data sources.',
  },
};

function catalog(plugins = [connector, windows]) {
  return {
    updated: '2026-11-05',
    categories: { tools: { zh: '工具与能力', en: 'Tools' } },
    plugins,
  };
}

function rankReport(ok) {
  return {
    ok,
    registryUrl: 'https://awesome-dsh-plugin.com/plugins.json',
    catalogUpdated: '2026-11-12',
    marketVersion: '1.73.11',
    locale: 'zh',
    category: 'all',
    sort: 'downloads-desc',
    algorithm: 'test algorithm',
    algorithmContract: 'test contract',
    checkedAt: '2026-11-12T02:00:00.000Z',
    queries: [],
  };
}

function reconciliationScript() {
  const workflow = readFileSync(new URL('../.github/workflows/market-search-rank.yml', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  const match = workflow.match(/uses: actions\/github-script@v7[\s\S]*?script: \|\n([\s\S]*?)\n      - name: Preserve failing status/);
  assert.ok(match, 'github-script reconciliation body should be extractable');
  return match[1].split('\n').map((line) => line.replace(/^ {12}/, '')).join('\n');
}

async function runReconciliation({ report, issues }) {
  const calls = { paginate: [], update: [], create: [], createComment: [], warnings: [] };
  const listForRepo = async () => {
    throw new Error('listForRepo must be called through github.paginate');
  };
  const github = {
    paginate: async (method, params) => {
      assert.equal(method, listForRepo);
      calls.paginate.push({ method, params });
      return issues;
    },
    rest: {
      issues: {
        listForRepo,
        update: async (params) => { calls.update.push(params); },
        create: async (params) => { calls.create.push(params); },
        createComment: async (params) => { calls.createComment.push(params); },
      },
    },
  };
  const fakeRequire = (specifier) => {
    assert.equal(specifier, 'node:fs');
    return {
      existsSync: () => true,
      readFileSync: () => JSON.stringify(report),
    };
  };
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;
  const execute = new AsyncFunction('require', 'github', 'context', 'core', reconciliationScript());
  await execute(fakeRequire, github, { repo: { owner: 'duhu2000', repo: 'dsh-mcp-connector' } }, {
    warning: (message) => calls.warnings.push(message),
  });
  return calls;
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

test('same bare name from another npm owner is not treated as the connector', () => {
  const impostor = {
    ...connector,
    npm: '@other-owner/dsh-mcp-connector',
    url: 'https://github.com/other-owner/dsh-mcp-connector',
    downloads: 50_000,
  };
  const result = assessQuery(catalog([impostor, connector]), {
    id: 'mcp', query: 'mcp', maxRank: 1, required: true,
  });
  assert.equal(result.rank, 2);
  assert.equal(result.connector.npm, 'dsh-mcp-connector');
});

test('a bare display name without npm or repository identity is not the connector', () => {
  const ambiguous = { ...connector, npm: undefined, url: undefined, downloads: 50_000 };
  const result = assessQuery(catalog([ambiguous]), {
    id: 'mcp', query: 'mcp', maxRank: 1, required: true,
  });
  assert.equal(result.rank, null);
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

test('reconciliation excludes pull requests even when their body contains the marker', async () => {
  const marker = '<!-- market-search-rank-monitor -->';
  const calls = await runReconciliation({
    report: rankReport(false),
    issues: [{
      number: 215,
      title: 'DSH Market MCP search rank is below target',
      body: marker,
      user: { login: 'github-actions[bot]' },
      pull_request: { url: 'https://api.github.com/pulls/215' },
    }],
  });
  assert.equal(calls.paginate.length, 1);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.update.length, 0);
});

test('reconciliation keeps tracking the bot alert after a user renames it', async () => {
  const calls = await runReconciliation({
    report: rankReport(false),
    issues: [{
      number: 212,
      title: 'Investigate current MCP ranking drift',
      body: '<!-- market-search-rank-monitor -->',
      user: { login: 'github-actions[bot]' },
    }],
  });
  assert.equal(calls.create.length, 0);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].issue_number, 212);
});

test('failure reconciliation finds the single alert after the first API page', async () => {
  const unrelated = Array.from({ length: 100 }, (_, index) => ({
    number: index + 1,
    title: `Unrelated issue ${index + 1}`,
    body: '',
    user: { login: 'someone' },
  }));
  const existing = {
    number: 212,
    title: 'DSH Market MCP search rank is below target',
    body: '<!-- market-search-rank-monitor -->',
    user: { login: 'github-actions[bot]' },
  };
  const calls = await runReconciliation({ report: rankReport(false), issues: [...unrelated, existing] });
  assert.equal(calls.paginate[0].params.per_page, 100);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].issue_number, 212);
});

test('recovery reconciliation finds a later-page alert, comments, and closes it', async () => {
  const unrelated = Array.from({ length: 100 }, (_, index) => ({
    number: index + 1,
    title: `Unrelated issue ${index + 1}`,
    body: '',
    user: { login: 'someone' },
  }));
  const existing = {
    number: 212,
    title: 'DSH Market MCP search rank is below target',
    body: '<!-- market-search-rank-monitor -->',
    user: { login: 'github-actions[bot]' },
  };
  const calls = await runReconciliation({ report: rankReport(true), issues: [...unrelated, existing] });
  assert.equal(calls.create.length, 0);
  assert.equal(calls.createComment.length, 1);
  assert.equal(calls.createComment[0].issue_number, 212);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].state, 'closed');
});
