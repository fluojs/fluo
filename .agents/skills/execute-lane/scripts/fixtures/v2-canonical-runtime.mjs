import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { approvalBinding } from '../../../create-lane/scripts/approval-contracts.mjs';
import { searchArtifact } from '../../../search-issue/scripts/publication.mjs';

const writeJson = (path, value) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const fixtureCommandRunner = ({ root, issueNumbers }) => {
  let cleanupCompleted = false;
  let state = {
    expectedHead: '0'.repeat(40),
    branch: `issue-${String(issueNumbers[0])}-fixture`,
    worktree: `.worktrees/issue-${String(issueNumbers[0])}-fixture`,
  };
  const issues = new Map(
    issueNumbers.map((number) => [
      number,
      {
        number,
        url: `https://github.com/fluojs/fluo/issues/${String(number)}`,
        title: `Fixture issue ${String(number)}`,
        body: `## Acceptance Criteria\n- [ ] Implement canonical behavior for issue ${String(number)}.`,
        updatedAt: '2026-08-26T00:00:00Z',
      },
    ]),
  );
  let conflictUpstreamHead = null;
  let awaitingExpectedHead = false;
  const runner = (command, args) => {
    if (command === 'gh') {
      const issue = issues.get(Number(args[2]));
      if (issue === undefined) throw new TypeError('unknown fixture issue');
      return JSON.stringify(issue);
    }
    if (command !== 'git') throw new TypeError(`unexpected fixture command: ${command}`);
    const cwd = args[1];
    const gitArgs = args.slice(2);
    if (gitArgs[0] === 'rev-parse' && gitArgs[1] === '--show-toplevel') return `${cwd}\n`;
    if (gitArgs[0] === 'remote' && gitArgs[1] === 'get-url') return 'https://github.com/fluojs/fluo.git\n';
    if (gitArgs[0] === 'symbolic-ref') {
      awaitingExpectedHead = true;
      state.branch = cwd.split('/').at(-1);
      state.worktree = `.worktrees/${state.branch}`;
      return `${state.branch}\n`;
    }
    if (gitArgs[0] === 'worktree' && gitArgs[1] === 'list') {
      return cleanupCompleted
        ? `worktree ${root}\nHEAD ${state.expectedHead}\nbranch refs/heads/main\n\n`
        : `worktree ${resolve(root, state.worktree)}\nHEAD ${state.expectedHead}\nbranch refs/heads/${state.branch}\n\n`;
    }
    if (gitArgs[0] === 'show-ref' && cleanupCompleted) {
      const error = new Error('missing fixture branch');
      Object.assign(error, { status: 1, signal: null, killed: false, pid: process.pid });
      throw error;
    }
    if (gitArgs[0] === 'ls-remote' && cleanupCompleted) {
      const error = new Error('missing fixture origin branch');
      Object.assign(error, { status: 2, signal: null, killed: false, pid: process.pid });
      throw error;
    }
    if (gitArgs[0] === 'cat-file') {
      if (awaitingExpectedHead) {
        state.expectedHead = gitArgs[2].replace(/\^\{commit\}$/u, '');
        awaitingExpectedHead = false;
      }
      return '';
    }
    if (gitArgs[0] === 'status' && gitArgs[1] === '--porcelain=v1') return '';
    if (gitArgs[0] === 'rev-parse' && gitArgs[1] === 'HEAD') return `${state.expectedHead}\n`;
    if (gitArgs[0] === 'ls-tree') return `100644 blob ${gitArgs.at(-1)}\tfixture.txt\0`;
    if (gitArgs[0] === 'merge-base') {
      conflictUpstreamHead = gitArgs[2];
      return `${'0'.repeat(40)}\n`;
    }
    if (gitArgs[0] === 'diff' && gitArgs.includes('--name-status')) {
      const separator = gitArgs.lastIndexOf('--');
      const left = gitArgs[separator - 2];
      const right = gitArgs[separator - 1];
      const path = right === conflictUpstreamHead ? 'upstream.txt' : 'implementation.ts';
      return `M\0${path}\0`;
    }
    if (gitArgs[0] === 'diff') return 'diff --git a/package.json b/package.json\n@@ package.json:10-14 @@\n';
    if (gitArgs[0] === 'show') {
      const source = gitArgs[1].split(':').slice(1).join(':');
      return readFileSync(resolve(root, source), 'utf8');
    }
    throw new TypeError(`unexpected fixture git args: ${gitArgs.join(' ')}`);
  };
  runner.setCleanupCompleted = () => {
    cleanupCompleted = true;
  };
  runner.setIssue = (number, next) => {
    issues.set(number, { ...issues.get(number), ...next });
  };
  return runner;
};

