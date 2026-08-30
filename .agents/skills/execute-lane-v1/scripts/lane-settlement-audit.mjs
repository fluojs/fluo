import {
  readdirSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import {
  isStrictRfc3339DateTime,
} from '../../../workflow-contracts/schema-validator.mjs';
import {
  validateLedger,
} from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  assertImmutableLaneBinding,
} from './handoff-provenance.mjs';
import {
  dependencyGate,
} from './dependency-gate.mjs';
import { readIssueSupervisorStore } from './issue-supervisor-store.mjs';
import { issueSupervisorTerminalStatuses } from './issue-supervisor-contracts.mjs';
import {
  canonicalLaneLedgerPath,
  canonicalLaneRuntimeRoot,
} from './lane-runtime-paths.mjs';
import {
  loadIssueDagRunBundle,
} from './issue-dag-store.mjs';

const terminalStatuses = new Set(issueSupervisorTerminalStatuses);
const defaultCommandRunner = (command, args, options) =>
  execFileSync(command, args, { ...options, encoding: 'utf8' });

const canonicalFile = (path, name) => {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(path) !== path
  ) {
    throw new TypeError(`${name} must be a real canonical file.`);
  }
  return readFileSync(path, 'utf8');
};

const sharedLaneState = (runtimeRoot, lane) => {
  const laneRoot = resolve(runtimeRoot, lane.lane_id);
  const snapshotPath = resolve(laneRoot, 'snapshot.json');
  const eventsPath = resolve(laneRoot, 'events.jsonl');
  if (!existsSync(snapshotPath) && !existsSync(eventsPath)) {
    return null;
  }
  if (!existsSync(snapshotPath) || !existsSync(eventsPath)) {
    throw new TypeError('shared lane settlement evidence is incomplete.');
  }
  const snapshot = JSON.parse(
    canonicalFile(snapshotPath, 'shared lane snapshot'),
  );
  const events = canonicalFile(eventsPath, 'shared lane events')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  assertImmutableLaneBinding(snapshot, lane);
  if (events.length > 0) {
    assertEventChain(events);
  }
  return { snapshot, events, receipts: [] };
};

export const observeUntouchedDependencyAbsence = ({
  repository_root: repositoryRoot,
  runtime_root: runtimeRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  command_runner: commandRunner = defaultCommandRunner,
  now = () => new Date().toISOString(),
}) => {
  const issueRoot = resolve(
    runtimeRoot,
    laneId,
    'issues',
    String(issueNumber),
  );
  const branchPrefix = `issue-${String(issueNumber)}-`;
  const worktreeRoot = resolve(repositoryRoot, '.worktrees');
  const worktrees = existsSync(worktreeRoot)
    ? readdirSync(worktreeRoot)
    : [];
  const taskRoot = resolve(repositoryRoot, '.omo', 'senpi-task', 'tasks');
  const taskFiles = existsSync(taskRoot)
    ? readdirSync(taskRoot).filter((name) => name.endsWith('.json'))
    : [];
  const taskIdentity =
    `"lane_id":"${laneId}","issue_number":${String(issueNumber)}`;
  const localBranches = String(commandRunner(
    'git',
    [
      '-C',
      repositoryRoot,
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
    ],
    { cwd: repositoryRoot },
  ));
  const remoteBranches = String(commandRunner(
    'git',
    [
      '-C',
      repositoryRoot,
      'ls-remote',
      '--heads',
      'origin',
    ],
    { cwd: repositoryRoot },
  ));
  const pullRequests = JSON.parse(String(commandRunner(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'all',
      '--limit',
      '1000',
      '--json',
      'headRefName',
    ],
    { cwd: repositoryRoot },
  )));
  if (!Array.isArray(pullRequests)) {
    throw new TypeError('GitHub pull request absence observation is invalid.');
  }
  return {
    issue_number: issueNumber,
    issue_store_absent: !existsSync(resolve(issueRoot, 'snapshot.json')),
    dag_absent: ![
      'dag-state.json',
      'dag-events.jsonl',
    ].some((name) => existsSync(resolve(issueRoot, name))),
    local_branch_absent: !localBranches
      .split('\n')
      .some((branch) => branch.startsWith(branchPrefix)),
    remote_branch_absent: !remoteBranches
      .split('\n')
      .some((line) =>
        line.endsWith(`/heads/${branchPrefix}`) ||
        line.includes(`/heads/${branchPrefix}`),
      ),
    worktree_absent: !worktrees.some((name) =>
      name.startsWith(branchPrefix),
    ),
    task_absent: !taskFiles.some((name) =>
      readFileSync(resolve(taskRoot, name), 'utf8').includes(taskIdentity),
    ),
    pr_absent: !pullRequests.some(
      (pullRequest) =>
        typeof pullRequest?.headRefName === 'string' &&
        pullRequest.headRefName.startsWith(branchPrefix),
    ),
    observed_at: now(),
  };
};

