import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import { runInvalidValidator, runMutatedCompletedLedger, runValidator } from './verify-lane-ledger.test-support';

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
});
