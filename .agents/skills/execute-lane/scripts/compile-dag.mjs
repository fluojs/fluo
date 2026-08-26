import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import { implementerRoute } from './implementer-runtime.mjs';

const nodeId = (issueNumber) => `issue-${String(issueNumber)}-supervisor`;

export const supervisorRoute = Object.freeze({
  subagent_type: 'fluo-issue-supervisor',
});
export const nestedDispatchPolicy = Object.freeze({
  implementer: Object.freeze({ run_in_background: false }),
  reviewers: Object.freeze({
    run_in_background: false,
    batch: true,
  }),
});

export { implementerRoute };

const dispatchGate = (laneId) => `STARTUP GATE:
- Before any mutation or terminal decision, run:
  node .agents/skills/execute-lane/scripts/await-lane-dispatch.mjs
  --root . --ledger .omo/lanes/${laneId}.json
- Continue only when it exits zero and reports the attached native run.
- A delayed parent attach is not a ledger conflict.`;

const supervisorPrompt = (lane, issueNumber, dependencies) => `TASK:
Execute the complete Fluo lifecycle for issue ${String(issueNumber)} as an issue supervisor.

DELIVERABLE:
Return one typed terminal report for lane ${lane.lane_id} and issue ${String(issueNumber)}.

${dispatchGate(lane.lane_id)}

SCOPE:
- Consume the canonical lane ledger at .omo/lanes/${lane.lane_id}.json.
- Use one isolated issue branch and worktree.
- Before dispatching the first implementer, compile the issue, canonical docs,
  RFC/security sources, callers, adapters, and tests into one immutable
  review-preflight v1 acceptance matrix whose rows carry each exact live Acceptance Criteria section criterion text and digest. Reject unrelated bullet lists. Include positive, negative, and
  boundary cases for every row plus complexity, memory, atomicity, and mutation
  boundaries. Persist preflight-completed through issue-supervisor-store.mjs.
- Initialise every issue supervisor only at canonicalLaneRuntimeRoot(repository_root).
  Resolve preflight authority with resolveCanonicalPreflightAuthority(); the
  store recomputes it from .omo/lanes/${lane.lane_id}.json, the selected-or-
  explicitly-approved-suggested issue receipt, lane-plan approval, search
  artifact, and a fresh trusted-lead gh issue view snapshot. The live contract
  binds repository/origin, issue URL/title/body/updated revision, acceptance IDs
  and content digests, and its observation receipt. Never synthesize acceptance
  from an issue number. Use the complete canonical acceptance ID set as both row
  IDs and acceptance_row_ids. Every core source must be revision/content bound
  and covered by a row; additional docs/RFC/security sources require canonical
  Git revisions and content digests and must also be row-covered.
- Supply the accepted preflight unchanged to the implementer and every reviewer.
- Reconcile and reuse an existing canonical issue branch, worktree, and OPEN PR
  when their live identities and heads match; never create duplicates.
- Read .agents/skills/issue-to-pr/references/implementer.md before delegating implementation.
- Delegate the implementer through the direct native task tool with
  ${JSON.stringify(implementerRoute)}. Use only the configured subagent_type,
  include the complete implementer contract plus issue-bound inputs, and set
  ${JSON.stringify(nestedDispatchPolicy.implementer)}
  (\`run_in_background: false\`). Do not pass category,
  model overrides, a background request, or a handle request.
  Shell-launched delegation is forbidden.
- After the implementer reaches a terminal state, run
  node .agents/skills/execute-lane/scripts/implementer-runtime.mjs
  .omo/senpi-task <task-id>. Accept the child only when the verifier exits zero
  and reports the actual Terra high session. Missing or mismatched runtime
  evidence is a terminal child-contract blocker.
- Never use the implementer route for contract, code, or verification review.
  Delegate those axes through one direct native task call to separate
  category-routed, source-read-only children as one foreground batch with
  ${JSON.stringify(nestedDispatchPolicy.reviewers)}. Do not launch reviewers
  through shell processes or separate task calls. Contract and code may use only read, grep, find, ls,
  read-only LSP, and session-history inspection tools; they must never invoke
  bash/shell, edit/write/apply, code evaluation, tasks, GitHub mutation, or an
  unknown tool. Verification may use those read-only tools plus exactly one
  successful bash event, and that event must invoke canonical-verification.mjs
  with --root, --runtime-root, --lane, --issue, --cwd, --head, --preflight,
  and --task bound to this repository, lane, issue, worktree, current head,
  immutable accepted preflight digest, and actual reviewer
  task ID, followed by -- pnpm verify. It must not run a direct build, test,
  typecheck, lint, or any other mutation command. Build each task name with
  reviewerTaskName() and place the exact reviewerPromptSentinel()
  output from reviewer-runtime.mjs in its prompt. The task must inherit this
  canonical repository cwd and settle under the current supervisor parent
  session. Verify the real canonical Senpi task record and persist its
  digest-bound receipt. reviewer-runtime.mjs must digest the canonical
  .omo/senpi-task/logs/<task-id>.jsonl, enforce every actual tool event, and for
  verification bind the trusted wrapper command/result receipt to that session
  digest; task names or caller claims alone are not evidence.
- Wait for the entire triad to settle before sending any finding or starting
  any fix. Each reviewer must close every preflight row as PASS or BLOCK and
  report all currently discoverable blockers rather than stopping at the first.
- Persist one review_batch binding the three task IDs, full row coverage, and
  every blocker to its contract source, violated preflight row, reproduction,
  and blocking reason. Untethered hardening suggestions are follow-up work, not
  lane blockers.
- For every implementation-completed and fix-completed transition, including
  same-generation ordinary fixes, spawn a distinct implementer task. Build the
  task name with implementerTaskName(issue, generation, currentHead) and include the exact
  implementerPromptSentinel() output in the native task prompt. It binds lane,
  issue, worktree, current head, immutable accepted preflight digest, this
  parent session, generation, and issue-only read-write scope. Require the child to return the implementer machine
  string final_response machine contract binding its parent, current/new heads,
  generation, worktree, preflight digest, ledger digest, addressed blockers, and verification
  summary; persist the verifier's task-record/output digests and never reuse a
  task ID.
- After two blocked heads since the last implementer generation, spawn a fresh
  Terra-high implementer task with the full preflight, complete append-only
  cumulative blocker ledger, current unresolved ledger subset, and current
  diff. Compute blockerLedgerDigest() over the complete ledger and bind that
  digest plus both ledger payloads into implementerPromptSentinel(); require the
  same digest in the machine final_response. A stale, omitted, truncated, or
  caller-authored ledger is a terminal child-contract failure. Do not revive
  the prior implementer session. Read runtime evidence only from
  repository_root/.omo/senpi-task. Implementers may run focused test-first and
  changed-file checks, but must not run the full local-CI gate, repository-wide
  build/typecheck/lint/full tests, or canonical verification during review.
- Reach READY_FOR_PR locally before the lead pushes or creates the PR.
- After PR creation, observe required CI on the exact reviewed head.
- Refresh PR mergeability immediately and while CI is pending. A GitHub
  CONFLICTING/DIRTY observation enters conflict-resolution without waiting for checks.
- On a fixable CI failure, return to implementation, create a new head, rerun the full local triad, push, and observe CI again. For an OPEN PR conflict, persist a typed conflict-resolution gate with old/new/upstream heads, files/hunks, impact, and rationale: dispatch a distinct real fluo-issue-implementer with exact conflict-resolution old-base/reviewed/upstream/resolved-head, worktree, preflight digest, parent, and generation scope; the supervisor must not edit and task reuse is forbidden. Mechanically inherit exact prior PASS axes only when canonical Git proves patch equivalence and no upstream overlap. Compute minimum rerun axes from canonical changed/conflicting paths and diff shapes; reviewers may add but never omit axes. Rerun all axes for ambiguous or cross-cutting impact; then require CI on the resolved exact head.
- The issue supervisor owns issue-bound push, PR mutation, merge, cleanup, and
  issue-local evidence only under immutable lane authority.
- The parent lead alone owns the shared lane ledger and root synchronization.
- Native dependsOn is ordering only. Before any mutation, validate terminal
  issue-store evidence for predecessor issues ${JSON.stringify(dependencies)}
  through supervisor-terminal.mjs and require every predecessor to be done.
- If predecessor evidence is missing, malformed, or blocked, persist one typed
  dependency blocker and stop without creating a child, branch, worktree, or PR.
- Bind this issue to the immutable lane plan. The parent may import predecessor
  evidence into the shared lane snapshot only after this DAG settles.

VERIFY:
- At initialization, implementation acceptance, review acceptance, canonical verification, conflict resolution, and reload, require the canonical path to be a registered real Git worktree on the expected branch; require every bound commit to exist and live git rev-parse HEAD to equal supervisor state.
- Bind every local review, PR observation, CI result, merge, and cleanup action to the current head.
- Query PR state with mergeable and mergeStateStatus fields before waiting for
  CI, and persist an OPEN, head-bound pr-conflict receipt when either proves
  conflict.
- Adopt an existing OPEN PR only after a same-head local triad and persist a
  pr-adopt receipt whose local, remote, and PR heads are identical.
- Persist every transition and receipt through issue-supervisor-store.mjs.
- Treat node completion as a claim until the parent validates persisted evidence and live Git/GitHub state.
- Any ordinary code or worktree mutation invalidates every prior PASS and must
  produce a new head plus a complete fresh triad. Same-head PASS reuse is
  forbidden; only the typed conflict-resolution gate may inherit verified,
  exact prior-head PASS receipts under its mechanical/scoped rules. Recompute
  conflict tree/content and pairwise binary diff digests from canonical Git
  objects; reviewer or gate digest claims are never underlying Git evidence.
- Run artifact-producing canonical verification exclusively through
  canonical-verification.mjs with the lane runtime root, issue identity, and
  worktree. Never overlap it with another build, typecheck, declaration, or
  canonical verifier for the same issue.

STOP WHEN:
The issue is merged, cleanup is observed, and its issue runtime state is done, or one explicit terminal blocker is persisted.`;

