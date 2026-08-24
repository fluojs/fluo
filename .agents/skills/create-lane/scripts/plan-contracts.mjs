const safeIdentifier = /^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const planKeys = [
  'version',
  'lane_id',
  'base_branch',
  'source',
  'merge_policy',
  'pr_merge_method',
  'authority_scope',
  'retry_policy',
  'confirmed_issues',
  'suggested_but_excluded',
  'backlog_candidates',
  'release_handoffs',
  'lanes',
  'dependency_graph',
];

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (record, keys) => {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const isIssueArray = (value) =>
  Array.isArray(value) &&
  value.every((issue) => Number.isSafeInteger(issue) && issue > 0) &&
  new Set(value).size === value.length;

const hasCanonicalDependencies = (graph, issues) => {
  if (!isRecord(graph)) {
    return false;
  }
  const issueSet = new Set(issues);
  const visiting = new Set();
  const visited = new Set();
  const visit = (issue) => {
    if (visiting.has(issue)) {
      return false;
    }
    if (visited.has(issue)) {
      return true;
    }
    visiting.add(issue);
    const dependencies = graph[String(issue)] ?? [];
    if (
      !isIssueArray(dependencies) ||
      dependencies.includes(issue) ||
      !dependencies
        .filter((dependency) => issueSet.has(dependency))
        .every(visit)
    ) {
      return false;
    }
    visiting.delete(issue);
    visited.add(issue);
    return true;
  };
  return (
    Object.keys(graph).every((key) => issueSet.has(Number(key))) &&
    issues.every(visit)
  );
};

export const planIsCanonical = (plan, artifact) => {
  if (
    !isRecord(plan) ||
    !hasExactKeys(plan, planKeys) ||
    plan.version !== 2 ||
    typeof plan.lane_id !== 'string' ||
    !safeIdentifier.test(plan.lane_id) ||
    typeof plan.base_branch !== 'string' ||
    plan.base_branch.length === 0 ||
    !isRecord(plan.source) ||
    plan.source.artifact_id !== artifact.artifact_id ||
    plan.source.sha256 !== artifact.sha256 ||
    !isIssueArray(plan.confirmed_issues) ||
    !Array.isArray(plan.suggested_but_excluded) ||
    !Array.isArray(plan.backlog_candidates) ||
    !Array.isArray(plan.release_handoffs) ||
    !Array.isArray(plan.lanes) ||
    plan.lanes.length === 0
  ) {
    return false;
  }
  const queues = [];
  for (const lane of plan.lanes) {
    if (
      !isRecord(lane) ||
      !hasExactKeys(lane, ['name', 'queue']) ||
      typeof lane.name !== 'string' ||
      lane.name.length === 0 ||
      !isIssueArray(lane.queue)
    ) {
      return false;
    }
    queues.push(...lane.queue);
  }
  return (
    queues.length === plan.confirmed_issues.length &&
    new Set(queues).size === queues.length &&
    plan.confirmed_issues.every((issue) => queues.includes(issue)) &&
    hasCanonicalDependencies(plan.dependency_graph, plan.confirmed_issues)
  );
};

export const readyLedger = (plan, artifact) => ({
  version: 2,
  run_id: plan.lane_id,
  lane_id: plan.lane_id,
  status: 'ready',
  created_by: 'create-lane',
  base_branch: plan.base_branch,
  source: {
    type: 'search-issue',
    search_run_id: artifact.search_run_id,
    search_ledger: `.omo/search-issue/artifacts/${artifact.search_run_id}.json`,
    artifact_id: artifact.artifact_id,
    sha256: artifact.sha256,
  },
  merge_policy: plan.merge_policy,
  pr_merge_method: plan.pr_merge_method,
  authority_scope: plan.authority_scope,
  retry_policy: plan.retry_policy,
  execution: {
    status: 'not-started',
    last_command: null,
    last_updated: null,
  },
  confirmed_issues: plan.confirmed_issues,
  suggested_but_excluded: plan.suggested_but_excluded,
  backlog_candidates: plan.backlog_candidates,
  release_handoffs: plan.release_handoffs,
  completed_issues: [],
  issue_progress: {},
  lanes: plan.lanes.map((lane) => ({
    name: lane.name,
    queue: lane.queue,
    current_issue: lane.queue[0],
    status: 'queued',
    branch: null,
    worktree: null,
    pr: null,
    retry_count: 0,
  })),
  dependency_graph: plan.dependency_graph,
  root_main_sync: { status: 'not-started', sha: null },
});
