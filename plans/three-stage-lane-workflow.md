# Three Stage Lane Workflow

## TL;DR
> **Summary**: Replace the mixed `lane-supervisor` command with a three-stage pipeline: `search-issue` discovers/registers GitHub issues, `create-lane` turns existing issues into an executable lane ledger, and `execute-lane` drains that ledger through implementation, review, squash merge, cleanup, and main sync.
> **Deliverables**:
> - New command contracts for `.opencode/commands/search-issue.md`, `.opencode/commands/create-lane.md`, `.opencode/commands/execute-lane.md`
> - Removal of `.opencode/commands/lane-supervisor.md`
> - Updated references in `issue-to-pr`, `pr-to-merge`, and `fluo-issue-implementer`
> - Generic lane ledger validator and fixtures
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 5 -> Task 7

## Context
### Original Request
The requested architecture is a full replacement of the current source-choice `lane-supervisor` model with three explicit stages:

1. `search-issue`
2. `create-lane`
3. `execute-lane`

The current `lane-supervisor` should stop asking whether to use GitHub issues or run issue discovery. It should be replaced by commands that either create a new lane from already-selected GitHub issues or resume/execute an existing lane ledger.

### Interview Summary
- `search-issue` should happen before lane work and should own issue discovery/creation.
- `create-lane` should own lane design from existing issues.
- `execute-lane` should own the old drain loop behavior only.
- The user prefers a breaking cleanup over preserving the old mixed responsibility model.

### Metis Review (gaps addressed)
- Naming ambiguity resolved: use `search-issue`, `create-lane`, `execute-lane` as primary command names.
- Backward compatibility resolved: remove `lane-supervisor`; no command alias or redirect remains.
- Ledger ambiguity resolved: `create-lane` writes the executable lane ledger; `execute-lane` consumes it.
- Validator drift resolved: rename/genericize validator to lane ledger verification.
- Stale references resolved through explicit grep-based acceptance criteria.

## Work Objectives
### Core Objective
Make the lane workflow command architecture responsibility-complete and mechanically enforceable as a three-stage pipeline.

### Deliverables
- `.opencode/commands/search-issue.md`: issue discovery/registration command contract.
- `.opencode/commands/create-lane.md`: GitHub issue set to lane ledger command contract.
- `.opencode/commands/execute-lane.md`: lane ledger execution/drain command contract.
- Delete `.opencode/commands/lane-supervisor.md`; old invocations must fail instead of silently redirecting.
- Updated dependent command/agent references.
- Generic lane ledger validator script and package script.
- Positive/negative fixture coverage for lane ledger validation.

### Definition of Done
- `grep -RIn "Source choice\\|search-to-issue를 먼저 실행\\|source_mode: search-to-issue" .opencode/commands .opencode/agents` returns no live workflow contract references.
- `pnpm verify:lane-ledger -- <valid fixture>` passes.
- `pnpm verify:lane-ledger -- <invalid fixture>` fails with a specific invariant error in test coverage.
- `pnpm exec biome check tooling/governance/lane-ledger-contract.mjs tooling/governance/lane-ledger-contract.d.mts tooling/governance/lane-ledger-schema.mjs tooling/governance/lane-ledger-progress-schema.mjs tooling/governance/lane-ledger-dependency.mjs tooling/governance/lane-ledger-progress.mjs tooling/governance/lane-ledger-state.mjs tooling/governance/verify-lane-ledger.mjs package.json` passes.
- `pnpm exec vitest run tooling/governance/verify-lane-ledger.test.ts tooling/governance/verify-lane-ledger-state.test.ts tooling/governance/verify-lane-ledger-progress.test.ts tooling/governance/verify-lane-ledger-identity.test.ts tooling/governance/verify-lane-ledger-schema.test.ts` passes with exactly 363 tests.
- The focused strict v1 suite has exactly five test files and 363 tests, including `verify-lane-ledger-schema.test.ts`. `lane-ledger-schema.mjs` owns root/source/lane shape validation, `lane-ledger-progress-schema.mjs` owns status-specific progress key validation, and `lane-ledger-dependency.mjs` owns dependency graph validation. These implementation modules are not test files; any previous 93, 211, or four-file wording is stale.
- Command-doc verifier gates check that `.opencode/commands/create-lane.md` and `.opencode/commands/execute-lane.md` document the canonical schema, status, cursor, root-sync, authority, and cleanup prerequisites.
- `pnpm verify:lane-ledger -- tooling/governance/fixtures/lane-ledger/valid-ready.json tooling/governance/fixtures/lane-ledger/valid-completed-multi-issue.json` passes as the reproducible gate. The raw real ledger `.omo/lanes/lane-2026-08-05-persistence-a.json`, when present, is an expected nonzero strict-v1 migration failure and is never a passing compatibility fixture.

