import { mkdir, writeFile } from 'node:fs/promises';
const output = new URL('../distribution/dsh-index/', import.meta.url);
const names = ['dsh-mcp-connector', 'qcc-dsh-mcp-oauth', 'qcc-dsh-mcp-legal-oauth'];
const titles = {
  'dsh-mcp-connector': { en: 'MCP Connector — Data Marketplace', zh: 'MCP连接器 · 专业数据源市场' },
  'qcc-dsh-mcp-oauth': { en: 'Qichacha Enterprise Data OAuth', zh: '企查查 · 企业数据 OAuth' },
  'qcc-dsh-mcp-legal-oauth': { en: 'Qichacha Legal Data OAuth', zh: '企查查 · 法律数据 OAuth' },
};
const plugins = [], evidence = [];
for (const name of names) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const packument = await response.json();
  const version = packument['dist-tags']?.latest;
  const manifest = packument.versions?.[version];
  if (!manifest?.dsh?.bundle || manifest.deprecated || manifest.private) throw new Error(`${name}: latest is not an eligible public bundle`);
  const timestamp = Date.parse(packument.time?.[version]) / 1000;
  if (!Number.isFinite(timestamp)) throw new Error(`${name}: missing publication timestamp`);
  const entry = {
    name, title: titles[name], description: manifest.description || name,
    versions: [{ version, publishTimestamp: Math.floor(timestamp), source: { type: 'npm', registry: 'https://registry.npmjs.org/' },
      ...(manifest.engines?.dsh ? { engines: { dsh: manifest.engines.dsh } } : {}) }],
  };
  if (manifest.homepage?.startsWith('https://')) entry.homepage = manifest.homepage;
  const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (repo?.replace(/^git\+/, '').startsWith('https://')) entry.repository = { url: repo.replace(/^git\+/, '').replace(/\.git$/, '') };
  plugins.push(entry);
  evidence.push({ name, version, source: url, publishedAt: packument.time[version], license: manifest.license,
    engines: manifest.engines, peerDependencies: manifest.peerDependencies, integrity: manifest.dist?.integrity,
    checkedAt: new Date().toISOString() });
}
await mkdir(output, { recursive: true });
await writeFile(new URL('index.json', output), JSON.stringify({ format: 1, title: { en: 'QCC Community Plugins', zh: '企查查社区插件' },
  description: { en: 'Independent third-party index; not an official DeepSeek marketplace.', zh: '独立第三方插件索引；非 DeepSeek 官方市场或官方推荐。数据服务授权与费用另计。' }, plugins }, null, 2) + '\n');
// Evidence is emitted to stdout, not committed with changing timestamps.
console.log(JSON.stringify(evidence, null, 2));
console.log(evidence.map(x => `${x.name}@${x.version}`).join('\n'));
