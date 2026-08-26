import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { auditLaneSupervisorSettlement } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-settlement-audit.mjs',
  )
)) as {
  auditLaneSupervisorSettlement: (input: {
    repository_root: string;
    lane: Readonly<Record<string, unknown>>;
    command_runner?: unknown;
  }) => Readonly<Record<string, unknown>>;
};
const { prepareCanonicalV2Runtime } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/v2-canonical-runtime.mjs',
  )
);
const { initialiseIssueSupervisorStore } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor-store.mjs',
  )
)) as {
  initialiseIssueSupervisorStore: (
    runtimeRoot: string,
    identity: Readonly<Record<string, unknown>>,
    options?: unknown,
  ) => Readonly<Record<string, unknown>>;
};

describe('execute-lane supervisor settlement audit', () => {
  it('rejects native DAG completion without canonical issue stores', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-settlement-'),
    );
    const lane = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-two-lanes-v2.json',
        ),
        'utf8',
      ),
    ) as Readonly<Record<string, unknown>>;

    try {
      expect(
        auditLaneSupervisorSettlement({
          repository_root: directory,
          lane,
        }),
      ).toEqual({
        version: 1,
        lane_id: 'lane-4101-runtime',
        status: 'incomplete',
        done_issues: [],
        blocked_issues: [],
        active_issues: [],
        missing_issues: [4101, 4102],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a valid bundle copied under another issue path', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-settlement-identity-'),
    );
    const lane = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-two-lanes-v2.json',
        ),
        'utf8',
      ),
    ) as Readonly<Record<string, unknown>>;
    const { runtimeRoot, commandRunner } = prepareCanonicalV2Runtime({
      repository_root: directory,
      lane_id: 'lane-4101-runtime',
      issue_numbers: [4101, 4102],
      authority_scope: {
        pr_creation: true,
        pr_merge: true,
        cleanup_command_worktrees: true,
      },
      retry_policy: {
        retry_count_is_terminal: true,
        max_same_failure_repeats: 3,
        max_wall_clock_minutes: 180,
        stop_on_child_contract_error: true,
      },
    });

    try {
      initialiseIssueSupervisorStore(runtimeRoot, {
        lane_id: 'lane-4101-runtime',
        issue_number: 4101,
        branch: 'issue-4101-runtime',
        worktree: '.worktrees/issue-4101-runtime',
        starting_head_sha: '0'.repeat(40),
        started_at: '2026-08-25T00:00:00.000Z',
        review_policy: 'preflight-v1',
        repository_root: directory,
        parent_session_id: 'ses-settlement-audit',
        release_handoff: false,
        authority_scope: {
          pr_creation: true,
          pr_merge: true,
          cleanup_command_worktrees: true,
        },
        retry_policy: {
          retry_count_is_terminal: true,
          max_same_failure_repeats: 3,
          max_wall_clock_minutes: 180,
          stop_on_child_contract_error: true,
        },
      }, { command_runner: commandRunner });
      renameSync(
        join(runtimeRoot, 'lane-4101-runtime', 'issues', '4101'),
        join(runtimeRoot, 'lane-4101-runtime', 'issues', '4102'),
      );

      expect(() =>
        auditLaneSupervisorSettlement({
          repository_root: directory,
          lane,
          command_runner: commandRunner,
        }),
      ).toThrow(/issue store identity/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
