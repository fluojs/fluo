import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { rootSyncObservation } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/transition-contracts.mjs',
  )
);

describe('execute-lane root synchronization', () => {
  const mergeA = 'a'.repeat(40);
  const mergeB = 'b'.repeat(40);
  const baseHead = 'c'.repeat(40);
  const snapshot = {
    base_branch: 'main',
    issue_progress: {
      '4101': { status: 'done', merge_commit: mergeA },
      '4102': { status: 'done', merge_commit: mergeB },
    },
  };

  it('accepts a synchronized base head containing every merge commit', () => {
    expect(
      rootSyncObservation(
        {
          observation: {
            authority: 'lead',
            base_branch: 'main',
            ff_only: true,
            status: 'done',
            sha: baseHead,
            local_sha: baseHead,
            remote_sha: baseHead,
            contained_merge_commits: [mergeA, mergeB],
          },
        },
        snapshot,
      ),
    ).toBe(baseHead);
  });

  it('rejects mismatched base heads or omitted merge ancestry', () => {
    expect(() =>
      rootSyncObservation(
        {
          observation: {
            authority: 'lead',
            base_branch: 'main',
            ff_only: true,
            status: 'done',
            sha: baseHead,
            local_sha: mergeA,
            remote_sha: baseHead,
            contained_merge_commits: [mergeA, mergeB],
          },
        },
        snapshot,
      ),
    ).toThrow(/ff-only update/u);
    expect(() =>
      rootSyncObservation(
        {
          observation: {
            authority: 'lead',
            base_branch: 'main',
            ff_only: true,
            status: 'done',
            sha: baseHead,
            local_sha: baseHead,
            remote_sha: baseHead,
            contained_merge_commits: [mergeA],
          },
        },
        snapshot,
      ),
    ).toThrow(/merge ancestry/u);
  });
});
