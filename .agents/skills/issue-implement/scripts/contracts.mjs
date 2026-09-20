import { assertContract } from '../../../workflow-contracts/contracts.mjs';

export const implementerAuthority = Object.freeze({
  edit: true, test: true, commit: true, push: false, create_pr: false,
});

export const leadAuthority = Object.freeze({
  edit: false, test: false, commit: false, push: false, create_pr: false,
});

class IssueImplementContractError extends TypeError {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'IssueImplementContractError';
    this.path = path;
    this.reason = reason;
  }
}

const inputKeys = [
  'version', 'lane_id', 'issue_number', 'issue_url', 'issue_title',
  'base_branch', 'branch', 'worktree', 'starting_head_sha', 'mode',
  'existing_pr', 'blockers', 'fix_back_attempt', 'preflight_sha256',
];
const prKeys = ['number', 'url', 'head_branch'];
const identityKeys = ['branch', 'worktree', 'checked_out_branch', 'head_sha', 'pr'];
const resultKeys = [
  'version', 'result', 'mode', 'lane_id', 'issue_number', 'branch', 'worktree',
  'pr', 'previous_head_sha', 'head_sha', 'commit_sha', 'changed_files',
  'verification', 'fix_back_result', 'addressed_blockers', 'remaining_blockers',
  'preflight_sha256',
];
const verificationKeys = ['command', 'status'];
const shaPattern = /^[a-f0-9]{40}$/u;
const branchPattern = /^issue-[1-9][0-9]*(?:-[a-z0-9]+)*$/u;

const fail = (path, reason) => {
  throw new IssueImplementContractError(path, reason);
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
    fail(`${path}.branch`, 'must use the lane issue branch, with an optional existing title suffix');
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
  const identities = blockers.map((blocker) => JSON.stringify([blocker.reviewer, blocker.signature]));
  if (new Set(identities).size !== identities.length) {
    fail(path, 'must contain unique reviewer/signature blocker identities');
  }
};

const assertUnresolvedInputBlockers = (blockers, path) => {
  assertCanonicalBlockers(blockers, path);
  const resolvedIndex = blockers.findIndex((blocker) => blocker.status !== 'unresolved');
  if (resolvedIndex !== -1) {
    fail(`${path}[${String(resolvedIndex)}]`, 'input blocker must be unresolved');
  }
};

export const assertIssueImplementInput = (value) => {
  assertExactKeys(value, inputKeys, 'issue-implement input');
  if (value.version !== 1) {
    fail('issue-implement input.version', 'must equal 1');
  }
  assertString(value.lane_id, 'issue-implement input.lane_id');
  if (!Number.isSafeInteger(value.issue_number) || value.issue_number < 1) {
    fail('issue-implement input.issue_number', 'must be a positive integer');
  }
  assertString(value.issue_url, 'issue-implement input.issue_url');
  assertString(value.issue_title, 'issue-implement input.issue_title');
  assertString(value.base_branch, 'issue-implement input.base_branch');
  assertBranchWorktree(value.branch, value.worktree, 'issue-implement input');
  if (value.branch !== `issue-${String(value.issue_number)}` && !value.branch.startsWith(`issue-${String(value.issue_number)}-`)) {
    fail('issue-implement input.branch', 'must bind the input issue number');
  }
  assertSha(value.starting_head_sha, 'issue-implement input.starting_head_sha');
  if (typeof value.preflight_sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.preflight_sha256)) {
    fail('issue-implement input.preflight_sha256', 'must be a 64-character lowercase SHA-256 digest');
  }
  if (value.existing_pr !== null) {
    assertPr(value.existing_pr, 'issue-implement input.existing_pr');
    if (value.existing_pr.head_branch !== value.branch) {
      fail('issue-implement input.existing_pr', 'PR head branch must match input branch');
    }
  }
  assertUnresolvedInputBlockers(value.blockers, 'issue-implement input.blockers');

  if (value.mode === 'implement') {
    if (value.blockers.length !== 0 || value.fix_back_attempt !== null) {
      fail('issue-implement input', 'implement must not carry blockers or fix-back attempt');
    }
    return;
  }
  if (value.mode !== 'fix-back') {
    fail('issue-implement input.mode', 'must be implement or fix-back');
  }
  if (value.blockers.length === 0) {
    fail('issue-implement input.blockers', 'fix-back requires unresolved blockers');
  }
  if (value.blockers.some((blocker) => blocker.fix_back_eligible !== true)) {
    fail(
      'issue-implement input.blockers',
      'fix-back requires every blocker to set fix_back_eligible true; route others to human resolution',
    );
  }
  if (!Number.isSafeInteger(value.fix_back_attempt) || value.fix_back_attempt < 1) {
    fail('issue-implement input.fix_back_attempt', 'must be a positive safe integer; the lane owns retry limits');
  }
};

