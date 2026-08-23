import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadBundledCatalog, listCatalog, mergeCatalog, fetchRemoteCatalog, readLimitedJson } from '../lib/catalog.js';
import { normalizeConnectorDescriptor } from '../lib/schema.js';

function desc(id, { published = true, featured = false, category = '其他' } = {}) {
  return normalizeConnectorDescriptor({
    id,
    name: id,
    category,
    published,
    featured,
    servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: `${id}-a` }],
  });
}

test('内置目录加载 + published 过滤', () => {
  const bundled = loadBundledCatalog();
  assert.ok(bundled.length >= 3, '内置目录应至少 3 条');
  const published = listCatalog(bundled, {});
  assert.ok(published.every((d) => d.published !== false));
  assert.ok(!published.some((d) => d.id === 'legacy-internal'), 'published:false 不应出现');
  assert.ok(published.some((d) => d.id === 'qcc-company'));
  const qccCards = published.filter((d) => d.id.startsWith('qcc-'));
  assert.equal(qccCards.length, 4, '内置目录应包含 4 张企查查卡片');
  assert.ok(qccCards.every((d) => d.icon === '/mcp-connector/ui/assets/qcc-logo.svg'), '4 张卡片统一使用内置企查查 Logo');
  assert.ok(qccCards.every((d) => d.prompts.length > 0), '4 张卡片均应提供可快速体验的 Prompt');
  assert.ok(qccCards.flatMap((d) => d.prompts).some((prompt) => prompt.text.includes('{{')), 'Prompt 应使用参数模板');
  assert.ok(!qccCards.flatMap((d) => d.prompts).some((prompt) => /小米科技|华为技术|雷军/.test(prompt.text)), '目录不应再硬编码示例主体');
  assert.ok(qccCards.every((d) => d.promptVariables.every((variable) => variable.required === false || variable.default)), '内置 Prompt 必填参数应提供可直接试用的默认示例');
  const pkulaw = published.find((d) => d.id === 'pkulaw-legal');
  assert.equal(pkulaw?.auth.mode, 'bearer', '北大法宝应以 Bearer Token 方式接入');
  assert.equal(pkulaw?.auth.credentialName, '北大法宝 Access Token');
  assert.equal(pkulaw?.servers.length, 9, '北大法宝卡片应一次配置官网公开的 9 个 Server');
  assert.equal(pkulaw?.icon, '/mcp-connector/ui/assets/pkulaw-logo.png', '北大法宝应使用内置官网 Logo');
  const wind = published.find((d) => d.id === 'wind-stock-data');
  assert.equal(wind?.auth.mode, 'bearer', 'Wind 股票数据应以 Bearer Wind Key 接入');
  assert.equal(wind?.auth.credentialName, 'Wind API Key（个人密钥）');
  assert.equal(wind?.servers.length, 1, 'Wind 股票数据卡片只接入官网当前公开的股票 MCP Server');
  assert.equal(wind?.servers[0]?.url, 'https://mcp.wind.com.cn/vserver_stock_data/mcp/');
  assert.equal(wind?.servers[0]?.headers.Accept, 'application/json, text/event-stream');
  assert.deepEqual(published.filter((d) => d.featured).map((d) => d.id).sort(), ['pkulaw-legal', 'qcc-company', 'wind-stock-data'], '内置目录应有 3 个推荐位（featured）');
  assert.deepEqual(published.slice(0, 6).map((d) => d.id), ['qcc-company', 'pkulaw-legal', 'wind-stock-data', 'qcc-legal', 'qcc-tender', 'qcc-document'], 'featured 连接器应排前');
});

test('mergeCatalog 优先级 + 本地覆盖', () => {
  const low = [desc('a'), desc('shared', { published: false })];
  const high = [desc('b'), desc('shared', { published: true })];
  const overrides = new Map([['b', { published: false }]]);
  const merged = mergeCatalog([low, high], overrides);
  const byId = Object.fromEntries(merged.map((d) => [d.id, d]));
  assert.equal(byId.shared.published, true, '高层覆盖低层');
  assert.equal(byId.b.published, false, '本地覆盖覆盖一切');
});

test('listCatalog 分类/关键词/精选排序', () => {
  const list = [desc('x', { category: '企业数据' }), desc('y', { category: '地图出行', featured: true }), desc('z', { category: '企业数据' })];
  const byCat = listCatalog(list, { category: '企业数据' });
  assert.deepEqual(byCat.map((d) => d.id).sort(), ['x', 'z']);
  const featured = listCatalog(list, {})[0];
  assert.equal(featured.id, 'y', 'featured 置顶');
  const kw = listCatalog(list, { keyword: '地图' });
  assert.equal(kw.length, 1);
});

test('listCatalog 同级连接器保留市场声明顺序', () => {
  const list = [desc('first'), desc('second'), desc('third')];
  assert.deepEqual(listCatalog(list, {}).map((item) => item.id), ['first', 'second', 'third']);
});

test('fetchRemoteCatalog 拉取并解析 { connectors } 结构', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"v1"' });
    res.end(JSON.stringify({ connectors: [{ id: 'remote-a', name: 'Remote', servers: [{ serverKey: 'a', url: 'https://mcp.example.com/stream', serverName: 'remote-a' }] }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const result = await fetchRemoteCatalog(`http://127.0.0.1:${port}/catalog.json`, { requestTimeoutMs: 5000 });
    assert.equal(result.notModified, false);
    assert.equal(result.connectors.length, 1);
    assert.equal(result.connectors[0].id, 'remote-a');
  } finally {
    server.close();
  }
});

test('readLimitedJson 拒绝超限目录响应', async () => {
  const response = new Response(JSON.stringify({ value: '0123456789' }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => readLimitedJson(response, 5), /超过 5 bytes/);
});
