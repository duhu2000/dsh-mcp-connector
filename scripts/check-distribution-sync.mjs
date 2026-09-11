#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKAGE_NAME = 'dsh-mcp-connector';
const REPOSITORY_URL = 'https://github.com/duhu2000/dsh-mcp-connector';

export const DEFAULT_TARGETS = [
  {
    id: 'awesome-dsh-plugin',
    label: 'awesome-dsh-plugin / DSH Market upstream',
    url: 'https://awesome-dsh-plugin.com/plugins.json',
    parser: 'awesome',
    trackingUrl: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4821',
  },
  {
    id: 'dshfind',
    label: 'dshfind',
    url: 'https://api.dshfind.com/v1/plugins/duhu2000/dsh-mcp-connector',
    parser: 'dshfind',
  },
  {
    id: 'dsh-directory',
    label: 'DSH Directory',
    url: 'https://dsh.directory/plugins/duhu2000/dsh-mcp-connector',
    parser: 'json-ld',
  },
  {
    id: 'dsh-pub',
    label: 'dsh.pub',
    url: 'https://dsh.pub/en/plugins/dsh-mcp-connector/',
    parser: 'json-ld',
    trackingUrl: 'https://github.com/dsh-pub/dsh-pub/issues/88',
  },
  {
    id: 'dshbase',
    label: 'dshbase',
    url: 'https://www.dshbase.com/plugins/dsh-mcp-connector/',
    parser: 'dshbase',
    trackingUrl: 'https://github.com/ylwl1997/dshbase/issues/100',
  },
];

function normalizeVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? null;
}

function normalizeRepository(value) {
  return String(value ?? '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function parseAwesome(payload) {
  const plugins = Array.isArray(payload) ? payload : payload?.plugins;
  if (!Array.isArray(plugins)) return { observedVersion: null, detail: 'plugins.json has no plugins array' };
  const expectedRepository = normalizeRepository(REPOSITORY_URL);
  const plugin = plugins.find((candidate) => candidate?.name === PACKAGE_NAME
    || normalizeRepository(candidate?.url ?? candidate?.repository) === expectedRepository);
  if (!plugin) return { observedVersion: null, detail: 'connector entry is missing' };
  return {
    observedVersion: normalizeVersion(plugin.version),
    npmPublished: plugin.npm === PACKAGE_NAME,
    detail: `catalog updated ${payload?.updated ?? 'unknown'}`,
  };
}

export function parseDshfind(payload) {
  const install = payload?.install ?? {};
  return {
    observedVersion: normalizeVersion(install.pkg_version),
    npmPublished: install.npm_published === true && install.pkg_name === PACKAGE_NAME,
    detail: `last synced ${payload?.last_synced_at ?? payload?.as_of ?? 'unknown'}`,
  };
}

export function parseJsonLdPage(text) {
  const html = String(text ?? '');
  const repositoryMarker = 'duhu2000/dsh-mcp-connector';
  if (!html.toLowerCase().includes(repositoryMarker)) {
    return { observedVersion: null, detail: 'connector identity is missing from the page' };
  }
  const structuredVersion = html.match(/"version"\s*:\s*"v?([^"\s]+)"/i)?.[1];
  const fieldVersion = html.match(/<dt[^>]*>Version<\/dt>\s*<dd[^>]*>v?([^<\s]+)<\/dd>/i)?.[1];
  return {
    observedVersion: normalizeVersion(structuredVersion ?? fieldVersion),
    npmPublished: html.includes(`npmjs.com/package/${PACKAGE_NAME}`),
    detail: 'public plugin page',
  };
}

