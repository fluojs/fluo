import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isRecord, schemaFailure } from './schema-validator.mjs';

// allow: SIZE_OK — central shared contract registry and cross-contract invariants.
export const contractNames = [
  'search-artifact-v2',
  'lane-ledger-v2',
  'lane-dag-binding',
  'review-preflight',
  'local-review-verdict',
  'review-verdict',
  'blocker',
  'receipt',
  'event',
];

const schemas = new Map(
  contractNames.map((name) => [
    name,
    JSON.parse(readFileSync(resolve(import.meta.dirname, `${name}.schema.json`), 'utf8')),
  ]),
);

export class WorkflowContractError extends TypeError {
  constructor(contractPath, reason) {
    super(`${contractPath}: ${reason}`);
    this.name = 'WorkflowContractError';
    this.contractPath = contractPath;
    this.reason = reason;
  }
}

const fail = (path, reason) => {
  throw new WorkflowContractError(path, reason);
};

export const payloadDigest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const searchArtifactDigest = (artifact) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        version: artifact.version,
        artifact_id: artifact.artifact_id,
        search_run_id: artifact.search_run_id,
        selected_issues: artifact.selected_issues,
      }),
    )
    .digest('hex');

const assertSafeBranch = (branch) => {
  const safe =
    branch !== 'HEAD' &&
    !branch.startsWith('refs/') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    branch.split('/').every(
      (part) =>
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part) &&
        !part.endsWith('.') &&
        !part.endsWith('.lock'),
    );
  if (!safe) {
    fail('lane-ledger-v2.branch', 'branch must be a safe canonical branch');
  }
};

const assertLaneLedgerSemantics = (value) => {
  if (value.run_id !== value.lane_id) {
    fail('lane-ledger-v2', 'run_id and lane_id must match');
  }
  const artifactPaths = [
    `.omo/search-issue/artifacts/${value.source.search_run_id}.json`,
    `.omo/search-issue/artifacts/legacy/${value.source.search_run_id}.json`,
  ];
  if (
    value.source.artifact_id !== `search:${value.source.search_run_id}` ||
    !artifactPaths.includes(value.source.search_ledger)
  ) {
    fail('lane-ledger-v2.source', 'source identity and artifact path must match');
  }
  const queuedIssues = value.lanes.flatMap((lane) => lane.queue);
  if (
    queuedIssues.length !== value.confirmed_issues.length ||
    new Set(queuedIssues).size !== queuedIssues.length ||
    !value.confirmed_issues.every((issue) => queuedIssues.includes(issue))
  ) {
    fail(
      'lane-ledger-v2.lanes',
      'lane queues must partition confirmed_issues exactly once',
    );
  }
  for (const lane of value.lanes) {
    if (lane.current_issue !== null && !lane.queue.includes(lane.current_issue)) {
      fail('lane-ledger-v2.lanes', 'current_issue must appear in its lane queue');
    }
    if (lane.branch !== null) {
      assertSafeBranch(lane.branch);
    }
    if (
      (lane.branch === null) !== (lane.worktree === null) ||
      (lane.branch !== null && lane.worktree !== `.worktrees/${lane.branch}`)
    ) {
      fail(
        'lane-ledger-v2.lanes',
        'worktree must exactly match its branch under .worktrees',
      );
    }
    if (
      (lane.status === 'blocked-child-contract-error') !==
      Object.hasOwn(lane, 'current_blocker')
    ) {
      fail(
        'lane-ledger-v2.lanes',
        'blocked-child-contract-error alone must carry current_blocker',
      );
    }
  }
};

