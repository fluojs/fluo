# OpenCode Validation & Dry-Run Guide

본 문서는 fluo 저장소의 OpenCode 에이전트, 커맨드, 스킬 구조가 프로젝트 불변 정책(Shared Invariants)을 준수하는지 검증하기 위한 가이드를 제공한다.

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

- `.opencode/commands/execute-lane.md`와 `.codex/commands/execute-lane.md`에 `Per-lane progress, no global batch barrier` 섹션이 있는지 확인한다.
- `Child completion barrier`는 해당 child/lane item의 완료 보고를 요구하는 lane-local barrier로만 해석되고, 전체 lane batch join으로 해석되지 않는지 확인한다.

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

검증 중 발견된 특이 사항이나 아키텍처 결정은 `.sisyphus/notepads/` 아래 적절한 파일에 기록한다.
