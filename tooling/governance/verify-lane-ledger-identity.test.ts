import { describe, expect, it } from 'vitest';

// allow: SIZE_OK - identity contract cases stay co-located at the verifier seam.
import type { IssueProgressFixture, LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  expectedPrimaryRepoRoot,
  repoRoot,
  requireIssueProgress,
  requireRootMainSync,
  runInvalidValidator,
  runMutatedCompletedLedger,
  runValidatorPath,
} from './verify-lane-ledger.test-support';

function activateIssue102(ledger: LaneLedgerFixture, status = 'running'): IssueProgressFixture {
  ledger.status = 'running';
  ledger.completed_issues = [101];
  Object.assign(ledger.lanes[0], { status, current_issue: 102 });
  const rootMainSync = requireRootMainSync(ledger);
  Object.assign(rootMainSync, { status: 'not-started', sha: null });
  const progress = requireIssueProgress(ledger, '102');
  progress.status = status;
  delete progress.cleanup;
  ledger.lanes[0].branch = progress.branch;
  ledger.lanes[0].worktree = progress.worktree;
  return progress;
}

describe('verify-lane-ledger canonical v1 completion contract', () => {
  it('rejects ledgers that do not grant PR merge authority', () => {
    expect(runInvalidValidator('invalid-pr-merge-false.json')).toContain('authority_scope.pr_merge must be true');
  });

  it('rejects a ledger not created by create-lane', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.created_by = 'other-command';
      }),
    ).toContain('created_by must be create-lane');
  });

  it.each([
    '',
    '-danger',
    'feature bad',
    'feature\nbad',
    'feature;rm',
    'feature..bad',
    'feature@{bad',
    '/feature',
    'feature/',
    'feature//bad',
    '.feature',
    'feature.',
    'feature.lock',
    'safe/.lock',
    'HEAD',
    'refs/heads/main',
  ])('rejects unsafe base branch %s', (baseBranch) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.base_branch = baseBranch;
      }),
    ).toContain('base_branch must be a safe non-empty branch name');
  });

  it.each(['main', 'release/2026-08'])('accepts safe base branch %s', (baseBranch) => {
    const output = runMutatedCompletedLedger((ledger) => {
      ledger.base_branch = baseBranch;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each(['cleanup_command_worktrees', 'root_main_sync_ff_only'])(
    'rejects non-boolean authority_scope.%s',
    (field) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          ledger.authority_scope[field] = 'true';
        }),
      ).toContain(`authority_scope.${field} must be a boolean`);
    },
  );

  it.each([
    'https://github.com/example/fluo/pull/501',
    'https://github.com/fluojs/other/pull/501',
    'https://github.com/fluojs%2ffoo/fluo/pull/501',
    'https://github.com/fluojs/fluo/pull/501?check=1',
    'https://github.com/fluojs/fluo/pull/501#review',
    'https://github.com/fluojs/fluo/pull/501/',
    'https://user@github.com/fluojs/fluo/pull/501',
    'https://github.com:443/fluojs/fluo/pull/501',
    'https://github.com/Fluojs/fluo/pull/501',
    'https://github.com/fluojs\n/fluo/pull/501',
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects non-canonical PR identity %s', (pr) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '101').pr = pr;
      }),
    ).toContain('pr must be a positive integer or canonical fluojs/fluo pull URL');
  });

  it('accepts one PR identity mirrored for the same active issue', () => {
    const output = runMutatedCompletedLedger((ledger) => {
      ledger.status = 'running';
      ledger.lanes[0].status = 'merged';
      ledger.lanes[0].current_issue = 102;
      ledger.lanes[0].pr = 502;
      const rootMainSync = requireRootMainSync(ledger);
      rootMainSync.status = 'not-started';
      rootMainSync.sha = null;
      const progress = requireIssueProgress(ledger, '102');
      progress.status = 'merged';
      progress.pr = 'https://github.com/fluojs/fluo/pull/502';
      delete progress.cleanup;
      ledger.lanes[0].branch = progress.branch;
      ledger.lanes[0].worktree = progress.worktree;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects one PR identity mapped to different issues', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        ledger.status = 'running';
        ledger.lanes[0].status = 'merged';
        ledger.lanes[0].current_issue = 102;
        ledger.lanes[0].pr = 501;
        const rootMainSync = requireRootMainSync(ledger);
        rootMainSync.status = 'not-started';
        rootMainSync.sha = null;
        const progress = requireIssueProgress(ledger, '102');
        progress.status = 'merged';
        delete progress.cleanup;
        ledger.lanes[0].branch = progress.branch;
        ledger.lanes[0].worktree = progress.worktree;
      }),
    ).toContain('duplicate PR mapping: 501');
  });

  it.each(['-danger', 'feature bad', 'feature..bad', 'feature@{bad', 'safe/.lock'])(
    'rejects unsafe progress branch %s',
    (branch) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          requireIssueProgress(ledger, '101').branch = branch;
        }),
      ).toContain('issue progress branch must be a safe non-empty branch name');
    },
  );

  it('accepts a relative worktree matching the progress branch', () => {
    const output = runMutatedCompletedLedger((ledger) => {
      const progress = requireIssueProgress(ledger, '101');
      progress.worktree = `.worktrees/${progress.branch}`;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('accepts the primary repository absolute worktree path', () => {
    const output = runMutatedCompletedLedger((ledger) => {
      const progress = requireIssueProgress(ledger, '101');
      progress.worktree = `${expectedPrimaryRepoRoot}/.worktrees/${progress.branch}`;
    }, runValidatorPath);

    expect(output).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.runIf(repoRoot !== expectedPrimaryRepoRoot)(
    'rejects an absolute worktree path rooted under the current linked worktree',
    () => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          const progress = requireIssueProgress(ledger, '101');
          progress.worktree = `${repoRoot}/.worktrees/${progress.branch}`;
        }),
      ).toContain('worktree must match the completed progress branch under .worktrees');
    },
  );

  it.each(['.worktrees/other-branch', '/tmp/issue-101-runtime-alpha'])(
    'rejects mismatched worktree evidence %s',
    (worktree) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          requireIssueProgress(ledger, '101').worktree = worktree;
        }),
      ).toContain('worktree must match the completed progress branch under .worktrees');
    },
  );

  it('rejects an invalid optional reviewed_head', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '102').reviewed_head = 'abc123';
      }),
    ).toContain('reviewed_head must be a 40-character SHA when present');
  });

  it.each([
    { commits: [] },
    { commits: ['abc'] },
    { commits: ['ABCDEF1'] },
    { commits: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
  ])('rejects invalid optional commits $commits', ({ commits }) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        requireIssueProgress(ledger, '102').commits = commits;
      }),
    ).toContain('commits must contain non-empty 7-40 character lowercase hex entries when present');
  });

  it.each([[Number.MAX_SAFE_INTEGER + 1, true], [-1, false], [0.5, false]])(
    'rejects unsafe retry_count %s',
    (retryCount, active) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
          const progress = active ? activateIssue102(ledger) : requireIssueProgress(ledger, '101');
          progress.retry_count = retryCount;
      }),
    ).toContain('retry_count must be a non-negative safe integer');
    },
  );

  it('rejects an unsafe active lane branch', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        activateIssue102(ledger);
        ledger.lanes[0].branch = '-danger';
      }),
    ).toContain('lane branch must be a safe non-empty branch name');
  });

  it.each([
    [undefined, '.worktrees/issue-102-runtime-beta', 'lane worktree requires a safe branch'],
    ['-danger', '.worktrees/issue-102-runtime-beta', 'lane branch must be a safe non-empty branch name'],
    ['issue-102-runtime-beta', '.worktrees/other', 'lane worktree must match lane branch under .worktrees'],
    ['issue-102-runtime-beta', '/tmp/issue-102-runtime-beta', 'lane worktree must match lane branch under .worktrees'],
  ])('rejects invalid active lane worktree evidence %s %s', (branch, worktree, error) => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        activateIssue102(ledger);
        ledger.lanes[0].branch = branch;
        ledger.lanes[0].worktree = worktree;
      }),
    ).toContain(error);
  });

  it('accepts an active lane branch before worktree evidence exists', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = activateIssue102(ledger);
        ledger.lanes[0].worktree = undefined;
        Reflect.deleteProperty(progress, 'worktree');
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('accepts mirrored active lane and canonical progress identity evidence', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = activateIssue102(ledger);
        ledger.lanes[0].branch = progress.branch;
        ledger.lanes[0].worktree = progress.worktree;
        ledger.lanes[0].pr = 502;
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each(['.worktrees/other', '/tmp/issue-102-runtime-beta'])(
    'rejects mismatched non-completed progress worktree %s',
    (worktree) => {
      expect(
        runMutatedCompletedLedger((ledger) => {
          activateIssue102(ledger).worktree = worktree;
        }),
      ).toContain('worktree must match the progress branch under .worktrees');
    },
  );

  it('accepts matching non-completed progress branch and worktree', () => {
    expect(runMutatedCompletedLedger((ledger) => activateIssue102(ledger), runValidatorPath)).toContain(
      'Lane ledger check passed for 1 file(s).',
    );
  });

  it('rejects a current progress branch absent from the lane identity', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        activateIssue102(ledger);
        ledger.lanes[0].branch = undefined;
        ledger.lanes[0].worktree = undefined;
      }),
    ).toContain('current lane and issue progress branch must both be absent or exactly equal');
  });

  it('rejects a current lane branch that differs from progress', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        activateIssue102(ledger);
        ledger.lanes[0].branch = 'issue-102-other';
        ledger.lanes[0].worktree = '.worktrees/issue-102-other';
      }),
    ).toContain('current lane and issue progress branch must both be absent or exactly equal');
  });

  it('rejects a current progress worktree absent from the lane identity', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        activateIssue102(ledger);
        ledger.lanes[0].worktree = undefined;
      }),
    ).toContain('current lane and issue progress worktree must both be absent or exactly equal');
  });

  it('rejects equivalent but non-identical current worktree paths', () => {
    expect(
      runMutatedCompletedLedger((ledger) => {
        const progress = activateIssue102(ledger);
        progress.worktree = `${expectedPrimaryRepoRoot}/.worktrees/${progress.branch}`;
      }),
    ).toContain('current lane and issue progress worktree must both be absent or exactly equal');
  });

  it('rejects duplicate PR references', () => {
    expect(
      runMutatedCompletedLedger((ledger: LaneLedgerFixture) => {
        requireIssueProgress(ledger, '102').pr = requireIssueProgress(ledger, '101').pr;
      }),
    ).toContain('duplicate PR mapping');
  });
});
