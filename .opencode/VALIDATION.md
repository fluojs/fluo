# OpenCode Validation & Dry-Run Guide

본 문서는 fluo 저장소의 OpenCode 에이전트, 커맨드, 스킬 구조가 프로젝트 불변 정책(Shared Invariants)과 strict canonical v1 lane ledger 계약을 준수하는지 검증하기 위한 가이드를 제공한다.

## 1. 정적 검증 (Static Checks)

새로운 커맨드나 에이전트를 추가/수정했을 때 다음 체크리스트를 확인한다.

### 1.1 필수 파일 및 구조 확인
- [ ] 에이전트 파일이 `.opencode/agents/`에 존재하며 `fluo-` 접두사로 시작하는가?
- [ ] 커맨드 파일이 `.opencode/commands/`에 존재하며 `description`과 `argument-hint`가 포함된 frontmatter를 가지고 있는가?
- [ ] 공유 지식 스킬(Knowledge Skills)이 `.opencode/skills/fluo-*/SKILL.md`에만 남아 있는가?
- [ ] command와 같은 이름의 legacy skill entrypoint가 없는가? (`create-lane`, `execute-lane`, `issue-to-pr`, `pr-to-merge`, `search-issue`, `docs-sync-guardian`)

### 1.2 권한 및 경계 검증
- [ ] **Reviewer/Guardian/Auditor 에이전트**: frontmatter에 `edit: deny`가 설정되어 있고 `bash` 허용 범위가 `git status|diff|log`, `gh pr view|diff` 등 읽기 전용으로 제한되어 있는가?
- [ ] **Implementer 에이전트**: `edit: ask` 또는 `allow`인 경우에도 `git push`, `git merge`, `npm publish` 등이 `deny` 또는 명시적으로 gating(`ask`)되어 있는가?
- [ ] **Command Harness**: 사용자가 직접 실행하는 `gh issue create`, `gh pr merge`, `npm publish` 등이 하네스 로직에 의해 보호되거나 금지되어 있는가?
- [ ] **명시적 승인/Authority**: high-impact side-effect 실행 시 command harness `authority` gate, registration triage, 또는 사용자 컨펌 단계를 거치는가?
- [ ] **Full-auto 권한**: `execute-lane --full-auto`처럼 full-auto mode가 있다면 lane ledger에 `authority_scope.pr_merge=true`와 `pr_merge_method="squash"`를 기록하고, child command `block`/unresolved `needs-human-check`, local publish, dirty cleanup/root sync를 우회하지 않는가?
- [ ] **Developer-final 권한**: `merge_policy: developer-final`이면 `authority_scope.pr_merge=true`여도 `gh pr merge` 직전 사용자 또는 상위 harness의 explicit approval을 요구하고, 없으면 `needs-human-check-terminal`로 멈추는가?
- [ ] **Lane-local progress**: `execute-lane`이 여러 unlocked lane을 dispatch하더라도 global batch barrier 없이 먼저 완료된 lane item부터 PR collection, `/pr-to-merge`, fix-back/merge gate를 진행한다고 명시하고, 완료 알림 수신 시 `background_output` 수집 → ledger item 업데이트 → `/pr-to-merge` → verdict 처리 → fix-back/merge gate 순서를 즉시 수행하도록 고정하는가?

### 1.3 불변 정책 준수 (root AGENTS.md)
- [ ] 모든 출력물에 **Korean First** 정책이 적용되었는가? (기술 식별자 제외)
- [ ] 로컬 `npm publish` 명령어가 실행되거나 권장되지 않는가? (GitHub Actions 전용)
- [ ] 모든 구현 작업이 `.worktrees/` 디렉토리 내에서 수행되도록 설계되었는가?
- [ ] 커맨드 파일에서 적절한 에이전트(@fluo-*)나 스킬을 참조하고 있는가?

---

## 2. 안전 드라이런 (Safe Dry-Run) 시나리오

실제 GitHub이나 npm에 영향을 주지 않고 로직을 검증하는 방법이다.