### Must Have
- `search-issue` is the only stage allowed to create GitHub issues.
- `create-lane` never creates issues, PRs, branches, or worktrees.
- `execute-lane` never discovers or expands issue scope.
- `execute-lane` uses squash merge only.
- `execute-lane` preserves child completion barrier and fix-back loop.
- Lane ledger validation is required before final reporting.

### Must NOT Have
- No source-choice gate in `execute-lane`.
- No `search-to-issue` handoff inside lane execution.
- No suggested issue additions inside lane execution.
- No merge from `pr-to-merge`; it remains read-only.
- No cleanup before PR `MERGED` and linked issue `CLOSED`.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD for validator and fixture behavior; docs contract changes validated by grep and command text assertions.
- QA policy: Every task includes agent-executed scenarios.
- Evidence: `evidence/task-{N}-{slug}.txt`

## Execution Strategy
### Parallel Execution Waves
Wave 1: Task 1 and Task 2 in sequence for canonical contracts and ledger schema.
Wave 2: Tasks 3, 4, 5 in parallel after schema is fixed.
Wave 3: Tasks 6, 7, 8 after command contracts and validator exist.

### Dependency Matrix
| Task | Blocks | Blocked By |
| --- | --- | --- |
| 1 | 2, 3, 4, 5 | none |
| 2 | 5, 6, 7 | 1 |
| 3 | 6 | 1 |
| 4 | 6 | 1 |
| 5 | 7 | 1, 2 |
| 6 | 8 | 2, 3, 4 |
| 7 | 8 | 2, 5 |
| 8 | Final Verification | 6, 7 |

## TODOs

- [ ] 1. Define Canonical Three-Stage Command Contracts

  **What to do**: Create the authoritative responsibility matrix for `search-issue`, `create-lane`, and `execute-lane`. Decide that `search-issue` owns issue discovery/creation, `create-lane` owns lane ledger creation from existing GitHub issues, and `execute-lane` owns execution only.

  **Must NOT do**: Do not modify implementation scripts yet. Do not keep source-choice semantics in `execute-lane`.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5] | Blocked By: []

  **References**:
  - Pattern: `.opencode/commands/search-issue.md` - reuse audit and issue creation responsibilities.
  - Historical source: run `git log --all --oneline -- .opencode/commands/lane-supervisor.md`, then use `git show <commit>:.opencode/commands/lane-supervisor.md` with the selected historical commit to inspect the deleted lane planning and execution loop.
  - Pattern: `.opencode/commands/issue-to-pr.md` - preserve child completion barrier.
  - Pattern: `.opencode/commands/pr-to-merge.md` - preserve read-only review gate.

  **Acceptance Criteria**:
  - [ ] A responsibility table exists in the command docs or migration doc.
  - [ ] The table has explicit Allowed / Forbidden / Inputs / Outputs for all three stages.
  - [ ] The table states `create-lane` writes the lane ledger and `execute-lane` consumes it.

  **QA Scenarios**:
  ```text
  Scenario: Responsibility table is complete
    Tool: bash
    Steps: grep -RIn "search-issue.*create-lane.*execute-lane\\|Allowed\\|Forbidden\\|Inputs\\|Outputs" .opencode/commands plans
    Expected: output contains all three command names and all four responsibility headings.
    Evidence: evidence/task-1-responsibility-table.txt

  Scenario: Execution stage has no discovery responsibility
    Tool: bash
    Steps: grep -RIn "search-to-issue를 먼저 실행\\|Source choice\\|Suggested additions" .opencode/commands/execute-lane.md
    Expected: command exits non-zero with no matches.
    Evidence: evidence/task-1-no-execute-discovery.txt
  ```

  **Commit**: YES | Message: `docs(commands): define three-stage lane workflow` | Files: `.opencode/commands/*.md`

