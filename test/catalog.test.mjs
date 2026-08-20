import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadBundledCatalog, listCatalog, mergeCatalog, fetchRemoteCatalog } from '../lib/catalog.js';
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
