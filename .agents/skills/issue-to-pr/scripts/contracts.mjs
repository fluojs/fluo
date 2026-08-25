import { assertContract } from '../../../workflow-contracts/contracts.mjs';

export const implementerAuthority = Object.freeze({
  edit: true, test: true, commit: true, push: false, create_pr: false,
});

export const leadAuthority = Object.freeze({
  edit: false, test: false, commit: false, push: true, create_pr: true,
});

class IssueToPrContractError extends TypeError {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'IssueToPrContractError';
    this.path = path;
    this.reason = reason;
  }
}

const inputKeys = [
  'version', 'lane_id', 'issue_number', 'issue_url', 'issue_title',
  'base_branch', 'branch', 'worktree', 'starting_head_sha', 'mode',
  'existing_pr', 'blockers', 'fix_back_attempt',
];
const prKeys = ['number', 'url', 'head_branch'];
const identityKeys = ['branch', 'worktree', 'checked_out_branch', 'pr'];
const resultKeys = [
  'version', 'result', 'mode', 'lane_id', 'issue_number', 'branch', 'worktree',
  'pr', 'previous_head_sha', 'head_sha', 'commit_sha', 'changed_files',
  'verification', 'fix_back_result', 'addressed_blockers', 'remaining_blockers',
];
const verificationKeys = ['command', 'status'];
const shaPattern = /^[a-f0-9]{40}$/u;
const branchPattern = /^issue-[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const fail = (path, reason) => {
  throw new IssueToPrContractError(path, reason);
};

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (value, path) => {
  if (!isRecord(value)) {
    fail(path, 'must be an object');
  }
};

const assertExactKeys = (value, keys, path) => {
  assertRecord(value, path);
  const expected = new Set(keys);
  const unknown = Object.keys(value).find((key) => !expected.has(key));
  if (unknown !== undefined) {
    fail(path, `unknown key ${unknown}`);
  }
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) {
    fail(path, `${missing} is required`);
  }
};

const assertString = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, 'must be a non-empty string');
  }
};

const assertSha = (value, path) => {
  if (typeof value !== 'string' || !shaPattern.test(value)) {
    fail(path, 'must be a 40-character lowercase Git SHA');
  }
};

const assertPr = (value, path) => {
  assertExactKeys(value, prKeys, path);
  if (!Number.isSafeInteger(value.number) || value.number < 1) {
    fail(`${path}.number`, 'must be a positive integer');
  }
  assertString(value.url, `${path}.url`);
  assertString(value.head_branch, `${path}.head_branch`);
};

const assertBranchWorktree = (branch, worktree, path) => {
  if (typeof branch !== 'string' || !branchPattern.test(branch)) {
    fail(`${path}.branch`, 'must use issue-<number>-<short-title>');
  }
  if (worktree !== `.worktrees/${branch}`) {
    fail(`${path}.worktree`, 'must exactly match branch under .worktrees');
  }
};

const assertCanonicalBlockers = (blockers, path) => {
  if (!Array.isArray(blockers)) {
    fail(path, 'must be an array');
  }
  blockers.forEach((blocker) => assertContract('blocker', blocker));
};

const assertUnresolvedInputBlockers = (blockers, path) => {
  assertCanonicalBlockers(blockers, path);
  const resolvedIndex = blockers.findIndex((blocker) => blocker.status !== 'unresolved');
  if (resolvedIndex !== -1) {
    fail(`${path}[${String(resolvedIndex)}]`, 'input blocker must be unresolved');
  }
};

