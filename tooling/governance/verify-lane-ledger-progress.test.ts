import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import { requireIssueProgress, runMutatedCompletedLedger } from './verify-lane-ledger.test-support';

describe('verify-lane-ledger canonical v1 completion contract', () => {
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