- [ ] 2. Define Lane Artifact and Ledger Schema

  **What to do**: Define the handoff artifacts:
  - `.sisyphus/search-issue/<run-id>.json`
  - `.omo/lanes/<lane-id>.json`
Include the exact root keys `version`, `run_id`, `lane_id`, `status`, `created_by`, `base_branch`, `source`, `merge_policy`, `pr_merge_method`, `authority_scope`, `retry_policy`, `execution`, `confirmed_issues`, `suggested_but_excluded`, `backlog_candidates`, `release_handoffs`, `completed_issues`, `issue_progress`, `lanes`, `dependency_graph`, and `root_main_sync`, with only optional `created_at`. The strict validator enforces exact-key equality, not an external provenance exemption.

  **Must NOT do**: Do not let `execute-lane` mutate issue selection or lane grouping.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [5, 6, 7] | Blocked By: [1]

  **References**:
  - Fixture: `tooling/governance/fixtures/lane-ledger/valid-completed-multi-issue.json` - valid completed multi-issue fixture.
  - Real artifact: `.omo/lanes/lane-2026-08-05-persistence-a.json` - raw legacy persistence ledger, expected to fail strict v1 migration validation when available.
  - Pattern: `tooling/governance/verify-lane-ledger.mjs` - current validator behavior.

  **Acceptance Criteria**:
  - [ ] Schema docs require `version: 1`; version 1 remains canonical because both ready and deployed completed artifacts declare v1. Version 2 is reserved for a future incompatible format with explicit producer and migration support.
  - [ ] `create-lane` output is `status: ready`.
  - [ ] `execute-lane` accepts only `ready`, `running`, or terminal-resume ledgers.
  - [ ] Active lanes require an integer `current_issue`; terminal lanes require a `null` `current_issue` and move completion evidence to `issue_progress`.
  - [ ] Completed ledgers require per-issue `issue_progress` evidence, and `completed_issues` must contain exactly the same issue numbers as merge-completed `merged`, `done`, or post-merge cleanup-failure entries. Queue advancement still requires `done`.
  - [ ] Legacy-shaped contents from old `.sisyphus/lane-supervisor/*.json` ledgers are explicitly rejected with migration guidance; rejection is based on invalid legacy contents, not solely on an arbitrary read-only path. No migration ledger is a canonical passing fixture.

  **Final strict v1 contract**:
  - Root identity is `run_id` plus `lane_id`, with `created_by: create-lane`, `base_branch`, and `source`; each lane identity is its queue item, `current_issue`, branch, worktree, PR, and retry count.
  - `run_id` and `lane_id` use path-safe basenames without `+`. A `search-issue` source uses the source-only grammar `[A-Za-z0-9][A-Za-z0-9+._-]*`, preserves internal `+`, and requires exact `.sisyphus/search-issue/<search_run_id>.json` provenance.
  - `authority_scope` explicitly gates issue creation, PR creation, PR merge, command-owned cleanup, root main fast-forward sync, and GitHub Actions publishing. Missing or false cleanup/root-sync authority skips the side effect rather than inferring permission.
  - `retry_policy` and `execution` are persisted fields. Fix-back reuses the same PR, branch, and worktree, and terminal escalation follows the recorded retry policy.
  - `dependency_graph` is sparse. Confirmed positive-safe-integer issue keys map to unique positive-safe-integer prerequisites; external prerequisites are allowed in values, while duplicate, self, and cyclic edges fail closed.
  - Non-completion progress contains only base execution identity, verification, retry, and blocker fields. `running` requires branch/worktree, `in_review` additionally requires canonical PR and verification, and non-null branch/worktree assignments are globally unique across issues. `merged` adds completion evidence without cleanup; `done` adds cleanup. Post-merge cleanup failure uses `blocked-terminal`, null lane dispatch identity, complete merged evidence, no cleanup, and unresolved non-fix-back blockers. Release handoffs never carry branch/worktree/PR dispatch identity and never become completed, merged, or done.
  - Progress is lane-local: a child completion barrier applies only to that lane item. There is no global batch barrier; completed items proceed immediately to collection, review, fix-back, or merge gates.
  - Strict completion evidence requires terminal lane states, current PR/linked-issue identity, reviewer/check evidence, merge evidence, authorized cleanup evidence, and authorized root-sync evidence. Final reporting is forbidden while non-terminal work or stale evidence remains.
  - Root sync is allowed only on a clean root worktree via `git pull --ff-only origin <base-branch>`; reset, rebase, merge, or dirty-root cleanup is forbidden.

  **QA Scenarios**:
  ```text
  Scenario: Canonical v1 lane schema is documented
    Tool: bash
    Steps: grep -RIn "status: ready\\|version: 1\\|current_issue\\|issue_progress\\|completed_issues" .opencode/commands plans
    Expected: ready status, allowed root/progress statuses, canonical version 1, first-unfinished integer cursor, terminal null cursor, issue_progress evidence, and completed-set consistency appear in schema documentation.
    Evidence: evidence/task-2-schema-doc.txt

  Scenario: Legacy lane ledger is explicitly rejected
    Tool: bash
    Steps: grep -RIn "lane-supervisor.*reject\\|rejected.*migration\\|migration guidance" plans/three-stage-lane-workflow.md
    Expected: legacy lane-supervisor ledgers are documented as rejected with migration guidance, not as passing fixtures.
    Evidence: evidence/task-2-legacy-rejection.txt

  Scenario: Execution cannot change issue selection
    Tool: bash
    Steps: grep -RIn "confirmed_issues.*mutate\\|issue selection.*forbidden\\|never expands issue scope" .opencode/commands/execute-lane.md
    Expected: output contains explicit prohibition.
    Evidence: evidence/task-2-no-scope-mutation.txt
  ```

  **Commit**: YES | Message: `docs(commands): define lane ledger schema` | Files: `.opencode/commands/create-lane.md`, `.opencode/commands/execute-lane.md`