### 2.1 가짜 PR/이슈 참조 (Fake References)
실제 이슈나 PR 번호 대신 존재하지 않는 번호를 사용하여 에이전트의 데이터 수집 및 분석 단계(Error handling 포함)를 확인한다.
- `/pr-to-merge 9999` (존재하지 않는 PR 번호로 에러 핸들링 및 읽기 시도 확인)
- `/issue-to-pr 8888` (인자 파싱 및 컨텍스트 수집 단계까지만 확인. **실제 branch 생성이나 `git worktree add` 직전에 중단**)
- `/search-issue` (무인자 호출 직후 감사 범위/목적 question gate가 먼저 뜨는지 확인하고, 감사 수행 후 registration triage가 `register/defer/reject`를 산출하는지 확인. 실제 등록은 dry-run/mock 또는 `register` 0건 시나리오로만 검증)
- `/create-lane 8888` (존재하지 않는 issue로 read-only 조회 실패와 side-effect 없는 중단 확인)
- `/execute-lane missing-lane-id` (존재하지 않는 lane ledger로 error handling 확인)

### 2.2 읽기 전용 모드 (Read-Only Check)
검증용 에이전트(Auditor, Reviewer)를 실행할 때 `edit: deny` 상태에서 실제 파일을 읽고 분석 결과(markdown table 등)가 정상적으로 출력되는지 확인한다.
- `/docs-sync-guardian 123` 실행 시 에이전트가 `edit: deny` 상태에서 분석 보고서만 생성하는지 확인.

### 2.3 릴리스 handoff 모드 (Release Handoff Check)
release/publish 자체가 목표인 lane item은 OpenCode command가 publish를 실행하지 않고 GitHub Actions Changesets workflow로 handoff하는지 확인한다.
- `/execute-lane missing-lane-id` (존재하지 않는 ledger로 error handling만 확인하고, 실제 release workflow를 trigger하지 않음)

### 2.4 Full-auto 드라이런 (Authority Scope Check)
`execute-lane --full-auto`는 실제 side effect가 발생하지 않는 가짜 lane ledger와 dry-run 전제에서만 검증한다. lane ledger에 `authority_scope.pr_merge=true`, `pr_merge_method="squash"`, `retry_policy`, `execution` 상태가 기록되고, child command verdict가 `block` 또는 unresolved `needs-human-check`이면 merge/publish로 넘어가지 않는지 확인한다.
- `/execute-lane missing-lane-id --full-auto main` (존재하지 않는 ledger로 authority scope와 error handling만 확인)

### 2.5 Lane-local progress contract check

여러 lane을 동시에 dispatch하는 경우에도 모든 `/issue-to-pr` child 완료를 기다리는 전역 barrier가 없어야 한다. 먼저 완료된 lane item은 해당 lane item 단위로 ledger에 반영되고 즉시 `/pr-to-merge`로 넘어가야 한다.

- `.opencode/commands/execute-lane.md`에 `Per-lane progress, no global batch barrier` 섹션이 있는지 확인한다.
- `.opencode/commands/execute-lane.md`에 `Execution loop invariant`, `Background completion event handling`, `developer-final approval gate` 섹션이 정확한 heading으로 있는지 확인한다.
- `.opencode/commands/create-lane.md`에 `Human gates`, `Merge authority and method`, `Lane planning rules`, `Creation gates`, `Output contract` 섹션이 있는지 확인한다.
- `Child completion barrier`는 해당 child/lane item의 완료 보고를 요구하는 lane-local barrier로만 해석되고, 전체 lane batch join으로 해석되지 않는지 확인한다.

### 2.6 Canonical v1 ledger validation

검증은 실행 전에 immutable preflight로 시작한다. 원본 persistence ledger를 읽기 전용으로 열고 candidate snapshot을 별도 경로에 만든 뒤, 원본과 candidate의 identity 및 변경 여부를 기록한다. 원본 ledger, persistence store, 또는 실제 작업 상태를 자동으로 수정하는 migration은 검증으로 인정하지 않는다.

Preflight는 다음을 모두 확인한다.

