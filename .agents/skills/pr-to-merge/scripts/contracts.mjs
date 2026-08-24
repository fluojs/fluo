import { assertContract } from '../../../workflow-contracts/contracts.mjs';

export const REVIEWERS = ['contract', 'code', 'verification'];
export const VERDICTS = ['merge', 'block', 'needs-human-check'];
export const CANONICAL_BLOCKER_KEYS = [
  'reviewer',
  'signature',
  'evidence',
  'fix_back_eligible',
  'status',
];

const SIGNALS = ['PASS', 'BLOCK', 'NEEDS-HUMAN-CHECK'];
const HEAD_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export class PrToMergeContractError extends TypeError {
  constructor(reason) {
    super(`pr-to-merge: ${reason}`);
    this.name = 'PrToMergeContractError';
    this.reason = reason;
  }
}

const fail = (reason) => {
  throw new PrToMergeContractError(reason);
};

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const assertReview = (review, headSha) => {
  if (!isRecord(review)) {
    fail('each reviewer result must be an object');
  }
  if (!hasExactKeys(review, ['reviewer', 'reviewed_head_sha', 'verdict_signal', 'blockers'])) {
    fail('reviewer result has non-canonical keys');
  }
  if (!REVIEWERS.includes(review.reviewer)) {
    fail('reviewer must be contract, code, or verification');
  }
  if (review.reviewed_head_sha !== headSha) {
    fail('every reviewer must bind the same head as the gate');
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

export const aggregateReviewerGate = (input) => {
  if (!isRecord(input) || !hasExactKeys(input, ['head_sha', 'reviews'])) {
    fail('input must contain exactly head_sha and reviews');
  }
  if (typeof input.head_sha !== 'string' || !HEAD_SHA_PATTERN.test(input.head_sha)) {
    fail('head_sha must be a lowercase 40-character Git SHA');
  }
  if (!Array.isArray(input.reviews)) {
    fail('reviews must be an array');
  }

  for (const review of input.reviews) {
    assertReview(review, input.head_sha);
  }

  const reviewerNames = input.reviews.map((review) => review.reviewer);
  if (
    reviewerNames.length !== REVIEWERS.length ||
    REVIEWERS.some((reviewer) => reviewerNames.filter((name) => name === reviewer).length !== 1)
  ) {
    fail('reviews must contain exactly one each of contract, code, verification');
  }

  const blockers = input.reviews.flatMap((review) => review.blockers);
  if (input.reviews.some((review) => review.verdict_signal === 'BLOCK')) {
    return { verdict: 'block', blockers };
  }
  if (input.reviews.some((review) => review.verdict_signal === 'NEEDS-HUMAN-CHECK')) {
    return { verdict: 'needs-human-check', blockers: [] };
  }
  return { verdict: 'merge', blockers: [] };
};
