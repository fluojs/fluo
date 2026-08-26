import {
  assertContract,
  hashEvent,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import { receipt, reviewOutcome } from './transition-contracts.mjs';

export const appendEvent = (
  events,
  streamId,
  eventType,
  subjectId,
  payload,
) => {
  const sequence = events.length + 1;
  const event = {
    version: 1,
    stream_id: streamId,
    sequence,
    previous_hash: events.at(-1)?.event_hash ?? null,
    event_hash: '',
    event_type: eventType,
    subject_id: subjectId,
    payload,
    payload_sha256: payloadDigest(payload),
    occurred_at: new Date(
      Date.UTC(2026, 7, 24) + sequence * 1000,
    ).toISOString(),
  };
  event.event_hash = hashEvent(event);
  assertContract('event', event);
  events.push(event);
};

export const setRootStatus = (snapshot, status) => {
  snapshot.status = status;
  snapshot.execution = {
    status,
    last_command: `$execute-lane ${snapshot.lane_id}`,
    last_updated: '2026-08-24T00:00:00.000Z',
  };
};

export const progressFor = (snapshot, identity) =>
  snapshot.issue_progress[String(identity.issue_number)];

export const initialiseExecution = (snapshot, identity, events) => {
  const lane = snapshot.lanes[identity.lane_index];
  if (snapshot.status !== 'ready' && lane.status !== 'queued') {
    return;
  }
  setRootStatus(snapshot, 'running');
  lane.status = 'in_review';
  lane.branch = identity.branch;
  lane.worktree = identity.worktree;
  lane.pr = identity.pr_url;
  snapshot.issue_progress[String(identity.issue_number)] = {
    status: 'in_review',
    branch: identity.branch,
    worktree: identity.worktree,
    pr: identity.pr_url,
    head_sha: identity.head_sha,
    verification: 'review fixture ready',
    retry_count: lane.retry_count,
    blockers: [],
  };
  appendEvent(events, identity.lane_id, 'lane.started', identity.lane_id, {
    issue_number: identity.issue_number,
    head_sha: identity.head_sha,
  });
};

export const terminalize = (
  snapshot,
  identity,
  status,
  blockers = [],
) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  const siblingIsActive = snapshot.lanes.some(
    (candidate, index) =>
      index !== identity.lane_index &&
      ['queued', 'running', 'in_review', 'merged'].includes(candidate.status),
  );
  setRootStatus(snapshot, siblingIsActive ? 'running' : status);
  if (!siblingIsActive) {
    snapshot.root_main_sync = {
      status: 'blocked-terminal',
      sha: null,
    };
  }
  lane.status = status;
  lane.current_issue = null;
  lane.branch = null;
  lane.worktree = null;
  lane.pr = null;
  if (status === 'blocked-child-contract-error') {
    lane.current_blocker = {
      signature: 'child-contract-error',
      evidence: 'invalid child output or transition evidence',
    };
  } else {
    Reflect.deleteProperty(lane, 'current_blocker');
  }
  progress.status = status;
  progress.blockers = blockers;
};

export const mergeReceipt = (identity) =>
  receipt({
    identity,
    receiptId:
      `${identity.lane_id}:issue:${String(identity.issue_number)}:` +
      `pr.merge:${identity.head_sha}`,
    sideEffect: 'pr.merge',
    status: 'succeeded',
    target: {
      kind: 'pull-request',
      id: String(identity.pr_number),
      url: identity.pr_url,
    },
    evidence: `observed squash merge of ${identity.head_sha}`,
  });

const sideEffectEvidence = (status, succeededEvidence) =>
  status === 'succeeded'
    ? succeededEvidence
    : status === 'skipped'
      ? 'not attempted: authority absent'
      : 'attempt failed';

export const cleanupReceipts = (identity, status = 'succeeded') => [
  receipt({
    identity,
    receiptId:
      `${identity.lane_id}:issue:${String(identity.issue_number)}:` +
      `worktree.remove:${identity.head_sha}`,
    sideEffect: 'worktree.remove',
    status,
    target: { kind: 'worktree', id: identity.worktree, url: null },
    evidence: sideEffectEvidence(status, 'observed worktree removal'),
  }),
  receipt({
    identity,
    receiptId:
      `${identity.lane_id}:issue:${String(identity.issue_number)}:` +
      `branch.delete:local:${identity.head_sha}`,
    sideEffect: 'branch.delete',
    status,
    target: { kind: 'branch', id: `local:${identity.branch}`, url: null },
    evidence: sideEffectEvidence(status, 'observed local branch deletion'),
  }),
  receipt({
    identity,
    receiptId:
      `${identity.lane_id}:issue:${String(identity.issue_number)}:` +
      `branch.delete:remote:${identity.head_sha}`,
    sideEffect: 'branch.delete',
    status,
    target: { kind: 'branch', id: `origin:${identity.branch}`, url: null },
    evidence: sideEffectEvidence(status, 'observed remote branch deletion'),
  }),
];

export const rootSyncReceipt = (
  identity,
  baseBranch,
  syncedSha,
  status = 'succeeded',
) =>
  receipt({
    identity: {
      ...identity,
      head_sha: status === 'skipped' ? null : syncedSha,
    },
    receiptId: `${identity.lane_id}:root.sync`,
    sideEffect: 'root.sync',
    status,
    target: { kind: 'branch', id: baseBranch, url: null },
    evidence: sideEffectEvidence(
      status,
      `observed ff-only sync to ${syncedSha}`,
    ),
  });

const applyMerge = (snapshot, identity, outcome, receipts, events) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  lane.status = 'merged';
  progress.status = 'merged';
  progress.blockers = (progress.blockers ?? []).map((blocker) => ({
    ...blocker,
    status: 'remediated',
  }));
  Object.assign(progress, {
    review_verdict: 'merge',
    checks: 'PASS',
    reviewers: {
      contract: 'PASS',
      code: 'PASS',
      verification: 'PASS',
    },
    reviewed_head: identity.head_sha,
    commits: [identity.head_sha],
    merge_commit: outcome.merge_commit_sha,
    issue_state: 'CLOSED',
  });
  if (!snapshot.completed_issues.includes(identity.issue_number)) {
    snapshot.completed_issues.push(identity.issue_number);
  }
  receipts.push(mergeReceipt(identity));
  appendEvent(events, identity.lane_id, 'merge.observed', identity.pr_url, {
    head_sha: identity.head_sha,
    merge_commit_sha: outcome.merge_commit_sha,
  });
};

export const applyReview = (
  step,
  snapshot,
  identity,
  receipts,
  events,
) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  let outcome;
  try {
    outcome = reviewOutcome(step, identity);
  } catch {
    terminalize(snapshot, identity, 'blocked-child-contract-error');
    appendEvent(events, identity.lane_id, 'review.malformed', identity.pr_url, {
      head_sha: identity.head_sha,
    });
    return;
  }
  if (outcome.verdict === 'merge') {
    applyMerge(snapshot, identity, outcome, receipts, events);
  } else if (outcome.verdict === 'needs-human-check') {
    terminalize(snapshot, identity, 'needs-human-check-terminal');
    appendEvent(events, identity.lane_id, 'review.human', identity.pr_url, {
      head_sha: identity.head_sha,
    });
  } else {
    lane.status = 'running';
    progress.status = 'running';
    progress.blockers = outcome.blockers;
    appendEvent(events, identity.lane_id, 'review.block', identity.pr_url, {
      blocker_count: outcome.blockers.length,
    });
  }
};
