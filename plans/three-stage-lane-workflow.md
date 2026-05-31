# Three Stage Lane Workflow

## TL;DR
> **Summary**: Replace the mixed `lane-supervisor` command with a three-stage pipeline: `search-issue` discovers/registers GitHub issues, `create-lane` turns existing issues into an executable lane ledger, and `execute-lane` drains that ledger through implementation, review, squash merge, cleanup, and main sync.
> **Deliverables**:
> - New command contracts for `.codex/commands/search-issue.md`, `.codex/commands/create-lane.md`, `.codex/commands/execute-lane.md`
> - Removal of `.codex/commands/lane-supervisor.md`
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
- `.codex/commands/search-issue.md`: issue discovery/registration command contract.
- `.codex/commands/create-lane.md`: GitHub issue set to lane ledger command contract.
- `.codex/commands/execute-lane.md`: lane ledger execution/drain command contract.
- Delete `.codex/commands/lane-supervisor.md`; old invocations must fail instead of silently redirecting.
- Updated dependent command/agent references.
- Generic lane ledger validator script and package script.
- Positive/negative fixture coverage for lane ledger validation.

### Definition of Done
- `grep -RIn "Source choice\\|search-to-issue를 먼저 실행\\|source_mode: search-to-issue" .codex/commands .codex/agents` returns no live workflow contract references.
- `pnpm verify:lane-ledger -- <valid fixture>` passes.
- `pnpm verify:lane-ledger -- <invalid fixture>` fails with a specific invariant error in test coverage.
- `pnpm exec biome check tooling/governance/verify-lane-ledger.mjs package.json` passes.
- `pnpm vitest run tooling/governance/verify-lane-ledger.test.ts` passes.
- `pnpm verify:lane-ledger -- .sisyphus/lane-supervisor/lane-2026-05-31-011905.json` passes during migration compatibility.

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
  - Pattern: `.codex/commands/search-to-issue.md` - reuse audit and issue creation responsibilities.
  - Historical source: `git show HEAD:.codex/commands/lane-supervisor.md` - split old lane planning from execution loop before deleting the command.
  - Pattern: `.codex/commands/issue-to-pr.md` - preserve child completion barrier.
  - Pattern: `.codex/commands/pr-to-merge.md` - preserve read-only review gate.

  **Acceptance Criteria**:
  - [ ] A responsibility table exists in the command docs or migration doc.
  - [ ] The table has explicit Allowed / Forbidden / Inputs / Outputs for all three stages.
  - [ ] The table states `create-lane` writes the lane ledger and `execute-lane` consumes it.

  **QA Scenarios**:
  ```text
  Scenario: Responsibility table is complete
    Tool: bash
    Steps: grep -RIn "search-issue.*create-lane.*execute-lane\\|Allowed\\|Forbidden\\|Inputs\\|Outputs" .codex/commands plans
    Expected: output contains all three command names and all four responsibility headings.
    Evidence: evidence/task-1-responsibility-table.txt

  Scenario: Execution stage has no discovery responsibility
    Tool: bash
    Steps: grep -RIn "search-to-issue를 먼저 실행\\|Source choice\\|Suggested additions" .codex/commands/execute-lane.md
    Expected: command exits non-zero with no matches.
    Evidence: evidence/task-1-no-execute-discovery.txt
  ```

  **Commit**: YES | Message: `docs(commands): define three-stage lane workflow` | Files: `.codex/commands/*.md`

