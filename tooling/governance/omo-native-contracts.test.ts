import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const contractRoot = resolve(process.cwd(), '.agents/workflow-contracts');
const contractNames = [
  'search-artifact-v2',
  'lane-ledger-v2',
  'lane-dag-binding',
  'review-preflight',
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
const reviewPreflightContent = {
  version: 1,
  lane_id: lane.lane_id,
  issue_number: issueNumber,
  issue_contract_revision: 'issue-4101@1',
  issue_contract_sha256: '1'.repeat(64),
  lane_plan_approval_sha256: '2'.repeat(64),
  head_sha: headSha,
  generated_at: '2026-08-26T00:00:00.000Z',
  approved_sources: [{ source: 'issue #4101', revision: 'issue-4101@1', content_sha256: '3'.repeat(64) }],
  acceptance_row_ids: ['runtime-contract'],
  rows: [{
    id: 'runtime-contract',
    acceptance_text: 'Runtime contract remains compatible.',
    acceptance_sha256: createHash('sha256').update(JSON.stringify({ content: 'Runtime contract remains compatible.' })).digest('hex'),
    source: 'issue #4101',
    source_bindings: [{ source: 'issue #4101', revision: 'issue-4101@1', content_sha256: '3'.repeat(64) }],
    invariant: 'Runtime contract remains compatible.',
    surfaces: ['runtime'],
    positive_cases: ['supported input'],
    negative_cases: ['unsupported input'],
    boundary_cases: ['empty input'],
  }],
  nonfunctional: {
    complexity: 'linear',
    memory: 'bounded',
    atomicity: 'atomic',
    mutation_boundary: 'read-only',
  },
};
const reviewPreflight = {
  ...reviewPreflightContent,
  sha256: createHash('sha256').update(JSON.stringify(reviewPreflightContent)).digest('hex'),
};
const reviewerReceipts = Object.fromEntries(
  ['contract', 'code', 'verification'].map((axis) => {
    const finalResponse = {
      sentinel: 'fluo:execute-lane:review:final:v1',
      axis,
      head_sha: headSha,
      preflight_sha256: reviewPreflight.sha256,
      verdict_signal: 'PASS',
      coverage: { 'runtime-contract': 'PASS' },
      blockers: [],
      blocker_sources: {},
    };
    const toolEvents = [{
      tool: 'read',
      is_error: false,
      arguments: axis === 'verification'
        ? {
            path:
              `.omo/lane-runs/${lane.lane_id}/issues/${String(issueNumber)}/` +
              'canonical-verification/st_parent_verify_contracts.json',
          }
        : { path: 'package.json' },
    }];
    const sessionSha = '4'.repeat(64);
    return [axis, {
      task_id: `st_${axis}`,
      record_sha256: '3'.repeat(64),
      output_sha256: createHash('sha256').update(JSON.stringify(finalResponse)).digest('hex'),
      final_response: finalResponse,
      parent_session_id: 'ses_contracts',
      dag_run_id: 'dag_contracts',
      dag_key:
        `fluo:lane:${lane.lane_id}:issue-${String(issueNumber)}:lifecycle:v3`,
      dag_node_id: `review-${axis}-${headSha}`,
      dag_owner_fingerprint: '7'.repeat(64),
      lane_id: lane.lane_id,
      issue_number: issueNumber,
      worktree: '.worktrees/issue-4101-runtime',
      head_sha: headSha,
      preflight_sha256: reviewPreflight.sha256,
      axis,
      mutation_sentinel: 'fluo:execute-lane:review:read-only:v1',
      session_sha256: sessionSha,
      tool_events_sha256: createHash('sha256').update(JSON.stringify(toolEvents)).digest('hex'),
      tool_events: toolEvents,
      canonical_verification: axis === 'verification' ? {
        receipt_id: 'st_parent_verify_contracts',
        receipt_sha256: '5'.repeat(64),
        authority_snapshot_sha256: '6'.repeat(64),
        command: ['pnpm', 'verify'],
        status: 0,
        result: 'pass',
        session_sha256: sessionSha,
      } : null,
    }];
  }),
);
const localReviewVerdict = {
  version: 2,
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
  reviews: ['contract', 'code', 'verification'].map((reviewer) => ({
    reviewer,
    reviewed_head_sha: headSha,
    verdict_signal: 'PASS',
    blockers: [],
  })),
  review_batch: {
    preflight_sha256: reviewPreflight.sha256,
    task_ids: {
      contract: 'st_contract',
      code: 'st_code',
      verification: 'st_verification',
    },
    reviewer_receipts: reviewerReceipts,
    coverage: {
      contract: { 'runtime-contract': 'PASS' },
      code: { 'runtime-contract': 'PASS' },
      verification: { 'runtime-contract': 'PASS' },
    },
    blocker_sources: {},
  },
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
    ['review-preflight', reviewPreflight],
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

  it('enforces referenced review evidence schemas and date-time formats', () => {
    const api = requireContracts();
    const v2Verdict = {
      ...localReviewVerdict,
      version: 2,
      reviews: [
        { reviewer: 'contract', reviewed_head_sha: headSha, verdict_signal: 'PASS', blockers: [] },
        { reviewer: 'code', reviewed_head_sha: headSha, verdict_signal: 'PASS', blockers: [] },
        { reviewer: 'verification', reviewed_head_sha: headSha, verdict_signal: 'PASS', blockers: [] },
      ],
      review_batch: {
        preflight_sha256: reviewPreflight.sha256,
        task_ids: { contract: 'st_contract', code: 'st_code', verification: 'st_verification' },
        reviewer_receipts: reviewerReceipts,
        coverage: {
          contract: { 'runtime-contract': 'PASS' },
          code: { 'runtime-contract': 'PASS' },
          verification: { 'runtime-contract': 'PASS' },
        },
        blocker_sources: {},
      },
    };
    expect(() => api.assertContract('local-review-verdict', v2Verdict)).not.toThrow();
    for (const generatedAt of [
      'not-a-date',
      '2026-02-30T00:00:00Z',
      '2025-02-29T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00+24:00',
      '2026-01-01T00:00:00+00:60',
    ]) {
      expect(() => api.assertContract('review-preflight', { ...reviewPreflight, generated_at: generatedAt })).toThrow(/date-time/u);
    }
    for (const generatedAt of [
      '2024-02-29T23:59:59Z',
      '2026-04-30T12:34:56.123456-07:30',
      '2026-01-01T00:00:00+23:59',
    ]) {
      const content = { ...reviewPreflightContent, generated_at: generatedAt };
      const valid = {
        ...content,
        sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
      };
      expect(() => api.assertContract('review-preflight', valid)).not.toThrow();
    }
    expect(() => api.assertContract('local-review-verdict', {
      ...v2Verdict,
      review_batch: { ...v2Verdict.review_batch, coverage: { ...v2Verdict.review_batch.coverage, code: {} } },
    })).toThrow(/property/u);
    expect(() => api.assertContract('local-review-verdict', {
      ...v2Verdict,
      review_batch: { ...v2Verdict.review_batch, blocker_sources: { invented: { contract_source: 'x' } } },
    })).toThrow(/required/u);
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