export const prepareCanonicalV2Runtime = ({
  repository_root: root,
  lane_id: laneId,
  issue_numbers: issueNumbers,
  selected_issue_numbers: selectedIssueNumbers = issueNumbers,
  authority_scope: authorityScope = {
    pr_creation: true,
    pr_merge: true,
    cleanup_command_worktrees: true,
  },
  retry_policy: retryPolicy = {
    retry_count_is_terminal: false,
    max_same_failure_repeats: null,
    max_wall_clock_minutes: null,
    stop_on_child_contract_error: true,
  },
  release_handoffs: releaseHandoffs = [],
}) => {
  const runId = `source-${laneId}`;
  const artifact = searchArtifact(runId, selectedIssueNumbers);
  const ledgerAuthority = {
    issue_creation: false,
    ...authorityScope,
    root_main_sync_ff_only: true,
    publish_via_github_actions: false,
  };
  const planHandoffs = releaseHandoffs.map((issueNumber) => ({
    issue_number: issueNumber,
    reason: 'release-or-publish-is-core',
    issue_evidence_sha256: String(issueNumber).padStart(64, '0').slice(-64),
  }));
  const suggestedIssues = issueNumbers.filter((issue) => !selectedIssueNumbers.includes(issue));
  const plan = {
    version: 2,
    lane_id: laneId,
    base_branch: 'main',
    source: { artifact_id: artifact.artifact_id, sha256: artifact.sha256 },
    merge_policy: 'supervisor-auto',
    pr_merge_method: 'squash',
    authority_scope: ledgerAuthority,
    retry_policy: retryPolicy,
    confirmed_issues: issueNumbers,
    suggested_but_excluded: [],
    backlog_candidates: [],
    release_handoffs: planHandoffs,
    lanes: issueNumbers.map((issueNumber) => ({ name: `issue-${String(issueNumber)}`, queue: [issueNumber] })),
    dependency_graph: {},
  };
  const issueApprovals = [
    { gate: 'confirmed-issues', issue_numbers: selectedIssueNumbers },
    { gate: 'suggested-additions', issue_numbers: suggestedIssues },
  ].map(({ gate, issue_numbers }) => {
    const approvalId = `approval-${laneId}-${gate}`;
    const input = { gate, approval_id: approvalId, issue_numbers };
    return {
      version: 1,
      approval_id: approvalId,
      gate,
      binding_sha256: approvalBinding(input, artifact, plan),
      lane_id: laneId,
      issue_numbers,
    };
  });
  const approvalInput = {
    gate: 'lane-plan',
    approval_id: `approval-${laneId}-lane-plan`,
    release_handoff_attestations: planHandoffs.map((handoff) => ({
      issue_number: handoff.issue_number,
      issue_evidence_sha256: handoff.issue_evidence_sha256,
      decision: 'release-or-publish-is-core',
      changeset_only: false,
    })),
  };
  const binding = approvalBinding(approvalInput, artifact, plan);
  const approval = {
    version: 1,
    approval_id: approvalInput.approval_id,
    gate: 'lane-plan',
    binding_sha256: binding,
    lane_id: laneId,
    release_handoff_attestations: approvalInput.release_handoff_attestations,
    plan,
  };
  const ledger = {
    version: 2,
    run_id: laneId,
    lane_id: laneId,
    ...(releaseHandoffs.length === 0
      ? {}
      : { lane_plan_approval_sha256: binding }),
    status: 'ready',
    created_by: 'create-lane',
    base_branch: 'main',
    source: {
      type: 'search-issue', search_run_id: runId,
      search_ledger: `.omo/search-issue/artifacts/${runId}.json`,
      artifact_id: artifact.artifact_id, sha256: artifact.sha256,
    },
    merge_policy: plan.merge_policy,
    pr_merge_method: plan.pr_merge_method,
    authority_scope: ledgerAuthority,
    retry_policy: retryPolicy,
    execution: { status: 'not-started', last_command: null, last_updated: null },
    confirmed_issues: issueNumbers,
    suggested_but_excluded: [], backlog_candidates: [],
    release_handoffs: releaseHandoffs,
    completed_issues: [], issue_progress: {},
    lanes: plan.lanes.map(({ name, queue }) => ({
      name, queue, current_issue: queue[0], status: 'queued', branch: null,
      worktree: null, pr: null, retry_count: 0,
    })),
    dependency_graph: {},
    root_main_sync: { status: 'not-started', sha: null },
  };
  writeJson(resolve(root, ledger.source.search_ledger), artifact);
  for (const issueApproval of issueApprovals) {
    writeJson(resolve(root, `.omo/approvals/${issueApproval.approval_id}.json`), issueApproval);
  }
  writeJson(resolve(root, `.omo/approvals/${approval.approval_id}.json`), approval);
  writeJson(resolve(root, `.omo/lanes/${laneId}.json`), ledger);
  const runtimeRoot = resolve(root, '.omo', 'lane-runs');
  mkdirSync(runtimeRoot, { recursive: true });
  for (const issueNumber of issueNumbers) {
    mkdirSync(resolve(root, `.worktrees/issue-${String(issueNumber)}-authority`), { recursive: true });
    mkdirSync(resolve(root, `.worktrees/issue-${String(issueNumber)}-runtime`), { recursive: true });
  }
  const commandRunner = fixtureCommandRunner({ root, issueNumbers });
  return { artifact, approval, issueApprovals, ledger, plan, runtimeRoot, commandRunner };
};
