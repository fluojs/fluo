import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const skillRoot = resolve(repositoryRoot, '.agents/skills/issue-implement');
const contractsPath = resolve(skillRoot, 'scripts/contracts.mjs');
const blocker = {
  reviewer: 'code',
  signature: 'missing-abort-path',
  evidence: 'packages/runtime/src/worker.ts:42',
  fix_back_eligible: true,
  status: 'unresolved',
};
const baseInput = {
  version: 1,
  lane_id: 'lane-4101-runtime',
  issue_number: 4101,
  issue_url: 'https://github.com/fluojs/fluo/issues/4101',
  issue_title: 'Handle worker aborts',
  base_branch: 'main',
  branch: 'issue-4101-handle-worker-aborts',
  worktree: '.worktrees/issue-4101-handle-worker-aborts',
  starting_head_sha: 'a'.repeat(40),
  preflight_sha256: 'c'.repeat(64),
};
const implementInput = {
  ...baseInput,
  mode: 'implement',
  existing_pr: null,
  blockers: [],
  fix_back_attempt: null,
};
const existingPr = {
  number: 5101,
  url: 'https://github.com/fluojs/fluo/pull/5101',
  head_branch: baseInput.branch,
};
const fixBackInput = {
  ...baseInput,
  mode: 'fix-back',
  existing_pr: existingPr,
  blockers: [blocker],
  fix_back_attempt: 1,
};
const identity = {
  branch: baseInput.branch,
  worktree: baseInput.worktree,
  checked_out_branch: baseInput.branch,
  head_sha: baseInput.starting_head_sha,
  pr: existingPr,
};
const completedResult = {
  version: 1,
  result: 'completed',
  mode: 'fix-back',
  lane_id: baseInput.lane_id,
  issue_number: baseInput.issue_number,
  branch: baseInput.branch,
  worktree: baseInput.worktree,
  pr: existingPr,
  preflight_sha256: baseInput.preflight_sha256,
  previous_head_sha: baseInput.starting_head_sha,
  head_sha: 'b'.repeat(40),
  commit_sha: 'b'.repeat(40),
  changed_files: ['packages/runtime/src/worker.ts'],
  verification: [{ command: 'pnpm --filter @fluojs/runtime test', status: 'passed' }],
  fix_back_result: 'remediated',
  addressed_blockers: [{ ...blocker, status: 'remediated' }],
  remaining_blockers: [],
};

type IssueImplementContracts = {
  readonly assertIssueImplementIdentity: (input: unknown, identityValue: unknown) => void;
  readonly assertIssueImplementInput: (value: unknown) => void;
  readonly assertIssueImplementResult: (input: unknown, result: unknown) => void;
  readonly assertBlockerReconciliation: (input: unknown, addressed: unknown, remaining: unknown) => void;
  readonly implementerAuthority: Readonly<Record<string, boolean>>;
  readonly leadAuthority: Readonly<Record<string, boolean>>;
};

const api: IssueImplementContracts = await import(contractsPath);