- [ ] 2. Define Lane Artifact and Ledger Schema

  **What to do**: Define the handoff artifacts:
  - `.sisyphus/search-issue/<run-id>.json`
  - `.sisyphus/lane/<run-id>.json`
  Include `selected_issues`, `confirmed_issues`, `lanes`, `authority_scope`, `merge_policy`, `retry_policy`, `completed_issues`, `root_main_sync`, and `version`.

  **Must NOT do**: Do not let `execute-lane` mutate issue selection or lane grouping.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [5, 6, 7] | Blocked By: [1]

  **References**:
  - Pattern: `.sisyphus/lane-supervisor/lane-2026-05-31-011905.json` - migration fixture.
  - Pattern: `tooling/governance/verify-lane-ledger.mjs` - current validator behavior.

  **Acceptance Criteria**:
  - [ ] Schema docs include `version`.
  - [ ] `create-lane` output is `status: ready`.
  - [ ] `execute-lane` accepts only `ready`, `running`, or terminal-resume ledgers.
  - [ ] Old `.sisyphus/lane-supervisor/*.json` ledgers are explicitly migration-compatible or rejected with a clear message.

  **QA Scenarios**:
  ```text
  Scenario: Valid ready lane schema is documented
    Tool: bash
    Steps: grep -RIn "status: ready\\|version:\\|.sisyphus/lane/" .codex/commands plans
    Expected: all three tokens appear in schema documentation.
    Evidence: evidence/task-2-schema-doc.txt

  Scenario: Execution cannot change issue selection
    Tool: bash
    Steps: grep -RIn "confirmed_issues.*mutate\\|issue selection.*forbidden\\|never expands issue scope" .codex/commands/execute-lane.md
    Expected: output contains explicit prohibition.
    Evidence: evidence/task-2-no-scope-mutation.txt
  ```

  **Commit**: YES | Message: `docs(commands): define lane ledger schema` | Files: `.codex/commands/create-lane.md`, `.codex/commands/execute-lane.md`

- [ ] 3. Replace Search Command Contract

  **What to do**: Introduce `.codex/commands/search-issue.md`. Move or copy the current `search-to-issue` responsibilities, then add explicit artifact output. Decide whether `.codex/commands/search-to-issue.md` becomes a deprecated alias or is removed.

  **Must NOT do**: Do not let `search-issue` create lanes or run implementation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [1]

  **References**:
  - Source: `.codex/commands/search-to-issue.md` - existing question-only audit contract.
  - Policy: `AGENTS.md` - side-effect gates for issue creation.

  **Acceptance Criteria**:
  - [ ] `.codex/commands/search-issue.md` exists.
  - [ ] It states GitHub issue creation is its only high-impact side effect.
  - [ ] It outputs selected issue numbers and a search artifact path.
  - [ ] It forbids lane planning and PR work.

  **QA Scenarios**:
  ```text
  Scenario: Search stage outputs issue artifact
    Tool: bash
    Steps: grep -RIn ".sisyphus/search-issue/.*selected_issues" .codex/commands/search-issue.md
    Expected: artifact path and selected_issues appear.
    Evidence: evidence/task-3-search-artifact.txt

  Scenario: Search stage forbids lane execution
    Tool: bash
    Steps: grep -RIn "lane planning.*금지\\|PR 생성.*금지\\|merge.*금지" .codex/commands/search-issue.md
    Expected: explicit prohibitions appear.
    Evidence: evidence/task-3-search-forbidden.txt
  ```

  **Commit**: YES | Message: `docs(commands): add search-issue stage` | Files: `.codex/commands/search-issue.md`, `.codex/commands/search-to-issue.md`

- [ ] 4. Add Create-Lane Command Contract

  **What to do**: Add `.codex/commands/create-lane.md`. It accepts issue numbers or a search artifact, validates GitHub issues read-only, groups lanes, sets merge policy, writes a ready lane ledger, and runs lane ledger validation.

  **Must NOT do**: Do not dispatch workers, create branches, create PRs, merge PRs, or cleanup worktrees.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [1]

  **References**:
  - Historical planning logic: `git show HEAD:.codex/commands/lane-supervisor.md` lane planning section.
  - Validator: `tooling/governance/verify-lane-ledger.mjs`.

  **Acceptance Criteria**:
  - [ ] `.codex/commands/create-lane.md` exists.
  - [ ] Inputs are issue list or search artifact only.
  - [ ] It writes `.sisyphus/lane/<run-id>.json`.
  - [ ] It records merge policy and authority scope.
  - [ ] It explicitly forbids implementation and PR side effects.

  **QA Scenarios**:
  ```text
  Scenario: Create-lane has no implementation verbs
    Tool: bash
    Steps: grep -RIn "issue-to-pr\\|gh pr create\\|gh pr merge\\|git worktree add" .codex/commands/create-lane.md
    Expected: no matches except in explicit Must NOT text.
    Evidence: evidence/task-4-create-lane-no-exec.txt

  Scenario: Create-lane records authority upfront
    Tool: bash
    Steps: grep -RIn "merge_policy\\|authority_scope\\|cleanup_command_worktrees" .codex/commands/create-lane.md
    Expected: all authority fields appear.
    Evidence: evidence/task-4-authority.txt
  ```

  **Commit**: YES | Message: `docs(commands): add create-lane stage` | Files: `.codex/commands/create-lane.md`

