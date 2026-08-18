import { describe, expect, it } from 'vitest';

// allow: SIZE_OK - state relationship matrix cases stay co-located at the verifier seam.
import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  completedCleanupFixture,
  requireIssueProgress,
  requireRootMainSync,
  runMutatedCompletedLedger,
  runMutatedReadyLedger,
  runValidator,
  runValidatorPath,
} from './verify-lane-ledger.test-support';

function setActiveSecondIssue(ledger: LaneLedgerFixture, laneStatus: string, progressStatus = laneStatus): void {
  ledger.status = 'running';
  ledger.completed_issues = [101];
  Object.assign(ledger.lanes[0], { status: laneStatus, current_issue: 102 });
  Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
  const progress = requireIssueProgress(ledger, '102');
  progress.status = progressStatus;
  delete progress.cleanup;
  ledger.lanes[0].branch = progress.branch;
  ledger.lanes[0].worktree = progress.worktree;
  ledger.lanes[0].pr = progress.pr;
}

function setTerminalSecondIssue(ledger: LaneLedgerFixture, laneStatus: string, progressStatus = laneStatus): void {
  ledger.status = 'running';
  ledger.completed_issues = [101];
  Object.assign(ledger.lanes[0], { status: laneStatus, current_issue: null, branch: null, worktree: null });
  Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
  const progress = requireIssueProgress(ledger, '102');
  progress.status = progressStatus;
  delete progress.cleanup;
}

function addLaterIssue(ledger: LaneLedgerFixture, status?: string): void {
  ledger.confirmed_issues.push(103);
  ledger.lanes[0].queue.push(103);
  ledger.dependency_graph['103'] = [];
  if (status === undefined) {
    return;
  }
  const progress = { ...requireIssueProgress(ledger, '102') };
  Object.assign(progress, {
    status,
    branch: 'issue-103-runtime-gamma',
    worktree: '.worktrees/issue-103-runtime-gamma',
    pr: 'https://github.com/fluojs/fluo/pull/503',
    retry_count: 0,
  });
  if (status !== 'done' && status !== 'merged') {
    delete progress.cleanup;
  }
  if (status === 'done') {
    progress.cleanup = { ...completedCleanupFixture };
  }
  if (status === 'done' || status === 'merged') {
    ledger.completed_issues.push(103);
  }
  ledger.issue_progress = { ...ledger.issue_progress, '103': progress };
}