describe('$issue-implement input contract', () => {
  it('accepts the branch identity emitted by execute-lane init', () => {
    expect(() => api.assertIssueImplementInput({
      ...implementInput, branch: 'issue-4101', worktree: '.worktrees/issue-4101',
    })).not.toThrow();
  });

  it.each([null, existingPr])('accepts implement and fix-back with optional existing PR %j', (pr) => {
    expect(() => api.assertIssueImplementInput({ ...implementInput, existing_pr: pr })).not.toThrow();
    expect(() => api.assertIssueImplementInput({ ...fixBackInput, existing_pr: pr })).not.toThrow();
  });

  it('requires preflight binding without accepting an implementation-owned policy override', () => {
    const { preflight_sha256: _digest, ...unbound } = implementInput;
    expect(() => api.assertIssueImplementInput(unbound)).toThrow();
    for (const preflight_sha256 of [null, '', 'a'.repeat(40), 'C'.repeat(64), 'z'.repeat(64)]) {
      expect(() => api.assertIssueImplementInput({ ...implementInput, preflight_sha256 })).toThrow();
    }
    for (const override of [{ review_axes: ['code'] }, { issue_contract: {} }, { review_policy: 'skip' }]) {
      expect(() => api.assertIssueImplementInput({ ...implementInput, ...override })).toThrow();
    }
  });

  it.each(['new-pr', 'local-new', 'local-fix-back', 'ci-fix-back', 'unknown'])('rejects obsolete or unknown mode %s', (mode) => {
    expect(() => api.assertIssueImplementInput({ ...fixBackInput, mode })).toThrow();
  });

  it.each([4, 100, Number.MAX_SAFE_INTEGER])('leaves retry ceilings to the lane (attempt %i)', (fix_back_attempt) => {
    expect(() => api.assertIssueImplementInput({ ...fixBackInput, fix_back_attempt })).not.toThrow();
  });

  it.each([null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid fix-back attempt %j', (fix_back_attempt) => {
    expect(() => api.assertIssueImplementInput({ ...fixBackInput, fix_back_attempt })).toThrow();
  });

  it.each([
    { version: 2 }, { lane_id: '' }, { issue_number: 0 }, { issue_number: 999 },
    { issue_url: '' }, { issue_title: '' }, { base_branch: '' },
    { branch: 'main' }, { worktree: '.worktrees/../outside' },
    { starting_head_sha: 'not-a-sha' }, { unexpected: true },
    { existing_pr: { ...existingPr, head_branch: 'issue-999-other' } },
    { existing_pr: { ...existingPr, number: 0 } },
    { existing_pr: { ...existingPr, url: '' } },
    { existing_pr: { ...existingPr, unexpected: true } },
  ])('rejects malformed input %j', (patch) => {
    expect(() => api.assertIssueImplementInput({ ...implementInput, ...patch })).toThrow();
  });

  it('enforces mode-specific blockers and canonical unresolved, fixable blocker shape', () => {
    expect(() => api.assertIssueImplementInput({ ...implementInput, blockers: [blocker] })).toThrow();
    expect(() => api.assertIssueImplementInput({ ...implementInput, fix_back_attempt: 1 })).toThrow();
    for (const blockers of [
      [], [blocker, blocker], [{ ...blocker, retryable: true }],
      [{ ...blocker, status: 'remediated' }], [{ ...blocker, fix_back_eligible: false }],
      [{ ...blocker, reviewer: 'ci' }], [{ ...blocker, evidence: '' }],
    ]) {
      expect(() => api.assertIssueImplementInput({ ...fixBackInput, blockers })).toThrow();
    }
  });

  it('uses the same local remediation contract for review and CI evidence', () => {
    for (const origin of ['review:worker.ts:42', 'ci:run/123/job/456']) {
      const finding = { ...blocker, reviewer: 'verification', evidence: origin };
      const input = { ...fixBackInput, blockers: [finding] };
      expect(() => api.assertIssueImplementInput(input)).not.toThrow();
      expect(() => api.assertIssueImplementResult(input, {
        ...completedResult,
        addressed_blockers: [{ ...finding, status: 'remediated' }],
      })).not.toThrow();
    }
  });
});

describe('$issue-implement identity contract', () => {
  it.each([implementInput, fixBackInput])('binds checkout, starting head, and optional PR in $mode mode', (input) => {
    expect(() => api.assertIssueImplementIdentity(input, { ...identity, pr: input.existing_pr })).not.toThrow();
  });

  it.each([
    { branch: 'issue-999-other' }, { worktree: '.worktrees/issue-999-other' },
    { checked_out_branch: 'main' }, { head_sha: 'b'.repeat(40) }, { head_sha: null },
    { pr: null }, { pr: { ...existingPr, number: 9999 } },
    { pr: { ...existingPr, url: 'https://github.com/fluojs/fluo/pull/9999' } },
    { pr: { ...existingPr, head_branch: 'issue-999-other' } }, { unexpected: true },
  ])('rejects identity drift %j', (patch) => {
    expect(() => api.assertIssueImplementIdentity(fixBackInput, { ...identity, ...patch })).toThrow();
  });

  it('cannot introduce PR identity when none was supplied', () => {
    expect(() => api.assertIssueImplementIdentity(implementInput, identity)).toThrow();
  });
});