export const assertIssueToPrInput = (value) => {
  assertExactKeys(value, inputKeys, 'issue-to-pr input');
  if (value.version !== 1) {
    fail('issue-to-pr input.version', 'must equal 1');
  }
  assertString(value.lane_id, 'issue-to-pr input.lane_id');
  if (!Number.isSafeInteger(value.issue_number) || value.issue_number < 1) {
    fail('issue-to-pr input.issue_number', 'must be a positive integer');
  }
  assertString(value.issue_url, 'issue-to-pr input.issue_url');
  assertString(value.issue_title, 'issue-to-pr input.issue_title');
  assertString(value.base_branch, 'issue-to-pr input.base_branch');
  assertBranchWorktree(value.branch, value.worktree, 'issue-to-pr input');
  if (!value.branch.startsWith(`issue-${String(value.issue_number)}-`)) {
    fail('issue-to-pr input.branch', 'must bind the input issue number');
  }
  assertSha(value.starting_head_sha, 'issue-to-pr input.starting_head_sha');
  assertUnresolvedInputBlockers(value.blockers, 'issue-to-pr input.blockers');

  if (value.mode === 'new-pr' || value.mode === 'local-new') {
    if (value.existing_pr !== null || value.blockers.length !== 0 || value.fix_back_attempt !== null) {
      fail('issue-to-pr input', 'new modes must not carry PR, blockers, or fix-back attempt');
    }
    return;
  }
  if (!['fix-back', 'local-fix-back', 'ci-fix-back'].includes(value.mode)) {
    fail(
      'issue-to-pr input.mode',
      'must be new-pr, local-new, fix-back, local-fix-back, or ci-fix-back',
    );
  }
  if (value.mode === 'local-fix-back') {
    if (value.existing_pr !== null || value.blockers.length === 0) {
      fail(
        'issue-to-pr input',
        'local-fix-back requires blockers and must not carry PR identity',
      );
    }
  } else {
    assertPr(value.existing_pr, 'issue-to-pr input.existing_pr');
    if (value.existing_pr.head_branch !== value.branch || value.blockers.length === 0) {
      fail('issue-to-pr input', 'remote fix-back PR identity and blockers are required');
    }
  }
  if (value.blockers.some((blocker) => blocker.fix_back_eligible !== true)) {
    fail(
      'issue-to-pr input.blockers',
      'fix-back requires every blocker to set fix_back_eligible true; route others to human resolution',
    );
  }
  if (!Number.isSafeInteger(value.fix_back_attempt) || value.fix_back_attempt < 1 || value.fix_back_attempt > 3) {
    fail('issue-to-pr input.fix_back_attempt', 'must be an integer from 1 through 3');
  }
};

export const assertIssueToPrIdentity = (input, identity) => {
  assertIssueToPrInput(input);
  assertExactKeys(identity, identityKeys, 'issue-to-pr identity');
  assertBranchWorktree(identity.branch, identity.worktree, 'issue-to-pr identity');
  if (identity.branch !== input.branch || identity.worktree !== input.worktree || identity.checked_out_branch !== input.branch) {
    fail('issue-to-pr identity', 'branch, worktree, and checked-out branch must match input');
  }
  if (['new-pr', 'local-new', 'local-fix-back'].includes(input.mode)) {
    if (identity.pr !== null) {
      fail('issue-to-pr identity.PR', 'local or new implementation must not reuse a PR');
    }
    return;
  }
  assertPr(identity.pr, 'issue-to-pr identity.PR');
  if (
    identity.pr.number !== input.existing_pr.number ||
    identity.pr.url !== input.existing_pr.url ||
    identity.pr.head_branch !== input.branch
  ) {
    fail('issue-to-pr identity.PR', 'must match the existing PR exactly');
  }
};

