import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const skillRoot = resolve(repositoryRoot, '.agents/skills/issue-to-pr');
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
};
const newPrInput = {
  ...baseInput,
  mode: 'new-pr',
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
  previous_head_sha: baseInput.starting_head_sha,
  head_sha: 'b'.repeat(40),
  commit_sha: 'b'.repeat(40),
  changed_files: ['packages/runtime/src/worker.ts'],
  verification: [
    {
      command: 'pnpm --filter @fluo/runtime test',
      status: 'passed',
    },
  ],
  fix_back_result: 'remediated',
  addressed_blockers: [{ ...blocker, status: 'remediated' }],
  remaining_blockers: [],
};

type IssueToPrContracts = {
  readonly assertIssueToPrIdentity: (input: unknown, identityValue: unknown) => void;
  readonly assertIssueToPrInput: (value: unknown) => void;
  readonly assertIssueToPrResult: (input: unknown, result: unknown) => void;
  readonly implementerAuthority: Readonly<Record<string, boolean>>;
  readonly leadAuthority: Readonly<Record<string, boolean>>;
};

let contracts: IssueToPrContracts | undefined;
if (existsSync(contractsPath)) {
  contracts = await import(contractsPath);
}

const requireContracts = (): IssueToPrContracts => {
  expect(contracts, 'issue-to-pr contracts.mjs must expose the native contract API').toBeDefined();
  if (contracts === undefined) {
    throw new TypeError('issue-to-pr contracts.mjs is unavailable');
  }
  return contracts;
};

describe('$issue-to-pr native input and identity contract', () => {
  it('accepts new-pr and fix-back inputs and imports canonical blockers', () => {
    // Given
    const api = requireContracts();
    const source = readFileSync(contractsPath, 'utf8');

    // When / Then
    expect(() => api.assertIssueToPrInput(newPrInput)).not.toThrow();
    expect(() => api.assertIssueToPrInput(fixBackInput)).not.toThrow();
    expect(source).toMatch(
      /from ['"]\.\.\/\.\.\/\.\.\/workflow-contracts\/contracts\.mjs['"]/u,
    );
    expect(() =>
      api.assertIssueToPrInput({
        ...fixBackInput,
        blockers: [{ ...blocker, retryable: true }],
      }),
    ).toThrow(/blocker|unknown key/u);
  });

  it('rejects malformed branch, worktree, checkout, and PR identity', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertIssueToPrIdentity(fixBackInput, identity)).not.toThrow();
    expect(() =>
      api.assertIssueToPrIdentity(fixBackInput, {
        ...identity,
        checked_out_branch: 'issue-999-other',
      }),
    ).toThrow(/identity|branch/u);
    expect(() =>
      api.assertIssueToPrIdentity(fixBackInput, {
        ...identity,
        worktree: '.worktrees/issue-999-other',
      }),
    ).toThrow(/identity|worktree/u);
    expect(() =>
      api.assertIssueToPrIdentity(fixBackInput, {
        ...identity,
        pr: { ...existingPr, number: 9999 },
      }),
    ).toThrow(/identity|PR/u);
  });

  it('rejects fix-back input containing a blocker that requires human resolution', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() =>
      api.assertIssueToPrInput({
        ...fixBackInput,
        blockers: [{ ...blocker, fix_back_eligible: false }],
      }),
    ).toThrow(/fix_back_eligible|human/u);
  });
});

describe('$issue-to-pr authority and typed output contract', () => {
  it('grants implementers edit, test, and commit but reserves push and PR creation for the lead', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(api.implementerAuthority).toEqual({
      edit: true,
      test: true,
      commit: true,
      push: false,
      create_pr: false,
    });
    expect(api.leadAuthority).toEqual({
      edit: false,
      test: false,
      commit: false,
      push: true,
      create_pr: true,
    });
  });

  it('accepts a typed same-identity result only when implementation creates a new head', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() => api.assertIssueToPrResult(fixBackInput, completedResult)).not.toThrow();
    expect(() =>
      api.assertIssueToPrResult(fixBackInput, {
        ...completedResult,
        head_sha: baseInput.starting_head_sha,
        commit_sha: baseInput.starting_head_sha,
      }),
    ).toThrow(/new head|head_sha/u);
    expect(() =>
      api.assertIssueToPrResult(fixBackInput, {
        ...completedResult,
        branch: 'issue-999-other',
      }),
    ).toThrow(/identity|branch/u);
    expect(() =>
      api.assertIssueToPrResult(fixBackInput, {
        ...completedResult,
        unexpected: true,
      }),
    ).toThrow(/unknown key|typed output/u);
  });

  it('requires every input blocker to appear exactly once as remediated output', () => {
    // Given
    const api = requireContracts();

    // When / Then
    expect(() =>
      api.assertIssueToPrResult(fixBackInput, {
        ...completedResult,
        addressed_blockers: [],
      }),
    ).toThrow(/addressed_blockers|input blocker/u);
    expect(() =>
      api.assertIssueToPrResult(fixBackInput, {
        ...completedResult,
        addressed_blockers: [
          {
            ...blocker,
            signature: 'different-blocker',
            status: 'remediated',
          },
        ],
      }),
    ).toThrow(/addressed_blockers|input blocker/u);
  });
});

describe('$issue-to-pr native skill package', () => {
  it('ships the skill, workflow, implementer, and machine contract assets', () => {
    // Given / When
    const assets = [
      'SKILL.md',
      'references/workflow.md',
      'references/implementer.md',
      'scripts/contracts.mjs',
    ];

    // Then
    expect(assets.filter((asset) => existsSync(resolve(skillRoot, asset)))).toEqual(
      assets,
    );
  });
});
