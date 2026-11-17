/** Local QA metadata only; never changes the repository's release version. */
import { compareVersions } from '../../lib/version-status.js';

// Release PRs must exercise the published predecessor, before the new version exists on npm.
export function smartModeQaBaselineVersion(sourceVersion, baselineVersion = sourceVersion) {
  if (![sourceVersion, baselineVersion].every(value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value))
      || compareVersions(baselineVersion, sourceVersion) > 0) throw new Error('Invalid QA baseline version');
  return baselineVersion;
}

export function smartModeQaVersion(baseVersion, { buildNumber, commit, pullRequest = 243 } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion) || !Number.isSafeInteger(buildNumber) || buildNumber < 1
      || !Number.isSafeInteger(pullRequest) || pullRequest < 1
      || typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid QA version inputs');
  const [major, minor, patch] = baseVersion.split('.').map(Number);
  if (![major, minor, patch + 1].every(Number.isSafeInteger)) throw new Error('Invalid QA version inputs');
  return `${major}.${minor}.${patch + 1}-pr.${pullRequest}.qa.${buildNumber}+g${commit.slice(0, 7)}`;
}
