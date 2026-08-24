import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const headSha = 'a'.repeat(40);
const otherHeadSha = 'b'.repeat(40);
const contractScriptUrl = pathToFileURL(
  resolve(process.cwd(), '.agents/skills/pr-to-merge/scripts/contracts.mjs'),
).href;

const loadContracts = () => import(contractScriptUrl);

const review = (
  reviewer: 'contract' | 'code' | 'verification',
  verdictSignal: 'PASS' | 'BLOCK' | 'NEEDS-HUMAN-CHECK',
  blockers: readonly Record<string, unknown>[] = [],
  reviewedHeadSha = headSha,
) => ({
  reviewer,
  reviewed_head_sha: reviewedHeadSha,
  verdict_signal: verdictSignal,
  blockers,
});

const blocker = {
  reviewer: 'code',
  signature: 'src/router.ts:incorrect-fallback:preserve-route-precedence',
  evidence: 'src/router.ts:42 selects the fallback before the explicit route',
  fix_back_eligible: true,
  status: 'unresolved',
};

describe('$pr-to-merge native same-head reviewer gate', () => {
  it('returns merge when the complete same-head reviewer triad passes', async () => {
    // Given
    const contracts = await loadContracts();
    const reviews = [
      review('contract', 'PASS'),
      review('code', 'PASS'),
      review('verification', 'PASS'),
    ];

    // When
    const result = contracts.aggregateReviewerGate({ head_sha: headSha, reviews });

    // Then
    expect(result).toEqual({ verdict: 'merge', blockers: [] });
  });

  it('returns block when one same-head reviewer blocks', async () => {
    // Given
    const contracts = await loadContracts();
    const reviews = [
      review('contract', 'PASS'),
      review('code', 'BLOCK', [blocker]),
      review('verification', 'PASS'),
    ];

    // When
    const result = contracts.aggregateReviewerGate({ head_sha: headSha, reviews });

    // Then
    expect(result).toEqual({ verdict: 'block', blockers: [blocker] });
  });

  it('returns needs-human-check when one same-head reviewer escalates', async () => {
    // Given
    const contracts = await loadContracts();
    const reviews = [
      review('contract', 'NEEDS-HUMAN-CHECK'),
      review('code', 'PASS'),
      review('verification', 'PASS'),
    ];

    // When
    const result = contracts.aggregateReviewerGate({ head_sha: headSha, reviews });

    // Then
    expect(result).toEqual({ verdict: 'needs-human-check', blockers: [] });
  });

  it('rejects a reviewer verdict bound to a different head', async () => {
    // Given
    const contracts = await loadContracts();
    const reviews = [
      review('contract', 'PASS'),
      review('code', 'PASS', [], otherHeadSha),
      review('verification', 'PASS'),
    ];

    // When / Then
    expect(() =>
      contracts.aggregateReviewerGate({ head_sha: headSha, reviews }),
    ).toThrow(/same head/u);
  });

  it('rejects a missing reviewer instead of merging an incomplete gate', async () => {
    // Given
    const contracts = await loadContracts();
    const reviews = [review('contract', 'PASS'), review('code', 'PASS')];

    // When / Then
    expect(() =>
      contracts.aggregateReviewerGate({ head_sha: headSha, reviews }),
    ).toThrow(/contract, code, verification/u);
  });

  it('preserves exactly the canonical blocker keys', async () => {
    // Given
    const contracts = await loadContracts();
    const reviews = [
      review('contract', 'PASS'),
      review('code', 'BLOCK', [blocker]),
      review('verification', 'PASS'),
    ];

    // When
    const result = contracts.aggregateReviewerGate({ head_sha: headSha, reviews });

    // Then
    expect(Object.keys(result.blockers[0] ?? {}).sort()).toEqual([
      'evidence',
      'fix_back_eligible',
      'reviewer',
      'signature',
      'status',
    ]);
  });
});
