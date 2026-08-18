import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  requireIssueProgress,
  runMutatedCompletedLedger,
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
      ledger.root_main_sync.status = 'not-started';
      ledger.root_main_sync.sha = null;
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
});