const releaseHandoffPrompt = (lane, issueNumber) => `TASK:
Represent approved release handoff issue ${String(issueNumber)} in lane ${lane.lane_id}.

DELIVERABLE:
Return one typed blocked-maintainer-decision result bound to the approved lane-plan receipt.

${dispatchGate(lane.lane_id)}

SCOPE:
- Do not dispatch implementation, mutate a PR, or run a local publish path.
- Initialise the version 2 issue store only at
  canonicalLaneRuntimeRoot(repository_root) with review_policy=preflight-v1,
  the actual parent session, and canonical branch/worktree/head identity.
- Let initialiseIssueSupervisorStore() derive identity and authority from the
  canonical ledger, consumed lane-plan approval, and selected search artifact;
  never supply synthetic contract, authority, source, or approval values.
- Compile and persist preflight-completed with every canonical approved source
  and acceptance ID before applying release-handoff. A missing, substituted,
  or unpersisted preflight must stop before the handoff transition.
- Preserve the handoff for maintainer-controlled GitHub Actions execution.

VERIFY:
Recompute canonical approval binding, issue number, release_handoff=true, and
changeset_only=false evidence. Apply release-handoff only with the accepted
snapshot lane_plan_approval_sha256, then reload its v2 history and require
initialised -> preflight-completed -> release-handoff.

STOP WHEN:
The canonical store is blocked-maintainer-decision, or preflight/approval binding is rejected.`;

