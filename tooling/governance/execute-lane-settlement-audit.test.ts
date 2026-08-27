import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  auditLaneIssueSettlement,
  observeUntouchedDependencyAbsence,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-settlement-audit.mjs',
  )
)) as {
  auditLaneIssueSettlement: (input: {
    repository_root: string;
    lane: Readonly<Record<string, unknown>>;
    command_runner?: unknown;
  }) => Readonly<Record<string, unknown>>;
  observeUntouchedDependencyAbsence: (input: {
    repository_root: string;
    runtime_root: string;
    lane_id: string;
    issue_number: number;
    command_runner: (
      command: string,
      args: readonly string[],
      options: Readonly<Record<string, unknown>>,
    ) => string;
    now: () => string;
  }) => Readonly<Record<string, unknown>>;
};
const { prepareCanonicalV2Runtime } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/v2-canonical-runtime.mjs',
  )
);
const { createReviewPreflight } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/review-loop-policy.mjs',
  )
);
const {
  applyIssueSupervisorTransition,
  initialiseIssueSupervisorStore,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor-store.mjs',
  )
)) as {
  applyIssueSupervisorTransition: (
    runtimeRoot: string,
    laneId: string,
    issueNumber: number,
    transition: Readonly<Record<string, unknown>>,
    options?: unknown,
  ) => Readonly<Record<string, unknown>>;
  initialiseIssueSupervisorStore: (
    runtimeRoot: string,
    identity: Readonly<Record<string, unknown>>,
    options?: unknown,
  ) => Readonly<Record<string, unknown>>;
};
const {
  attachIssueDagRun,
  createIssueDagRunBundle,
  observeIssueDagCompletion,
  persistIssueDagRunBundle,
  settleIssueDagPhase,
  terminalizeIssueDagRun,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-dag-store.mjs',
  )
)) as {
  createIssueDagRunBundle: (
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, any>>;
  attachIssueDagRun: (
    bundle: Readonly<Record<string, any>>,
    evidence: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, any>>;
  observeIssueDagCompletion: (
    bundle: Readonly<Record<string, any>>,
    evidence: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, any>>;
  settleIssueDagPhase: (
    bundle: Readonly<Record<string, any>>,
    evidence: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, any>>;
  terminalizeIssueDagRun: (
    bundle: Readonly<Record<string, any>>,
    evidence: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, any>>;
  persistIssueDagRunBundle: (
    runtimeRoot: string,
    bundle: Readonly<Record<string, any>>,
  ) => void;
};

describe('execute-lane supervisor settlement audit', () => {
  it('reobserves every untouched dependency artifact boundary', () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), 'fluo-lane-absence-')),
    );
    const commands: string[] = [];
    try {
      const observation = observeUntouchedDependencyAbsence({
        repository_root: directory,
        runtime_root: resolve(directory, '.omo', 'lane-runs'),
        lane_id: 'lane-4101-runtime',
        issue_number: 4102,
        command_runner: (command, args) => {
          commands.push([command, ...args].join(' '));
          return '[]';
        },
        now: () => '2026-08-27T00:00:00.000Z',
      });

      expect(observation).toEqual({
        issue_number: 4102,
        issue_store_absent: true,
        dag_absent: true,
        local_branch_absent: true,
        remote_branch_absent: true,
        worktree_absent: true,
        task_absent: true,
        pr_absent: true,
        observed_at: '2026-08-27T00:00:00.000Z',
      });
      expect(commands).toHaveLength(3);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
        auditLaneIssueSettlement({
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

  it('accepts a canonical child-contract terminal store as settled', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-settlement-child-contract-'),
    );
    const { ledger, runtimeRoot, commandRunner } =
      prepareCanonicalV2Runtime({
        repository_root: directory,
        lane_id: 'lane-4101-runtime',
        issue_numbers: [4101],
      });

    try {
      let bundle = initialiseIssueSupervisorStore(
        runtimeRoot,
        {
          lane_id: 'lane-4101-runtime',
          issue_number: 4101,
          branch: 'issue-4101-runtime',
          worktree: '.worktrees/issue-4101-runtime',
          starting_head_sha: '0'.repeat(40),
          started_at: '2026-08-25T00:00:00.000Z',
          review_policy: 'preflight-v1',
          repository_root: directory,
          parent_session_id: 'ses-settlement-child-contract',
        },
        { command_runner: commandRunner },
      );
      const state = bundle.snapshot as Readonly<Record<string, any>>;
      const authority = state.preflight_authority as Readonly<
        Record<string, any>
      >;
      const sources = authority.canonical_sources as readonly Readonly<
        Record<string, unknown>
      >[];
      const criteria = authority.canonical_acceptance_criteria as readonly Readonly<
        Record<string, string>
      >[];
      const preflight = createReviewPreflight({
        version: 1,
        lane_id: state.lane_id,
        issue_number: state.issue_number,
        issue_contract_revision: state.issue_contract_revision,
        issue_contract_sha256: state.issue_contract_sha256,
        lane_plan_approval_sha256: state.lane_plan_approval_sha256,
        head_sha: state.head_sha,
        generated_at: '2026-08-25T00:00:00.000Z',
        approved_sources: sources,
        acceptance_row_ids: authority.canonical_acceptance_ids,
        rows: authority.canonical_acceptance_ids.map(
          (id: string, index: number) => ({
            id,
            acceptance_text: criteria[index].content,
            acceptance_sha256: criteria[index].content_sha256,
            source: String(sources.at(-1)?.source),
            source_bindings: sources,
            invariant: 'The governed issue lifecycle remains fail-closed.',
            surfaces: ['issue-supervisor'],
            positive_cases: ['Canonical terminal evidence is accepted.'],
            negative_cases: ['Malformed child evidence is rejected.'],
            boundary_cases: ['The exact observed head remains authoritative.'],
          }),
        ),
        nonfunctional: {
          complexity: 'Settlement remains bounded.',
          memory: 'Evidence remains issue-local.',
          atomicity: 'Each transition is persisted atomically.',
          mutation_boundary: 'Only issue supervisor state is mutated.',
        },
      });
      bundle = applyIssueSupervisorTransition(
        runtimeRoot,
        'lane-4101-runtime',
        4101,
        {
          kind: 'preflight-completed',
          preflight,
        },
        { command_runner: commandRunner },
      );
      bundle = applyIssueSupervisorTransition(
        runtimeRoot,
        'lane-4101-runtime',
        4101,
        {
          kind: 'child-contract-error',
          observed_head: '0'.repeat(40),
          signature: 'reviewer-task-suspended-without-final',
          evidence: 'Required reviewer task produced no final response.',
        },
        { command_runner: commandRunner },
      );
      const definition = {
        key: 'fluo:lane:lane-4101-runtime:issue-4101:lifecycle:v3',
        name: 'Fluo lane lane-4101-runtime issue 4101 lifecycle',
        nodes: [
          {
            id: `preflight-g0-h${'0'.repeat(40)}`,
            category: 'deep',
            dependsOn: [],
            prompt: 'fixture',
          },
        ],
      };
      let dagBundle = createIssueDagRunBundle({
        lane_id: 'lane-4101-runtime',
        issue_number: 4101,
        dependencies: [],
        coordinator_session_id: 'ses-settlement-child-contract',
        head_sha: '0'.repeat(40),
        definition,
        dispatch_event_hash: 'd'.repeat(64),
      });
      dagBundle = attachIssueDagRun(dagBundle, {
        run_id: 'run_issue_4101',
        run_key: definition.key,
        parent_session_id: 'ses-settlement-child-contract',
        definition_fingerprint: 'e'.repeat(64),
        native_generation: 1,
      });
      persistIssueDagRunBundle(runtimeRoot, dagBundle);

      expect(
        auditLaneIssueSettlement({
          repository_root: directory,
          lane: ledger,
          command_runner: commandRunner,
        }),
      ).toEqual({
        version: 1,
        lane_id: 'lane-4101-runtime',
        status: 'incomplete',
        done_issues: [],
        blocked_issues: [],
        active_issues: [
          {
            issue_number: 4101,
            status: 'blocked-child-contract-error',
            dag_status: 'phase-running',
          },
        ],
        missing_issues: [],
      });

      dagBundle = observeIssueDagCompletion(dagBundle, {
        completed_node_ids: [`preflight-g0-h${'0'.repeat(40)}`],
        definition_fingerprint: 'e'.repeat(64),
        native_generation: 1,
      });
      dagBundle = settleIssueDagPhase(dagBundle, {
        completed_node_ids: [`preflight-g0-h${'0'.repeat(40)}`],
        definition_fingerprint: 'e'.repeat(64),
        native_generation: 1,
      });
      dagBundle = terminalizeIssueDagRun(dagBundle, {
        issue_status: 'blocked-child-contract-error',
        issue_event_hash: String(
          (
            (
              bundle.events as readonly Readonly<
                Record<string, unknown>
              >[]
            ).at(-1) as Readonly<Record<string, unknown>>
          )
            .event_hash,
        ),
      });
      persistIssueDagRunBundle(runtimeRoot, dagBundle);
      const issueDirectory = resolve(
        runtimeRoot,
        'lane-4101-runtime',
        'issues',
        '4101',
      );
      const beforeAudit = readdirSync(issueDirectory, {
        recursive: true,
      })
        .map(String)
        .sort();

      expect(
        auditLaneIssueSettlement({
          repository_root: directory,
          lane: ledger,
          command_runner: commandRunner,
        }),
      ).toEqual({
        version: 1,
        lane_id: 'lane-4101-runtime',
        status: 'terminal-claims-ready',
        done_issues: [],
        blocked_issues: [
          {
            issue_number: 4101,
            status: 'blocked-child-contract-error',
          },
        ],
        active_issues: [],
        missing_issues: [],
      });
      expect(
        readdirSync(issueDirectory, { recursive: true })
          .map(String)
          .sort(),
      ).toEqual(beforeAudit);
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
        auditLaneIssueSettlement({
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
