import { assertContract } from '../../../workflow-contracts/contracts.mjs';

export const REVIEWERS = ['contract', 'code', 'verification'];
export const VERDICTS = ['pass', 'block', 'needs-human-check'];
export const CANONICAL_BLOCKER_KEYS = [
  'reviewer',
  'signature',
  'evidence',
  'fix_back_eligible',
  'status',
];

const SIGNALS = ['PASS', 'BLOCK', 'NEEDS-HUMAN-CHECK'];
const HEAD_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export class ReviewHeadContractError extends TypeError {
  constructor(reason) {
    super(`review-head: ${reason}`);
    this.name = 'ReviewHeadContractError';
    this.reason = reason;
  }
}

const fail = (reason) => {
  throw new ReviewHeadContractError(reason);
};

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const assertReview = (review, headSha, policySha) => {
  if (!isRecord(review)) {
    fail('each reviewer result must be an object');
  }
  if (!hasExactKeys(review, ['reviewer', 'reviewed_head_sha', 'preflight_sha256', 'verdict_signal', 'blockers'])) {
    fail('reviewer result has non-canonical keys');
  }
  if (!REVIEWERS.includes(review.reviewer)) {
    fail('reviewer must be contract, code, or verification');
  }
  if (review.reviewed_head_sha !== headSha) {
    fail('every reviewer must bind the same head as the gate');
  }
  if (review.preflight_sha256 !== policySha) {
    fail('every reviewer must bind the current preflight policy');
  }
  if (!SIGNALS.includes(review.verdict_signal)) {
    fail('verdict_signal must be PASS, BLOCK, or NEEDS-HUMAN-CHECK');
  }
  if (!Array.isArray(review.blockers)) {
    fail('blockers must be an array');
  }
  for (const blocker of review.blockers) {
    assertContract('blocker', blocker);
    if (blocker.reviewer !== review.reviewer) {
      fail('blocker reviewer must match its reviewer result');
    }
  }
  if (review.verdict_signal === 'BLOCK' && review.blockers.length === 0) {
    fail('BLOCK must contain at least one canonical blocker');
  }
  if (review.verdict_signal !== 'BLOCK' && review.blockers.length !== 0) {
    fail('only BLOCK may contain blockers');
  }
};

export const buildReviewFact = (input, headSha, policy) => {
  if (input?.head_sha !== headSha) fail('review must bind the current head');
  return { ...input, ...aggregateReviewerGate(input, policy), head: headSha };
};

export const validateReviewFact = (value, headSha, policy) => {
  if (!isRecord(value)) fail('review fact must be an object');
  const { head, verdict, blockers, ...input } = value;
  const expected = buildReviewFact(input, headSha, policy);
  if (head !== headSha || verdict !== expected.verdict || JSON.stringify(blockers) !== JSON.stringify(expected.blockers)) {
    fail('review fact does not match reviewer evidence');
  }
  return expected;
};

export const aggregateReviewerGate = (input, policy) => {
  if (!isRecord(input) || !hasExactKeys(input, ['head_sha', 'preflight_sha256', 'active_axes', 'reviews'])) {
    fail('input must contain exactly head_sha, preflight_sha256, active_axes, reviews');
  }
  if (!isRecord(policy) || typeof policy.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(policy.sha256)
    || !Array.isArray(policy.active_axes) || policy.active_axes.length === 0
    || policy.active_axes.some((a) => !REVIEWERS.includes(a))
    || new Set(policy.active_axes).size !== policy.active_axes.length
    || input.preflight_sha256 !== policy.sha256) {
    fail('gate must bind the current preflight policy');
  }
  if (!Array.isArray(input.active_axes) || input.active_axes.length !== policy.active_axes.length
    || new Set(input.active_axes).size !== input.active_axes.length
    || policy.active_axes.some((a) => !input.active_axes.includes(a))) {
    fail('active_axes must exactly match the preflight policy');
  }
  if (typeof input.head_sha !== 'string' || !HEAD_SHA_PATTERN.test(input.head_sha)) {
    fail('head_sha must be a lowercase 40-character Git SHA');
  }
  if (!Array.isArray(input.reviews)) {
    fail('reviews must be an array');
  }

  for (const review of input.reviews) {
    assertReview(review, input.head_sha, policy.sha256);
  }

  const reviewerNames = input.reviews.map((review) => review.reviewer);
  if (
    reviewerNames.length !== policy.active_axes.length ||
    policy.active_axes.some((reviewer) => reviewerNames.filter((name) => name === reviewer).length !== 1)
  ) {
    fail(`reviews must contain exactly one each of ${policy.active_axes.join(', ')}`);
  }

  const blockers = input.reviews.flatMap((review) => review.blockers);
  if (input.reviews.some((review) => review.verdict_signal === 'BLOCK')) {
    return { verdict: 'block', blockers };
  }
  if (input.reviews.some((review) => review.verdict_signal === 'NEEDS-HUMAN-CHECK')) {
    return { verdict: 'needs-human-check', blockers: [] };
  }
  return { verdict: 'pass', blockers: [] };
};
