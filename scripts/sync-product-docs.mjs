import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function replaceGenerated(text, key, value) {
  const start = `<!-- generated:${key} -->`, end = `<!-- /generated:${key} -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2) throw Error(`Missing or duplicate generated block: ${key}`);
  const a = text.indexOf(start) + start.length, b = text.indexOf(end);
  if (b < a) throw Error(`Invalid generated block: ${key}`);
  return text.slice(0, a) + value + text.slice(b);
}

export async function syncProductDocs({root = process.cwd(), check = false} = {}) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const assets = JSON.parse(await readFile(resolve(root, 'docs/screenshots/assets.json'), 'utf8'));
  const v = pkg.version, capture = assets.capture;
  const zh = `截图与 GIF 采集自 v${capture.sourceVersion}（${capture.capturedOn}）无凭据 Mock 页面，展示界面而非真实业务验收；市场数量是测试夹具。来源与更新方法见 [素材说明](docs/screenshots/README.md)。`;
  const en = `Screenshots and GIF were captured from v${capture.sourceVersion} (${capture.capturedOn}), using the credential-free Mock harness. They demonstrate UI, not real business acceptance; counts are fixtures. See [asset provenance](docs/screenshots/README.md).`;
  const blocks = {
    'README.md': { version: `当前公开版本为 [\`dsh-mcp-connector@${v}\`](https://www.npmjs.com/package/dsh-mcp-connector)，对应 [GitHub Release v${v}](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v${v})。`, media: zh },
    'README.en.md': { version: `The current public version is [\`dsh-mcp-connector@${v}\`](https://www.npmjs.com/package/dsh-mcp-connector), with [GitHub Release v${v}](https://github.com/duhu2000/dsh-mcp-connector/releases/tag/v${v}).`, media: en },
    'docs/tutorials/FIRST-SUCCESS-SCENARIOS.md': { version: `正式 \`dsh-mcp-connector@${v}\`` },
    'docs/screenshots/README.md': { media: `本组 7 张截图和 GIF 均从 v${capture.sourceVersion} 于 ${capture.capturedOn} 重新采集，未修改截图中的版本文字。` },
  };
  const drift = [];
  for (const [path, values] of Object.entries(blocks)) {
    const file = resolve(root, path), before = await readFile(file, 'utf8');
    let after = before;
    for (const [key, value] of Object.entries(values)) after = replaceGenerated(after, key, value);
    if (before !== after) { drift.push(path); if (!check) await writeFile(file, after); }
  }
  if (check && drift.length) throw Error(`Generated product copy is stale: ${drift.join(', ')}. Run npm run docs:sync`);
  return drift;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncProductDocs({check: process.argv.includes('--check')}).then(paths => console.log(`Product docs: ${paths.length} changed`)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
