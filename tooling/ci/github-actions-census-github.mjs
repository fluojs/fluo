import { execFileSync } from 'node:child_process';

const pageRecords = (text, key) => text.trim().split('\n').filter(Boolean).flatMap((line) => {
  const page = JSON.parse(line);
  if (page?.total_count >= 1000) throw new RangeError(`GitHub ${key} response reached the 1000-record completeness limit`);
  const records = page?.[key];
  if (!Array.isArray(records)) throw new TypeError(`GitHub ${key} response is malformed`);
  return records;
});

function request(endpoint, key, execute) {
  try {
    return pageRecords(execute('gh', ['api', '--method', 'GET', '--paginate', endpoint], { encoding: 'utf8' }), key);
  } catch (error) {
    throw new Error(`GitHub API request failed for ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function collectGithubActionsCensus({ owner, repo, workflow, since, until, execFileSync: execute = execFileSync, observedAt = () => new Date().toISOString() }) {
  const prefix = `repos/${owner}/${repo}/actions`;
  const runs = request(`${prefix}/workflows/${workflow}/runs?per_page=100`, 'workflow_runs', execute);
  const attempts = [];
  let jobsPages = 0;
  for (const run of runs) {
    if (!Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run?.run_attempt) || run.run_attempt < 1) {
      throw new TypeError('GitHub workflow run is incomplete');
    }
    const created = Date.parse(run.created_at);
    if (Number.isNaN(created) || created < Date.parse(since) || created >= Date.parse(until)) continue;
    for (let number = 1; number <= run.run_attempt; number += 1) {
      const attemptRecords = request(`${prefix}/runs/${run.id}/attempts/${number}/jobs?per_page=100`, 'jobs', execute);
      jobsPages += 1;
      attempts.push({
        conclusion: run.conclusion,
        created_at: run.created_at,
        jobs: attemptRecords,
        run_attempt: number,
        run_id: run.id,
      });
    }
  }
  return {
    attempts,
    limits: ['GitHub API-visible records only; unavailable API responses fail the census.'],
    observed_at: observedAt(),
    pagination: { jobs: jobsPages, runs: 1 },
    workflow_runs: runs,
  };
}