- [ ] 5. Add Execute-Lane Command Contract

  **What to do**: Add `.codex/commands/execute-lane.md`. Move the old `lane-supervisor` drain loop into it: worker dispatch, PR collection, child completion barrier, review gate, fix-back loop, squash merge, issue close verification, cleanup, root main sync, and ledger validation.

  **Must NOT do**: Do not include source choice, search handoff, suggested additions, or issue selection expansion.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [7] | Blocked By: [1, 2]

  **References**:
  - Historical drain loop: `git show HEAD:.codex/commands/lane-supervisor.md`.
  - Implementation command: `.codex/commands/issue-to-pr.md`.
  - Review command: `.codex/commands/pr-to-merge.md`.
  - Release handoff: `.codex/commands/package-publish.md`.

  **Acceptance Criteria**:
  - [ ] `.codex/commands/execute-lane.md` exists.
  - [ ] It accepts only lane run-id/path and optional resume/authority flags.
  - [ ] It states merge method is always squash.
  - [ ] It includes child completion barrier.
  - [ ] It includes after-fixback same-reviewer recheck.
  - [ ] It runs lane ledger validator before final report.

  **QA Scenarios**:
  ```text
  Scenario: Execute-lane has drain loop but no discovery
    Tool: bash
    Steps: grep -RIn "Source choice\\|Suggested additions\\|search-to-issue를 먼저 실행" .codex/commands/execute-lane.md
    Expected: no matches.
    Evidence: evidence/task-5-no-discovery.txt

  Scenario: Execute-lane enforces squash and cleanup
    Tool: bash
    Steps: grep -RIn "gh pr merge .*--squash\\|cleanup\\|linked issue.*CLOSED" .codex/commands/execute-lane.md
    Expected: squash merge, cleanup, and issue close checks appear.
    Evidence: evidence/task-5-merge-cleanup.txt
  ```

  **Commit**: YES | Message: `docs(commands): add execute-lane stage` | Files: `.codex/commands/execute-lane.md`

- [ ] 6. Deprecate Lane-Supervisor and Update Caller References

  **What to do**: Delete `.codex/commands/lane-supervisor.md` entirely. Update `issue-to-pr`, `pr-to-merge`, and `fluo-issue-implementer` references from `lane-supervisor` to `execute-lane` or “lane execution harness”.

  **Must NOT do**: Do not leave old examples that invoke source-choice supervisor flows.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [8] | Blocked By: [3, 4, 5]

  **References**:
  - Stale refs: `.codex/commands/issue-to-pr.md`, `.codex/commands/pr-to-merge.md`, `.codex/agents/fluo-issue-implementer.toml`.
  - Old command to remove: `.codex/commands/lane-supervisor.md`.

  **Acceptance Criteria**:
  - [ ] `.codex/commands/lane-supervisor.md` no longer exists.
  - [ ] No live command contract says lane-supervisor may call search-to-issue.
  - [ ] Caller references point to `execute-lane` or generic lane execution harness.

  **QA Scenarios**:
  ```text
  Scenario: No old source-choice examples remain
    Tool: bash
    Steps: grep -RIn "이 문제를 issue로 나누고\\|search-to-issue를 먼저 실행\\|Source choice" .codex/commands .codex/agents
    Expected: no matches in live command contracts.
    Evidence: evidence/task-6-no-old-source-choice.txt

  Scenario: Fix-back caller names are updated
    Tool: bash
    Steps: grep -RIn "execute-lane\\|lane execution harness" .codex/commands/issue-to-pr.md .codex/commands/pr-to-merge.md .codex/agents/fluo-issue-implementer.toml
    Expected: all three files contain updated caller naming.
    Evidence: evidence/task-6-caller-refs.txt
  ```

  **Commit**: YES | Message: `docs(commands): remove lane-supervisor` | Files: `.codex/commands/lane-supervisor.md`, `.codex/commands/issue-to-pr.md`, `.codex/commands/pr-to-merge.md`, `.codex/agents/fluo-issue-implementer.toml`

