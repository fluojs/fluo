import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import { dependencyGate } from './dependency-gate.mjs';

const nodeId = (issueNumber) => `issue-${String(issueNumber)}-supervisor`;

const supervisorPrompt = (lane, issueNumber) => `TASK:
Execute the complete Fluo lifecycle for issue ${String(issueNumber)} as an issue supervisor.

DELIVERABLE:
Return one typed terminal report for lane ${lane.lane_id} and issue ${String(issueNumber)}.

SCOPE:
- Consume the canonical lane ledger at .omo/lanes/${lane.lane_id}.json.
- Use one isolated issue branch and worktree.
- Reconcile and reuse an existing canonical issue branch, worktree, and OPEN PR
  when their live identities and heads match; never create duplicates.
- Delegate implementation and each contract/code/verification review to separate children.
- Reach READY_FOR_PR locally before the lead pushes or creates the PR.
- After PR creation, observe required CI on the exact reviewed head.
- On a fixable CI failure, return to implementation, create a new head, rerun the full local triad, push, and observe CI again.
- The issue supervisor owns issue-bound push, PR mutation, merge, cleanup, and
  issue-local evidence only under immutable lane authority.
- The parent lead alone owns the shared lane ledger and root synchronization.
- Before any mutation, re-read the shared lane snapshot and require this issue
  to remain the queued lane cursor with every dependency at canonical done.

VERIFY:
- Bind every local review, PR observation, CI result, merge, and cleanup action to the current head.
- Adopt an existing OPEN PR only after a same-head local triad and persist a
  pr-adopt receipt whose local, remote, and PR heads are identical.
- Persist every transition and receipt through issue-supervisor-store.mjs.
- Treat node completion as a claim until the parent validates persisted evidence and live Git/GitHub state.
- Never reuse a reviewer PASS after the head changes.

STOP WHEN:
The issue is merged, cleanup is observed, and its issue runtime state is done, or one explicit terminal blocker is persisted.`;

const releaseHandoffPrompt = (lane, issueNumber) => `TASK:
Represent approved release handoff issue ${String(issueNumber)} in lane ${lane.lane_id}.

DELIVERABLE:
Return one typed blocked-maintainer-decision result bound to the approved lane-plan receipt.

SCOPE:
- Do not dispatch implementation.
- Do not create or mutate a PR.
- Do not publish or run a local publish path.
- Preserve the release handoff for maintainer-controlled GitHub Actions execution.

VERIFY:
Validate the issue number, release-handoff approval digest, and changeset_only=false evidence from the canonical lane ledger.

STOP WHEN:
The release handoff is persisted as blocked-maintainer-decision, or the approval binding is rejected.`;

export const compileLegacyLaneSupervisorDag = (lane) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  const releaseHandoffs = new Set(lane.release_handoffs);
  const confirmedIssues = new Set(lane.confirmed_issues);
  const nodes = lane.confirmed_issues.map((issueNumber) => {
    const dependencies = lane.dependency_graph[String(issueNumber)] ?? [];
    if (dependencies.some((dependency) => !confirmedIssues.has(dependency))) {
      throw new TypeError(
        `issue ${String(issueNumber)} has a dependency outside confirmed issues.`,
      );
    }
    const releaseHandoff = releaseHandoffs.has(issueNumber);
    if (
      !releaseHandoff &&
      dependencies.some((dependency) => releaseHandoffs.has(dependency))
    ) {
      throw new TypeError(
        `issue ${String(issueNumber)} has a release handoff dependency that cannot execute in the DAG.`,
      );
    }
    return {
      id: nodeId(issueNumber),
      label: releaseHandoff
        ? `Issue #${String(issueNumber)} release handoff`
        : `Issue #${String(issueNumber)} supervisor`,
      description: releaseHandoff
        ? `Park approved release handoff issue #${String(issueNumber)} for maintainer action.`
        : `Run issue #${String(issueNumber)} through local review, PR, CI, merge, and cleanup.`,
      task_summary: releaseHandoff
        ? `Issue #${String(issueNumber)} release handoff 보존`
        : `Issue #${String(issueNumber)} 전체 lifecycle 실행`,
      category: releaseHandoff ? 'quick' : 'deep',
      load_skills: ['execute-lane'],
      dependsOn: dependencies.map(nodeId),
      prompt: releaseHandoff
        ? releaseHandoffPrompt(lane, issueNumber)
        : supervisorPrompt(lane, issueNumber),
    };
  });
  return {
    key: `fluo:lane:${lane.lane_id}:issue-supervisors:v1`,
    name: `Fluo lane ${lane.lane_id} issue supervisors`,
    nodes,
  };
};

export const compileIssueSupervisorDag = (lane, issueNumber) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  const laneState = lane.lanes.find(
    (candidate) =>
      candidate.status === 'queued' &&
      candidate.current_issue === issueNumber,
  );
  if (laneState === undefined) {
    throw new TypeError(
      `issue ${String(issueNumber)} is not the queued lane cursor.`,
    );
  }
  const gate = dependencyGate(lane, issueNumber);
  if (gate.status !== 'ready') {
    throw new TypeError(
      `issue ${String(issueNumber)} dependency gate is ${gate.status}.`,
    );
  }
  const node = compileLegacyLaneSupervisorDag(lane).nodes.find(
    (candidate) => candidate.id === nodeId(issueNumber),
  );
  if (node === undefined) {
    throw new TypeError(
      `issue ${String(issueNumber)} is missing from the supervisor plan.`,
    );
  }
  return {
    key: `fluo:lane:${lane.lane_id}:issue-${String(issueNumber)}:supervisor:v2`,
    name: `Fluo lane ${lane.lane_id} issue ${String(issueNumber)} supervisor`,
    nodes: [{ ...node, dependsOn: [] }],
  };
};
