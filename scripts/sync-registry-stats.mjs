#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_STATS_URL =
  'https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog-stats.json';
export const STATS_START = '<!-- catalog-stats:start -->';
export const STATS_END = '<!-- catalog-stats:end -->';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function normalizeStats(value) {
  if (!value || Array.isArray(value) || value.schemaVersion !== 1) {
    throw new Error('registry stats must use schemaVersion 1');
  }
  const registryCount = positiveInteger(value.registryCount, 'registryCount');
  const bundledUniqueCount = positiveInteger(value.bundledUniqueCount, 'bundledUniqueCount');
  const marketCount = positiveInteger(value.marketCount, 'marketCount');
  const featuredCount = positiveInteger(value.featuredCount, 'featuredCount');
  const categoryCount = positiveInteger(value.categoryCount, 'categoryCount');
  if (marketCount !== registryCount + bundledUniqueCount) {
    throw new Error('marketCount must equal registryCount + bundledUniqueCount');
  }
  if (featuredCount > marketCount) throw new Error('featuredCount must not exceed marketCount');
  if (!Array.isArray(value.categoryNames) || value.categoryNames.length !== categoryCount) {
    throw new Error('categoryNames length must equal categoryCount');
  }
  const categoryNames = value.categoryNames.map((name) => {
    if (typeof name !== 'string' || !/^[\p{L}\p{N} .&+/-]{1,40}$/u.test(name)) {
      throw new Error('categoryNames contains an unsafe value');
    }
    return name;
  });
  if (new Set(categoryNames).size !== categoryNames.length) throw new Error('categoryNames must be unique');
  if (typeof value.updatedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.updatedOn)) {
    throw new Error('updatedOn must use YYYY-MM-DD');
  }
  return {
    schemaVersion: 1,
    registryCount,
    bundledUniqueCount,
    marketCount,
    featuredCount,
    categoryCount,
    categoryNames,
    updatedOn: value.updatedOn,
  };
}

export function renderChineseStats(stats) {
  return `${STATS_START}\n截至 ${stats.updatedOn}，公共 Registry 已发布 ${stats.registryCount} 条连接器描述；与随包的 ${stats.bundledUniqueCount} 张企查查卡片合并去重后，市场页可浏览 ${stats.marketCount} 张卡片，覆盖${stats.categoryNames.join('、')} ${stats.categoryCount} 类。推荐位严格保留 4 张企查查卡片、北大法宝和 Wind，共 ${stats.featuredCount} 张；其他连接器按业务分类展示。Registry 可独立持续更新，实际数量以客户端刷新后的市场页签徽标和上方实时统计徽标为准。\n${STATS_END}`;
}

export function renderEnglishStats(stats) {
  return `${STATS_START}\nAs of ${stats.updatedOn}, the public Registry publishes ${stats.registryCount} connector descriptors. After merging and deduplicating them with the ${stats.bundledUniqueCount} bundled Qichacha cards, the Marketplace exposes ${stats.marketCount} cards across ${stats.categoryCount} business categories. Recommendations remain limited to the four Qichacha cards, PKULaw, and Wind, for ${stats.featuredCount} featured cards in total. The Registry evolves independently; the badge shown after a client refresh and the live badges above are the authoritative current counts.\n${STATS_END}`;
}

export function replaceStatsBlock(text, replacement) {
  const start = text.indexOf(STATS_START);
  const end = text.indexOf(STATS_END);
  if (start === -1 || end === -1 || end < start) throw new Error('README catalog stats markers are missing or invalid');
  return `${text.slice(0, start)}${replacement}${text.slice(end + STATS_END.length)}`;
}

async function fetchStats(url, { fetchImpl = fetch, attempts = 3, timeoutMs = 15_000 } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'raw.githubusercontent.com') {
    throw new Error('stats URL must use https://raw.githubusercontent.com');
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': 'dsh-mcp-connector-stats-sync' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeStats(await response.json());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`unable to fetch registry stats after ${attempts} attempts: ${lastError?.message ?? lastError}`);
}

export async function syncRegistryStats({
  sourcePath,
  statsUrl = DEFAULT_STATS_URL,
  chineseReadmePath = 'README.md',
  englishReadmePath = 'README.en.md',
  snapshotPath = 'docs/registry-stats.json',
  fetchImpl,
} = {}) {
  const stats = sourcePath
    ? normalizeStats(JSON.parse(await readFile(resolve(sourcePath), 'utf8')))
    : await fetchStats(statsUrl, { fetchImpl });
  const [chinese, english] = await Promise.all([
    readFile(resolve(chineseReadmePath), 'utf8'),
    readFile(resolve(englishReadmePath), 'utf8'),
  ]);
  await Promise.all([
    writeFile(resolve(chineseReadmePath), replaceStatsBlock(chinese, renderChineseStats(stats))),
    writeFile(resolve(englishReadmePath), replaceStatsBlock(english, renderEnglishStats(stats))),
    writeFile(resolve(snapshotPath), `${JSON.stringify(stats, null, 2)}\n`),
  ]);
  return stats;
}

function sourceArgument(argv) {
  const index = argv.indexOf('--source');
  if (index === -1) return undefined;
  if (!argv[index + 1]) throw new Error('--source requires a local JSON path');
  return argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncRegistryStats({ sourcePath: sourceArgument(process.argv.slice(2)) }).then((stats) => {
    console.log(`registry-stats: synced ${stats.registryCount} registry / ${stats.marketCount} market connectors`);
  }).catch((error) => {
    console.error(`registry-stats: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