describe('verify-lane-ledger canonical v1 completion contract', () => {
  it('rejects an unknown root status', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'mystery';
      }),
    ).toContain('invalid ledger.status: mystery');
  });

  it('rejects root status done with an active lane', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.lanes[0].status = 'merged';
        ledger.lanes[0].current_issue = 102;
        const progress = requireIssueProgress(ledger, '102');
        progress.status = 'merged';
        delete progress.cleanup;
      }),
    ).toContain('done ledger status requires every lane status to be done');
  });

  it('rejects a terminal root status with an active lane', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'blocked-terminal';
        ledger.lanes[0].status = 'merged';
        ledger.lanes[0].current_issue = 102;
        const progress = requireIssueProgress(ledger, '102');
        progress.status = 'merged';
        delete progress.cleanup;
      }),
    ).toContain('terminal ledger status cannot contain active lanes');
  });

  it('accepts merged issue progress before active-lane cleanup', () => {
    const output = runMutatedCompletedLedger((ledger) => {
      ledger.status = 'running';
      ledger.lanes[0].status = 'merged';
      ledger.lanes[0].current_issue = 102;
      const rootMainSync = requireRootMainSync(ledger);
      rootMainSync.status = 'not-started';
      rootMainSync.sha = null;
      const progress = requireIssueProgress(ledger, '102');
      progress.status = 'merged';
      delete progress.cleanup;
      ledger.lanes[0].branch = progress.branch;
      ledger.lanes[0].worktree = progress.worktree;
      ledger.lanes[0].pr = progress.pr;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each(['queued', 'running', 'in_review'])('rejects %s lane whose cursor skips the first unfinished issue', (status) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.lanes[0].status = status;
        ledger.lanes[0].current_issue = 101;
        ledger.completed_issues = [101];
        requireIssueProgress(ledger, '102').status = status;
      }),
    ).toContain('active lane.current_issue must be the first queue issue absent from completed_issues');
  });

  it('rejects an active cursor when all queue issues are completed', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.lanes[0].status = 'running';
        ledger.lanes[0].current_issue = 102;
      }),
    ).toContain('active lane.current_issue cannot remain set when all queue issues are completed');
  });

  it('rejects root sync done while a lane is active', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.lanes[0].status = 'merged';
        ledger.lanes[0].current_issue = 102;
        const progress = requireIssueProgress(ledger, '102');
        progress.status = 'merged';
        delete progress.cleanup;
      }),
    ).toContain('root_main_sync done requires every lane to be terminal');
  });

  it('rejects root sync done without root sync authority', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.authority_scope.root_main_sync_ff_only = false;
      }),
    ).toContain('root_main_sync done requires root_main_sync_ff_only authority');
  });

  it('rejects a missing root_main_sync object', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        delete ledger.root_main_sync;
      }),
    ).toContain('root_main_sync is required');
  });

  it('rejects an unknown root_main_sync status', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireRootMainSync(ledger).status = 'mystery';
      }),
    ).toContain('invalid root_main_sync.status: mystery');
  });

  it('accepts terminal root sync with authority and a 40-character SHA', () => {
    expect(runValidator('valid-completed-multi-issue.json')).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each([
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
  ])('rejects $name', ({ expectedError, mutate }) => {
    expect(runMutatedCompletedLedger(mutate)).toContain(expectedError);
  });

  it.each([
    {
      name: 'a missing execution object',
      mutate: (ledger: LaneLedgerFixture) => {
        Reflect.deleteProperty(ledger, 'execution');
      },
    },
    {
      name: 'a non-object execution value',
      mutate: (ledger: LaneLedgerFixture) => {
        Object.assign(ledger, { execution: [] });
      },
    },
  ])('rejects $name', ({ mutate }) => {
    expect(runMutatedReadyLedger(mutate)).toContain('execution is required');
  });

  it.each(['status', 'last_command', 'last_updated'])('rejects execution missing canonical key %s', (field) => {
    expect(
      runMutatedReadyLedger((ledger) => {
        Reflect.deleteProperty(ledger.execution, field);
      }),
    ).toContain('execution must contain exactly the canonical keys');
  });

  it('rejects unknown execution keys', () => {
    expect(
      runMutatedReadyLedger((ledger) => {
        ledger.execution.worker = 'legacy';
      }),
    ).toContain('execution must contain exactly the canonical keys');
  });

  it('requires not-started execution for a ready ledger', () => {
    expect(
      runMutatedReadyLedger((ledger) => {
        ledger.execution.status = 'running';
        ledger.execution.last_command = 'execute-lane lane-test-valid-ready';
        ledger.execution.last_updated = '2026-08-01T00:01:00Z';
      }),
    ).toContain('execution.status must be not-started for ledger status ready');
  });

  it.each([
    'running',
    'done',
    'blocked-terminal',
    'needs-human-check-terminal',
    'blocked-budget-exhausted',
    'blocked-maintainer-decision',
    'blocked-child-contract-error',
    'blocked-ledger-conflict',
  ])('maps execution status to non-ready root status %s', (status) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = status;
        ledger.execution.status = 'not-started';
        ledger.execution.last_command = null;
        ledger.execution.last_updated = null;
      }),
    ).toContain(`execution.status must be ${status} for ledger status ${status}`);
  });

  it.each([
    ['last_command', 'execute-lane lane-test-valid-ready'],
    ['last_updated', '2026-08-01T00:01:00Z'],
  ])('requires null execution.%s for not-started execution', (field, value) => {
    expect(
      runMutatedReadyLedger((ledger) => {
        ledger.execution[field] = value;
      }),
    ).toContain('not-started execution must record null last_command and last_updated');
  });

  it.each([
    ['last_command', null],
    ['last_command', ''],
    ['last_updated', null],
    ['last_updated', ''],
  ])('requires non-empty execution.%s for non-ready execution', (field, value) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.execution[field] = value;
      }),
    ).toContain('non-ready execution must record non-empty last_command and last_updated');
  });

  it('accepts running execution metadata mapped to a running root', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.execution.status = 'running';
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each([
    {
      name: 'a non-queued lane',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.lanes[0].status = 'running';
      },
      error: 'ready ledger requires every lane to be queued',
    },
    {
      name: 'completed issues',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.completed_issues = [1];
      },
      error: 'ready ledger requires empty completed_issues and issue_progress',
    },
    {
      name: 'issue progress',
      mutate: (ledger: LaneLedgerFixture) => {
        Object.assign(ledger.issue_progress ?? {}, { '1': { status: 'queued' } });
      },
      error: 'ready ledger requires empty completed_issues and issue_progress',
    },
    {
      name: 'started root sync',
      mutate: (ledger: LaneLedgerFixture) => {
        requireRootMainSync(ledger).status = 'skipped-authority';
      },
      error: 'ready ledger requires root_main_sync not-started',
    },
  ])('rejects ready ledger with $name', ({ error, mutate }) => {
    expect(runMutatedReadyLedger(mutate)).toContain(error);
  });

  it.each([
    ['running', 'queued'],
    ['in_review', 'running'],
  ])('requires %s lane to have matching current progress', (laneStatus, progressStatus) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, laneStatus, progressStatus);
      }),
    ).toContain(`${laneStatus} lane requires matching current issue_progress`);
  });

  it('requires queued progress to match when present', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'queued', 'running');
      }),
    ).toContain('queued lane issue_progress must be absent or queued');
  });

  it('accepts a queued lane without current progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'queued');
        Reflect.deleteProperty(ledger.issue_progress ?? {}, '102');
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('requires zero retries for a queued lane without current progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'queued');
        Reflect.deleteProperty(ledger.issue_progress ?? {}, '102');
        ledger.lanes[0].retry_count = 1;
      }),
    ).toContain('queued lane without issue progress requires retry_count 0');
  });

  it('requires zero retries for a done lane', () => {
    expect(runMutatedCompletedLedger((ledger) => (ledger.lanes[0].retry_count = 1))).toContain(
      'done lane requires retry_count 0',
    );
  });

  it('requires terminal retry count to match the first unfinished progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setTerminalSecondIssue(ledger, 'blocked-terminal');
        requireIssueProgress(ledger, '102').retry_count = 2;
      }),
    ).toContain('terminal lane retry_count must match first unfinished issue progress');
  });

  it('rejects merged progress before the current queue entry', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'running');
        const previousProgress = requireIssueProgress(ledger, '101');
        previousProgress.status = 'merged';
        delete previousProgress.cleanup;
      }),
    ).toContain('queue entries before current must have done issue progress');
  });

  it.each(['running', 'in_review', 'merged', 'done', 'blocked-terminal'])(
    'rejects later queue progress in status %s',
    (status) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          setActiveSecondIssue(ledger, 'running');
          addLaterIssue(ledger, status);
        }),
      ).toContain('queue entries after current must be absent or queued');
    },
  );

  it.each([undefined, 'queued'])('accepts later queue progress status %s', (status) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'running');
        addLaterIssue(ledger, status);
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('requires merged lane to have matching merged progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'merged', 'running');
      }),
    ).toContain('merged lane requires matching merged issue_progress');
  });

  it('requires merged lane to have current issue progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'merged');
        Reflect.deleteProperty(ledger.issue_progress ?? {}, '102');
      }),
    ).toContain('merged lane requires matching current issue_progress');
  });

  it('requires a merged current issue in completed_issues', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'merged');
      }),
    ).toContain('merged lane current_issue must appear in completed_issues');
  });

  it.each([
    ['blocked-terminal', 'needs-human-check-terminal'],
    ['blocked-maintainer-decision', 'blocked-terminal'],
  ])('requires non-done terminal lane %s to match first unfinished progress', (laneStatus, progressStatus) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setTerminalSecondIssue(ledger, laneStatus, progressStatus);
      }),
    ).toContain('non-done terminal lane requires matching terminal progress for the first unfinished issue');
  });

  it('rejects non-done terminal lane without first unfinished progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setTerminalSecondIssue(ledger, 'blocked-terminal');
        Reflect.deleteProperty(ledger.issue_progress ?? {}, '102');
      }),
    ).toContain('non-done terminal lane requires matching terminal progress for the first unfinished issue');
  });

  it('allows a running root to contain an already-terminal lane', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setTerminalSecondIssue(ledger, 'blocked-terminal');
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects done root with root sync not-started', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        Object.assign(requireRootMainSync(ledger), { status: 'not-started', sha: null });
      }),
    ).toContain('done ledger requires root_main_sync to leave not-started');
  });

  it('requires null SHA while root sync is not-started', () => {
    expect(
      runMutatedReadyLedger((ledger) => {
        requireRootMainSync(ledger).sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      }),
    ).toContain('root_main_sync not-started must record null sha');
  });

  it.each([
    ['skipped-authority', true, 'root_main_sync skipped-authority requires root_main_sync_ff_only authority false'],
    ['blocked-dirty', false, 'root_main_sync blocked-dirty requires root_main_sync_ff_only authority true'],
  ])('enforces authority for root sync %s', (status, authority, error) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        Object.assign(requireRootMainSync(ledger), { status, sha: null });
        ledger.authority_scope.root_main_sync_ff_only = authority;
      }),
    ).toContain(error);
  });

  it.each(['skipped-authority', 'blocked-dirty'])('requires null SHA for root sync %s', (status) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        Object.assign(requireRootMainSync(ledger), {
          status,
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        });
        ledger.authority_scope.root_main_sync_ff_only = status === 'blocked-dirty';
      }),
    ).toContain(`root_main_sync ${status} must record null sha`);
  });

  it.each(['skipped-authority', 'blocked-dirty'])('requires terminal lanes for root sync %s', (status) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setActiveSecondIssue(ledger, 'merged');
        ledger.completed_issues = [101, 102];
        Object.assign(requireRootMainSync(ledger), { status, sha: null });
        ledger.authority_scope.root_main_sync_ff_only = status === 'blocked-dirty';
      }),
    ).toContain(`root_main_sync ${status} requires every lane to be terminal`);
  });

  it.each([
    ['skipped-authority', false],
    ['blocked-dirty', true],
  ])('accepts canonical root sync %s', (status, authority) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        Object.assign(requireRootMainSync(ledger), { status, sha: null });
        ledger.authority_scope.root_main_sync_ff_only = authority;
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects release-handoff as a root status', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'release-handoff';
      }),
    ).toContain('invalid ledger.status: release-handoff');
  });

  it('represents a release handoff with blocked-maintainer-decision', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        setTerminalSecondIssue(ledger, 'blocked-maintainer-decision');
        ledger.status = 'blocked-maintainer-decision';
        ledger.release_handoffs = [102];
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });
});
