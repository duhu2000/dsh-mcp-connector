/**
 * 发布前校验 npm 包内容，防止测试、设计稿、工作流或本地文件被误发布。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WHITELIST = [
  /^package\.json$/,
  /^cordis\.patch\.yml$/,
  /^README\.md$/,
  /^README\.en\.md$/,
  /^screenshots\.json$/,
  /^CONTRIBUTING\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE$/,
  /^install\.sh$/,
  /^catalog\/[^/]+\.json$/,
  /^lib\/[^/]+\.js$/,
  /^lib\/connectors\/[^/]+\.js$/,
  /^scripts\/(?:probe-connector|build-registry|ui-harness)\.mjs$/,
  /^registry\/README\.md$/,
  /^registry\/catalog\.json$/,
  /^registry\/connectors\/[^/]+\.json$/,
  /^registry\/schema\/[^/]+\.json$/,
  /^docs\/(?:DESKTOP-E2E|MARKET-REGISTRATION|PLUGIN-UPDATE|STDIO-SUPPORT|USER-GUIDE)\.md$/,
  /^docs\/screenshots\/(?:README\.md|[^/]+\.(?:gif|jpe?g|png|svg|webp))$/,
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

const sensitivePatterns = [
  ['私钥', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['npm token', /npm_[A-Za-z0-9]{20,}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['OpenAI 风格密钥', /sk-[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['本机绝对路径', /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/],
];
const sensitive = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const [label, pattern] of sensitivePatterns) {
    if (pattern.test(content)) sensitive.push(`${file}: ${label}`);
  }
}
if (sensitive.length > 0) {
  console.error('verify-pack 失败：发布文件疑似包含凭证或本机信息：');
  for (const item of sensitive) console.error(`  - ${item}`);
  process.exit(1);
}

const installScript = readFileSync('install.sh', 'utf8');
if (!/^PKG="dsh-mcp-connector"$/m.test(installScript)) {
  console.error('verify-pack 失败：install.sh 未安装 dsh-mcp-connector');
  process.exit(1);
}

console.log(`verify-pack 通过：${files.length} 个发布文件均在白名单内，且未发现凭证或本机路径`);
