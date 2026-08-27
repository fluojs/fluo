import {
  readFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalLaneLedgerPath,
  canonicalLaneRuntimeRoot,
} from './lane-runtime-paths.mjs';
import {
  loadIssueDagRunBundle,
} from './issue-dag-store.mjs';
import {
  planIssueDagAmendment,
} from './issue-dag-lifecycle.mjs';
import {
  planLaneCoordinator,
} from './lane-coordinator.mjs';
import {
  readIssueSupervisorStore,
} from './issue-supervisor-store.mjs';
import {
  computeConflictGitEvidence,
} from './trusted-evidence.mjs';

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) throw new TypeError(`Missing ${flag}.`);
  return value;
};

const positiveInteger = (value, name) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
};

export const phaseContextFromArgs = (args) => {
  if (!args.includes('--phase-context-json')) {
    return undefined;
  }
  const parsed = JSON.parse(valueAfter(args, '--phase-context-json'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new TypeError('phase context must be a JSON object.');
  }
  return parsed;
};

export const phaseContextForIssue = (args, issue) => {
  const explicit = phaseContextFromArgs(args);
  const revalidationGeneration = issue.events.filter(
    (event) => event.kind === 'local-review-revalidation-required',
  ).length;
  if (
    issue.snapshot.status !== 'local-review' ||
    revalidationGeneration === 0
  ) {
    return explicit;
  }
  return {
    ...(explicit ?? {}),
    review_revalidation_generation: revalidationGeneration,
  };
};

const loadLane = (args) => {
  const canonical = canonicalLaneLedgerPath(
    valueAfter(args, '--root'),
    valueAfter(args, '--ledger'),
  );
  const lane = JSON.parse(readFileSync(canonical.ledgerPath, 'utf8'));
  if (lane.lane_id !== canonical.laneId) {
    throw new TypeError('Lane ledger identity does not match its path.');
  }
  return { canonical, lane };
};

const issueDagsFor = (runtimeRoot, lane) =>
  Object.fromEntries(
    lane.confirmed_issues.map((issueNumber) => [
      String(issueNumber),
      loadIssueDagRunBundle(runtimeRoot, lane.lane_id, issueNumber)?.state ??
        null,
    ]),
  );

const plan = (args) => {
  const { canonical, lane } = loadLane(args);
  const runtimeRoot = canonicalLaneRuntimeRoot(canonical.repositoryRoot);
  return planLaneCoordinator({
    lane,
    issue_dags: issueDagsFor(runtimeRoot, lane),
    max_active_issue_dags: positiveInteger(
      args.includes('--max-active')
        ? valueAfter(args, '--max-active')
        : '2',
      'max-active',
    ),
  });
};

const status = (args) => {
  const { canonical, lane } = loadLane(args);
  const runtimeRoot = canonicalLaneRuntimeRoot(canonical.repositoryRoot);
  return {
    version: 3,
    lane_id: lane.lane_id,
    issues: lane.confirmed_issues.map((issueNumber) => {
      const dag = loadIssueDagRunBundle(
        runtimeRoot,
        lane.lane_id,
        issueNumber,
      )?.state;
      return {
        issue_number: issueNumber,
        dag_status: dag?.status ?? 'not-admitted',
        run_id: dag?.run_id ?? null,
        phase: dag?.active_phase_key ?? null,
        head_sha: dag?.head_sha ?? null,
        definition_generation: dag?.definition_generation ?? null,
        native_generation: dag?.native_generation ?? null,
      };
    }),
  };
};

const next = (args) => {
  const { canonical, lane } = loadLane(args);
  const issueNumber = positiveInteger(
    valueAfter(args, '--issue'),
    'issue',
  );
  const runtimeRoot = canonicalLaneRuntimeRoot(canonical.repositoryRoot);
  const dag = loadIssueDagRunBundle(
    runtimeRoot,
    lane.lane_id,
    issueNumber,
  );
  if (dag === null) {
    throw new TypeError('Issue DAG must be admitted before planning a phase.');
  }
  const issue = readIssueSupervisorStore(
    runtimeRoot,
    lane.lane_id,
    issueNumber,
  );
  let phaseContext = phaseContextForIssue(args, issue);
  if (phaseContext?.stage === 'gate') {
    const {
      diffs: _diffs,
      ...machineEvidence
    } = computeConflictGitEvidence({
      repository_root: issue.snapshot.repository_root,
      worktree: issue.snapshot.worktree,
      previously_reviewed_head: issue.snapshot.head_sha,
      upstream_head: phaseContext.upstream_head,
      resolved_head: phaseContext.resolved_head,
    });
    phaseContext = {
      ...phaseContext,
      machine_evidence: machineEvidence,
    };
  }
  return planIssueDagAmendment({
    lane,
    issue_snapshot: issue.snapshot,
    dag_state: dag.state,
    phase_context: phaseContext,
  });
};

const usage =
  'Usage: node lane-coordinator-cli.mjs <plan|status|next> --root <repository> --ledger <lane-ledger> [--max-active <n>] [--issue <n>] [--phase-context-json <json>]\n';

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(usage);
    process.exit(0);
  }
  const command = args[0];
  const result =
    command === 'plan'
      ? plan(args)
      : command === 'status'
        ? status(args)
        : command === 'next'
          ? next(args)
          : (() => {
              throw new TypeError('Unknown coordinator command.');
            })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
