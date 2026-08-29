#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PACKAGE_NAME = 'dsh-mcp-connector';
const README_PATHS = ['README.md', 'README.en.md'];

export function referencedVersions(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

export function assertCurrentReferences(path, text, version) {
  const npmVersions = referencedVersions(text, /dsh-mcp-connector@(\d+\.\d+\.\d+)/g);
  const releaseVersions = referencedVersions(text, /releases\/tag\/v(\d+\.\d+\.\d+)/g);
  const errors = [];

  if (npmVersions.length === 0) errors.push(`missing ${PACKAGE_NAME}@<version> reference`);
  if (releaseVersions.length === 0) errors.push('missing GitHub Release v<version> reference');
  for (const found of new Set([...npmVersions, ...releaseVersions])) {
    if (found !== version) errors.push(`references ${found}, expected ${version}`);
  }
  if (errors.length > 0) throw new Error(`${path}: ${errors.join('; ')}`);
}

export async function checkReadmeVersions({
  packagePath = 'package.json',
  readmePaths = README_PATHS,
} = {}) {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  if (packageJson.name !== PACKAGE_NAME || typeof packageJson.version !== 'string') {
    throw new Error(`${packagePath} must declare ${PACKAGE_NAME} with a version`);
  }
  for (const path of readmePaths) {
    assertCurrentReferences(path, await readFile(path, 'utf8'), packageJson.version);
  }
  return packageJson.version;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  checkReadmeVersions().then((version) => {
    console.log(`README 版本校验通过：${PACKAGE_NAME}@${version}`);
  }).catch((error) => {
    console.error(`README 版本校验失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