export const auditUntouchedDependencySettlement = ({
  shared,
  runtime_root: runtimeRoot,
  issue_number: issueNumber,
  absence_reobserver: absenceReobserver,
}) => {
  assertContract('lane-ledger-v2', shared.snapshot);
  validateLedger('lane-ledger-v2', shared.snapshot);
  if (!Array.isArray(shared.events)) {
    throw new TypeError('shared dependency events are missing.');
  }
  assertEventChain(shared.events);
  const progress = shared.snapshot.issue_progress[String(issueNumber)];
  const gate = dependencyGate(shared.snapshot, issueNumber);
  const events = shared.events.filter(
    (event) =>
      event.event_type === 'dependency.blocked' &&
      event.subject_id === String(issueNumber),
  );
  const blocker = progress?.blockers?.[0];
  const evidence =
    `dependencies ${gate.unsatisfied_dependencies.join(', ')} did not reach canonical done`;
  const artifactAbsence = events[0]?.payload?.artifact_absence;
  const liveAbsence =
    typeof absenceReobserver === 'function'
      ? absenceReobserver({
          lane_id: shared.snapshot.lane_id,
          issue_number: issueNumber,
          persisted: structuredClone(artifactAbsence),
        })
      : null;
  const absenceKeys = [
    'issue_store_absent',
    'dag_absent',
    'local_branch_absent',
    'remote_branch_absent',
    'worktree_absent',
    'task_absent',
    'pr_absent',
  ];
  const issueRoot = resolve(
    runtimeRoot,
    shared.snapshot.lane_id,
    'issues',
    String(issueNumber),
  );
  if (
    progress?.status !== 'blocked-terminal' ||
    progress.retry_count !== 0 ||
    progress.verification !== evidence ||
    !Array.isArray(progress.blockers) ||
    progress.blockers.length !== 1 ||
    blocker?.reviewer !== 'contract' ||
    blocker.signature !== 'dependency:not-done' ||
    blocker.evidence !== evidence ||
    blocker.fix_back_eligible !== false ||
    blocker.status !== 'unresolved' ||
    shared.snapshot.completed_issues.includes(issueNumber) ||
    gate.status !== 'blocked' ||
    gate.unsatisfied_dependencies.length === 0 ||
    events.length !== 1 ||
    events[0].stream_id !== shared.snapshot.lane_id ||
    JSON.stringify(events[0].payload?.unsatisfied_dependencies) !==
      JSON.stringify(gate.unsatisfied_dependencies) ||
    shared.events.some(
      (event) =>
        event.event_type === 'supervisor.dispatch.intent' &&
        event.subject_id === String(issueNumber),
    ) ||
    artifactAbsence?.issue_number !== issueNumber ||
    absenceKeys.some((key) => artifactAbsence[key] !== true) ||
    liveAbsence?.issue_number !== issueNumber ||
    absenceKeys.some((key) => liveAbsence?.[key] !== true) ||
    JSON.stringify(
      Object.fromEntries(
        absenceKeys.map((key) => [key, liveAbsence?.[key]]),
      ),
    ) !==
      JSON.stringify(
        Object.fromEntries(
          absenceKeys.map((key) => [key, artifactAbsence?.[key]]),
        ),
      ) ||
    typeof artifactAbsence.observed_at !== 'string' ||
    !isStrictRfc3339DateTime(artifactAbsence.observed_at) ||
    typeof liveAbsence?.observed_at !== 'string' ||
    !isStrictRfc3339DateTime(liveAbsence.observed_at) ||
    Date.parse(liveAbsence.observed_at) <
      Date.parse(events[0].occurred_at) ||
    [
      'snapshot.json',
      'dag-state.json',
      'dag-events.jsonl',
    ].some((name) => existsSync(resolve(issueRoot, name)))
  ) {
    throw new TypeError(
      `issue ${String(issueNumber)} untouched dependency settlement is invalid.`,
    );
  }
  return {
    issue_number: issueNumber,
    status: 'blocked-terminal',
  };
};

