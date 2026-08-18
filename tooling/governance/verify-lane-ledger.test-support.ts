import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type IssueProgressFixture = {
  status: string;
  branch: string;
  worktree: string;
  pr: string | number;
  verification: string;
  retry_count: number;
  review_verdict: string;
  reviewers?: {
    contract: string;
    code: string;
    verification: string;
  };
  reviewed_head?: string;
  commits?: string[];
  merge_commit: string;
  cleanup?: string;
  issue_state: string;
  [key: string]: unknown;
};

export type LaneFixture = {
  queue: number[];
  current_issue: number | null;
  status: string;
  branch?: string | null;
  worktree?: string | null;
  pr?: string | number | null;
};

export type RootMainSyncFixture = {
  status: string;
  sha: string | null;
};

export type RetryPolicyFixture = {
  retry_count_is_terminal: boolean | string | null;
  max_same_failure_repeats: number | string | null;
  max_wall_clock_minutes: number | string | null;
  stop_on_child_contract_error: boolean | string | null;
  [key: string]: unknown;
};

export type ExecutionFixture = {
  status: string;
  last_command: string | null;
  last_updated: string | null;
  [key: string]: unknown;
};

export type LaneLedgerFixture = {
  version?: number;
  created_by?: string;
  base_branch?: string;
  status: string;
  merge_policy: string;
  authority_scope: {
    issue_creation: boolean | string | null;
    pr_creation: boolean | string | null;
    pr_merge: boolean | string | null;
    publish_via_github_actions: boolean | string | null;
    cleanup_command_worktrees: boolean | string | null;
    root_main_sync_ff_only: boolean | string | null;
    [key: string]: unknown;
  };
  lanes: [LaneFixture, ...LaneFixture[]];
  confirmed_issues: number[];
  completed_issues: number[];
  issue_progress?: Record<string, IssueProgressFixture>;
  retry_policy: RetryPolicyFixture;
  execution: ExecutionFixture;
  release_handoffs: number[];
  root_main_sync?: RootMainSyncFixture;
};

export const currentDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(currentDir, '../..');
export const expectedPrimaryRepoRoot = dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_MASTER: '1' },
  }).trim(),
);
export const validatorPath = resolve(repoRoot, 'tooling/governance/verify-lane-ledger.mjs');
export const fixtureDir = resolve(repoRoot, 'tooling/governance/fixtures/lane-ledger');
export const readyFixturePath = resolve(fixtureDir, 'valid-ready.json');
export const completedFixturePath = resolve(fixtureDir, 'valid-completed-multi-issue.json');
export function runValidatorPath(ledgerPath: string): string {
  return execFileSync(process.execPath, [validatorPath, ledgerPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function runValidator(fixtureName: string): string {
  return runValidatorPath(resolve(fixtureDir, fixtureName));
}

export function runInvalidValidatorPath(ledgerPath: string): string {
  try {
    runValidatorPath(ledgerPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error) {
      return String(error.stderr);
    }
    throw error;
  }

  throw new Error(`${ledgerPath} unexpectedly passed lane ledger validation`);
}

export function runInvalidValidator(fixtureName: string): string {
  return runInvalidValidatorPath(resolve(fixtureDir, fixtureName));
}

export function requireIssueProgress(ledger: LaneLedgerFixture, issue: string): IssueProgressFixture {
  const progress = ledger.issue_progress?.[issue];
  if (!progress) {
    throw new Error(`completed fixture is missing issue_progress for ${issue}`);
  }
  return progress;
}

export function requireRootMainSync(ledger: LaneLedgerFixture): RootMainSyncFixture {
  const rootMainSync = ledger.root_main_sync;
  if (!rootMainSync) {
    throw new Error('completed fixture is missing root_main_sync');
  }
  return rootMainSync;
}

function runMutatedLedger(
  fixturePath: string,
  mutate: (ledger: LaneLedgerFixture) => void,
  validate: (ledgerPath: string) => string = runInvalidValidatorPath,
): string {
  const temporaryDir = mkdtempSync(join(tmpdir(), 'fluo-lane-ledger-'));
  const temporaryLedgerPath = join(temporaryDir, 'ledger.json');

  try {
    const ledger: LaneLedgerFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const initialRootStatus = ledger.status;
    const initialExecutionStatus = ledger.execution.status;
    mutate(ledger);
    if (ledger.status !== initialRootStatus && ledger.execution?.status === initialExecutionStatus) {
      ledger.execution.status = ledger.status === 'ready' ? 'not-started' : ledger.status;
    }
    writeFileSync(temporaryLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    return validate(temporaryLedgerPath);
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

export function runMutatedReadyLedger(
  mutate: (ledger: LaneLedgerFixture) => void,
  validate: (ledgerPath: string) => string = runInvalidValidatorPath,
): string {
  return runMutatedLedger(readyFixturePath, mutate, validate);
}

export function runMutatedCompletedLedger(
  mutate: (ledger: LaneLedgerFixture) => void,
  validate: (ledgerPath: string) => string = runInvalidValidatorPath,
): string {
  return runMutatedLedger(completedFixturePath, mutate, validate);
}