- [ ] 3. Replace Search Command Contract

  **What to do**: Introduce `.opencode/commands/search-issue.md`. Move the issue discovery and registration responsibilities into it, then add explicit artifact output.

  **Must NOT do**: Do not let `search-issue` create lanes or run implementation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [1]

  **References**:
  - Source: `.opencode/commands/search-issue.md` - active issue discovery and registration contract.
  - Policy: `AGENTS.md` - side-effect gates for issue creation.

  **Acceptance Criteria**:
  - [ ] `.opencode/commands/search-issue.md` exists.
  - [ ] It states GitHub issue creation is its only high-impact side effect.
  - [ ] It outputs selected issue numbers and a search artifact path.
  - [ ] The artifact has exactly `version: 1`, `search_run_id`, and non-empty unique positive-safe-integer `selected_issues`, with filename/ID binding and exclusive atomic no-overwrite publication.
  - [ ] It forbids lane planning and PR work.

  **QA Scenarios**:
  ```text
  Scenario: Search stage outputs issue artifact
    Tool: bash
    Steps: grep -RIn ".sisyphus/search-issue/.*selected_issues" .opencode/commands/search-issue.md
    Expected: artifact path and selected_issues appear.
    Evidence: evidence/task-3-search-artifact.txt

  Scenario: Search stage forbids lane execution
    Tool: bash
    Steps: grep -RIn "lane planning.*금지\\|PR 생성.*금지\\|merge.*금지" .opencode/commands/search-issue.md
    Expected: explicit prohibitions appear.
    Evidence: evidence/task-3-search-forbidden.txt
  ```

  **Commit**: YES | Message: `docs(commands): add search-issue stage` | Files: `.opencode/commands/search-issue.md`

