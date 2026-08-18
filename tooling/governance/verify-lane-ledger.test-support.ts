import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type IssueProgressFixture = {
  status: string;
  pr: string | number;
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
};

export type LaneLedgerFixture = {
  version?: number;
  status: string;
  authority_scope: {
    cleanup_command_worktrees: boolean;
    root_main_sync_ff_only: boolean;
    [key: string]: unknown;
  };
  lanes: [LaneFixture, ...LaneFixture[]];
  confirmed_issues: number[];
  completed_issues: number[];
  issue_progress?: Record<string, IssueProgressFixture>;
  root_main_sync: {
    status: string;
    sha: string | null;
  };
};

export const currentDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(currentDir, '../..');
export const validatorPath = resolve(repoRoot, 'tooling/governance/verify-lane-ledger.mjs');
export const fixtureDir = resolve(repoRoot, 'tooling/governance/fixtures/lane-ledger');
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

export function runMutatedCompletedLedger(
  mutate: (ledger: LaneLedgerFixture) => void,
  validate: (ledgerPath: string) => string = runInvalidValidatorPath,
): string {
  const temporaryDir = mkdtempSync(join(tmpdir(), 'fluo-lane-ledger-'));
  const temporaryLedgerPath = join(temporaryDir, 'ledger.json');

  try {
    const ledger: LaneLedgerFixture = JSON.parse(readFileSync(completedFixturePath, 'utf8'));
    mutate(ledger);
    writeFileSync(temporaryLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    return validate(temporaryLedgerPath);
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}
