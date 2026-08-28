# Execute-lane v3 workflow

## Runtime model

The canonical lane ledger is the shared plan and settlement projection. It is
not a native DAG definition. The trusted parent coordinator owns:

- lane admission and cross-issue dependencies;
- native issue-DAG start, attach, amend, retry, and recovery;
- issue and issue-DAG state writes;
- semantic result verification and typed transitions;
- PR/CI/merge/cleanup observation;
- terminal import and root synchronization.

Direct phase agents are single-depth process workers with task, DAG, and team
dispatch disabled. The parent treats a native completion as unverified until
the wave settles and exactly one machine final response is authenticated.
Detached or `persisted_only` child records never authorize a transition.

Every admitted issue has one key and one immutable native run:

```text
key: fluo:lane:<lane>:issue-<issue>:lifecycle:v3
run_id: native ID attached after dispatch intent
parentSessionId: the coordinator session
```

A different parent session cannot adopt the run. Resume the owning session or
create an explicitly approved successor lane.

## Coordinator loop

For each coordinator wake:

1. Revalidate the canonical lane and approval authority.
2. Load the shared lane snapshot and every issue-DAG control bundle.
3. Terminalize untouched descendants of blocked predecessors only after fresh
   artifact-absence evidence.
4. Admit ready issues up to `max_active_issue_dags`.
5. Reconcile each admitted issue against its native key, run, event journal,
   node state, and task records.
6. Persist native completion as `native-completed-unverified`.
7. Verify the exact task owner, task attachment event, session logs, machine
   result, current issue event hash, and live Git/GitHub state.
8. Apply one canonical issue transition.
9. Settle the verified phase.
10. Compile and persist only the next amendment intent.
11. Apply or recover that amendment on the same run.
12. Terminalize matching issue and DAG state, import it into the lane, and
    release newly ready issues.

The default admission limit is 2. Review fan-out is three nodes inside one
issue wave. Merge and root-main synchronization remain serialized.

## Native control states

```text
dispatch-intent
  -> phase-running
  -> native-completed-unverified
  -> phase-settled
  -> amend-intent
  -> phase-running
  -> ...
  -> terminal
```

`definition_generation` is 0 for the initial definition and increments once per
accepted amendment. Native generation is 1 initially and increments once per
native amendment. Implementation generation starts at 1 and advances only
according to the adaptive fix-back policy.

An amendment intent binds:

- base native generation and definition fingerprint;
- base submitted-definition digest;
- target submitted-definition digest;
- phase key and exact head;
- exact added node IDs.

Attachment additionally requires the canonical `dag.definition.amended` event
with matching previous/current fingerprints, target submitted definition,
added nodes, no changed nodes, and no invalidated nodes.

## Phase table

| Canonical issue status | Next direct DAG wave | Parent transition |
| --- | --- | --- |
| `preflight` | starting-head-bound preflight or fresh append-only retry | `preflight-completed` |
| `implementing` | implementation generation | `implementation-completed` |
| `local-review` | contract/code/verification | `local-review` |
| `ready-for-pr` | PR adopt-or-create | PR observation |
| `ready-for-push` | PR update | PR observation |
| `ci-pending` | ordinal CI observation | CI pass/fix/conflict/pending |
| `ci-fix-back` | new implementation generation | `fix-completed` |
| `conflict-resolution` | implementation, gate, rerun axes | `conflict-resolved` |
| `merge-ready` | exact-head merge | `merge-observed` |
| `merged` | merge-bound cleanup | `cleanup-observed` |
| terminal status | no synthetic success node | DAG terminal binding |

The parent never precompiles later waves. A reviewer cannot start before the
parent has verified the implementation task and live worktree head.

Malformed but non-mutating preflight output is corrected only by appending
`preflight-g<N>-h<full-head>` in the same run. The prior node and task remain
immutable. Authority substitution, forbidden tools, mutation, and owner
mismatch are terminal child-contract failures rather than retry candidates.

## Review loop

The accepted `review-preflight-v1` remains immutable. Every implementation or
ordinary fix produces a new head and invalidates previous ordinary PASS
receipts. Reviewers run concurrently and independently on that exact head.

The parent first runs canonical verification to completion and publishes one
immutable receipt ID. It then dispatches the read-only reviewer triad, waits
for all three canonical task receipts, verifies complete row coverage and the
verification reviewer's exact receipt read, and persists one review batch:

- all PASS: proceed to PR;
- fixable BLOCK: append blocker ledger and start a new implementation phase;
- malformed child/runtime evidence: terminal child-contract blocker;
- human/policy/external finding: typed terminal blocker.

The second blocked head since the last implementer refresh advances the
implementation generation and uses the complete append-only blocker ledger.

## Conflict workflow

An OPEN PR with fresh `CONFLICTING` or `DIRTY` evidence enters conflict
resolution immediately.

Conflict execution uses three separate amendments:

1. `conflict-implementation` binds the reviewed and upstream heads and returns
   the previously unknown resolved head.
2. `conflict-gate` computes canonical changed/conflicting path and diff impact.
3. `conflict-review` runs every canonically affected axis.

Prior PASS inheritance is allowed only when canonical Git proves exact patch
equivalence and no upstream overlap. Ambiguous or cross-cutting impact reruns
all axes. CI then runs on the resolved exact head.

## Remote side effects

Each operator node owns one action. The parent reobserves live state before
accepting or retrying it.

- PR adoption requires OPEN state, canonical branch, and identical local,
  remote, and PR heads.
- CI evidence binds the exact reviewed PR head.
- Merge requires reviewed, remote, PR, and CI heads to match, squash merge,
  MERGED PR state, and CLOSED issue state.
- Cleanup binds the exact PR and merge result and records worktree/local/remote
  branch outcomes.
- No cleanup receipt means the issue is not `done`.

## Settlement

Native node or run completion is a scheduling claim. Canonical issue state is
the lifecycle authority.

Terminalization stores the exact issue terminal status and terminal issue event
hash in the issue-DAG control bundle. Lane settlement accepts:

- `done` only with verified merge and cleanup evidence plus matching terminal
  DAG state;
- typed terminal blockers only with matching issue/DAG evidence;
- dependency-blocked untouched issues without a DAG only when complete
  artifact-absence evidence proves no side effect occurred.

Only canonical `done` releases a successor.