- [ ] 4. Add Create-Lane Command Contract

  **What to do**: Add `.opencode/commands/create-lane.md`. It accepts issue numbers or a search artifact, validates GitHub issues read-only, groups lanes, sets merge policy, writes a ready lane ledger, and runs lane ledger validation.

  **Must NOT do**: Do not dispatch workers, create branches, create PRs, merge PRs, or cleanup worktrees.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [1]

  **References**:
  - Historical planning logic: run `git log --all --oneline -- .opencode/commands/lane-supervisor.md`, then use `git show <commit>:.opencode/commands/lane-supervisor.md` with the selected historical commit to inspect the deleted lane planning section.
  - Validator: `tooling/governance/verify-lane-ledger.mjs`.

  **Acceptance Criteria**:
  - [ ] `.opencode/commands/create-lane.md` exists.
  - [ ] Inputs are issue list or search artifact only.
  - [ ] It writes `.omo/lanes/<lane-id>.json`.
  - [ ] It records merge policy and authority scope.
  - [ ] It explicitly forbids implementation and PR side effects.

  **QA Scenarios**:
  ```text
  Scenario: Create-lane has no implementation verbs
    Tool: bash
    Steps: grep -RIn "issue-to-pr\\|gh pr create\\|gh pr merge\\|git worktree add" .opencode/commands/create-lane.md
    Expected: no matches except in explicit Must NOT text.
    Evidence: evidence/task-4-create-lane-no-exec.txt

  Scenario: Create-lane records authority upfront
    Tool: bash
    Steps: grep -RIn "merge_policy\\|authority_scope\\|cleanup_command_worktrees" .opencode/commands/create-lane.md
    Expected: all authority fields appear.
    Evidence: evidence/task-4-authority.txt
  ```

  **Commit**: YES | Message: `docs(commands): add create-lane stage` | Files: `.opencode/commands/create-lane.md`

- [ ] 5. Add Execute-Lane Command Contract

  **What to do**: Add `.opencode/commands/execute-lane.md`. Move the old `lane-supervisor` drain loop into it: worker dispatch, PR collection, child completion barrier, review gate, fix-back loop, squash merge, issue close verification, cleanup, root main sync, and ledger validation.

  **Must NOT do**: Do not include source choice, search handoff, suggested additions, or issue selection expansion.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [7] | Blocked By: [1, 2]

  **References**:
  - Historical drain loop: run `git log --all --oneline -- .opencode/commands/lane-supervisor.md`, then use `git show <commit>:.opencode/commands/lane-supervisor.md` with the selected historical commit to inspect the deleted drain loop.
  - Implementation command: `.opencode/commands/issue-to-pr.md`.
  - Review command: `.opencode/commands/pr-to-merge.md`.
  - Release boundary: `.opencode/commands/execute-lane.md` is the active execution contract; package publishing remains outside this workflow.

  **Acceptance Criteria**:
  - [ ] `.opencode/commands/execute-lane.md` exists.
  - [ ] It accepts only lane run-id/path and optional resume/authority flags.
  - [ ] It states merge method is always squash.
  - [ ] Its `Execution loop invariant` and `Per-lane progress, no global batch barrier` sections enforce a lane-local head barrier without a global batch barrier.
  - [ ] Its `Bounded fix-back loop` section requires bounded fix-back on the same branch, worktree, and PR, with retry policy applied before completion evidence is accepted.
  - [ ] It runs lane ledger validator before final report.

  **QA Scenarios**:
  ```text
  Scenario: Execute-lane has drain loop but no discovery
    Tool: bash
    Steps: grep -RIn "Source choice\\|Suggested additions\\|search-to-issue를 먼저 실행" .opencode/commands/execute-lane.md
    Expected: no matches.
    Evidence: evidence/task-5-no-discovery.txt

  Scenario: Execute-lane enforces squash and cleanup
    Tool: bash
    Steps: grep -RIn "gh pr merge .*--squash\\|cleanup\\|linked issue.*CLOSED" .opencode/commands/execute-lane.md
    Expected: squash merge, cleanup, and issue close checks appear.
    Evidence: evidence/task-5-merge-cleanup.txt
  ```

  **Commit**: YES | Message: `docs(commands): add execute-lane stage` | Files: `.opencode/commands/execute-lane.md`

