import { createHash } from 'node:crypto';

import {
  assertContract,
  assertEventChain,
  hashEvent,
} from '../../../workflow-contracts/contracts.mjs';

const shaPattern = /^[a-f0-9]{40}$/u;
const terminalStatuses = new Set([
  'done',
  'needs-human-check-terminal',
  'blocked-budget-exhausted',
  'blocked-child-contract-error',
  'blocked-ledger-conflict',
  'blocked-terminal',
]);
const occurredAt = '2026-08-24T00:00:00.000Z';

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value, name) => {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const requireString = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

const requireSha = (value, name) => {
  const sha = requireString(value, name);
  if (!shaPattern.test(sha)) {
    throw new TypeError(`${name} must be a 40-character lowercase SHA.`);
  }
  return sha;
};

const payloadHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const identityFrom = (scenario) => {
  const pr = requireRecord(scenario.pr, 'scenario.pr');
  const issueNumber = scenario.issue_number;
  const prNumber = pr.number;
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError('scenario.issue_number must be a positive integer.');
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new TypeError('scenario.pr.number must be a positive integer.');
  }
  return {
    lane_id: requireString(scenario.lane_id, 'scenario.lane_id'),
    issue_number: issueNumber,
    branch: requireString(scenario.branch, 'scenario.branch'),
    worktree: requireString(scenario.worktree, 'scenario.worktree'),
    pr_number: prNumber,
    pr_url: requireString(pr.url, 'scenario.pr.url'),
    head_sha: requireSha(pr.head_sha, 'scenario.pr.head_sha'),
  };
};

const eventAppender = (streamId, subjectId, events) => (eventType, payload) => {
  const event = {
    version: 1,
    stream_id: streamId,
    sequence: events.length + 1,
    previous_hash: events.at(-1)?.event_hash ?? null,
    event_hash: '',
    event_type: eventType,
    subject_id: subjectId,
    payload_sha256: payloadHash(payload),
    occurred_at: occurredAt,
  };
  event.event_hash = hashEvent(event);
  assertContract('event', event);
  events.push(event);
};

const mergeReceipt = (identity, status) => {
  const receipt = {
    version: 1,
    receipt_id: `${identity.lane_id}:pr.merge:1`,
    lane_id: identity.lane_id,
    issue_number: identity.issue_number,
    side_effect: 'pr.merge',
    status,
    head_sha: identity.head_sha,
    evidence: `PR #${String(identity.pr_number)} at ${identity.head_sha}`,
  };
  assertContract('receipt', receipt);
  return receipt;
};

const blockerIsFixable = (blocker) =>
  isRecord(blocker) &&
  blocker.status === 'unresolved' &&
  blocker.fix_back_eligible === true;

export const runReplay = (input) => {
  const scenario = requireRecord(input, 'scenario');
  const identity = identityFrom(scenario);
  const steps = scenario.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('scenario.steps must be a non-empty array.');
  }

  const events = [];
  const receipts = [];
  const append = eventAppender(identity.lane_id, identity.lane_id, events);
  let status = scenario.start_state === 'interrupted' ? 'interrupted' : 'pr-ready';
  let mergeCount = 0;
  let fixAttempts = 0;

  append('lane.started', { status, head_sha: identity.head_sha });

  for (const rawStep of steps) {
    if (terminalStatuses.has(status)) {
      break;
    }
    const step = requireRecord(rawStep, 'scenario step');
    const kind = requireString(step.kind, 'scenario step.kind');

    if (kind === 'malformed-review') {
      status = 'blocked-child-contract-error';
      append('review.malformed', { status });
      continue;
    }

    if (kind === 'resume') {
      const liveHead = requireSha(step.live_head, 'resume.live_head');
      if (liveHead !== identity.head_sha) {
        status = 'blocked-ledger-conflict';
        append('resume.conflict', { live_head: liveHead });
      } else {
        status = 'pr-ready';
        append('resume.reconciled', { head_sha: liveHead });
      }
      continue;
    }

    if (kind === 'review') {
      const reviewedHead = requireSha(step.reviewed_head, 'review.reviewed_head');
      if (reviewedHead !== identity.head_sha) {
        status = 'blocked-ledger-conflict';
        append('review.stale', { reviewed_head: reviewedHead });
        continue;
      }
      if (step.verdict === 'merge') {
        mergeCount += 1;
        status = 'merged';
        receipts.push(mergeReceipt(identity, 'succeeded'));
        append('review.merge', { head_sha: identity.head_sha });
        continue;
      }
      if (step.verdict === 'needs-human-check') {
        status = 'needs-human-check-terminal';
        append('review.human', { head_sha: identity.head_sha });
        continue;
      }
      if (step.verdict === 'block' && Array.isArray(step.blockers)) {
        for (const blocker of step.blockers) {
          assertContract('blocker', blocker);
        }
        status = step.blockers.every(blockerIsFixable)
          ? 'fix-requested'
          : 'needs-human-check-terminal';
        append('review.block', { blockers: step.blockers.length, status });
        continue;
      }
      status = 'blocked-child-contract-error';
      append('review.malformed', { status });
      continue;
    }

    if (kind === 'fix' && status === 'fix-requested') {
      fixAttempts += 1;
      const newHead = requireSha(step.new_head, 'fix.new_head');
      if (newHead === identity.head_sha || fixAttempts > 6) {
        status = 'blocked-budget-exhausted';
        append('fix.noprogress', { attempts: fixAttempts });
      } else {
        identity.head_sha = newHead;
        status = 'pr-ready';
        append('fix.completed', { attempts: fixAttempts, head_sha: newHead });
      }
      continue;
    }

    if (kind === 'cleanup' && status === 'merged') {
      status = step.result === 'done' ? 'done' : 'blocked-terminal';
      append('cleanup.completed', { result: step.result, status });
      continue;
    }

    status = 'blocked-child-contract-error';
    append('step.invalid', { kind, status });
  }

  if (!terminalStatuses.has(status)) {
    status = status === 'fix-requested' ? 'blocked-budget-exhausted' : status;
    append('lane.terminal', { status });
  }
  assertEventChain(events);

  return {
    ...identity,
    status,
    merge_count: mergeCount,
    events,
    snapshot: {
      version: 2,
      lane_id: identity.lane_id,
      issue_number: identity.issue_number,
      status,
      head_sha: identity.head_sha,
      lease: { holder: 'execute-lane', status: 'released' },
      receipts,
    },
  };
};

export const runLaneBatch = (scenarios) => {
  if (!Array.isArray(scenarios)) {
    throw new TypeError('scenarios must be an array.');
  }
  return scenarios.map(runReplay);
};