- ledger `version`이 `1`이고, `run_id`, `merge_policy`, `authority_scope`, `confirmed_issues`, `completed_issues`, `lanes`가 존재한다.
- `authority_scope.pr_merge`가 정확히 `true`이고 `pr_merge_method`가 정확히 `squash`다. 누락되거나 다른 값이면 merge를 추정하지 않는다.
- `retry_policy`, `execution`, `release_handoffs`, `root_main_sync` metadata가 모두 필수이며 이름, 값, status를 그대로 보존한다. retry count, authority, execution status, release handoff status를 migration 중에 재설정하지 않는다.
- `source`가 exact `{type, search_run_id, search_ledger}`인지 확인한다. `search-issue`의 `search_run_id`는 source-only grammar `[A-Za-z0-9][A-Za-z0-9+._-]*`를 사용해 내부 `+`를 허용하고, `search_ledger`는 exact `.sisyphus/search-issue/<search_run_id>.json`이어야 한다. `run_id`와 `lane_id`에는 `+`를 허용하지 않는다.
- search artifact가 exact `{version: 1, search_run_id, selected_issues}`인지 확인한다. ID와 `.sisyphus/search-issue/<search_run_id>.json` path가 일치하고 `selected_issues`가 non-empty unique positive-safe-integer array인지 검증한다. Producer는 complete sibling temporary file을 검증한 뒤 exclusive same-filesystem atomic create를 사용하며 existing target을 덮어쓰지 않는다.
- `dependency_graph` key는 confirmed positive-safe-integer issue이고 value는 unique positive-safe-integer prerequisite array인지 확인한다. External prerequisite는 value에 허용하지만 duplicate, self dependency, cycle은 거부한다.
- candidate snapshot과 모든 ledger, worktree 경로의 symlink를 확인하고 `realpath`를 계산한다. path 문자열만으로 동일성을 주장하지 않는다.
- branch와 worktree가 실제 repository membership에 속하고 ledger의 branch/path와 일치하는지 확인한다. command-owned가 아닌 worktree는 삭제 대상으로 취급하지 않는다.
- root worktree의 `git symbolic-ref --short HEAD`가 ledger의 base branch와 일치하는지 확인한다. dirty root에서는 root sync를 수행하지 않는다.
- completed issue마다 flat `issue_progress` evidence가 있고, `review_verdict: merge`, `checks: PASS`, exact reviewer `reviewers.contract: PASS`, `reviewers.code: PASS`, `reviewers.verification: PASS`, 40-character lowercase `merge_commit`, `issue_state: CLOSED`가 모두 확인된다. Nested merge or issue records are invalid.
- non-completion progress는 `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, `blockers`만 허용한다. `merged`는 completion evidence를 추가하지만 cleanup은 금지하고, `done`만 cleanup을 추가한다. Post-merge cleanup failure의 `blocked-terminal`만 complete merged evidence를 보존할 수 있다.
- release handoff는 ready일 때 dedicated single-issue queued lane과 absent progress를 사용하고, non-ready일 때 lane/progress가 모두 `blocked-maintainer-decision`이며 branch/worktree/PR dispatch identity가 없어야 한다.
- `cleanup`은 authority가 있을 때 정확히 `{status: done, worktree_removed: true, local_branch_deleted: true, remote_branch_deleted: true}`, authority가 없을 때 정확히 `{status: skipped-authority}`만 허용한다. realpath, repository/worktree membership, dirty-state는 live execution gates이며 cleanup object fields가 아니다.

Status evidence matrix:

| status | required evidence | queue effect |
| --- | --- | --- |
| `running` | safe branch와 matching worktree; PR은 null 가능 | current issue만 active |
| `in_review` | running identity, canonical PR, non-empty verification | current issue만 active |
| `merged` | complete merged evidence, no cleanup | issue는 completed지만 next issue는 locked |
| post-merge `blocked-terminal` | null lane dispatch identity, complete merged evidence, no cleanup, unresolved non-fix-back blocker | issue는 completed에 남고 later issue는 absent/queued |
| `done` | complete merged evidence와 exact cleanup variant | next issue advance 가능 |

서로 다른 issue는 같은 non-null branch, worktree, PR identity를 공유할 수 없다. 같은 current issue의 lane/progress mirror는 동일 assignment로 취급한다.

Legacy completion evidence가 이 shape를 충족하지 않으면 `migrate legacy completion evidence to canonical issue_progress`로 실패해야 한다. 이는 버전 bump나 legacy compatibility shim을 허용하지 않는 의도된 실패다. 실제 persistence ledger는 migration evidence로 일부러 failing 상태를 유지하며 자동 수정하지 않는다.

Committed fixtures under `tooling/governance/fixtures/lane-ledger/` are the passing source of truth. Run the standalone verifier with any arbitrary read-only path, including a copied candidate outside the repository:

```bash
node tooling/governance/verify-lane-ledger.mjs -- /absolute/path/to/candidate.json
```

The verifier must not require a repository-relative path, mutate the input, or write a migration result.

---

## 3. 금지 사항 (Prohibited for Validation)

다음 작업은 검증 과정에서 **절대** 수행하지 않는다.
- 실제 `gh issue create` 또는 `gh pr merge` 실행 (dry-run에서는 registration triage 또는 authority gate 직전/0건 시나리오에서 중단)
- 실제 `npm publish` 또는 `pnpm changeset publish` 실행
- GitHub Actions workflow의 실제 `dispatch` 또는 `rerun`
- 공유 브랜치(`main`)의 직접적인 cleanup 또는 삭제
- 드라이런 중 실제 branch 생성 또는 worktree 추가 (상태 변경 방지)
- full-auto 드라이런에서 실제 `gh issue create`, `gh pr merge`, cleanup, root sync 수행
- `execute-lane` 드라이런/구현에서 모든 lane worker 완료를 기다린 뒤 PR collection 또는 `/pr-to-merge`를 일괄 시작하는 global batch barrier 구성

---

## 4. 검증 방법 (Validation Methods)

```bash
# 에이전트 권한 설정 확인 (grep 이용)
grep -r "edit: deny" .opencode/agents/