- [ ] 6. Deprecate Lane-Supervisor and Update Caller References

  **What to do**: Delete `.opencode/commands/lane-supervisor.md` entirely. Update `issue-to-pr`, `pr-to-merge`, and `fluo-issue-implementer` references from `lane-supervisor` to `execute-lane` or “lane execution harness”.

  **Must NOT do**: Do not leave old examples that invoke source-choice supervisor flows.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [8] | Blocked By: [3, 4, 5]

  **References**:
  - Stale refs: `.opencode/commands/issue-to-pr.md`, `.opencode/commands/pr-to-merge.md`, `.opencode/agents/fluo-issue-implementer.md`.
  - Old command to remove: `.opencode/commands/lane-supervisor.md`.

  **Acceptance Criteria**:
  - [ ] `.opencode/commands/lane-supervisor.md` no longer exists.
  - [ ] No live command contract says lane-supervisor may call search-to-issue.
  - [ ] Caller references point to `execute-lane` or generic lane execution harness.

  **QA Scenarios**:
  ```text
  Scenario: No old source-choice examples remain
    Tool: bash
    Steps: grep -RIn "이 문제를 issue로 나누고\\|search-to-issue를 먼저 실행\\|Source choice" .opencode/commands .opencode/agents
    Expected: no matches in live command contracts.
    Evidence: evidence/task-6-no-old-source-choice.txt

  Scenario: Fix-back caller names are updated
    Tool: bash
    Steps: grep -RIn "execute-lane\\|lane execution harness" .opencode/commands/issue-to-pr.md .opencode/commands/pr-to-merge.md .opencode/agents/fluo-issue-implementer.md
    Expected: all three files contain updated caller naming.
    Evidence: evidence/task-6-caller-refs.txt
  ```

  **Commit**: YES | Message: `docs(commands): remove lane-supervisor` | Files: `.opencode/commands/lane-supervisor.md`, `.opencode/commands/issue-to-pr.md`, `.opencode/commands/pr-to-merge.md`, `.opencode/agents/fluo-issue-implementer.md`

