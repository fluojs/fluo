# Native Three-Stage Lane Workflow

## Status

This plan is implemented by the repository-local OMO+Senpi assets. The former OpenCode command plan is historical and
read-only; it is not an active runtime fallback.

## Canonical pipeline

```text
$search-issue
$create-lane .omo/search-issue/artifacts/<search_run_id>.json main
$execute-lane .omo/lanes/<lane_id>.json
```

The three stages have exclusive responsibilities:

| Stage | Active contract | Inputs | Outputs | Forbidden |
| --- | --- | --- | --- | --- |
| Search | `.agents/skills/search-issue/SKILL.md` | package/group/purpose scope and explicit issue-registration approval | `.omo/search-issue/artifacts/<search_run_id>.json` | lane design, implementation, PR work |
| Create | `.agents/skills/create-lane/SKILL.md` | one native v2 search artifact, three plan-bound approvals | canonical ready `.omo/lanes/<lane_id>.json` plus consumed-approval receipts | issue creation, branch/worktree/PR creation, merge |
| Execute | `.agents/skills/execute-lane/SKILL.md` | canonical v2 lane ledger and live reconciliation observations | atomic snapshot, append-only events, side-effect receipts, released lease | issue discovery, issue-set expansion, unobserved side effects |

The prior direct issue-list create input is explicitly retired so every lane has immutable provenance. For
already-open issues, use
`.agents/skills/search-issue/scripts/publish-search-artifact.mjs` to publish a
manual v2 artifact, then pass that artifact to `$create-lane`.

## Shared machine contracts

The shared source of truth is `.agents/workflow-contracts/`:

- `search-artifact-v2.schema.json`
- `lane-ledger-v2.schema.json`
- `lane-dag-binding.schema.json`
- `review-preflight.schema.json`
- `local-review-verdict.schema.json`
- `review-verdict.schema.json`
- `blocker.schema.json`
- `receipt.schema.json`
- `event.schema.json`
- `contracts.mjs`

`tooling/governance/verify-lane-ledger.mjs` accepts both preserved canonical v1
ledgers and native canonical v2 ledgers. A v2 ledger retains the complete
multi-issue lane model:

- source artifact ID and recomputed SHA-256 binding;
- confirmed and excluded issues;
- lane grouping and sparse dependency graph;
- release handoffs;
- merge and cleanup authority;
- adaptive retry policy for new v2 lanes, with bounded behavior retained only for already-approved legacy lane-ledger evidence;
- per-issue progress and completion evidence;
- root `main` fast-forward-only synchronization.

## Search artifact migration

Legacy actionable search records are immutable archive inputs. Reconstruct the ignored active runtime state with:

```bash
node .agents/skills/search-issue/scripts/migrate-legacy-artifacts.mjs \
  --source .opencode-backup/search-issue \
  --target .omo/search-issue/artifacts/legacy \
  --migrated-at 2026-08-24T00:00:00.000Z
```

The importer is idempotent, validates source shape, recomputes every v2 digest, fails closed on byte collisions, and
emits a checksum receipt. Native runtime skills never load archived command or role definitions.

## Create-lane invariants

1. Input is exactly one v2 artifact at
   `.omo/search-issue/artifacts/<search-run-id>.json` or
   `.omo/search-issue/artifacts/legacy/<search-run-id>.json`.
2. Artifact ID and SHA-256 are recomputed from canonical content.
3. Confirmed issues exactly match the artifact selection.
4. Suggested additions are separately approved and may extend the issue set.
5. The lane plan partitions every approved issue exactly once and validates dependencies.
6. All three approval records bind the artifact and complete plan and are
   consumed once.
7. A release handoff additionally binds live issue evidence and an explicit
   per-issue lane-plan attestation with `changeset_only: false`.
8. Ledger and approval receipts publish exclusively without overwrite.
9. Output directories must be real directories, never symlink redirects.

## Execute-lane invariants

1. Load the canonical snapshot, event chain, receipts, and lease before
   dispatch.
2. Reconcile the persisted branch, worktree, PR, and head with live state.
3. Progress each lane independently; there is no global batch barrier.
4. Preserve dependency order and release-handoff lanes. Initialise their canonical v2 identity/authority, persist the
   accepted preflight, then transition using the recomputed approval binding; missing/substituted evidence fails closed.
5. Compile one native DAG containing every confirmed issue supervisor. Map explicit dependencies and each queue predecessor to `dependsOn`, persist one lane dispatch intent and binding, then start the complete DAG once. Independent nodes may run concurrently. Native ordering does not prove predecessor success: each dependent validates canonical predecessor `done` evidence before mutation, and missing, incomplete, or blocked evidence terminalizes it without issue artifacts.
6. Implementers run focused test-first checks, not full local CI. In the parallel review batch contract/code are
   read-only; verification is the sole artifact-producing local-CI writer under the canonical lease.
7. `ready-for-pr` requires one complete triad. Ordinary mutation requires a new head and fresh triad; same-head PASS
   reuse is forbidden.
8. CI binds the reviewed PR head. A `CONFLICTING`/`DIRTY` observation enters `conflict-resolution`, never CI fix-back. Only that typed gate may inherit exact prior PASS receipts, and only after a distinct real conflict-scoped `fluo-issue-implementer` produces the commit and machine output and canonical Git proves old-base/reviewed versus upstream/resolved patch equivalence with no overlap. Canonical path/diff classification sets the minimum scoped axes; reviewers may only add axes. Ambiguous/cross-cutting impact reruns all before exact-head CI.
9. Record merge success only after CI PASS and an issue-supervisor-owned live
   squash merge observation bound to the reviewed PR head, with the linked
   issue observed `CLOSED`.
10. Cleanup only after merge observation; retain a terminal blocker when any
   worktree/local-branch/remote-branch removal is incomplete.
11. Recompute eligibility only after each issue terminal is validated and
    imported. Sync the clean root with a parent-lead `git pull --ff-only`
    observation only after every lane is done or explicitly terminal.
12. Append events, atomically replace the snapshot, record target-bound
   receipts, and release the lease after every transition.
13. Run the canonical ledger verifier before final reporting.

## Verification

```bash
pnpm exec vitest run \
  tooling/governance/omo-native-contracts.test.ts \
  tooling/governance/omo-native-events.test.ts \
  tooling/governance/search-issue-native.test.ts \
  tooling/governance/search-artifact-migration.test.ts \
  tooling/governance/create-lane-native.test.ts \
  tooling/governance/create-lane-multi.test.ts \
  tooling/governance/issue-to-pr-native.test.ts \
  tooling/governance/pr-to-merge-native.test.ts \
  tooling/governance/omo-native-assets.test.ts \
  tooling/governance/verify-lane-ledger.test.ts \
  tooling/governance/verify-lane-ledger-state.test.ts \
  tooling/governance/verify-lane-ledger-progress.test.ts \
  tooling/governance/verify-lane-ledger-identity.test.ts \
  tooling/governance/verify-lane-ledger-schema.test.ts
node --test .agents/skills/execute-lane/scripts/reviewer-runtime.test.mjs
node --test .agents/skills/execute-lane/scripts/review-loop-policy.test.mjs
node --test .agents/skills/execute-lane/scripts/conflict-resolution-policy.test.mjs
node --test .agents/skills/execute-lane/scripts/issue-supervisor-files.test.mjs
```

Manual QA must exercise valid and malformed search/create inputs plus happy, fix-back, human-check, budget,
malformed-child, persisted-resume, cleanup-block, and root-sync execute transitions.

The scripts under `scripts/fixtures/` are deterministic contract exercisers. They never constitute production approval
or live side-effect evidence.
