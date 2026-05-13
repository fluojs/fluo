# OpenCode Validation & Dry-Run Guide

본 문서는 fluo 저장소의 OpenCode 에이전트, 커맨드, 스킬 구조가 프로젝트 불변 정책(Shared Invariants)을 준수하는지 검증하기 위한 가이드를 제공한다.

## 1. 정적 검증 (Static Checks)

새로운 커맨드나 에이전트를 추가/수정했을 때 다음 체크리스트를 확인한다.

### 1.1 필수 파일 및 구조 확인
- [ ] 에이전트 파일이 `.opencode/agents/`에 존재하며 `fluo-` 접두사로 시작하는가?
- [ ] 커맨드 파일이 `.opencode/commands/`에 존재하며 `description`과 `argument-hint`가 포함된 frontmatter를 가지고 있는가?
- [ ] 공유 지식 스킬(Knowledge Skills)이 `.opencode/skills/`에 적절히 위치해 있는가?
- [ ] 6개의 레거시 스킬 스텁(`.opencode/skills/<name>/SKILL.md`)이 `migration_status: compatibility-stub` 및 `replaced_by` 필드를 포함하고 있는가?

### 1.2 권한 및 경계 검증
- [ ] **Reviewer/Guardian/Auditor 에이전트**: frontmatter에 `edit: deny`가 설정되어 있고 `bash` 허용 범위가 `git status|diff|log`, `gh pr view|diff` 등 읽기 전용으로 제한되어 있는가?
- [ ] **Implementer 에이전트**: `edit: ask` 또는 `allow`인 경우에도 `git push`, `git merge`, `npm publish` 등이 `deny` 또는 명시적으로 gating(`ask`)되어 있는가?
- [ ] **Command Harness**: 사용자가 직접 실행하는 `gh issue create`, `gh pr merge`, `npm publish` 등이 하네스 로직에 의해 보호되거나 금지되어 있는가?
- [ ] **명시적 승인**: high-impact side-effect 실행 시 `authority` gate 또는 사용자 컨펌 단계를 거치는가?

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
- `/search-to-issue @fluojs/core` (감사 수행 후 이슈 등록 승인 단계에서 '등록 안 함' 선택)

### 2.2 읽기 전용 모드 (Read-Only Check)
검증용 에이전트(Auditor, Reviewer)를 실행할 때 `edit: deny` 상태에서 실제 파일을 읽고 분석 결과(markdown table 등)가 정상적으로 출력되는지 확인한다.
- `/docs-sync-guardian 123` 실행 시 에이전트가 `edit: deny` 상태에서 분석 보고서만 생성하는지 확인.

### 2.3 릴리스 플랜 모드 (Plan-Only Mode)
`package-publish` 실행 시 `plan` 모드를 사용하여 실제 릴리스 없이 절차만 시뮬레이션한다.
- `/package-publish plan @fluojs/core 1.0.0-beta.1 beta`

---

## 3. 금지 사항 (Prohibited for Validation)

다음 작업은 검증 과정에서 **절대** 수행하지 않는다.
- 실제 `gh issue create` 또는 `gh pr merge` 실행 (사용자 승인 단계에서 중단)
- 실제 `npm publish` 또는 `pnpm changeset publish` 실행
- GitHub Actions workflow의 실제 `dispatch` 또는 `rerun`
- 공유 브랜치(`main`)의 직접적인 cleanup 또는 삭제
- 드라이런 중 실제 branch 생성 또는 worktree 추가 (상태 변경 방지)

---

## 4. 검증 방법 (Validation Methods)

```bash
# 에이전트 권한 설정 확인 (grep 이용)
grep -r "edit: deny" .opencode/agents/

# 커맨드-에이전트 참조 일치 확인
grep -r "fluo-" .opencode/commands/

# 레거시 스텁 상태 확인
grep -r "migration_status: compatibility-stub" .opencode/skills/

# LSP diagnostics (프로젝트 내 도구 이용)
# 에디터의 LSP 기능을 이용하거나, OpenCode의 lsp_diagnostics 도구를 사용하여 
# .opencode/ 내의 모든 markdown 파일에 에러가 없는지 확인한다.
```

검증 중 발견된 특이 사항이나 아키텍처 결정은 `.sisyphus/notepads/` 아래 적절한 파일에 기록한다.