- [ ] 7. Genericize Lane Ledger Validator

  **What to do**: Finish generic `tooling/governance/verify-lane-ledger.mjs` coverage for canonical v1. Cover active integer cursors, terminal null cursors, issue_progress-based multi-issue completion evidence, completed-set consistency, legacy terminal lane-level evidence rejection with migration guidance, duplicate PR mapping, invalid squash method, cleanup without merge, and valid ready and completed fixtures. Require the entire focused validator suite to pass.

  **Must NOT do**: Do not weaken existing validation for merged/cleanup states.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [8] | Blocked By: [2, 5]

  **References**:
  - Current script: `tooling/governance/verify-lane-ledger.mjs`.
  - Shape modules: `tooling/governance/lane-ledger-schema.mjs`, `tooling/governance/lane-ledger-progress-schema.mjs`, `tooling/governance/lane-ledger-dependency.mjs`.
  - Current script alias: `package.json`.
  - Valid completed fixture: `tooling/governance/fixtures/lane-ledger/valid-completed-multi-issue.json`.
  - Raw real completed artifact, expected strict-v1 migration failure when available: `.omo/lanes/lane-2026-08-05-persistence-a.json`.

  **Acceptance Criteria**:
  - [ ] `pnpm verify:lane-ledger -- <valid fixture>` passes.
  - [ ] Invalid fixtures fail in automated tests with specific messages.
  - [ ] Old script name is removed; do not retain a `lane-supervisor` alias.
  - [ ] `package.json` exposes `verify:lane-ledger`.

  **QA Scenarios**:
  ```text
  Scenario: Valid v1 fixtures pass the reproducible gate
    Tool: bash
    Steps: pnpm verify:lane-ledger -- tooling/governance/fixtures/lane-ledger/valid-ready.json tooling/governance/fixtures/lane-ledger/valid-completed-multi-issue.json
    Expected: exit 0 and "Lane ledger check passed" for both committed valid fixtures; both declare version 1.
    Evidence: evidence/task-7-valid-ledger.txt

  Scenario: Available real legacy artifact fails migration validation
    Tool: bash
    Steps: if test -f .omo/lanes/lane-2026-08-05-persistence-a.json; then ! pnpm verify:lane-ledger -- .omo/lanes/lane-2026-08-05-persistence-a.json; fi
    Expected: when available, the raw real artifact exits nonzero with migration guidance; absence does not fail the reproducible fixture gate.
    Evidence: evidence/task-7-real-ledger-migration-failure.txt

  Scenario: State, progress, and identity invariants remain covered
    Tool: bash
    Steps: pnpm exec vitest run tooling/governance/verify-lane-ledger-state.test.ts tooling/governance/verify-lane-ledger-progress.test.ts tooling/governance/verify-lane-ledger-identity.test.ts
    Expected: exit 0 and assertions cover allowed root/progress statuses, first-unfinished cursor, cleanup-before-done rejection, root-sync authority and terminal prerequisites, canonical fluojs/fluo PR identity, same-issue canonical PR mirroring allowed, cross-issue PR reuse rejected, and created_by/base/worktree rules.
    Evidence: evidence/task-7-state-progress-identity.txt

  Scenario: Canonical validator suite remains aligned
    Tool: bash
    Steps: pnpm exec vitest run tooling/governance/verify-lane-ledger.test.ts tooling/governance/verify-lane-ledger-state.test.ts tooling/governance/verify-lane-ledger-progress.test.ts tooling/governance/verify-lane-ledger-identity.test.ts tooling/governance/verify-lane-ledger-schema.test.ts
    Expected: the entire focused validator suite passes.
    Evidence: evidence/task-7-test-suite.txt

  Scenario: Invalid cleanup fixture fails
    Tool: bash
    Steps: pnpm exec vitest run tooling/governance/verify-lane-ledger-progress.test.ts -t "rejects cleanup done on running progress"
    Expected: exit 0 and test assertion proves validator rejects cleanup before progress is done.
    Evidence: evidence/task-7-invalid-cleanup.txt

  Scenario: Command-doc verifier gates are explicit
    Tool: bash
    Steps: grep -RIn "root_main_sync\\|authority\\|cleanup\\|current_issue\\|issue_progress" .opencode/commands/create-lane.md .opencode/commands/execute-lane.md
    Expected: command docs expose schema, state, root-sync authority and terminal prerequisites, and cleanup ordering checks.
    Evidence: evidence/task-7-command-doc-gates.txt
  ```

  **Commit**: YES | Message: `test(governance): validate lane ledger invariants` | Files: `tooling/governance/*`, `package.json`

- [ ] 8. End-to-End Pipeline Documentation and Migration Verification

  **What to do**: Add an end-to-end command sequence to the command docs:
  ```text
  /search-issue
  /create-lane .sisyphus/search-issue/<search_run_id>.json main
  /execute-lane <lane-id> main
  ```
  Include migration notes that old `lane-supervisor` usage is removed, and verify no stale live references remain.

  **Must NOT do**: Do not add a workflow that bypasses `create-lane`.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification | Blocked By: [6, 7]

  **References**:
  - New command files from Tasks 3-5.
  - `.opencode/MIGRATION.md` - active migration note documenting removal of `lane-supervisor` and the canonical replacement flow.
  - Validator from Task 7.

  **Acceptance Criteria**:
  - [ ] Pipeline example appears exactly once as the canonical path.
  - [ ] Removed old workflow is clearly marked unsupported in migration notes, not retained as a command.
  - [ ] Repo-wide grep shows old source-choice behavior is gone from live command contracts.

  **QA Scenarios**:
  ```text
  Scenario: Canonical pipeline appears
    Tool: bash
    Steps: grep -RIn "/search-issue\\|/create-lane\\|/execute-lane" .opencode/commands
    Expected: all three commands appear in the canonical migration docs.
    Evidence: evidence/task-8-canonical-pipeline.txt

  Scenario: No bypass path remains
    Tool: bash
    Steps: grep -RIn "/execute-lane .*2046\\|execute-lane.*issue list\\|lane-supervisor .*execute" .opencode/commands
    Expected: no live command contract allows issue-list direct execution without a lane ledger.
    Evidence: evidence/task-8-no-bypass.txt
  ```

  **Commit**: YES | Message: `docs(commands): document lane pipeline migration` | Files: `.opencode/commands/*.md`