# 커맨드-에이전트 참조 일치 확인
grep -r "fluo-" .opencode/commands/

# command를 shadowing하는 legacy skill entrypoint가 없는지 확인
test ! -f .opencode/skills/lane-supervisor/SKILL.md
test ! -f .opencode/skills/create-lane/SKILL.md
test ! -f .opencode/skills/execute-lane/SKILL.md
test ! -f .opencode/skills/issue-to-pr/SKILL.md
test ! -f .opencode/skills/pr-to-merge/SKILL.md
test ! -f .opencode/skills/search-to-issue/SKILL.md
test ! -f .opencode/skills/search-issue/SKILL.md
test ! -f .opencode/skills/docs-sync-guardian/SKILL.md
test ! -f .opencode/skills/package-publish/SKILL.md
test ! -f .opencode/commands/package-publish.md

# knowledge skill만 남았는지 확인
find .opencode/skills -name SKILL.md

# LSP diagnostics (프로젝트 내 도구 이용)
# 에디터의 LSP 기능을 이용하거나, OpenCode의 lsp_diagnostics 도구를 사용하여 
# .opencode/ 내의 모든 markdown 파일에 에러가 없는지 확인한다.
```

검증 결과와 migration evidence는 명령 실행 결과, candidate snapshot, 또는 검증 시스템이 지정한 read-only 산출물로 남긴다. 존재하지 않는 별도 notepad 경로를 만들거나 안내하지 않는다.

## 5. Strict v1 focused gate

The focused suite has exactly five TEST files and 363 tests, including `verify-lane-ledger-schema.test.ts`. `lane-ledger-schema.mjs` owns root/source/lane shape validation, `lane-ledger-progress-schema.mjs` owns status-specific progress key validation, and `lane-ledger-dependency.mjs` owns dependency graph validation. These implementation modules are not counted as test files:

```bash
pnpm exec vitest run tooling/governance/verify-lane-ledger.test.ts tooling/governance/verify-lane-ledger-state.test.ts tooling/governance/verify-lane-ledger-progress.test.ts tooling/governance/verify-lane-ledger-identity.test.ts tooling/governance/verify-lane-ledger-schema.test.ts
```

Migration fails closed for missing identity/source, unknown keys, nested legacy evidence, non-prefix queues, one-sided identity or retry values, status-incompatible completion evidence, invalid dependency graphs, non-done cleanup, and completed or merged release handoffs. Do not describe producer provenance as exempt from exact-key validation.
