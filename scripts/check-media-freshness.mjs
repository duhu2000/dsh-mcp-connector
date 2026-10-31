import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const INPUTS = ['ui/index.html', 'ui/sharing-experience.js', 'ui/connection-template-sharing.js', 'scripts/ui-harness.mjs', 'scripts/capture-storefront.mjs', 'catalog/catalog.json', 'scripts/fixtures/storefront-catalog.json'];
export async function sourceFingerprint(root = process.cwd()) {
  const hash = createHash('sha256');
  for (const path of INPUTS) { hash.update(path + '\0'); hash.update(await readFile(resolve(root, path))); }
  return hash.digest('hex');
}
export function freshnessErrors(meta, version, fingerprint, now = new Date()) {
  const errors = [];
  for (const item of [meta.capture, ...meta.screenshots, meta.demo]) {
    if (item.sourceVersion !== version) errors.push('capture version differs from package.json');
    const date = new Date(`${item.capturedOn}T00:00:00Z`);
    const age = (now - date) / 86400000;
    if (!Number.isFinite(age) || age < -1 || age > 14) errors.push('capture date missing, future or older than 14 days');
  }
  if (meta.capture.sourceFingerprint !== fingerprint) errors.push('UI/capture source changed');
  return [...new Set(errors)];
}
export async function checkFreshness(root = process.cwd()) {
  const meta = JSON.parse(await readFile(resolve(root,'docs/screenshots/assets.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(root,'package.json'), 'utf8'));
  const errors = freshnessErrors(meta, pkg.version, await sourceFingerprint(root));
  if (errors.length) throw Error(`${errors.join('; ')}. Run npm run storefront:capture && npm run docs:sync before release.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkFreshness().then(() => console.log('Product media is current')).catch(e => { console.error(e.message); process.exitCode = 1; });
}
