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
  reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: reviewedHeadSha, preflight_sha256: policy.sha256,
  verdict_signal: verdictSignal, blockers,
  evidence: [{ acceptance: 'Preserve route precedence', locations: ['src/router.ts:42'] }], observations: [],
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
  it('#4128 new admission: evidence required, observations cannot turn a PASS into a blocker', async () => {
    const { aggregateReviewerGate, buildReviewFact, validateReviewFact } = await loadContracts();
    const valid = gate();
    expect(aggregateReviewerGate(valid, policy)).toEqual({ verdict: 'pass', blockers: [] });
    for (const patch of [
      { evidence: [] }, { evidence: undefined }, { observations: undefined },
      { evidence: [{ acceptance: '', locations: ['src/router.ts:42'] }] },
      { evidence: [{ acceptance: 'precedence', locations: [] }] },
      { evidence: [{ acceptance: 'precedence', locations: ['../router.ts:42'] }] },
      { observations: [''] }, { observations: [false] },
    ]) expect(() => aggregateReviewerGate(gate([
      { ...review('contract'), ...patch }, review('code'), review('verification'),
    ]), policy)).toThrow(TypeError);
    const observed = gate([{ ...review('contract'), observations: ['Optional improvement'] },
      review('code'), review('verification')]);
    expect(aggregateReviewerGate(observed, policy)).toEqual({ verdict: 'pass', blockers: [] });
    const fact = buildReviewFact(observed, headSha, policy);
    expect(validateReviewFact(fact, headSha, policy)).toEqual(fact);
  });

  it('#4128 stored envelopes: legacy bytes survive, partial modern fields are rejected', async () => {
    const { validateReviewFact } = await loadContracts();
    const reviews = policy.active_axes.map((reviewer, index) => ({
      reviewer, ...(index ? { agent: `fluo-${reviewer}-reviewer` } : {}),
      reviewed_head_sha: headSha, preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [],
    }));
    const legacy = { ...gate(reviews), head: headSha, verdict: 'pass', blockers: [] };
    const bytes = JSON.stringify(legacy);
    expect(validateReviewFact(legacy, headSha, policy)).toEqual(legacy);
    expect(JSON.stringify(legacy)).toBe(bytes);
    for (const patch of [{ observations: [] }, { evidence: [] }, { extra: true }]) {
      expect(() => validateReviewFact({ ...legacy, reviews: [
        { ...reviews[0], ...patch }, ...reviews.slice(1),
      ] }, headSha, policy)).toThrow(TypeError);
    }
  });

  it('#4099 retention: canonical previous PASS -> fresh contract and preserved original reviewer heads', async () => {
    const { buildReviewFact, validateReviewFact, aggregateReviewerGate } = await loadContracts();
    const boundPolicy = { ...policy, contract_sha256: 'd'.repeat(64) };
    const previous = buildReviewFact(gate(), headSha, boundPolicy);
    const retention = { version: 1, previous_head_sha: headSha, new_head_sha: otherHeadSha,
      contract_sha256: boundPolicy.contract_sha256, policy_sha256: policy.sha256,
      previous_merge_base_sha: 'e'.repeat(40), new_merge_base_sha: 'e'.repeat(40),
      previous_review: previous, previous_accepted_at: '2026-01-01T00:00:00.000Z',
      changed_files: ['README.md'], compared_files: [{ path: 'src/router.ts', axes: ['code', 'verification'],
        previous_sha256: 'f'.repeat(64), new_sha256: 'f'.repeat(64), previous_mode: '100644', new_mode: '100644' }] };
    const fresh = { ...gate([review('contract', 'PASS', [], otherHeadSha)]), head_sha: otherHeadSha };

    const fact = buildReviewFact(fresh, otherHeadSha, boundPolicy, retention);

    expect(validateReviewFact(fact, otherHeadSha, boundPolicy)).toEqual(fact);
    expect(aggregateReviewerGate(fresh, boundPolicy, retention)).toEqual({ verdict: 'pass', blockers: [] });
    expect(fact.retention.previous_review).toEqual(previous);
    expect(fact.retention.previous_review.reviews.map((envelope: { reviewed_head_sha: string }) => envelope.reviewed_head_sha))
      .toEqual([headSha, headSha, headSha]);
    expect(() => buildReviewFact(fresh, otherHeadSha, boundPolicy)).toThrow(TypeError);
    expect(() => buildReviewFact({ ...fresh, retention }, otherHeadSha, boundPolicy)).toThrow(TypeError);
    for (const patch of [
      { previous_review: null }, { previous_review: { ...previous, verdict: 'block' } },
      { previous_review: { ...previous, verdict: 'needs-human-check' } },
      { previous_review: { ...previous, reviews: previous.reviews.slice(1) } },
      { previous_review: { ...previous, reviews: [...previous.reviews, previous.reviews[1]] } },
      { previous_review: { ...previous, reviews: [{ ...previous.reviews[0], agent: 'fluo-code-reviewer' }, ...previous.reviews.slice(1)] } },
      { previous_head_sha: 'e'.repeat(40) }, { policy_sha256: '0'.repeat(64) }, { contract_sha256: '0'.repeat(64) },
      { changed_files: ['docs/guides/CONTEXT.md'] }, { changed_files: ['README.md', 'README.md'] },
      { compared_files: [{ ...retention.compared_files[0], new_sha256: '0'.repeat(64) }] },
      { compared_files: [{ ...retention.compared_files[0], new_mode: '100755' }] },
      { compared_files: [{ ...retention.compared_files[0], axes: ['code'] }] },
      { compared_files: [retention.compared_files[0], retention.compared_files[0]] },
    ]) expect(() => buildReviewFact(fresh, otherHeadSha, boundPolicy, { ...retention, ...patch })).toThrow(TypeError);
    expect(() => buildReviewFact({ ...fresh, reviews: [] }, otherHeadSha, boundPolicy, retention)).toThrow(TypeError);
    expect(() => buildReviewFact({ ...fresh, reviews: [...fresh.reviews, fresh.reviews[0]] },
      otherHeadSha, boundPolicy, retention)).toThrow(TypeError);
    const legacy = { ...previous, reviews: previous.reviews.map((envelope: Record<string, unknown>) => {
      const { evidence: _evidence, observations: _observations, agent: _agent, ...old } = envelope;
      return old;
    }) };
    const retained = buildReviewFact(fresh, otherHeadSha, boundPolicy, { ...retention, previous_review: legacy });
    const thirdHead = 'f'.repeat(40);
    const third = buildReviewFact({ ...fresh, head_sha: thirdHead,
      reviews: [review('contract', 'PASS', [], thirdHead)] }, thirdHead, boundPolicy,
    { ...retention, previous_head_sha: otherHeadSha, new_head_sha: thirdHead, previous_review: retained });
    expect(validateReviewFact(third, thirdHead, boundPolicy)).toEqual(third);
    expect(third.retention.previous_review.retention.previous_review).toEqual(legacy);
    const invalid = structuredClone(third);
    invalid.retention.previous_review.retention.previous_review.reviews[0].observations = [];
    expect(() => validateReviewFact(invalid, thirdHead, boundPolicy)).toThrow(TypeError);
  });

  it('#4099 contract-only policy: no retained axes are fabricated', async () => {
    const { buildReviewFact, validateReviewFact } = await loadContracts();
    const contractPolicy = { ...policy, active_axes: ['contract'] };
    const input = gate([review('contract')], ['contract']);

    const fact = buildReviewFact(input, headSha, contractPolicy);

    expect(validateReviewFact(fact, headSha, contractPolicy)).toEqual(fact);
    expect(fact.retention).toBeUndefined();
    expect(fact.reviews.map((envelope: { reviewer: string }) => envelope.reviewer)).toEqual(['contract']);
  });

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

  it('rejects missing agent identity on new reviewer input', async () => {
    const { aggregateReviewerGate } = await loadContracts();
    const { agent: _agent, ...unidentified } = review('contract');
    const input = gate([unidentified, review('code'), review('verification')]);

    expect(() => aggregateReviewerGate(input, policy)).toThrow(TypeError);
  });

  it.each(['fluo-code-reviewer', 'fluo-unregistered-reviewer', 'deep-high'])(
    'rejects substituted reviewer agent: %s',
    async (agent) => {
      const { aggregateReviewerGate } = await loadContracts();
      const input = gate([
        { ...review('contract'), agent }, review('code'), review('verification'),
      ]);

      expect(() => aggregateReviewerGate(input, policy)).toThrow(TypeError);
    },
  );

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
