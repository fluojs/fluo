import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  requireIssueProgress,
  requireRootMainSync,
  runMutatedCompletedLedger,
  runMutatedReadyLedger,
  runValidator,
  runValidatorPath,
} from './verify-lane-ledger.test-support';

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
});
