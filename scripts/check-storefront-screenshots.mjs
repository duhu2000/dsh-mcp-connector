import { access, readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_SCREENSHOTS = 8;
export const SUPPORTED_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

function screenshotList(document) {
  if (Array.isArray(document)) return document;
  if (document && Array.isArray(document.screenshots)) return document.screenshots;
  throw new Error('screenshots.json 必须是路径数组或 {"screenshots": [...]}');
}

export async function checkStorefrontScreenshots({
  manifestPath = 'screenshots.json',
  repositoryRoot = process.cwd(),
} = {}) {
  const root = resolve(repositoryRoot);
  const absoluteManifest = resolve(root, manifestPath);
  const screenshots = screenshotList(JSON.parse(await readFile(absoluteManifest, 'utf8')));

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
