import { access, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_SCREENSHOTS = 8;
export const SUPPORTED_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

function screenshotList(document) {
  if (Array.isArray(document)) return document;
  if (document && Array.isArray(document.screenshots)) return document.screenshots;
  throw new Error('screenshots.json 必须是路径数组或 {"screenshots": [...]}');
}

export function imageDimensions(bytes, path = 'image') {
  if (bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length >= 24 && bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      const length = bytes.readUInt16BE(offset);
      if (sofMarkers.has(marker)) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      if (length < 2) break;
      offset += length;
    }
  }
  throw new Error(`无法读取图片尺寸：${path}`);
}

export function gifDurationSeconds(bytes) {
  let hundredths = 0;
  for (let offset = 0; offset + 7 < bytes.length; offset += 1) {
    if (bytes[offset] === 0x21 && bytes[offset + 1] === 0xf9 && bytes[offset + 2] === 0x04) {
      hundredths += bytes.readUInt16LE(offset + 4);
    }
  }
  return hundredths / 100;
}

async function verifyAsset(root, expected) {
  const absolutePath = resolve(root, normalize(expected.path));
  const pathFromRoot = relative(root, absolutePath);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) throw new Error(`素材路径不能离开仓库：${expected.path}`);
  const bytes = await readFile(absolutePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected.sha256) throw new Error(`${expected.path} SHA-256 漂移：${sha256}`);
  const dimensions = imageDimensions(bytes, expected.path);
  if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
    throw new Error(`${expected.path} 尺寸漂移：${dimensions.width}x${dimensions.height}，预期 ${expected.width}x${expected.height}`);
  }
  if (expected.durationSeconds !== undefined) {
    const durationSeconds = gifDurationSeconds(bytes);
    if (Math.abs(durationSeconds - expected.durationSeconds) > 0.05) {
      throw new Error(`${expected.path} 时长漂移：${durationSeconds.toFixed(2)} 秒，预期 ${expected.durationSeconds} 秒`);
    }
  }
}

export async function checkStorefrontScreenshots({
  manifestPath = 'screenshots.json',
  repositoryRoot = process.cwd(),
  assetMetadataPath = 'docs/screenshots/assets.json',
} = {}) {
  const root = resolve(repositoryRoot);
  const absoluteManifest = resolve(root, manifestPath);
  const document = JSON.parse(await readFile(absoluteManifest, 'utf8'));
  const screenshots = screenshotList(document);

  if (screenshots.length < 1 || screenshots.length > MAX_SCREENSHOTS) {
    throw new Error(`screenshots.json 必须声明 1-${MAX_SCREENSHOTS} 张图片，当前为 ${screenshots.length} 张`);
  }

  const manifestDirectory = dirname(absoluteManifest);
  const seen = new Set();
  for (const screenshot of screenshots) {
    if (typeof screenshot !== 'string' || screenshot.trim() !== screenshot || screenshot.length === 0) {
      throw new Error('每个截图路径必须是非空且无首尾空格的字符串');
    }
    if (/^https?:\/\//i.test(screenshot) || isAbsolute(screenshot)) {
      throw new Error(`截图必须使用仓库内相对路径：${screenshot}`);
    }

    const absoluteScreenshot = resolve(manifestDirectory, normalize(screenshot));
    const pathFromRoot = relative(root, absoluteScreenshot);
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new Error(`截图路径不能离开仓库：${screenshot}`);
    }
    if (seen.has(pathFromRoot)) throw new Error(`截图路径重复：${screenshot}`);
    seen.add(pathFromRoot);

    const extension = extname(absoluteScreenshot).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`不支持的截图格式：${screenshot}`);
    await access(absoluteScreenshot);
    if (!(await stat(absoluteScreenshot)).isFile()) throw new Error(`截图路径不是文件：${screenshot}`);
  }

  const resolvedMetadataPath = document?.assetMetadata ?? assetMetadataPath;
  if (resolvedMetadataPath) {
    const absoluteMetadata = resolve(root, normalize(resolvedMetadataPath));
    const metadataFromRoot = relative(root, absoluteMetadata);
    if (metadataFromRoot.startsWith('..') || isAbsolute(metadataFromRoot)) throw new Error('assetMetadata 不能离开仓库');
    const metadata = JSON.parse(await readFile(absoluteMetadata, 'utf8'));
    if (metadata.schemaVersion !== 1) throw new Error('截图素材元数据必须使用 schemaVersion 1');
    const metadataPaths = metadata.screenshots?.map((item) => item.path) ?? [];
    if (JSON.stringify(metadataPaths) !== JSON.stringify(screenshots)) throw new Error('screenshots.json 与素材元数据路径或顺序不一致');
    if (metadata.capture?.browserViewport?.width !== 1280 || metadata.capture?.browserViewport?.height !== 720) throw new Error('Storefront 浏览器采集视口必须为 1280x720');
    if (metadata.capture?.productPanelWidth !== 800 || metadata.capture?.desktopCardColumns !== 2) throw new Error('Storefront 必须复刻 800px 产品面板与桌面两列卡片');
    if (metadata.capture?.state !== 'credential-free-mock') throw new Error('Storefront 必须使用无凭据 Mock 状态');
    for (const expected of metadata.screenshots ?? []) await verifyAsset(root, expected);
    if (!metadata.demo) throw new Error('demo.gif 素材元数据缺失');
    await verifyAsset(root, metadata.demo);
  }

  return screenshots;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkStorefrontScreenshots()
    .then((screenshots) => console.log(`Storefront 截图校验通过：${screenshots.length} 张图片`))
    .catch((error) => {
      console.error(`Storefront 截图校验失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