export const auditLaneIssueSettlement = ({
  repository_root,
  lane,
  command_runner,
  absence_reobserver,
}) => {
  assertContract('lane-ledger-v2', lane);
  const runtimeRoot = canonicalLaneRuntimeRoot(repository_root);
  const doneIssues = [];
  const blockedIssues = [];
  const activeIssues = [];
  const missingIssues = [];
  const shared = sharedLaneState(runtimeRoot, lane);

  for (const issueNumber of lane.confirmed_issues) {
    const snapshotPath = resolve(
      runtimeRoot,
      lane.lane_id,
      'issues',
      String(issueNumber),
      'snapshot.json',
    );
    if (!existsSync(snapshotPath)) {
      if (
        shared?.snapshot.issue_progress[String(issueNumber)]?.status ===
        'blocked-terminal'
      ) {
        blockedIssues.push(
          auditUntouchedDependencySettlement({
            shared,
            runtime_root: runtimeRoot,
            issue_number: issueNumber,
            absence_reobserver,
          }),
        );
      } else {
        missingIssues.push(issueNumber);
      }
      continue;
    }
    const bundle = readIssueSupervisorStore(
      runtimeRoot,
      lane.lane_id,
      issueNumber,
      { command_runner },
    );
    if (
      bundle.snapshot.lane_id !== lane.lane_id ||
      bundle.snapshot.issue_number !== issueNumber
    ) {
      throw new TypeError(
        `issue store identity does not match lane ${lane.lane_id} issue ${String(issueNumber)}.`,
      );
    }
    const status = bundle.snapshot.status;
    const dagBundle = loadIssueDagRunBundle(
      runtimeRoot,
      lane.lane_id,
      issueNumber,
    );
    if (
      terminalStatuses.has(status) &&
      (dagBundle === null ||
        dagBundle.state.status !== 'terminal' ||
        dagBundle.state.terminal_issue_status !== status ||
        dagBundle.state.terminal_issue_event_hash !==
          bundle.events.at(-1)?.event_hash)
    ) {
      activeIssues.push({
        issue_number: issueNumber,
        status,
        dag_status: dagBundle?.state.status ?? 'missing',
      });
      continue;
    }
    if (status === 'done') {
      doneIssues.push(issueNumber);
    } else if (terminalStatuses.has(status)) {
      blockedIssues.push({ issue_number: issueNumber, status });
    } else {
      activeIssues.push({ issue_number: issueNumber, status });
    }
  }

  return {
    version: 1,
    lane_id: lane.lane_id,
    status:
      activeIssues.length === 0 && missingIssues.length === 0
        ? 'terminal-claims-ready'
        : 'incomplete',
    done_issues: doneIssues,
    blocked_issues: blockedIssues,
    active_issues: activeIssues,
    missing_issues: missingIssues,
  };
};

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Usage: node lane-settlement-audit.mjs --root <repository> --ledger <lane-ledger>\n',
    );
    process.exit(0);
  }
  const canonical = canonicalLaneLedgerPath(
    valueAfter(args, '--root'),
    valueAfter(args, '--ledger'),
  );
  const lane = JSON.parse(readFileSync(canonical.ledgerPath, 'utf8'));
  if (lane.lane_id !== canonical.laneId) {
    throw new TypeError(
      'lane ledger identity does not match its canonical path.',
    );
  }
  const result = auditLaneIssueSettlement({
    repository_root: canonical.repositoryRoot,
    lane,
    absence_reobserver: ({ lane_id: laneId, issue_number: issueNumber }) =>
      observeUntouchedDependencyAbsence({
        repository_root: canonical.repositoryRoot,
        runtime_root: canonicalLaneRuntimeRoot(
          canonical.repositoryRoot,
        ),
        lane_id: laneId,
        issue_number: issueNumber,
      }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'terminal-claims-ready') {
    process.exitCode = 1;
  }
}