const assertSemanticContract = (name, value) => {
  switch (name) {
    case 'search-artifact-v2':
      if (value.artifact_id !== `search:${value.search_run_id}`) {
        fail(name, 'artifact_id must be canonically derived from search_run_id');
      }
      if (value.sha256 !== searchArtifactDigest(value)) {
        fail(name, 'sha256 must match the canonical artifact content');
      }
      return;
    case 'lane-ledger-v2':
      assertSafeBranch(value.base_branch);
      assertLaneLedgerSemantics(value);
      return;
    case 'lane-dag-binding':
      if (value.version === 1) {
        if (
          !Object.hasOwn(value, 'snapshot_event_hash') ||
          Object.hasOwn(value, 'issue_number') ||
          Object.hasOwn(value, 'dependencies') ||
          Object.hasOwn(value, 'dispatch_event_hash')
        ) {
          fail(name, 'version 1 must contain only lane-wide binding fields');
        }
        if (
          value.dag_key !==
          `fluo:lane:${value.lane_id}:issue-supervisors:v1`
        ) {
          fail(name, 'dag_key must be canonical for lane_id');
        }
        return;
      }
      if (value.version === 3) {
        if (
          !Object.hasOwn(value, 'dispatch_event_hash') ||
          Object.hasOwn(value, 'snapshot_event_hash') ||
          Object.hasOwn(value, 'issue_number') ||
          Object.hasOwn(value, 'dependencies')
        ) {
          fail(name, 'version 3 must contain only lane-wide dispatch fields');
        }
        if (
          value.dag_key !==
          `fluo:lane:${value.lane_id}:issue-supervisors:v2`
        ) {
          fail(name, 'dag_key must be canonical for lane_id');
        }
        return;
      }
      if (
        !Object.hasOwn(value, 'issue_number') ||
        !Object.hasOwn(value, 'dependencies') ||
        !Object.hasOwn(value, 'dispatch_event_hash') ||
        Object.hasOwn(value, 'snapshot_event_hash')
      ) {
        fail(name, 'version 2 must contain only per-issue binding fields');
      }
      if (
        value.dag_key !==
        `fluo:lane:${value.lane_id}:issue-${String(value.issue_number)}:supervisor:v2`
      ) {
        fail(name, 'dag_key must be canonical for lane_id and issue_number');
      }
      return;
    case 'local-review-verdict':
      if (
        ['ready-for-pr', 'ready-for-push'].includes(value.verdict) &&
        (value.blockers.length !== 0 ||
          Object.values(value.reviewers).some((signal) => signal !== 'PASS'))
      ) {
        fail(name, 'ready verdict requires all reviewers PASS and no blockers');
      }
      if (value.verdict === 'block' && value.blockers.length === 0) {
        fail(name, 'block verdict must contain at least one blocker');
      }
      if (
        value.verdict === 'needs-human-check' &&
        !Object.values(value.reviewers).includes('NEEDS-HUMAN-CHECK')
      ) {
        fail(name, 'needs-human-check requires one reviewer escalation');
      }
      return;
    case 'review-preflight': {
      const canonical = {
        version: value.version,
        lane_id: value.lane_id,
        issue_number: value.issue_number,
        issue_contract_revision: value.issue_contract_revision,
        issue_contract_sha256: value.issue_contract_sha256,
        lane_plan_approval_sha256: value.lane_plan_approval_sha256,
        head_sha: value.head_sha,
        generated_at: value.generated_at,
        approved_sources: value.approved_sources,
        acceptance_row_ids: value.acceptance_row_ids,
        rows: value.rows,
        nonfunctional: value.nonfunctional,
      };
      if (value.sha256 !== payloadDigest(canonical)) {
        fail(name, 'sha256 must match the canonical preflight content');
      }
      return;
    }
    case 'review-verdict':
      if (value.verdict === 'pass' && value.blockers.length !== 0) {
        fail(name, 'pass verdict must not contain blockers');
      }
      if (value.verdict === 'block' && value.blockers.length === 0) {
        fail(name, 'block verdict must contain at least one blocker');
      }
      return;
    case 'receipt':
      if (value.status === 'succeeded' && value.head_sha === null) {
        fail(name, 'succeeded receipt must bind head_sha');
      }
      if (
        value.side_effect === 'pr.merge' &&
        (value.target.kind !== 'pull-request' ||
          !/^[1-9]\d*$/u.test(value.target.id) ||
          value.target.url !==
            `https://github.com/fluojs/fluo/pull/${value.target.id}`)
      ) {
        fail(name, 'PR merge receipt must bind a canonical pull-request target');
      }
      return;
    case 'event': {
      const timestamp = new Date(value.occurred_at);
      if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value.occurred_at) {
        fail(name, 'occurred_at must be a canonical UTC timestamp');
      }
      if (value.event_hash !== hashEvent(value)) {
        fail(name, 'event_hash does not match the canonical event content');
      }
      if (value.payload_sha256 !== payloadDigest(value.payload)) {
        fail(name, 'payload_sha256 does not match the canonical payload');
      }
      return;
    }
    case 'blocker':
      return;
    default:
      fail(name, 'unknown contract');
  }
};

export const assertContract = (name, value) => {
  const schema = schemas.get(name);
  if (schema === undefined) {
    fail(name, 'unknown contract');
  }
  const failure = schemaFailure(schema, value, name);
  if (failure !== null) {
    fail(name, failure);
  }
  assertSemanticContract(name, value);
};

export const assertLaneSourceBinding = (lane, artifact) => {
  assertContract('lane-ledger-v2', lane);
  assertContract('search-artifact-v2', artifact);
  if (lane.source.artifact_id !== artifact.artifact_id || lane.source.sha256 !== artifact.sha256) {
    fail('lane-ledger-v2.source', 'source binding must match artifact_id and sha256');
  }
};

export const assertSameHeadReview = (verdict, lane) => {
  assertContract('review-verdict', verdict);
  assertContract('lane-ledger-v2', lane);
  const issueProgress = lane.issue_progress[String(verdict.issue_number)];
  if (
    verdict.lane_id !== lane.lane_id ||
    !lane.confirmed_issues.includes(verdict.issue_number) ||
    !isRecord(issueProgress) ||
    issueProgress.head_sha !== verdict.head_sha
  ) {
    fail('review-verdict', 'review must bind the same head and lane identity');
  }
};

export const hashEvent = (event) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        event.version,
        event.stream_id,
        event.sequence,
        event.previous_hash,
        event.event_type,
        event.subject_id,
        event.payload_sha256,
        event.occurred_at,
      ]),
    )
    .digest('hex');

export const assertEventChain = (events) => {
  if (!Array.isArray(events) || events.length === 0) {
    fail('event-chain', 'events must be a non-empty array');
  }
  let previousHash = null;
  let streamId;
  for (const [index, event] of events.entries()) {
    assertContract('event', event);
    const sequence = index + 1;
    if (event.sequence !== sequence) {
      fail('event-chain', `sequence must be contiguous from 1; expected ${String(sequence)}`);
    }
    if (index === 0) {
      streamId = event.stream_id;
    } else if (event.stream_id !== streamId) {
      fail('event-chain', 'all events must share stream_id');
    }
    if (event.previous_hash !== previousHash) {
      fail('event-chain', 'previous_hash must link to the preceding event_hash');
    }
    previousHash = event.event_hash;
  }
};
