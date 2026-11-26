'use strict';

async function tagCommit(github, repo, tag) {
  const { data } = await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
  let object = data.object;
  while (object.type === 'tag') {
    const { data: annotated } = await github.rest.git.getTag({ ...repo, tag_sha: object.sha });
    object = annotated.object;
  }
  if (object.type !== 'commit') throw new Error('Release tag must point to a commit');
  return object.sha;
}

async function reviewedRun(github, repo, runId) {
  if (!/^[1-9]\d*$/.test(runId)) throw new Error('Enter a numeric Release run ID');
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: runId });
  const tag = run.head_branch;
  if (run.repository.full_name !== `${repo.owner}/${repo.repo}` ||
      run.event !== 'push' || run.path !== '.github/workflows/release.yml' ||
      !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag) ||
      !/^[a-f0-9]{40}$/.test(run.head_sha)) {
    throw new Error('Expected an original tag push run of the Release workflow');
  }
  if (await tagCommit(github, repo, tag) !== run.head_sha) {
    throw new Error('Tag has moved since the reviewed run');
  }
  return { tag, sha: run.head_sha };
}

async function ensureRelease(github, repo, tag, sha) {
  if (await tagCommit(github, repo, tag) !== sha) throw new Error('Verified tag has moved');
  try {
    const { data } = await github.rest.repos.getReleaseByTag({ ...repo, tag });
    if (data.draft) throw new Error('A draft release exists; review it before publishing');
    return data.html_url;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const { data } = await github.rest.repos.createRelease({
    ...repo, tag_name: tag, target_commitish: sha, generate_release_notes: true,
  });
  return data.html_url;
}

module.exports = { reviewedRun, ensureRelease };