const assertRetainedPr = (input, pr, path) => {
  if (input.existing_pr === null) {
    if (pr !== null) {
      fail(path, 'must remain null when no existing PR was supplied');
    }
    return;
  }
  assertPr(pr, path);
  if (
    pr.number !== input.existing_pr.number ||
    pr.url !== input.existing_pr.url ||
    pr.head_branch !== input.branch
  ) {
    fail(path, 'must preserve the existing PR exactly');
  }
};

export const assertIssueImplementIdentity = (input, identity) => {
  assertIssueImplementInput(input);
  assertExactKeys(identity, identityKeys, 'issue-implement identity');
  assertBranchWorktree(identity.branch, identity.worktree, 'issue-implement identity');
  if (identity.branch !== input.branch || identity.worktree !== input.worktree || identity.checked_out_branch !== input.branch) {
    fail('issue-implement identity', 'branch, worktree, and checked-out branch must match input');
  }
  assertSha(identity.head_sha, 'issue-implement identity.head_sha');
  if (identity.head_sha !== input.starting_head_sha) {
    fail('issue-implement identity.head_sha', 'must match the starting head before implementation');
  }
  assertRetainedPr(input, identity.pr, 'issue-implement identity.pr');
};

export const assertIssueImplementResult = (input, result) => {
  assertIssueImplementInput(input);
  assertExactKeys(result, resultKeys, 'issue-implement typed output');
  if (result.version !== 1 || result.result !== 'completed' || result.mode !== input.mode) {
    fail('issue-implement typed output', 'version, result, and mode are invalid');
  }
  if (
    result.lane_id !== input.lane_id ||
    result.issue_number !== input.issue_number ||
    result.branch !== input.branch ||
    result.worktree !== input.worktree
  ) {
    fail('issue-implement typed output identity', 'lane, issue, branch, and worktree must match input');
  }
  if (result.preflight_sha256 !== input.preflight_sha256) {
    fail('issue-implement typed output.preflight_sha256', 'must retain the input preflight contract binding');
  }
  assertRetainedPr(input, result.pr, 'issue-implement typed output.pr');
  assertSha(result.previous_head_sha, 'issue-implement typed output.previous_head_sha');
  assertSha(result.head_sha, 'issue-implement typed output.head_sha');
  assertSha(result.commit_sha, 'issue-implement typed output.commit_sha');
  if (result.previous_head_sha !== input.starting_head_sha || result.head_sha === input.starting_head_sha) {
    fail('issue-implement typed output.head_sha', 'implementation must create a new head');
  }
  if (result.commit_sha !== result.head_sha) {
    fail('issue-implement typed output.commit_sha', 'must equal the new head');
  }
  if (!Array.isArray(result.changed_files) || result.changed_files.length === 0 || result.changed_files.some((path) => typeof path !== 'string' || path.length === 0)) {
    fail('issue-implement typed output.changed_files', 'must contain changed paths');
  }
  if (!Array.isArray(result.verification) || result.verification.length === 0) {
    fail('issue-implement typed output.verification', 'must contain verifier results');
  }
  for (const entry of result.verification) {
    assertExactKeys(entry, verificationKeys, 'issue-implement typed output.verification entry');
    assertString(entry.command, 'issue-implement typed output.verification.command');
    if (entry.status !== 'passed') {
      fail('issue-implement typed output.verification.status', 'must be passed');
    }
  }
  assertCanonicalBlockers(result.addressed_blockers, 'issue-implement typed output.addressed_blockers');
  assertCanonicalBlockers(result.remaining_blockers, 'issue-implement typed output.remaining_blockers');
  assertBlockerReconciliation(
    input.blockers,
    result.addressed_blockers,
    result.remaining_blockers,
  );
  const expectedFixBackResult = input.mode === 'fix-back' ? 'remediated' : 'not-applicable';
  if (result.fix_back_result !== expectedFixBackResult) {
    fail('issue-implement typed output', 'completion requires the canonical mode result');
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
