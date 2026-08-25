import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const contractRoot = resolve(process.cwd(), '.agents/workflow-contracts');
const contractNames = [
  'search-artifact-v2',
  'lane-ledger-v2',
  'lane-dag-binding',
  'local-review-verdict',
  'review-verdict',
  'blocker',
  'receipt',
  'event',
] as const;
const modulePath = resolve(contractRoot, 'contracts.mjs');

const artifactDigest = (
  value: Readonly<{
    version: number;
    artifact_id: string;
    search_run_id: string;
    selected_issues: readonly number[];
  }>,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        version: value.version,
        artifact_id: value.artifact_id,
        search_run_id: value.search_run_id,
        selected_issues: value.selected_issues,
      }),
    )
    .digest('hex');

const artifactIdentity = {
  version: 2,
  artifact_id: 'search:search-2026-08-runtime',
  search_run_id: 'search-2026-08-runtime',
  selected_issues: [4101],
} as const;
const artifact = {
  ...artifactIdentity,
  sha256: artifactDigest(artifactIdentity),
};
const issueNumber = 4101;
const headSha = 'b'.repeat(40);
const lane = {
  version: 2,
  run_id: 'lane-4101-runtime',
  lane_id: 'lane-4101-runtime',
  status: 'running',
  created_by: 'create-lane',
  base_branch: 'main',
  source: {
    type: 'search-issue',
    search_run_id: artifact.search_run_id,
    search_ledger: `.omo/search-issue/artifacts/${artifact.search_run_id}.json`,
    artifact_id: artifact.artifact_id,
    sha256: artifact.sha256,
  },
  merge_policy: 'supervisor-auto',
  pr_merge_method: 'squash',
  authority_scope: {
    issue_creation: false,
    pr_creation: true,
    pr_merge: true,
    cleanup_command_worktrees: true,
    root_main_sync_ff_only: true,
    publish_via_github_actions: false,
  },
  retry_policy: {
    retry_count_is_terminal: true,
    max_same_failure_repeats: 3,
    max_wall_clock_minutes: 180,
    stop_on_child_contract_error: true,
  },
  execution: {
    status: 'running',
    last_command: '$execute-lane lane-4101-runtime',
    last_updated: '2026-08-24T00:00:00.000Z',
  },
  confirmed_issues: [issueNumber],
  suggested_but_excluded: [],
  backlog_candidates: [],
  release_handoffs: [],
  completed_issues: [],
  issue_progress: {
    [String(issueNumber)]: { head_sha: headSha },
  },
  lanes: [
    {
      name: 'runtime',
      queue: [issueNumber],
      current_issue: issueNumber,
      status: 'in_review',
      branch: 'issue-4101-runtime',
      worktree: '.worktrees/issue-4101-runtime',
      pr: 'https://github.com/fluojs/fluo/pull/4101',
      retry_count: 0,
    },
  ],
  dependency_graph: {},
  root_main_sync: { status: 'not-started', sha: null },
};
const laneDagBinding = {
  version: 1,
  lane_id: lane.lane_id,
  dag_key: `fluo:lane:${lane.lane_id}:issue-supervisors:v1`,
  run_id: 'run_lane_4101',
  definition_sha256: 'd'.repeat(64),
  snapshot_event_hash: null,
  status: 'attached',
};
const localReviewVerdict = {
  version: 1,
  lane_id: lane.lane_id,
  issue_number: issueNumber,
  verdict: 'ready-for-pr',
  head_sha: headSha,
  reviewers: {
    contract: 'PASS',
    code: 'PASS',
    verification: 'PASS',
  },
  blockers: [],
};
const blocker = {
  reviewer: 'code',
  signature: 'missing-abort-path',
  evidence: 'tooling/runtime.ts:42',
  fix_back_eligible: true,
  status: 'unresolved',
};
const reviewVerdict = {
  version: 1,
  lane_id: lane.lane_id,
  issue_number: issueNumber,
  reviewer: 'code',
  verdict: 'block',
  head_sha: headSha,
  blockers: [blocker],
};
const receipt = {
  version: 1,
  receipt_id: 'receipt-4101-merge',
  lane_id: lane.lane_id,
  issue_number: issueNumber,
  side_effect: 'pr.merge',
  status: 'succeeded',
  head_sha: headSha,
  target: {
    kind: 'pull-request',
    id: '4101',
    url: 'https://github.com/fluojs/fluo/pull/4101',
  },
  evidence: 'https://github.com/fluojs/fluo/pull/4101',
};

