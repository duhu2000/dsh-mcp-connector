const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureRelease, reviewedRun } = require('../scripts/release-recovery.cjs');

const repo = { owner: 'test-owner', repo: 'test-repo' };
const sha = '1'.repeat(40);
const tag = 'v1.2.3';

function fixture() {
  const run = {
    repository: { full_name: 'test-owner/test-repo' }, event: 'push',
    path: '.github/workflows/release.yml', head_sha: sha, head_branch: tag,
  };
  const git = { getRef: async () => ({ data: { object: { type: 'commit', sha } } }) };
  const actions = { getWorkflowRun: async () => ({ data: run }) };
  const created = [];
  const repos = {
    async getReleaseByTag() { throw Object.assign(new Error('not found'), { status: 404 }); },
    async createRelease(options) {
      created.push(options);
      return { data: { html_url: 'new-release' } };
    },
  };
  return { github: { rest: { actions, git, repos } }, run, git, repos, created };
}

test('resolve the original tag push, including an annotated tag', async () => {
  const { github, git } = fixture();
  git.getRef = async () => ({ data: { object: { type: 'tag', sha: '2'.repeat(40) } } });
  git.getTag = async () => ({ data: { object: { type: 'commit', sha } } });
  assert.deepEqual(await reviewedRun(github, repo, '123'), { tag, sha });
});

test('reject unrelated or manual runs and moved tags', async () => {
  for (const change of [{ repository: { full_name: 'other/repo' } }, { event: 'pull_request' },
    { event: 'workflow_dispatch' }, { path: '.github/workflows/ci.yml' }, { head_branch: 'main' },
    { head_sha: '2'.repeat(40) }]) {
    const { github, run } = fixture();
    Object.assign(run, change);
    await assert.rejects(reviewedRun(github, repo, '123'));
  }
  await assert.rejects(reviewedRun(fixture().github, repo, 'invalid'));
});

test('create a missing Release once and leave an existing Release alone', async () => {
  const { github, repos, created } = fixture();
  assert.equal(await ensureRelease(github, repo, tag, sha), 'new-release');
  repos.getReleaseByTag = async () => ({ data: { draft: false, html_url: 'existing-release' } });
  assert.equal(await ensureRelease(github, repo, tag, sha), 'existing-release');
  assert.deepEqual(created, [{ ...repo, tag_name: tag, target_commitish: sha, generate_release_notes: true }]);
});

test('a moved tag, draft or permission error must not create a release', async () => {
  const { github, repos, created } = fixture();
  await assert.rejects(ensureRelease(github, repo, tag, '2'.repeat(40)), /moved/);
  repos.getReleaseByTag = async () => ({ data: { draft: true } });
  await assert.rejects(ensureRelease(github, repo, tag, sha), /draft/);
  repos.getReleaseByTag = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
  await assert.rejects(ensureRelease(github, repo, tag, sha), /forbidden/);
  assert.deepEqual(created, []);
});
