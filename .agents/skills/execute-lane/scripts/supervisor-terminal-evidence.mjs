export const laneFor = (snapshot, issueNumber) => {
  const laneIndex = snapshot.lanes.findIndex((lane) =>
    lane.queue.includes(issueNumber),
  );
  if (laneIndex === -1) {
    throw new TypeError('supervisor issue is not assigned to a lane.');
  }
  return { lane: snapshot.lanes[laneIndex], laneIndex };
};

export const advanceLane = (snapshot, lane) => {
  const nextIssue = lane.queue.find(
    (issue) => !snapshot.completed_issues.includes(issue),
  );
  Object.assign(lane, {
    status: nextIssue === undefined ? 'done' : 'queued',
    current_issue: nextIssue ?? null,
    branch: null,
    worktree: null,
    pr: null,
    retry_count: 0,
  });
};

export const identityFromSupervisor = (snapshot, supervisor, laneIndex) => ({
  lane_id: snapshot.lane_id,
  lane_index: laneIndex,
  issue_number: supervisor.issue_number,
  branch: supervisor.branch,
  worktree: supervisor.worktree,
  pr_number: supervisor.pr?.number ?? null,
  pr_url: supervisor.pr?.url ?? null,
  head_sha: supervisor.head_sha,
});

export const completedProgress = (supervisor) => ({
  status: 'done',
  branch: supervisor.branch,
  worktree: supervisor.worktree,
  pr: supervisor.pr.url,
  head_sha: supervisor.head_sha,
  verification: supervisor.verification,
  retry_count: supervisor.attempt,
  blockers: supervisor.blockers,
  review_verdict: 'merge',
  checks: 'PASS',
  reviewers: supervisor.local_review.reviewers,
  reviewed_head: supervisor.head_sha,
  commits: [supervisor.head_sha],
  merge_commit: supervisor.merge.commit_sha,
  issue_state: 'CLOSED',
  cleanup: supervisor.authority_scope.cleanup_command_worktrees
    ? {
        status: 'done',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      }
    : { status: 'skipped-authority' },
});

export const blockedProgress = (supervisor) => ({
  status: supervisor.status,
  branch: supervisor.branch,
  worktree: supervisor.worktree,
  pr: supervisor.pr?.url ?? null,
  head_sha: supervisor.head_sha,
  verification: supervisor.verification,
  retry_count: supervisor.attempt,
  blockers: supervisor.blockers,
});

export const assertLiveCompletion = (supervisor, live) => {
  const expected = {
    issue_number: supervisor.issue_number,
    issue_url: `https://github.com/fluojs/fluo/issues/${String(supervisor.issue_number)}`,
    pr_number: supervisor.pr.number,
    pr_url: supervisor.pr.url,
    branch: supervisor.branch,
    worktree: supervisor.worktree,
    reviewed_head_sha: supervisor.head_sha,
    remote_head_sha: supervisor.head_sha,
    pr_head_sha: supervisor.head_sha,
    ci_head_sha: supervisor.head_sha,
    merge_commit_sha: supervisor.merge.commit_sha,
    merge_method: 'squash',
    pr_state: 'MERGED',
    issue_state: 'CLOSED',
    cleanup_status: supervisor.authority_scope.cleanup_command_worktrees
      ? 'done'
      : 'skipped-authority',
  };
  if (supervisor.authority_scope.cleanup_command_worktrees) {
    Object.assign(expected, {
      worktree_removed: true,
      local_branch_deleted: true,
      remote_branch_deleted: true,
    });
  }
  const actualKeys = Object.keys(live ?? {}).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError('supervisor live completion contains unexpected fields.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (live?.[key] !== value) {
      throw new TypeError(`supervisor live completion mismatch: ${key}.`);
    }
  }
};