export function parseDshbasePage(text) {
  const html = String(text ?? '');
  const releaseVersion = html.match(/dsh-mcp-connector\/releases\/tag\/v([^"'<\s]+)/i)?.[1];
  const deniesNpm = /not published to npm/i.test(html);
  return {
    observedVersion: normalizeVersion(releaseVersion),
    npmPublished: !deniesNpm && html.includes(`npmjs.com/package/${PACKAGE_NAME}`),
    detail: deniesNpm ? 'page incorrectly says the package is not published to npm' : 'public plugin page',
  };
}

export function assessTarget({ target, canonicalVersion, parsed, error }) {
  if (error) {
    return {
      id: target.id,
      label: target.label,
      url: target.url,
      trackingUrl: target.trackingUrl,
      status: 'unavailable',
      expectedVersion: canonicalVersion,
      observedVersion: null,
      detail: error.message,
    };
  }

  if (!parsed?.observedVersion) {
    return {
      id: target.id,
      label: target.label,
      url: target.url,
      trackingUrl: target.trackingUrl,
      status: 'missing',
      expectedVersion: canonicalVersion,
      observedVersion: null,
      detail: parsed?.detail ?? 'version is not exposed',
    };
  }

  const versionMatches = parsed.observedVersion === canonicalVersion;
  const npmInvalid = parsed.npmPublished === false;
  return {
    id: target.id,
    label: target.label,
    url: target.url,
    trackingUrl: target.trackingUrl,
    status: npmInvalid ? 'invalid' : versionMatches ? 'current' : 'stale',
    expectedVersion: canonicalVersion,
    observedVersion: parsed.observedVersion,
    npmPublished: parsed.npmPublished,
    detail: parsed.detail,
  };
}

function parseTarget(target, body) {
  if (target.parser === 'awesome') return parseAwesome(JSON.parse(body));
  if (target.parser === 'dshfind') return parseDshfind(JSON.parse(body));
  if (target.parser === 'json-ld') return parseJsonLdPage(body);
  if (target.parser === 'dshbase') return parseDshbasePage(body);
  throw new Error(`unknown parser: ${target.parser}`);
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: '*/*', 'user-agent': 'dsh-mcp-connector-distribution-check' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export function reportMarkdown(report) {
  const icons = { current: '✅', stale: '⚠️', invalid: '❌', missing: '❌', unavailable: '⏳' };
  const lines = [
    '## MCP Connector external directory sync',
    '',
    `Canonical npm version: \`${report.canonicalVersion}\``,
    '',
    '| Directory | Status | Observed | Tracking | Detail |',
    '|---|---|---|---|---|',
  ];
  for (const target of report.targets) {
    const detail = String(target.detail ?? '').replaceAll('|', '\\|');
    const tracking = target.trackingUrl ? `[follow-up](${target.trackingUrl})` : '-';
    lines.push(`| [${target.label}](${target.url}) | ${icons[target.status]} \`${target.status}\` | \`${target.observedVersion ?? '-'}\` | ${tracking} | ${detail} |`);
  }
  lines.push('', `Checked: ${report.checkedAt}`);
  return `${lines.join('\n')}\n`;
}

export async function checkDistributionSync({ fetchImpl = fetch, targets = DEFAULT_TARGETS } = {}) {
  const npmUrl = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
  const npmPayload = JSON.parse(await fetchText(fetchImpl, npmUrl));
  const canonicalVersion = normalizeVersion(npmPayload.version);
  if (!canonicalVersion) throw new Error(`npm latest returned an invalid version: ${npmPayload.version ?? '<missing>'}`);

  const results = await Promise.all(targets.map(async (target) => {
    try {
      const body = await fetchText(fetchImpl, target.url);
      return assessTarget({ target, canonicalVersion, parsed: parseTarget(target, body) });
    } catch (error) {
      return assessTarget({ target, canonicalVersion, error });
    }
  }));

  const blockingStatuses = new Set(['stale', 'invalid', 'missing']);
  return {
    package: PACKAGE_NAME,
    canonicalVersion,
    checkedAt: new Date().toISOString(),
    ok: !results.some((result) => blockingStatuses.has(result.status)),
    converged: results.every((result) => result.status === 'current'),
    targets: results,
  };
}

export async function runDistributionSyncCheck({ env = process.env, args = process.argv.slice(2), fetchImpl = fetch } = {}) {
  const report = await checkDistributionSync({ fetchImpl });
  const markdown = reportMarkdown(report);
  console.log(JSON.stringify(report, null, 2));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.DISTRIBUTION_REPORT_PATH) writeFileSync(env.DISTRIBUTION_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return args.includes('--strict-sync') && !report.ok ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runDistributionSyncCheck()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(`External directory sync check failed: ${error.message}`);
      process.exitCode = 1;
    });
}
