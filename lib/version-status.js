import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const INSTALLED_PLUGIN_VERSION = packageJson.version;
export const NPM_LATEST_URL = 'https://registry.npmjs.org/dsh-mcp-connector/latest';
export const NPM_PACKAGE_URL = 'https://www.npmjs.com/package/dsh-mcp-connector';
export const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/duhu2000/dsh-mcp-connector/releases/latest';
export const GITHUB_RELEASES_URL = 'https://github.com/duhu2000/dsh-mcp-connector/releases';
export const VERSION_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
export const VERSION_CHECK_FAILURE_TTL_MS = 5 * 60 * 1000;

function normalizeVersion(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/^v/i, '');
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : undefined;
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  if (!normalized) return undefined;
  const [withoutBuild] = normalized.split('+');
  const [core, prerelease] = withoutBuild.split('-', 2);
  return {
    normalized,
    core: core.split('.').map(Number),
    prerelease: prerelease?.split('.') ?? [],
  };
}

/** Compare two semantic versions. Returns a positive number when `left` is newer. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) - Number(bPart);
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return aPart.localeCompare(bPart);
  }
  return 0;
}

export function isVersionNewer(candidate, installed) {
  return compareVersions(candidate, installed) > 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(fetchImpl, url, { timeoutMs, headers, activeControllers }) {
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': `dsh-mcp-connector/${INSTALLED_PLUGIN_VERSION}`,
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

/**
 * Check npm and GitHub without exposing those origins to the iframe CSP.
 * npm `latest` is the update authority; GitHub is supplemental release metadata.
 */
export function createVersionStatusService({
  installedVersion = INSTALLED_PLUGIN_VERSION,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  cacheTtlMs = VERSION_CHECK_TTL_MS,
  failureTtlMs = VERSION_CHECK_FAILURE_TTL_MS,
  now = () => Date.now(),
  logger,
} = {}) {
  let cached;
  let expiresAt = 0;
  let inFlight;
  const activeControllers = new Set();

  async function query() {
    const checkedAtMs = now();
    const [npmResult, githubResult] = await Promise.allSettled([
      fetchJson(fetchImpl, NPM_LATEST_URL, { timeoutMs, activeControllers }),
      fetchJson(fetchImpl, GITHUB_LATEST_RELEASE_URL, {
        timeoutMs,
        activeControllers,
        headers: { accept: 'application/vnd.github+json' },
      }),
    ]);

    const npmVersion = npmResult.status === 'fulfilled' ? normalizeVersion(npmResult.value?.version) : undefined;
    const githubVersion = githubResult.status === 'fulfilled' ? normalizeVersion(githubResult.value?.tag_name) : undefined;
    const npmOk = npmVersion !== undefined;
    const githubOk = githubVersion !== undefined;
    const errors = [];
    if (!npmOk) errors.push(`npm: ${npmResult.status === 'rejected' ? errorMessage(npmResult.reason) : '返回了无效版本'}`);
    if (!githubOk) errors.push(`GitHub: ${githubResult.status === 'rejected' ? errorMessage(githubResult.reason) : '返回了无效版本'}`);
    if (errors.length > 0) logger?.warn?.(`plugin update check partial failure: ${errors.join('; ')}`);

    const updateAvailable = npmOk && isVersionNewer(npmVersion, installedVersion);
    const releasePending = githubOk && isVersionNewer(githubVersion, installedVersion)
      && (!npmOk || isVersionNewer(githubVersion, npmVersion));
    const status = npmOk && githubOk ? 'ok' : (npmOk || githubOk ? 'partial' : 'unavailable');
    // npm is authoritative for an actionable update. A GitHub-only failure must not
    // turn into a five-minute retry loop against the unauthenticated GitHub API.
    const resultTtlMs = npmOk ? cacheTtlMs : failureTtlMs;
    const result = {
      installedVersion,
      latestVersion: npmVersion ?? null,
      updateAvailable,
      releasePending,
      checking: false,
      status,
      checkedAt: new Date(checkedAtMs).toISOString(),
      nextCheckAt: new Date(checkedAtMs + resultTtlMs).toISOString(),
      npmPackageUrl: NPM_PACKAGE_URL,
      releasesUrl: GITHUB_RELEASES_URL,
      release: githubOk ? {
        version: githubVersion,
        tagName: githubResult.value.tag_name,
        url: typeof githubResult.value.html_url === 'string' ? githubResult.value.html_url : GITHUB_RELEASES_URL,
        publishedAt: githubResult.value.published_at ?? null,
      } : null,
      sources: {
        npm: npmOk ? { ok: true, version: npmVersion } : { ok: false },
        github: githubOk ? { ok: true, version: githubVersion } : { ok: false },
      },
    };
    expiresAt = checkedAtMs + resultTtlMs;
    cached = result;
    return result;
  }

  async function check({ force = false } = {}) {
    if (!force && cached && now() < expiresAt) return cached;
    if (inFlight) return inFlight;
    if (typeof fetchImpl !== 'function') {
      cached = {
        installedVersion,
        latestVersion: null,
        updateAvailable: false,
        releasePending: false,
        checking: false,
        status: 'unavailable',
        checkedAt: new Date(now()).toISOString(),
        nextCheckAt: new Date(now() + failureTtlMs).toISOString(),
        npmPackageUrl: NPM_PACKAGE_URL,
        releasesUrl: GITHUB_RELEASES_URL,
        release: null,
        sources: { npm: { ok: false }, github: { ok: false } },
      };
      expiresAt = now() + failureTtlMs;
      return cached;
    }
    inFlight = query().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  function status({ force = false } = {}) {
    const stale = !cached || now() >= expiresAt;
    if ((force || stale) && !inFlight) {
      void check({ force: true }).catch((error) => {
        logger?.warn?.(`plugin update check failed: ${errorMessage(error)}`);
      });
    }
    const current = cached ?? {
      installedVersion,
      latestVersion: null,
      updateAvailable: false,
      releasePending: false,
      status: 'checking',
      checkedAt: null,
      nextCheckAt: null,
      npmPackageUrl: NPM_PACKAGE_URL,
      releasesUrl: GITHUB_RELEASES_URL,
      release: null,
      sources: { npm: { ok: false }, github: { ok: false } },
    };
    return { ...current, checking: inFlight !== undefined };
  }

  function dispose() {
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
  }

  return { status, check, dispose };
}
