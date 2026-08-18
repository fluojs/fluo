import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  runInvalidValidator,
  runMutatedCompletedLedger,
  runMutatedReadyLedger,
  runValidator,
  runValidatorPath,
} from './verify-lane-ledger.test-support';

describe('verify-lane-ledger merge authority governance', () => {
  it('accepts create-lane ledgers with PR merge authority and squash merge method', () => {
    expect(runValidator('valid-ready.json')).toContain('Lane ledger check passed for 1 file(s).');
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

  it.each([
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
  ])('rejects $name', ({ expectedError, mutate }) => {
    expect(runMutatedCompletedLedger(mutate)).toContain(expectedError);
  });

  it.each([
    {
      name: 'a missing issue_progress object on ready',
      mutate: (ledger: LaneLedgerFixture) => {
        Reflect.deleteProperty(ledger, 'issue_progress');
      },
    },
    {
      name: 'a non-object issue_progress value on ready',
      mutate: (ledger: LaneLedgerFixture) => {
        Object.assign(ledger, { issue_progress: [] });
      },
    },
  ])('rejects $name', ({ mutate }) => {
    expect(runMutatedReadyLedger(mutate)).toContain('issue_progress must be an object');
  });

  it.each([
    {
      name: 'a missing authority_scope object',
      mutate: (ledger: LaneLedgerFixture) => {
        Reflect.deleteProperty(ledger, 'authority_scope');
      },
      expectedError: 'authority_scope is required',
    },
    {
      name: 'a non-object authority_scope value',
      mutate: (ledger: LaneLedgerFixture) => {
        Object.assign(ledger, { authority_scope: [] });
      },
      expectedError: 'authority_scope is required',
    },
    {
      name: 'a missing retry_policy object',
      mutate: (ledger: LaneLedgerFixture) => {
        Reflect.deleteProperty(ledger, 'retry_policy');
      },
      expectedError: 'retry_policy is required',
    },
    {
      name: 'a non-object retry_policy value',
      mutate: (ledger: LaneLedgerFixture) => {
        Object.assign(ledger, { retry_policy: [] });
      },
      expectedError: 'retry_policy is required',
    },
  ])('rejects $name', ({ expectedError, mutate }) => {
    expect(runMutatedCompletedLedger(mutate)).toContain(expectedError);
  });

  it.each([
    ['issue_creation', false],
    ['pr_creation', true],
    ['pr_merge', true],
    ['publish_via_github_actions', false],
  ])('requires authority_scope.%s to be %s', (field, expected) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.authority_scope[field] = !expected;
      }),
    ).toContain(`authority_scope.${field} must be ${String(expected)}`);
  });

  it.each(['cleanup_command_worktrees', 'root_main_sync_ff_only'])(
    'requires authority_scope.%s to be boolean',
    (field) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          ledger.authority_scope[field] = 'true';
        }),
      ).toContain(`authority_scope.${field} must be a boolean`);
    },
  );

  it.each([
    'issue_creation',
    'pr_creation',
    'pr_merge',
    'publish_via_github_actions',
    'cleanup_command_worktrees',
    'root_main_sync_ff_only',
  ])('rejects authority_scope missing canonical key %s', (field) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        Reflect.deleteProperty(ledger.authority_scope, field);
      }),
    ).toContain(`authority_scope.${field}`);
  });

  it('rejects unknown authority_scope keys including issue_selection', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.authority_scope.issue_selection = false;
      }),
    ).toContain('authority_scope must contain exactly the canonical keys');
  });

  it.each([
    'retry_count_is_terminal',
    'max_same_failure_repeats',
    'max_wall_clock_minutes',
    'stop_on_child_contract_error',
  ])('rejects retry_policy missing canonical key %s', (field) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        Reflect.deleteProperty(ledger.retry_policy, field);
      }),
    ).toContain('retry_policy must contain exactly the canonical keys');
  });

  it('rejects unknown retry_policy keys', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.retry_policy.unbounded = true;
      }),
    ).toContain('retry_policy must contain exactly the canonical keys');
  });

  it.each([
    ['max_same_failure_repeats', 0],
    ['max_same_failure_repeats', Number.MAX_SAFE_INTEGER + 1],
    ['max_wall_clock_minutes', 0],
    ['max_wall_clock_minutes', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects retry_policy.%s value %s', (field, value) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.retry_policy[field] = value;
      }),
    ).toContain(`retry_policy.${field} must be a positive safe integer`);
  });

  it.each(['retry_count_is_terminal', 'stop_on_child_contract_error'])(
    'rejects non-boolean retry_policy.%s',
    (field) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          ledger.retry_policy[field] = 'true';
        }),
      ).toContain(`retry_policy.${field} must be a boolean`);
    },
  );

  it('accepts non-terminal retry counts for supervisor-full-auto', () => {
    const output = runMutatedCompletedLedger((ledger) => {
      ledger.merge_policy = 'supervisor-full-auto';
      ledger.retry_policy.retry_count_is_terminal = false;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects terminal retry counts for supervisor-full-auto', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.merge_policy = 'supervisor-full-auto';
      }),
    ).toContain('retry_policy.retry_count_is_terminal must be false for supervisor-full-auto');
  });

  it.each(['developer-final', 'supervisor-auto', 'supervisor-with-human-escalation'])(
    'requires terminal retry counts for %s',
    (mergePolicy) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          ledger.merge_policy = mergePolicy;
          ledger.retry_policy.retry_count_is_terminal = false;
        }),
      ).toContain('retry_policy.retry_count_is_terminal must be true unless merge_policy is supervisor-full-auto');
    },
  );

  it.each([
    {
      name: 'a missing release_handoffs array',
      mutate: (ledger: LaneLedgerFixture) => {
        Reflect.deleteProperty(ledger, 'release_handoffs');
      },
      expectedError: 'release_handoffs must be an array',
    },
    {
      name: 'a non-array release_handoffs value',
      mutate: (ledger: LaneLedgerFixture) => {
        Object.assign(ledger, { release_handoffs: {} });
      },
      expectedError: 'release_handoffs must be an array',
    },
    {
      name: 'a non-positive release handoff',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.release_handoffs = [0];
      },
      expectedError: 'release_handoffs must contain unique positive issue numbers from confirmed_issues',
    },
    {
      name: 'a duplicate release handoff',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.release_handoffs = [101, 101];
      },
      expectedError: 'release_handoffs must contain unique positive issue numbers from confirmed_issues',
    },
    {
      name: 'an unconfirmed release handoff',
      mutate: (ledger: LaneLedgerFixture) => {
        ledger.release_handoffs = [103];
      },
      expectedError: 'release_handoffs must contain unique positive issue numbers from confirmed_issues',
    },
  ])('rejects $name', ({ expectedError, mutate }) => {
    expect(runMutatedCompletedLedger(mutate)).toContain(expectedError);
  });

  it('accepts a unique confirmed release handoff', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.release_handoffs = [102];
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });
});