## Final Verification Wave
- [ ] F1. Plan Compliance Audit
  - Verify all three stages have one owner each for issue creation, lane creation, and execution side effects.
- [ ] F2. Contract Reference Audit
  - Run `grep -RIn "lane-supervisor\\|search-to-issue\\|Source choice" .opencode/commands .opencode/agents tooling package.json` and classify every remaining match as migration artifact, validator compatibility, or defect.
- [ ] F3. Validator Audit
  - Run `pnpm verify:lane-ledger -- tooling/governance/fixtures/lane-ledger/valid-ready.json tooling/governance/fixtures/lane-ledger/valid-completed-multi-issue.json` as the reproducible fixture gate; confirm allowed root/progress statuses, active first-unfinished integer cursors, terminal null cursors, issue_progress-based completion evidence, completed-set consistency, cleanup-before-done rejection, root-sync authority and terminal prerequisites, canonical `fluojs/fluo` PR identity, same-issue canonical PR mirroring allowed, cross-issue PR reuse rejected, and `created_by`/base/worktree rules. Legacy terminal lane-level evidence must be rejected with migration guidance. If `.omo/lanes/lane-2026-08-05-persistence-a.json` is available, assert a separate read-only check exits nonzero.
  - Run `pnpm exec vitest run tooling/governance/verify-lane-ledger.test.ts tooling/governance/verify-lane-ledger-state.test.ts tooling/governance/verify-lane-ledger-progress.test.ts tooling/governance/verify-lane-ledger-identity.test.ts tooling/governance/verify-lane-ledger-schema.test.ts`; the entire focused validator suite must pass with exactly 363 tests.
  - Run explicit command-doc verifier gates against `.opencode/commands/create-lane.md` and `.opencode/commands/execute-lane.md` for schema, statuses, cursors, root-sync authority and terminal prerequisites, and cleanup ordering.
  - Keep the pure validator structural and mutating harness live Git/filesystem checks separate; the validator must not perform live identity, cleanup, or root-sync checks.
- [ ] F4. Manual Pipeline QA
  - Use `tmux` to run a dry documentation walkthrough:
    ```bash
    tmux new-session -d -s ulw-qa-lane-pipeline
    tmux send-keys -t ulw-qa-lane-pipeline 'grep -RIn "/search-issue\\|/create-lane\\|/execute-lane" .opencode/commands && pnpm verify:lane-ledger -- tooling/governance/fixtures/lane-ledger/valid-ready.json' C-m
    tmux capture-pane -pS -200 -t ulw-qa-lane-pipeline > evidence/final-pipeline-qa.txt
    tmux kill-session -t ulw-qa-lane-pipeline
    ```
  - Expected: canonical commands are present and the valid ledger fixture passes.

## Commit Strategy
- Keep docs contract changes separate from validator/test changes.
- Do not commit generated evidence unless this repo already stores evidence artifacts.
- Use conventional commits:
  - `docs(commands): define three-stage lane workflow`
  - `docs(commands): add lane pipeline commands`
  - `test(governance): validate lane ledger invariants`

## Success Criteria
- The old `lane-supervisor` mixed source-choice command is no longer the live orchestration entrypoint.
- `search-issue`, `create-lane`, and `execute-lane` each have single-purpose command contracts.
- Issue creation, lane creation, and execution/merge/cleanup authority are split across the three stages.
- Lane ledger validation enforces JSON structure and internal evidence consistency; live GitHub, repository, and dirty-worktree checks belong to `execute-lane` runtime gates.
- Existing downstream commands (`issue-to-pr`, `pr-to-merge`) refer to `execute-lane` or a generic lane execution harness, not the old supervisor.
