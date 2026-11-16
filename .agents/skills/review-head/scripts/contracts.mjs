import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { assertAgentIdentity, reviewerTargets } from '../../execute-lane/scripts/dispatch-targets.mjs';
import { isRetentionProsePath } from '../../issue-preflight/scripts/contracts.mjs';

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

const assertReview = (review, headSha, policySha, stored) => {
  if (!isRecord(review)) {
    fail('each reviewer result must be an object');
  }
  const keys = ['reviewer', 'reviewed_head_sha', 'preflight_sha256', 'verdict_signal', 'blockers'];
  // Only persisted facts may omit identity. Never normalize or rewrite their bytes.
  const substantiated = !stored || Object.hasOwn(review, 'evidence') || Object.hasOwn(review, 'observations');
  if (substantiated || Object.hasOwn(review, 'agent')) keys.push('agent');
  if (substantiated) keys.push('evidence', 'observations');
  if (!hasExactKeys(review, keys)) {
    fail('reviewer result has non-canonical keys');
  }
  if (!REVIEWERS.includes(review.reviewer)) {
    fail('reviewer must be contract, code, or verification');
  }
  if (!stored || Object.hasOwn(review, 'agent')) {
    assertAgentIdentity(reviewerTargets[review.reviewer], review.agent);
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
  if (substantiated) {
    if (!Array.isArray(review.evidence) || review.verdict_signal === 'PASS' && review.evidence.length === 0) {
      fail('PASS requires at least one acceptance evidence entry');
    }
    for (const entry of review.evidence) {
      if (!isRecord(entry) || !hasExactKeys(entry, ['acceptance', 'locations'])
        || typeof entry.acceptance !== 'string' || !entry.acceptance.trim()
        || !Array.isArray(entry.locations) || entry.locations.length === 0
        || entry.locations.some((location) => {
          if (typeof location !== 'string') return true;
          const match = /^(.*):([1-9][0-9]*)$/u.exec(location);
          return !match || !safePath(match[1]) || match[1].includes(':');
        })) fail('evidence requires acceptance and repository-relative file:line locations');
    }
    if (!Array.isArray(review.observations)
      || review.observations.some((item) => typeof item !== 'string' || !item.trim())) {
      fail('observations must be an array of non-empty strings');
    }
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

export const buildReviewFact = (input, headSha, policy, retention) => {
  if (input?.head_sha !== headSha) fail('review must bind the current head');
  return { ...input, ...aggregateReviewerGate(input, policy, retention), head: headSha,
    ...(retention === undefined ? {} : { retention }) };
};

export const validateReviewFact = (value, headSha, policy) => {
  if (!isRecord(value)) fail('review fact must be an object');
  const { head, verdict, blockers, retention, ...input } = value;
  if (input.head_sha !== headSha) fail('review must bind the current head');
  if (Object.hasOwn(value, 'retention') && retention === undefined) fail('missing retention');
  const expected = { ...input, ...aggregate(input, policy, true, retention), head: headSha,
    ...(retention === undefined ? {} : { retention }) };
  if (head !== headSha || verdict !== expected.verdict || JSON.stringify(blockers) !== JSON.stringify(expected.blockers)) {
    fail('review fact does not match reviewer evidence');
  }
  return expected;
};

export const aggregateReviewerGate = (input, policy, retention) => aggregate(input, policy, false, retention);

const sortedUnique = (items) => Array.isArray(items)
  && items.every((item) => typeof item === 'string')
  && items.every((item, index) => index === 0 || items[index - 1] < item);
const safePath = (path) => typeof path === 'string' && path.length > 0
  && !path.includes('\\') && !/[\x00-\x1f*?]/u.test(path)
  && path.split('/').every((part) => part && part !== '.' && part !== '..');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

// Pure validation checks each hop; only CLI Git observation authenticates coverage.
export const retentionFreshAxes = (retention, headSha, policy) => {
  if (retention === undefined) return policy.active_axes;
  const keys = ['version', 'previous_head_sha', 'new_head_sha', 'contract_sha256', 'policy_sha256',
    'previous_merge_base_sha', 'new_merge_base_sha', 'previous_review', 'previous_accepted_at',
    'changed_files', 'compared_files'];
  if (!isRecord(retention) || !hasExactKeys(retention, keys) || retention.version !== 1
    || !policy.active_axes.includes('contract')
    || retention.new_head_sha !== headSha || retention.previous_head_sha === headSha
    || [retention.previous_head_sha, retention.new_head_sha, retention.previous_merge_base_sha,
      retention.new_merge_base_sha].some((sha) => typeof sha !== 'string' || !HEAD_SHA_PATTERN.test(sha))
    || !digest(retention.contract_sha256) || retention.contract_sha256 !== policy.contract_sha256
    || retention.policy_sha256 !== policy.sha256
    || typeof retention.previous_accepted_at !== 'string'
    || !Number.isFinite(Date.parse(retention.previous_accepted_at))) fail('invalid retention binding');
  if (!sortedUnique(retention.changed_files) || retention.changed_files.length === 0
    || !retention.changed_files.every(isRetentionProsePath)) fail('retention requires explanatory authored changes');
  const previous = validateReviewFact(retention.previous_review, retention.previous_head_sha, policy);
  if (previous.verdict !== 'pass') fail('retention requires canonical previous PASS');
  const axes = policy.active_axes.filter((axis) => axis !== 'contract').sort();
  if (!axes.length || !Array.isArray(retention.compared_files)
    || !sortedUnique(retention.compared_files.map((file) => file?.path))) fail('invalid retention coverage');
  for (const file of retention.compared_files) {
    if (!isRecord(file) || !hasExactKeys(file, ['path', 'axes', 'previous_sha256', 'new_sha256', 'previous_mode', 'new_mode'])
      || !safePath(file.path) || !sortedUnique(file.axes) || file.axes.length !== axes.length
      || axes.some((axis, index) => file.axes[index] !== axis)
      || !digest(file.previous_sha256) || file.previous_sha256 !== file.new_sha256
      || file.previous_mode !== '100644' && file.previous_mode !== '100755'
      || file.previous_mode !== file.new_mode) fail('retention comparison differs or is incomplete');
  }
  return policy.active_axes.filter((axis) => !axes.includes(axis));
};

const aggregate = (input, policy, stored, retention) => {
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

  const freshAxes = retentionFreshAxes(retention, input.head_sha, policy);
  for (const review of input.reviews) {
    assertReview(review, input.head_sha, policy.sha256, stored);
  }

  const reviewerNames = input.reviews.map((review) => review.reviewer);
  if (
    reviewerNames.length !== freshAxes.length ||
    freshAxes.some((reviewer) => reviewerNames.filter((name) => name === reviewer).length !== 1)
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
