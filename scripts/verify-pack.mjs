/**
 * 发布前校验 npm 包内容，防止测试、设计稿、工作流或本地文件被误发布。
 */
import { execFileSync } from 'node:child_process';

const WHITELIST = [
  /^package\.json$/,
  /^cordis\.patch\.yml$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^install\.sh$/,
  /^catalog\/[^/]+\.json$/,
  /^lib\/[^/]+\.js$/,
  /^lib\/connectors\/[^/]+\.js$/,
  /^ui\/index\.html$/,
  /^ui\/assets\/[^/]+\.(?:svg|png|webp)$/,
];

let raw;
try {
  raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  console.error('verify-pack 失败：`npm pack --dry-run --json` 执行出错');
  console.error(String(error.stderr ?? error.message));
  process.exit(1);
}

const [pack] = JSON.parse(raw);
if (!pack || !Array.isArray(pack.files)) {
  console.error('verify-pack 失败：无法解析 npm pack 输出');
  process.exit(1);
}

const files = pack.files.map((file) => file.path).sort();
const stray = files.filter((file) => !WHITELIST.some((rule) => rule.test(file)));
if (stray.length > 0) {
  console.error('verify-pack 失败：以下文件不应进入 npm 发布包：');
  for (const file of stray) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`verify-pack 通过：${files.length} 个发布文件全部在白名单内`);