type ContractsModule = {
  readonly assertContract: (name: string, value: unknown) => void;
  readonly assertEventChain: (events: readonly unknown[]) => void;
  readonly assertLaneSourceBinding: (laneValue: unknown, artifactValue: unknown) => void;
  readonly assertSameHeadReview: (verdictValue: unknown, laneValue: unknown) => void;
  readonly hashEvent: (event: Readonly<Record<string, unknown>>) => string;
};

let contracts: ContractsModule | undefined;
if (existsSync(modulePath)) {
  contracts = await import(modulePath);
}

const requireContracts = (): ContractsModule => {
  expect(contracts, 'contracts.mjs must expose the shared contract API').toBeDefined();
  if (contracts === undefined) {
    throw new TypeError('contracts.mjs is unavailable');
  }
  return contracts;
};

describe('OMO native workflow JSON schemas', () => {
  it('parses every canonical schema', () => {
    // Given / When
    const parsed = contractNames.map((name) => {
      const path = resolve(contractRoot, `${name}.schema.json`);
      expect(existsSync(path), `${name} schema must exist`).toBe(true);
      const parsedSchema: unknown = JSON.parse(readFileSync(path, 'utf8'));
      return parsedSchema;
    });

    // Then
    expect(parsed).toHaveLength(contractNames.length);
  });

  it.each([
    ['search-artifact-v2', artifact],
    ['lane-ledger-v2', lane],
    ['lane-dag-binding', laneDagBinding],
    ['local-review-verdict', localReviewVerdict],
    ['review-verdict', reviewVerdict],
    ['blocker', blocker],
    ['receipt', receipt],
  ])('accepts the canonical %s fixture and rejects unknown keys', (name, fixture) => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertContract(name, fixture)).not.toThrow();
    expect(() => api.assertContract(name, { ...fixture, legacy: true })).toThrow(
      /unknown key/u,
    );
  });
});

describe('OMO native cross-contract invariants', () => {
  it('rejects a search artifact whose canonical content does not match sha256', () => {
    // Given
    const api = requireContracts();
    const tamperedArtifact = { ...artifact, selected_issues: [9999] };

    // When / Then
    expect(() =>
      api.assertContract('search-artifact-v2', tamperedArtifact),
    ).toThrow(/sha256.*canonical/u);
  });

  it('binds a lane source to both artifact_id and sha256', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertLaneSourceBinding(lane, artifact)).not.toThrow();
    expect(() =>
      api.assertLaneSourceBinding(
        { ...lane, source: { ...lane.source, sha256: 'd'.repeat(64) } },
        artifact,
      ),
    ).toThrow(/source binding/u);
  });

  it('requires each lane v2 worktree to match its branch', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertContract('lane-ledger-v2', lane)).not.toThrow();
    expect(() =>
      api.assertContract('lane-ledger-v2', {
        ...lane,
        lanes: [
          {
            ...lane.lanes[0],
            worktree: '.worktrees/issue-999-other',
          },
        ],
      }),
    ).toThrow(/worktree.*branch/u);
  });

  it('accepts review evidence only for the lane current head', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertSameHeadReview(reviewVerdict, lane)).not.toThrow();
    expect(() =>
      api.assertSameHeadReview({ ...reviewVerdict, head_sha: 'e'.repeat(40) }, lane),
    ).toThrow(/same head/u);
  });

  it('requires blockers only for blocking verdicts and canonical blocker keys', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertContract('review-verdict', reviewVerdict)).not.toThrow();
    expect(() =>
      api.assertContract('review-verdict', { ...reviewVerdict, verdict: 'pass' }),
    ).toThrow(/pass verdict.*blockers/u);
    expect(() =>
      api.assertContract('blocker', { ...blocker, retryable: true }),
    ).toThrow(/unknown key/u);
  });

  it('records successful side effects as head-bound receipts', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertContract('receipt', receipt)).not.toThrow();
    expect(() =>
      api.assertContract('receipt', { ...receipt, head_sha: null }),
    ).toThrow(/succeeded receipt.*head_sha/u);
  });

});