describe('$issue-implement authority and completion contract', () => {
  it('grants only the implementer local edit/test/commit and grants neither actor remote authority', () => {
    expect(api.implementerAuthority).toEqual({ edit: true, test: true, commit: true, push: false, create_pr: false });
    expect(api.leadAuthority).toEqual({ edit: false, test: false, commit: false, push: false, create_pr: false });
    expect(Object.isFrozen(api.implementerAuthority)).toBe(true);
    expect(Object.isFrozen(api.leadAuthority)).toBe(true);
  });

  it.each([null, existingPr])('returns a local committed head preserving optional PR %j', (pr) => {
    expect(() => api.assertIssueImplementResult({ ...fixBackInput, existing_pr: pr }, { ...completedResult, pr })).not.toThrow();
    expect(() => api.assertIssueImplementResult({ ...implementInput, existing_pr: pr }, {
      ...completedResult, mode: 'implement', pr, fix_back_result: 'not-applicable', addressed_blockers: [],
    })).not.toThrow();
  });

  it('requires output to retain the exact preflight digest', () => {
    const { preflight_sha256: _digest, ...unbound } = completedResult;
    expect(() => api.assertIssueImplementResult(fixBackInput, unbound)).toThrow();
    expect(() => api.assertIssueImplementResult(fixBackInput, {
      ...completedResult, preflight_sha256: 'd'.repeat(64),
    })).toThrow();
  });

  it.each([
    { version: 2 }, { result: 'failed' }, { mode: 'implement' },
    { lane_id: 'another-lane' }, { issue_number: 999 }, { branch: 'issue-999-other' },
    { worktree: '.worktrees/issue-999-other' }, { pr: null },
    { pr: { ...existingPr, number: 9999 } },
    { pr: { ...existingPr, url: 'https://github.com/fluojs/fluo/pull/9999' } },
    { pr: { ...existingPr, head_branch: 'issue-999-other' } },
    { previous_head_sha: 'd'.repeat(40) }, { head_sha: 'not-a-sha' },
    { head_sha: baseInput.starting_head_sha, commit_sha: baseInput.starting_head_sha },
    { commit_sha: 'd'.repeat(40) }, { changed_files: [] }, { changed_files: [''] },
    { verification: [] }, { verification: [{ command: 'test', status: 'failed' }] },
    { verification: [{ command: '', status: 'passed' }] },
    { verification: [{ command: 'test', status: 'passed', extra: true }] },
    { fix_back_result: 'still-blocked' }, { unexpected: true },
    { review_axes: [] }, { issue_contract: {} },
  ])('rejects invalid or identity-conflicting completion %j', (patch) => {
    expect(() => api.assertIssueImplementResult(fixBackInput, { ...completedResult, ...patch })).toThrow();
  });

  it('cannot claim creation of a PR from a local-only input', () => {
    expect(() => api.assertIssueImplementResult({ ...fixBackInput, existing_pr: null }, completedResult)).toThrow();
  });

  it('requires exact one-to-one canonical blocker reconciliation', () => {
    for (const addressed_blockers of [
      [], [blocker], [completedResult.addressed_blockers[0], completedResult.addressed_blockers[0]],
      [{ ...blocker, signature: 'different', status: 'remediated' }],
      [{ ...blocker, evidence: 'different', status: 'remediated' }],
      [{ ...blocker, reviewer: 'contract', status: 'remediated' }],
      [{ ...blocker, fix_back_eligible: false, status: 'remediated' }],
    ]) {
      expect(() => api.assertIssueImplementResult(fixBackInput, { ...completedResult, addressed_blockers })).toThrow();
    }
    expect(() => api.assertIssueImplementResult(fixBackInput, {
      ...completedResult, remaining_blockers: [blocker],
    })).toThrow();
    expect(() => api.assertBlockerReconciliation([blocker], completedResult.addressed_blockers, [])).not.toThrow();
    expect(() => api.assertBlockerReconciliation([blocker, blocker], [
      ...completedResult.addressed_blockers,
      { ...blocker, signature: 'unexpected', status: 'remediated' },
    ], [])).toThrow();
  });
});

describe('$issue-implement skill package', () => {
  it('ships the local stage assets and retires the old package without API aliases', () => {
    const assets = ['SKILL.md', 'references/workflow.md', 'references/implementer.md', 'scripts/contracts.mjs'];
    expect(assets.filter((asset) => existsSync(resolve(skillRoot, asset)))).toEqual(assets);
    for (const asset of assets) {
      expect(existsSync(resolve(repositoryRoot, '.agents/skills/issue-to-pr', asset))).toBe(false);
    }
    expect(Object.keys(api).sort()).toEqual([
      'assertBlockerReconciliation', 'assertIssueImplementIdentity', 'assertIssueImplementInput',
      'assertIssueImplementResult', 'implementerAuthority', 'leadAuthority',
    ]);
  });
});
