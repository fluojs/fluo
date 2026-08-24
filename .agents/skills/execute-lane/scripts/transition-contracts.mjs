import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { aggregateReviewerGate } from '../../pr-to-merge/scripts/contracts.mjs';

const shaPattern = /^[a-f0-9]{40}$/u;
const canonicalPrUrl = /^https:\/\/github\.com\/fluojs\/fluo\/pull\/([1-9]\d*)$/u;

export const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const requireRecord = (value, name) => {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

export const requireString = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

export const requireSha = (value, name) => {
  const sha = requireString(value, name);
  if (!shaPattern.test(sha)) {
    throw new TypeError(`${name} must be a 40-character lowercase SHA.`);
  }
  return sha;
};

const requirePositiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
};

export const identityFrom = (scenario, snapshot) => {
  const pr = requireRecord(scenario.pr, 'scenario.pr');
  const laneId = requireString(scenario.lane_id, 'scenario.lane_id');
  const issueNumber = requirePositiveInteger(
    scenario.issue_number,
    'scenario.issue_number',
  );
  const branch = requireString(scenario.branch, 'scenario.branch');
  const worktree = requireString(scenario.worktree, 'scenario.worktree');
  const prNumber = requirePositiveInteger(pr.number, 'scenario.pr.number');
  const prUrl = requireString(pr.url, 'scenario.pr.url');
  const prMatch = canonicalPrUrl.exec(prUrl);
  if (
    laneId !== snapshot.lane_id ||
    !snapshot.confirmed_issues.includes(issueNumber) ||
    !branch.startsWith(`issue-${String(issueNumber)}-`) ||
    worktree !== `.worktrees/${branch}` ||
    prMatch === null ||
    Number(prMatch[1]) !== prNumber
  ) {
    throw new TypeError('scenario identity must bind the canonical lane and PR.');
  }
  const laneIndex = snapshot.lanes.findIndex((lane) =>
    lane.queue.includes(issueNumber),
  );
  if (laneIndex === -1) {
    throw new TypeError('scenario issue must belong to one lane queue.');
  }
  const existingProgress = snapshot.issue_progress[String(issueNumber)];
  if (
    isRecord(existingProgress) &&
    existingProgress.branch !== null &&
    existingProgress.worktree !== null &&
    existingProgress.pr !== null
  ) {
    const persistedBranch = requireString(
      existingProgress.branch,
      'snapshot branch',
    );
    const persistedWorktree = requireString(
      existingProgress.worktree,
      'snapshot worktree',
    );
    const persistedPrUrl = requireString(existingProgress.pr, 'snapshot PR');
    const persistedPrMatch = canonicalPrUrl.exec(persistedPrUrl);
    if (persistedPrMatch === null) {
      throw new TypeError('snapshot PR must use the canonical repository URL.');
    }
    return {
      lane_id: laneId,
      issue_number: issueNumber,
      branch: persistedBranch,
      worktree: persistedWorktree,
      pr_number: Number(persistedPrMatch[1]),
      pr_url: persistedPrUrl,
      head_sha: requireSha(existingProgress.head_sha, 'snapshot head_sha'),
      lane_index: laneIndex,
      conflict:
        branch !== persistedBranch ||
        worktree !== persistedWorktree ||
        prNumber !== Number(persistedPrMatch[1]) ||
        prUrl !== persistedPrUrl,
    };
  }
  const headSha =
    isRecord(existingProgress) && existingProgress.head_sha !== undefined
      ? requireSha(existingProgress.head_sha, 'snapshot head_sha')
      : requireSha(pr.head_sha, 'scenario.pr.head_sha');
  return {
    lane_id: laneId,
    issue_number: issueNumber,
    branch,
    worktree,
    pr_number: prNumber,
    pr_url: prUrl,
    head_sha: headSha,
    lane_index: laneIndex,
    conflict: false,
  };
};

export const reviewOutcome = (step, identity) => {
  const outcome = aggregateReviewerGate({
    head_sha: identity.head_sha,
    reviews: step.reviews,
  });
  if (outcome.verdict !== 'merge') {
    return { ...outcome, merge_commit_sha: null };
  }
  const observation = requireRecord(
    step.merge_observation,
    'review.merge_observation',
  );
  if (
    observation.authority !== 'lead' ||
    observation.action !== 'pr.merge' ||
    observation.pr_number !== identity.pr_number ||
    observation.pr_url !== identity.pr_url ||
    observation.head_sha !== identity.head_sha ||
    observation.merge_method !== 'squash' ||
    observation.merged !== true ||
    observation.issue_state !== 'CLOSED'
  ) {
    throw new TypeError(
      'merge observation must bind lead authority, PR identity, head, method, and issue closure.',
    );
  }
  return {
    ...outcome,
    merge_commit_sha: requireSha(
      observation.merge_commit_sha,
      'review.merge_commit_sha',
    ),
  };
};

export const resumeMatches = (step, identity) => {
  const live = requireRecord(step.live, 'resume.live');
  return (
    live.branch === identity.branch &&
    live.worktree === identity.worktree &&
    live.pr_number === identity.pr_number &&
    live.pr_url === identity.pr_url &&
    live.head_sha === identity.head_sha &&
    live.merged === false
  );
};

export const cleanupSucceeded = (step, identity) => {
  const observation = requireRecord(step.observation, 'cleanup.observation');
  if (
    observation.authority !== 'lead' ||
    observation.branch !== identity.branch ||
    observation.worktree !== identity.worktree
  ) {
    throw new TypeError(
      'cleanup observation must bind lead authority and lane identity.',
    );
  }
  return (
    observation.worktree_removed === true &&
    observation.local_branch_deleted === true &&
    observation.remote_branch_deleted === true
  );
};

export const rootSyncObservation = (step, snapshot, mergeCommitSha) => {
  const observation = requireRecord(step.observation, 'root-sync.observation');
  if (
    observation.authority !== 'lead' ||
    observation.base_branch !== snapshot.base_branch ||
    observation.ff_only !== true ||
    observation.status !== 'done' ||
    observation.sha !== mergeCommitSha
  ) {
    throw new TypeError(
      'root sync must be an observed lead-owned ff-only update of base_branch.',
    );
  }
  return observation.sha;
};

export const receipt = ({
  identity,
  receiptId,
  sideEffect,
  status,
  target,
  evidence,
}) => {
  const value = {
    version: 1,
    receipt_id: receiptId,
    lane_id: identity.lane_id,
    issue_number: identity.issue_number,
    side_effect: sideEffect,
    status,
    head_sha: identity.head_sha,
    target,
    evidence,
  };
  assertContract('receipt', value);
  return value;
};
