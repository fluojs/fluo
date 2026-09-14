import { execFileSync } from 'node:child_process';

const pageRecords = (text, key) => {
  const lines = text.trim().split('\n').filter(Boolean);
  const records = lines.flatMap((line) => {
    const page = JSON.parse(line);
    if (page?.total_count >= 1000) throw new RangeError(`GitHub ${key} response reached the 1000-record completeness limit`);
    if (!Array.isArray(page?.[key])) throw new TypeError(`GitHub ${key} response is malformed`);
    return page[key];
  });
  const unique = new Map();
  for (const record of records) {
    if (!Number.isSafeInteger(record?.id)) throw new TypeError(`GitHub ${key} record id is malformed`);
    const serialized = JSON.stringify(record);
    const previous = unique.get(record.id);
    if (previous !== undefined && previous !== serialized) {
      throw new TypeError(`GitHub ${key} pagination contains conflicting record ${record.id}`);
    }
    unique.set(record.id, serialized);
  }
  return { pages: lines.length, records: [...unique.values()].map((value) => JSON.parse(value)) };
};

function request(endpoint, key, execute) {
  try {
    return pageRecords(execute('gh', ['api', '--method', 'GET', '--paginate', endpoint], { encoding: 'utf8' }), key);
  } catch (error) {
    throw new Error(`GitHub API request failed for ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requestRecord(endpoint, execute) {
  try {
    const value = JSON.parse(execute('gh', ['api', '--method', 'GET', endpoint], { encoding: 'utf8' }));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('response is malformed');
    return value;
  } catch (error) {
    throw new Error(`GitHub API request failed for ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function collectGithubActionsCensus({ owner, repo, workflow, since, until, execFileSync: execute = execFileSync, observedAt = () => new Date().toISOString() }) {
  const prefix = `repos/${owner}/${repo}/actions`;
  const created = encodeURIComponent(`${since}..${until}`);
  const runResult = request(`${prefix}/workflows/${workflow}/runs?per_page=100&created=${created}`, 'workflow_runs', execute);
  const runs = runResult.records;
  const attempts = [];
  let jobsPages = 0;
  for (const run of runs) {
    if (!Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run?.run_attempt) || run.run_attempt < 1) {
      throw new TypeError('GitHub workflow run is incomplete');
    }
    const created = Date.parse(run.created_at);
    if (Number.isNaN(created) || created < Date.parse(since) || created >= Date.parse(until)) continue;
    for (let number = 1; number <= run.run_attempt; number += 1) {
      const attempt = requestRecord(`${prefix}/runs/${run.id}/attempts/${number}`, execute);
      if (!Number.isSafeInteger(attempt.run_attempt) || attempt.run_attempt !== number || !attempt.created_at) {
        throw new TypeError(`GitHub workflow run ${run.id} attempt ${number} is incomplete`);
      }
      const attemptResult = request(`${prefix}/runs/${run.id}/attempts/${number}/jobs?per_page=100`, 'jobs', execute);
      jobsPages += attemptResult.pages;
      attempts.push({
        ...attempt,
        jobs: attemptResult.records,
        run_id: run.id,
      });
    }
  }
  return {
    attempts,
    limits: ['GitHub API-visible records only; unavailable API responses fail the census.'],
    observed_at: observedAt(),
    pagination: { jobs: jobsPages, runs: runResult.pages },
    workflow_runs: runs,
  };
}