const assertAcyclic = (dependenciesByIssue) => {
  const visiting = new Set();
  const visited = new Set();
  const visit = (issueNumber) => {
    if (visiting.has(issueNumber)) {
      throw new TypeError('Lane DAG dependency graph contains a cycle.');
    }
    if (visited.has(issueNumber)) {
      return;
    }
    visiting.add(issueNumber);
    for (const dependency of dependenciesByIssue.get(issueNumber) ?? []) {
      visit(dependency);
    }
    visiting.delete(issueNumber);
    visited.add(issueNumber);
  };
  for (const issueNumber of dependenciesByIssue.keys()) {
    visit(issueNumber);
  }
};

export const compileLaneSupervisorDag = (lane) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  const releaseHandoffs = new Set(lane.release_handoffs);
  const confirmedIssues = new Set(lane.confirmed_issues);
  const queuePredecessors = new Map();
  for (const laneState of lane.lanes) {
    for (let index = 1; index < laneState.queue.length; index += 1) {
      queuePredecessors.set(
        laneState.queue[index],
        laneState.queue[index - 1],
      );
    }
  }
  const dependenciesByIssue = new Map(
    lane.confirmed_issues.map((issueNumber) => {
      const explicit =
        lane.dependency_graph[String(issueNumber)] ?? [];
      const queuePredecessor = queuePredecessors.get(issueNumber);
      return [
        issueNumber,
        [
          ...new Set([
            ...explicit,
            ...(queuePredecessor === undefined ? [] : [queuePredecessor]),
          ]),
        ],
      ];
    }),
  );
  assertAcyclic(dependenciesByIssue);
  const nodes = lane.confirmed_issues.map((issueNumber) => {
    const dependencies = dependenciesByIssue.get(issueNumber) ?? [];
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
      ...(releaseHandoff
        ? { category: 'quick' }
        : supervisorRoute),
      load_skills: ['execute-lane'],
      dependsOn: dependencies.map(nodeId),
      prompt: releaseHandoff
        ? releaseHandoffPrompt(lane, issueNumber)
        : supervisorPrompt(lane, issueNumber, dependencies),
    };
  });
  return {
    key: `fluo:lane:${lane.lane_id}:issue-supervisors:v2`,
    name: `Fluo lane ${lane.lane_id} issue supervisors`,
    nodes,
  };
};