- [ ] 7. Genericize Lane Ledger Validator

  **What to do**: Finish generic `tooling/governance/verify-lane-ledger.mjs` coverage. Add fixtures and tests for ready lane, done lane, blocked child contract error, duplicate PR mapping, invalid squash method, cleanup without merge, and stale done lane missing completed issue.

  **Must NOT do**: Do not weaken existing validation for merged/cleanup states.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [8] | Blocked By: [2, 5]

  **References**:
  - Current script: `tooling/governance/verify-lane-ledger.mjs`.
  - Current script alias: `package.json`.
  - Existing migration ledger: `.sisyphus/lane-supervisor/lane-2026-05-31-011905.json`.

  **Acceptance Criteria**:
  - [ ] `pnpm verify:lane-ledger -- <valid fixture>` passes.
  - [ ] Invalid fixtures fail in automated tests with specific messages.
  - [ ] Old script name is removed; do not retain a `lane-supervisor` alias.
  - [ ] `package.json` exposes `verify:lane-ledger`.

  **QA Scenarios**:
  ```text
  Scenario: Valid fixture passes
    Tool: bash
    Steps: pnpm verify:lane-ledger -- tooling/governance/fixtures/lane-ledger/valid-ready.json
    Expected: exit 0 and "Lane ledger check passed".
    Evidence: evidence/task-7-valid-ledger.txt

  Scenario: Invalid cleanup fixture fails
    Tool: bash
    Steps: pnpm vitest run tooling/governance/verify-lane-ledger.test.ts -t "rejects cleanup without merge"
    Expected: exit 0 and test assertion proves validator rejects cleanup without merge.
    Evidence: evidence/task-7-invalid-cleanup.txt
  ```

  **Commit**: YES | Message: `test(governance): validate lane ledger invariants` | Files: `tooling/governance/*`, `package.json`

- [ ] 8. End-to-End Pipeline Documentation and Migration Verification

  **What to do**: Add an end-to-end command sequence to the command docs:
  ```bash
  /search-issue
  /create-lane 2046 2045 2041 --merge-policy supervisor-auto
  /execute-lane lane-...
  ```
  Include migration notes that old `lane-supervisor` usage is removed, and verify no stale live references remain.

  **Must NOT do**: Do not add a workflow that bypasses `create-lane`.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification | Blocked By: [6, 7]

  **References**:
  - New command files from Tasks 3-5.
  - Deprecated stub from Task 6.
  - Validator from Task 7.

  **Acceptance Criteria**:
  - [ ] Pipeline example appears exactly once as the canonical path.
  - [ ] Removed old workflow is clearly marked unsupported in migration notes, not retained as a command.
  - [ ] Repo-wide grep shows old source-choice behavior is gone from live command contracts.

  **QA Scenarios**:
  ```text
  Scenario: Canonical pipeline appears
    Tool: bash
    Steps: grep -RIn "/search-issue\\|/create-lane\\|/execute-lane" .codex/commands
    Expected: all three commands appear in the canonical migration docs.
    Evidence: evidence/task-8-canonical-pipeline.txt

  Scenario: No bypass path remains
    Tool: bash
    Steps: grep -RIn "/execute-lane .*2046\\|execute-lane.*issue list\\|lane-supervisor .*execute" .codex/commands
    Expected: no live command contract allows issue-list direct execution without a lane ledger.
    Evidence: evidence/task-8-no-bypass.txt
  ```

  **Commit**: YES | Message: `docs(commands): document lane pipeline migration` | Files: `.codex/commands/*.md`

## Final Verification Wave
- [ ] F1. Plan Compliance Audit
  - Verify all three stages have one owner each for issue creation, lane creation, and execution side effects.
- [ ] F2. Contract Reference Audit
  - Run `grep -RIn "lane-supervisor\\|search-to-issue\\|Source choice" .codex/commands .codex/agents tooling package.json` and classify every remaining match as migration artifact, validator compatibility, or defect.
- [ ] F3. Validator Audit
  - Run `pnpm verify:lane-ledger -- <current valid fixtures>` and `pnpm vitest run tooling/governance/verify-lane-ledger.test.ts`.
- [ ] F4. Manual Pipeline QA
  - Use `tmux` to run a dry documentation walkthrough:
    ```bash
    tmux new-session -d -s ulw-qa-lane-pipeline
    tmux send-keys -t ulw-qa-lane-pipeline 'grep -RIn "/search-issue\\|/create-lane\\|/execute-lane" .codex/commands && pnpm verify:lane-ledger -- tooling/governance/fixtures/lane-ledger/valid-ready.json' C-m
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
- Lane ledger validation prevents stale issue/PR/worktree/merge/cleanup state.
- Existing downstream commands (`issue-to-pr`, `pr-to-merge`) refer to `execute-lane` or a generic lane execution harness, not the old supervisor.