export const assertIssueToPrResult = (input, result) => {
  assertIssueToPrInput(input);
  assertExactKeys(result, resultKeys, 'issue-to-pr typed output');
  if (result.version !== 1 || result.result !== 'completed' || result.mode !== input.mode) {
    fail('issue-to-pr typed output', 'version, result, and mode are invalid');
  }
  if (
    result.lane_id !== input.lane_id ||
    result.issue_number !== input.issue_number ||
    result.branch !== input.branch ||
    result.worktree !== input.worktree
  ) {
    fail('issue-to-pr typed output identity', 'lane, issue, branch, and worktree must match input');
  }
  const localMode = ['local-new', 'local-fix-back'].includes(input.mode);
  if (localMode) {
    if (result.pr !== null) {
      fail('issue-to-pr typed output.pr', 'local modes must return before PR creation');
    }
  } else {
    assertPr(result.pr, 'issue-to-pr typed output.pr');
    if (result.pr.head_branch !== input.branch) {
      fail('issue-to-pr typed output identity', 'PR head branch must match input branch');
    }
    if (
      ['fix-back', 'ci-fix-back'].includes(input.mode) &&
      (result.pr.number !== input.existing_pr.number ||
        result.pr.url !== input.existing_pr.url)
    ) {
      fail('issue-to-pr typed output identity', 'remote fix-back must retain the existing PR');
    }
  }
  assertSha(result.previous_head_sha, 'issue-to-pr typed output.previous_head_sha');
  assertSha(result.head_sha, 'issue-to-pr typed output.head_sha');
  assertSha(result.commit_sha, 'issue-to-pr typed output.commit_sha');
  if (result.previous_head_sha !== input.starting_head_sha || result.head_sha === input.starting_head_sha) {
    fail('issue-to-pr typed output.head_sha', 'implementation must create a new head');
  }
  if (result.commit_sha !== result.head_sha) {
    fail('issue-to-pr typed output.commit_sha', 'must equal the new head');
  }
  if (!Array.isArray(result.changed_files) || result.changed_files.length === 0 || result.changed_files.some((path) => typeof path !== 'string' || path.length === 0)) {
    fail('issue-to-pr typed output.changed_files', 'must contain changed paths');
  }
  if (!Array.isArray(result.verification) || result.verification.length === 0) {
    fail('issue-to-pr typed output.verification', 'must contain verifier results');
  }
  for (const entry of result.verification) {
    assertExactKeys(entry, verificationKeys, 'issue-to-pr typed output.verification entry');
    assertString(entry.command, 'issue-to-pr typed output.verification.command');
    if (entry.status !== 'passed') {
      fail('issue-to-pr typed output.verification.status', 'must be passed');
    }
  }
  assertCanonicalBlockers(result.addressed_blockers, 'issue-to-pr typed output.addressed_blockers');
  assertCanonicalBlockers(result.remaining_blockers, 'issue-to-pr typed output.remaining_blockers');
  assertBlockerReconciliation(
    input.blockers,
    result.addressed_blockers,
    result.remaining_blockers,
  );
  const expectedFixBackResult = [
    'fix-back',
    'local-fix-back',
    'ci-fix-back',
  ].includes(input.mode)
    ? 'remediated'
    : 'not-applicable';
  if (result.fix_back_result !== expectedFixBackResult) {
    fail('issue-to-pr typed output', 'completion requires the canonical mode result');
  }
};

export const assertBlockerReconciliation = (
  inputBlockers,
  addressedBlockers,
  remainingBlockers,
) => {
  assertCanonicalBlockers(inputBlockers, 'input blockers');
  assertCanonicalBlockers(addressedBlockers, 'addressed blockers');
  assertCanonicalBlockers(remainingBlockers, 'remaining blockers');
  const addressedMatchesInput =
    addressedBlockers.length === inputBlockers.length &&
    inputBlockers.every(
      (inputBlocker) =>
        addressedBlockers.filter(
          (addressed) =>
            addressed.reviewer === inputBlocker.reviewer &&
            addressed.signature === inputBlocker.signature &&
            addressed.evidence === inputBlocker.evidence &&
            addressed.fix_back_eligible === inputBlocker.fix_back_eligible &&
            addressed.status === 'remediated',
        ).length === 1,
    );
  if (!addressedMatchesInput) {
    fail(
      'addressed blockers',
      'must contain every input blocker exactly once as remediated',
    );
  }
  if (
    addressedBlockers.some((item) => item.status !== 'remediated') ||
    remainingBlockers.length !== 0
  ) {
    fail(
      'blocker reconciliation',
      'completion requires remediated addressed blockers and no remaining blockers',
    );
  }
};
