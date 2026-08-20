import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  completedCleanupFixture,
  requireIssueProgress,
  requireRootMainSync,
  runMutatedCompletedLedger,
  runValidatorPath,
  setNonCompletionProgress,
  setSkippedCleanup,
} from './verify-lane-ledger.test-support';

const completionEvidenceCases = [
  ['review_verdict', 'merge'],
  ['checks', 'PASS'],
  ['reviewers', { contract: 'PASS', code: 'PASS', verification: 'PASS' }],
  ['reviewed_head', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ['commits', ['aaaaaaa']],
  ['merge_commit', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ['issue_state', 'CLOSED'],
] as const;

function setIssue102State(ledger: LaneLedgerFixture, status: string): ReturnType<typeof requireIssueProgress> {
  ledger.status = 'running';
  ledger.completed_issues = [101];
  Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
  const progress = requireIssueProgress(ledger, '102');
  setNonCompletionProgress(progress, status);
  if (['queued', 'running', 'in_review'].includes(status)) {
    Object.assign(ledger.lanes[0], {
      status,
      current_issue: 102,
      branch: progress.branch,
      worktree: progress.worktree,
      pr: progress.pr,
      retry_count: progress.retry_count,
    });
  } else {
    Object.assign(ledger.lanes[0], {
      status,
      current_issue: null,
      branch: null,
      worktree: null,
      pr: null,
      retry_count: progress.retry_count,
    });
  }
  return progress;
}

function setTerminalPostMergeCleanupFailure(ledger: LaneLedgerFixture): ReturnType<typeof requireIssueProgress> {
  ledger.status = 'blocked-terminal';
  ledger.completed_issues = [101, 102];
  Object.assign(ledger.lanes[0], {
    status: 'blocked-terminal',
    current_issue: null,
    branch: null,
    worktree: null,
    pr: null,
  });
  Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
  const progress = requireIssueProgress(ledger, '102');
  progress.status = 'blocked-terminal';
  Reflect.deleteProperty(progress, 'cleanup');
  progress.blockers = [
    {
      reviewer: 'verification',
      signature: 'cleanup:worktree-removal-failed',
      evidence: 'merged pull request cleanup failed',
      fix_back_eligible: false,
      status: 'unresolved',
    },
  ];
  return progress;
}

describe('verify-lane-ledger canonical v1 completion contract', () => {
  it.each(['queued', 'running', 'in_review', 'blocked-terminal', 'blocked-maintainer-decision'].flatMap((status) =>
    completionEvidenceCases.map(([field, value]) => [status, field, value] as const),
  ))('rejects completion evidence %s.%s outside merged and done progress', (status, field, value) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setIssue102State(ledger, status);
        Object.assign(progress, { [field]: value });
      }),
    ).toContain('migrate legacy completion evidence to canonical issue_progress');
  });

  it.each(['legacy', 'review', 'merge', 'issue'])('rejects unknown issue progress key %s', (field) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101')[field] = {};
      }),
    ).toContain('issue progress contains an unknown key');
  });

  it.each(['reviewer', 'signature', 'evidence', 'fix_back_eligible', 'status'])('rejects blocker missing %s', (field) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const blocker = {
          reviewer: 'code',
          signature: 'src/example.ts:incorrect-state',
          evidence: 'focused test failure',
          fix_back_eligible: true,
          status: 'remediated',
        };
        Reflect.deleteProperty(blocker, field);
        requireIssueProgress(ledger, '101').blockers = [blocker];
      }),
    ).toContain('blocker must contain exactly reviewer/signature/evidence/fix_back_eligible/status');
  });

  it('rejects an unknown blocker reviewer', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101').blockers = [
          {
            reviewer: 'security',
            signature: 'policy:decision',
            evidence: 'review output',
            fix_back_eligible: false,
            status: 'remediated',
          },
        ];
      }),
    ).toContain('blocker reviewer must be contract, code, or verification');
  });

  it('accepts exact remediated blocker evidence', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101').blockers = [
          {
            reviewer: 'verification',
            signature: 'test:queue-prefix',
            evidence: 'focused suite passes',
            fix_back_eligible: true,
            status: 'remediated',
          },
        ];
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects an unknown issue progress status', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '102').status = 'mystery';
      }),
    ).toContain('invalid issue_progress.status: mystery');
  });

  it('rejects cleanup done on running progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = requireIssueProgress(ledger, '102');
        setNonCompletionProgress(progress, 'running');
        progress.cleanup = { ...completedCleanupFixture };
      }),
    ).toContain('cleanup done is only valid for done issue_progress');
  });

  it('rejects cleanup skipped-authority on non-done progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = requireIssueProgress(ledger, '102');
        setNonCompletionProgress(progress, 'blocked-terminal');
        progress.cleanup = 'skipped-authority';
      }),
    ).toContain('cleanup skipped-authority is only valid for done issue_progress');
  });

  it('rejects arbitrary cleanup evidence on active progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.completed_issues = [101];
        Object.assign(ledger.lanes[0], { status: 'running', current_issue: 102 });
        Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
        const progress = requireIssueProgress(ledger, '102');
        setNonCompletionProgress(progress, 'running');
        progress.cleanup = { status: 'pending' };
        ledger.lanes[0].branch = progress.branch;
        ledger.lanes[0].worktree = progress.worktree;
        ledger.lanes[0].pr = progress.pr;
      }),
    ).toContain('cleanup evidence is only valid for done issue_progress');
  });

  it('rejects arbitrary cleanup evidence on terminal non-done progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.completed_issues = [101];
        Object.assign(ledger.lanes[0], {
          status: 'blocked-terminal',
          current_issue: null,
          branch: null,
          worktree: null,
          pr: null,
        });
        Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
        const progress = requireIssueProgress(ledger, '102');
        setNonCompletionProgress(progress, 'blocked-terminal');
        progress.cleanup = { status: 'pending' };
      }),
    ).toContain('cleanup evidence is only valid for done issue_progress');
  });

  it.each([
    {
      name: 'active completion history without issue progress',
      expectedError: 'issue_progress must be an object',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.status = 'running';
        ledger.lanes[0].status = 'merged';
        ledger.lanes[0].current_issue = 102;
        const rootMainSync = requireRootMainSync(ledger);
        rootMainSync.status = 'not-started';
        rootMainSync.sha = null;
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
          '103': { ...progress, pr: 'https://github.com/fluojs/fluo/pull/503' },
        };
      },
    },
    {
      name: 'a done ledger without issue_progress',
      expectedError: 'migrate legacy completion evidence to canonical issue_progress',
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
          '103': { ...progress, pr: 'https://github.com/fluojs/fluo/pull/503' },
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
      name: 'missing verification evidence',
      expectedError: 'migrate legacy completion evidence to canonical issue_progress',
      mutate: (ledger: LaneLedgerFixture) => {
        Reflect.deleteProperty(requireIssueProgress(ledger, '101'), 'verification');
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
  ])('rejects $name', ({ expectedError, mutate }) => {
    expect(runMutatedCompletedLedger(mutate)).toContain(expectedError);
  });

  it.each([
    {
      name: 'missing checks',
      expectedError: 'checks must be PASS',
      mutate: (progress: ReturnType<typeof requireIssueProgress>) => Reflect.deleteProperty(progress, 'checks'),
    },
    {
      name: 'failed checks',
      expectedError: 'checks must be PASS',
      mutate: (progress: ReturnType<typeof requireIssueProgress>) => {
        progress.checks = 'FAIL';
      },
    },
    {
      name: 'missing reviewers',
      expectedError: 'reviewers must contain exactly contract/code/verification',
      mutate: (progress: ReturnType<typeof requireIssueProgress>) => Reflect.deleteProperty(progress, 'reviewers'),
    },
    {
      name: 'failed contract reviewer',
      expectedError: 'reviewers must all be PASS',
      mutate: (progress: ReturnType<typeof requireIssueProgress>) => {
        progress.reviewers.contract = 'FAIL';
      },
    },
    {
      name: 'an extra reviewer',
      expectedError: 'reviewers must contain exactly contract/code/verification',
      mutate: (progress: ReturnType<typeof requireIssueProgress>) => {
        progress.reviewers.security = 'PASS';
      },
    },
  ])('rejects completion evidence with $name', ({ expectedError, mutate }) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        mutate(requireIssueProgress(ledger, '101'));
      }),
    ).toContain(expectedError);
  });

  it('rejects legacy cleanup string evidence with migration guidance', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101').cleanup = 'done';
      }),
    ).toContain('migrate legacy completion evidence to canonical issue_progress');
  });

  it.each(['worktree_removed', 'local_branch_deleted', 'remote_branch_deleted'])(
    'rejects false cleanup evidence %s',
    (field) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          requireIssueProgress(ledger, '101').cleanup = {
            ...completedCleanupFixture,
            [field]: false,
          };
        }),
      ).toContain(`cleanup done requires ${field}=true`);
    },
  );

  it.each(['status', 'worktree_removed', 'local_branch_deleted', 'remote_branch_deleted'])(
    'rejects cleanup missing canonical field %s',
    (field) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          const cleanup = { ...completedCleanupFixture };
          Reflect.deleteProperty(cleanup, field);
          requireIssueProgress(ledger, '101').cleanup = cleanup;
        }),
      ).toContain(
        field === 'status'
          ? 'cleanup must be done when cleanup authority is true'
          : 'cleanup done must contain exactly status/worktree_removed/local_branch_deleted/remote_branch_deleted',
      );
    },
  );

  it('rejects extra completed cleanup evidence', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101').cleanup = {
          ...completedCleanupFixture,
          unexpected: true,
        };
      }),
    ).toContain('cleanup done must contain exactly status/worktree_removed/local_branch_deleted/remote_branch_deleted');
  });

  it('accepts exact skipped-authority cleanup without cleanup authority', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setSkippedCleanup(ledger);
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects skipped cleanup with cleanup authority', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101').cleanup = { status: 'skipped-authority' };
      }),
    ).toContain('cleanup must be done when cleanup authority is true');
  });

  it('rejects completed cleanup without cleanup authority', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.authority_scope.cleanup_command_worktrees = false;
      }),
    ).toContain('cleanup must be skipped-authority when cleanup authority is false');
  });

  it('rejects extra skipped-authority cleanup evidence', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setSkippedCleanup(ledger);
        requireIssueProgress(ledger, '101').cleanup = { status: 'skipped-authority', unexpected: true };
      }),
    ).toContain('cleanup skipped-authority must contain exactly status');
  });

  it('accepts merged progress before cleanup', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        Object.assign(ledger.lanes[0], { status: 'merged', current_issue: 102 });
        Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
        const progress = requireIssueProgress(ledger, '102');
        progress.status = 'merged';
        Reflect.deleteProperty(progress, 'cleanup');
        ledger.lanes[0].branch = progress.branch;
        ledger.lanes[0].worktree = progress.worktree;
        ledger.lanes[0].pr = progress.pr;
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('accepts terminal post-merge cleanup failure only with cleanup authority', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setTerminalPostMergeCleanupFailure(ledger);
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');

    expect(
      runMutatedCompletedLedger((ledger) => {
        setSkippedCleanup(ledger);
        setTerminalPostMergeCleanupFailure(ledger);
      }),
    ).toContain('post-merge cleanup failure requires cleanup_command_worktrees authority');
  });

  it('rejects terminal post-merge cleanup failure with partial completion evidence', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setTerminalPostMergeCleanupFailure(ledger);
        Reflect.deleteProperty(progress, 'merge_commit');
      }),
    ).toContain('post-merge blocked-terminal progress must preserve complete merged evidence');
  });

  it('rejects cleanup evidence on terminal post-merge cleanup failure', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setTerminalPostMergeCleanupFailure(ledger);
        progress.cleanup = { ...completedCleanupFixture };
      }),
    ).toContain('post-merge blocked-terminal progress must not contain cleanup evidence');
  });

  it('rejects terminal post-merge cleanup failure without blockers', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setTerminalPostMergeCleanupFailure(ledger);
        progress.blockers = [];
      }),
    ).toContain('post-merge blocked-terminal progress requires at least one unresolved blocker');
  });

  it('rejects terminal post-merge cleanup failure without an unresolved canonical blocker', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setTerminalPostMergeCleanupFailure(ledger);
        progress.blockers = [
          {
            reviewer: 'verification',
            signature: 'cleanup:worktree-removal-failed',
            evidence: 'cleanup failure was remediated',
            fix_back_eligible: false,
            status: 'remediated',
          },
        ];
      }),
    ).toContain('post-merge blocked-terminal progress requires at least one unresolved blocker');

    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setTerminalPostMergeCleanupFailure(ledger);
        progress.blockers = [
          {
            reviewer: 'verification',
            signature: 'cleanup:worktree-removal-failed',
            evidence: 'cleanup remains pending',
            fix_back_eligible: false,
            status: 'pending',
          },
        ];
      }),
    ).toContain('blocker status must be unresolved or remediated');
  });

  it('rejects fix-back-eligible unresolved post-merge cleanup blockers', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = setTerminalPostMergeCleanupFailure(ledger);
        progress.blockers = [
          {
            reviewer: 'verification',
            signature: 'cleanup:worktree-removal-failed',
            evidence: 'merged pull request cleanup failed',
            fix_back_eligible: true,
            status: 'unresolved',
          },
        ];
      }),
    ).toContain('unresolved post-merge cleanup blockers must set fix_back_eligible false');
  });
});
