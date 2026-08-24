import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const contractRoot = resolve(process.cwd(), '.agents/workflow-contracts');
const contractNames = [
  'search-artifact-v2',
  'lane-ledger-v2',
  'review-verdict',
  'blocker',
  'receipt',
  'event',
] as const;
const modulePath = resolve(contractRoot, 'contracts.mjs');

const artifact = {
  version: 2,
  artifact_id: 'search:search-2026-08-runtime',
  sha256: 'a'.repeat(64),
  search_run_id: 'search-2026-08-runtime',
  selected_issues: [4101],
};
const lane = {
  version: 2,
  lane_id: 'lane-4101-runtime',
  source: {
    artifact_id: artifact.artifact_id,
    sha256: artifact.sha256,
  },
  issue_number: 4101,
  branch: 'issue-4101-runtime',
  worktree: '.worktrees/issue-4101-runtime',
  head_sha: 'b'.repeat(40),
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
  issue_number: lane.issue_number,
  reviewer: 'code',
  verdict: 'block',
  head_sha: lane.head_sha,
  blockers: [blocker],
};
const receipt = {
  version: 1,
  receipt_id: 'receipt-4101-merge',
  lane_id: lane.lane_id,
  issue_number: lane.issue_number,
  side_effect: 'pr.merge',
  status: 'succeeded',
  head_sha: lane.head_sha,
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

const eventWithoutHash = (
  sequence: number,
  previous_hash: string | null,
): Readonly<Record<string, unknown>> => ({
  version: 1,
  stream_id: lane.lane_id,
  sequence,
  previous_hash,
  event_type: 'receipt.recorded',
  subject_id: receipt.receipt_id,
  payload_sha256: 'c'.repeat(64),
  occurred_at: `2026-08-24T00:00:0${String(sequence)}.000Z`,
});

const eventWithHash = (
  api: ContractsModule,
  sequence: number,
  previous_hash: string | null,
): Readonly<Record<string, unknown>> => {
  const event = eventWithoutHash(sequence, previous_hash);
  return { ...event, event_hash: api.hashEvent(event) };
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

  it('requires lane v2 branch, worktree, and issue identity to agree', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertContract('lane-ledger-v2', lane)).not.toThrow();
    expect(() =>
      api.assertContract('lane-ledger-v2', {
        ...lane,
        worktree: '.worktrees/issue-999-other',
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

  it('accepts only sequenced, content-hashed, hash-linked events', () => {
    // Given
    const api = requireContracts();
    const first = eventWithHash(api, 1, null);
    const firstHash = first['event_hash'];
    expect(typeof firstHash).toBe('string');
    const second = eventWithHash(api, 2, typeof firstHash === 'string' ? firstHash : null);

    // When / Then
    expect(() => api.assertContract('event', first)).not.toThrow();
    expect(() => api.assertEventChain([first, second])).not.toThrow();
    expect(() =>
      api.assertEventChain([{ ...first, subject_id: 'tampered' }, second]),
    ).toThrow(/event_hash/u);
    const skippedSequence = eventWithHash(
      api,
      3,
      typeof firstHash === 'string' ? firstHash : null,
    );
    expect(() => api.assertEventChain([first, skippedSequence])).toThrow(/sequence/u);
    const brokenLink = eventWithHash(api, 2, 'f'.repeat(64));
    expect(() => api.assertEventChain([first, brokenLink])).toThrow(/previous_hash/u);
  });
});
