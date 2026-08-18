import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../..');
const validatorPath = resolve(repoRoot, 'tooling/governance/verify-lane-ledger.mjs');
const fixtureDir = resolve(repoRoot, 'tooling/governance/fixtures/lane-ledger');
const completedFixturePath = resolve(fixtureDir, 'valid-completed-multi-issue.json');

type IssueProgressFixture = {
  status: string;
  pr: string;
  review_verdict: string;
  reviewed_head: string;
  merge_commit: string;
  cleanup?: string;
  issue_state: string;
  [key: string]: unknown;
};

type LaneLedgerFixture = {
  version?: number;
  status: string;
  lanes: [
    {
      queue: number[];
      current_issue: number | null;
      status: string;
    },
  ];
  confirmed_issues: number[];
  completed_issues: number[];
  issue_progress?: Record<string, IssueProgressFixture>;
};

function runValidatorPath(ledgerPath: string): string {
  return execFileSync(process.execPath, [validatorPath, ledgerPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runValidator(fixtureName: string): string {
  return runValidatorPath(resolve(fixtureDir, fixtureName));
}

function runInvalidValidatorPath(ledgerPath: string): string {
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

function runInvalidValidator(fixtureName: string): string {
  return runInvalidValidatorPath(resolve(fixtureDir, fixtureName));
}

function requireIssueProgress(ledger: LaneLedgerFixture, issue: string): IssueProgressFixture {
  const progress = ledger.issue_progress?.[issue];
  if (!progress) {
    throw new Error(`completed fixture is missing issue_progress for ${issue}`);
  }
  return progress;
}

function runMutatedCompletedLedger(
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

describe('verify-lane-ledger merge authority governance', () => {
  it('accepts create-lane ledgers with PR merge authority and squash merge method', () => {
    expect(runValidator('valid-ready.json')).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects ledgers that do not grant PR merge authority', () => {
    expect(runInvalidValidator('invalid-pr-merge-false.json')).toContain('authority_scope.pr_merge must be true');
  });

  it('rejects ledgers that do not lock PR merges to squash', () => {
    expect(runInvalidValidator('invalid-merge-method.json')).toContain('pr_merge_method must be squash');
  });

  it('rejects ledgers that omit the PR merge method decision', () => {
    expect(runInvalidValidator('invalid-missing-merge-method.json')).toContain('pr_merge_method must be squash');
  });
});

describe('verify-lane-ledger canonical v1 completion contract', () => {
  it('accepts a completed multi-issue ledger with durable per-issue evidence', () => {
    expect(runValidator('valid-completed-multi-issue.json')).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('accepts merged issue progress before active-lane cleanup', () => {
    const output = runMutatedCompletedLedger((ledger) => {
      ledger.status = 'running';
      ledger.lanes[0].status = 'merged';
      ledger.lanes[0].current_issue = 102;
      const progress = requireIssueProgress(ledger, '102');
      progress.status = 'merged';
      delete progress.cleanup;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each([
    {
      name: 'active completion history without issue progress',
      expectedError: 'completed_issues and issue_progress must contain the same issue numbers',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.status = 'running';
        ledger.lanes[0].status = 'running';
        ledger.lanes[0].current_issue = 102;
        delete ledger.issue_progress;
      },
    },
    {
      name: 'progress for an issue outside confirmed lane queues',
      expectedError: 'issue_progress issue must belong to confirmed_issues and a lane queue',
      mutate: (ledger: LaneLedgerFixture) => {
        const progress = requireIssueProgress(ledger, '101');
        ledger.completed_issues.push(103);
        ledger.issue_progress = {
          ...ledger.issue_progress,
          '103': { ...progress, pr: 'https://github.com/example/fluo/pull/503' },
        };
      },
    },
    {
      name: 'a missing version',
      expectedError: 'version is required',
      mutate: (ledger: LaneLedgerFixture) => {
        delete ledger.version;
      },
    },
    {
      name: 'an unsupported version',
      expectedError: 'unsupported ledger version: 2',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.version = 2;
      },
    },
    {
      name: 'an active lane with a null cursor',
      expectedError: 'active lane.current_issue must be an integer issue number',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.status = 'running';
        ledger.lanes[0].status = 'running';
      },
    },
    {
      name: 'a terminal lane with an integer cursor',
      expectedError: 'terminal lane.current_issue must be null; migrate completion evidence to issue_progress',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.lanes[0].current_issue = 102;
      },
    },
    {
      name: 'a done ledger without issue_progress',
      expectedError: 'done ledger must record issue_progress',
      mutate: (ledger: LaneLedgerFixture) => {
        delete ledger.issue_progress;
      },
    },
    {
      name: 'a completed issue without progress',
      expectedError: 'completed_issues and issue_progress must contain the same issue numbers',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.completed_issues.push(103);
      },
    },
    {
      name: 'issue progress without a completed issue',
      expectedError: 'completed_issues and issue_progress must contain the same issue numbers',
      mutate: (ledger: LaneLedgerFixture) => {
        const progress = requireIssueProgress(ledger, '101');
        ledger.confirmed_issues.push(103);
        ledger.lanes[0].queue.push(103);
        ledger.issue_progress = {
          ...ledger.issue_progress,
          '103': { ...progress, pr: 'https://github.com/example/fluo/pull/503' },
        };
      },
    },
    {
      name: 'an invalid merge SHA',
      expectedError: 'merge_commit must be a 40-character SHA',
      mutate: (ledger: LaneLedgerFixture) => {
        requireIssueProgress(ledger, '101').merge_commit = 'abc123';
      },
    },
    {
      name: 'an unresolved merge review',
      expectedError: 'review_verdict must be merge',
      mutate: (ledger: LaneLedgerFixture) => {
        requireIssueProgress(ledger, '101').review_verdict = 'needs-human-check';
      },
    },
    {
      name: 'missing cleanup evidence',
      expectedError: 'cleanup must be done',
      mutate: (ledger: LaneLedgerFixture) => {
        delete requireIssueProgress(ledger, '101').cleanup;
      },
    },
    {
      name: 'missing closed issue evidence',
      expectedError: 'issue_state must be CLOSED',
      mutate: (ledger: LaneLedgerFixture) => {
        requireIssueProgress(ledger, '101').issue_state = 'OPEN';
      },
    },
    {
      name: 'duplicate PR references',
      expectedError: 'duplicate PR mapping',
      mutate: (ledger: LaneLedgerFixture) => {
        requireIssueProgress(ledger, '102').pr = requireIssueProgress(ledger, '101').pr;
      },
    },
  ])('rejects $name', ({ expectedError, mutate }) => {
    expect(runMutatedCompletedLedger(mutate)).toContain(expectedError);
  });
});
