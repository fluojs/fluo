import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const headSha = 'a'.repeat(40);
const otherHeadSha = 'b'.repeat(40);
const contractScriptUrl = pathToFileURL(
  resolve(process.cwd(), '.agents/skills/review-head/scripts/contracts.mjs'),
).href;
const loadContracts = () => import(contractScriptUrl);
const policy = { sha256: 'c'.repeat(64), active_axes: ['contract', 'code', 'verification'] };
const review = (
  reviewer: string,
  verdictSignal = 'PASS',
  blockers: readonly Record<string, unknown>[] = [],
  reviewedHeadSha = headSha,
) => ({
  reviewer, reviewed_head_sha: reviewedHeadSha, preflight_sha256: policy.sha256,
  verdict_signal: verdictSignal, blockers,
});
const gate = (
  reviews: readonly Record<string, unknown>[] = policy.active_axes.map((axis) => review(axis)),
  axes = policy.active_axes,
) => ({
  head_sha: headSha, preflight_sha256: policy.sha256, active_axes: axes, reviews,
});
const blocker = {
  reviewer: 'code',
  signature: 'src/router.ts:incorrect-fallback:preserve-route-precedence',
  evidence: 'src/router.ts:42 selects the fallback before the explicit route',
  fix_back_eligible: true,
  status: 'unresolved',
};

describe('$review-head native exact-head selective gate', () => {
  it('returns pass, never merge, without requiring a PR', async () => {
    const { aggregateReviewerGate } = await loadContracts();
    expect(aggregateReviewerGate(gate(), policy)).toEqual({ verdict: 'pass', blockers: [] });
  });

  it.each([['contract'], ['code', 'verification']])('accepts exactly selected axes: %s', async (...axes) => {
    const { aggregateReviewerGate } = await loadContracts();
    expect(aggregateReviewerGate(gate(axes.map((a) => review(a)), axes), { ...policy, active_axes: axes }))
      .toEqual({ verdict: 'pass', blockers: [] });
  });

  it('returns block and preserves exactly the canonical blocker fields', async () => {
    const { aggregateReviewerGate } = await loadContracts();
    const result = aggregateReviewerGate(gate([
      review('contract'), review('code', 'BLOCK', [blocker]), review('verification'),
    ]), policy);
    expect(result).toEqual({ verdict: 'block', blockers: [blocker] });
    expect(Object.keys(result.blockers[0]).sort()).toEqual([
      'evidence', 'fix_back_eligible', 'reviewer', 'signature', 'status',
    ]);
  });

  it('returns needs-human-check only from a selected same-head reviewer', async () => {
    const { aggregateReviewerGate } = await loadContracts();
    expect(aggregateReviewerGate(gate([
      review('contract', 'NEEDS-HUMAN-CHECK'), review('code'), review('verification'),
    ]), policy)).toEqual({ verdict: 'needs-human-check', blockers: [] });
  });

  it.each([
    ['missing', [review('contract'), review('code')]],
    ['duplicate', [review('contract'), review('code'), review('code')]],
    ['extra', [...policy.active_axes.map((a) => review(a)), review('contract')]],
    ['wrong head', [review('contract'), review('code', 'PASS', [], otherHeadSha), review('verification')]],
    ['wrong policy', [review('contract'), { ...review('code'), preflight_sha256: 'd'.repeat(64) }, review('verification')]],
    ['malformed', [review('contract'), { ...review('code'), verdict_signal: 'merge' }, review('verification')]],
    ['empty blocker', [review('contract'), review('code', 'BLOCK'), review('verification')]],
    ['unexpected blocker', [review('contract'), review('code', 'PASS', [blocker]), review('verification')]],
    ['malformed blocker', [review('contract'), review('code', 'BLOCK', [{ ...blocker, status: 'unknown' }]), review('verification')]],
  ])('rejects %s reviewer evidence', async (_name, reviews) => {
    const { aggregateReviewerGate } = await loadContracts();
    expect(() => aggregateReviewerGate(gate(reviews), policy)).toThrow();
  });

  it('rejects stale policy and unilateral axis narrowing even on the same head', async () => {
    const { aggregateReviewerGate } = await loadContracts();
    expect(() => aggregateReviewerGate(gate(), { ...policy, sha256: 'd'.repeat(64) })).toThrow();
    expect(() => aggregateReviewerGate(gate([review('contract')], ['contract']), policy)).toThrow();
    expect(() => aggregateReviewerGate(gate(), { ...policy, active_axes: ['contract'] })).toThrow();
    expect(() => aggregateReviewerGate(gate(), { ...policy, active_axes: ['contract', 'contract'] })).toThrow();
  });

  it('rejects non-canonical input and additional reviewer fields', async () => {
    const { aggregateReviewerGate } = await loadContracts();
    expect(() => aggregateReviewerGate({ ...gate(), verdict: 'pass' }, policy)).toThrow();
    expect(() => aggregateReviewerGate(gate([
      { ...review('contract'), pr: 1 }, review('code'), review('verification'),
    ]), policy)).toThrow();
  });
});
