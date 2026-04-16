---
name: pr-to-merge
description: lane-supervisor가 만든 단일 PR을 중앙 게이트로 검토하고, 3개 고정 서브에이전트 리뷰를 수집해 merge/block/needs-human-check verdict를 내리는 fluo repo-local 리뷰 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: code-review
  mode: execution
  no_co_author: true
  argument-hint: "<pr-url|pr-number> [linked-issue-url|number] [base-branch]"
---

# PR-to-Merge Workflow

lane-supervisor 또는 maintainers가 만든 **단일 PR**을 중앙 게이트로 검토하고, 3개 고정 서브에이전트 리뷰를 수집해 `merge` / `block` / `needs-human-check` verdict를 내리는 fluo repo-local 리뷰 스킬이다.

이 스킬은 범용 리뷰 봇이 아니다. **branch 생성, 코드 수정, 머지 실행 없이**, PR의 변경 내용과 검증 상태를 읽고 추가 리뷰를 수행하는 **read-only gate**다.

## Scope

- PR 1개를 입력으로 받는다.
- linked issue와 base branch를 함께 받으면 우선 사용한다.
- PR metadata, changed files, CI 상태, contract docs를 읽는다.
- 3개 고정 reviewer 역할의 서브에이전트를 실행한다.
- supervisor가 merge 전에 참고할 최종 verdict를 만든다.

이 스킬은 다음 상황에 사용한다.

- "이 PR을 중앙 리뷰 게이트로 검토해줘"
- "lane-supervisor PR merge 전에 코드리뷰를 더 돌려줘"
- "이 PR이 merge 가능한지 verdict만 줘"

다음 상황에는 사용하지 않는다.

- 일반 ad-hoc 코드 설명
- 코드 수정이 필요한 구현 작업
- 여러 PR을 한 번에 리뷰하는 경우
- branch 생성/merge/cleanup 실행

## Repository-Specific Assumptions

이 저장소에서는 다음을 전제로 한다.

1. PR은 보통 worktree branch에서 왔고, base branch 기본값은 `main`이다.
2. package/runtime/tooling behavior는 문서 경계의 일부이며, contract doc이 있으면 코드보다 문서 해석이 우선한다.
3. `.github/PULL_REQUEST_TEMPLATE.md`의 review axes는 중앙 게이트의 기준이다.
4. release/tooling/CI 변경은 `docs/operations/release-governance.md`와 `docs/operations/testing-guide.md`와 정합해야 한다.
5. 이 스킬은 **read-only gate**이므로 코드, branch, PR state를 변경하지 않는다.

## Authority Boundary

- 이 스킬은 **verdict만** 만든다.
- merge / close / cleanup / push / code edit는 수행하지 않는다.
- 상위 `lane-supervisor` 또는 사용자가 이 verdict를 받아 실제 merge authority를 행사한다.

## Language Policy

- 이 스킬이 사용자에게 직접 보여주는 모든 문구는 한국어로 작성한다.
- All user-facing communication produced while using this skill must be written in Korean.
- GitHub URL, 브랜치명, 파일 경로, 패키지명, 라벨, 명령어, workflow 이름, 코드 식별자는 원문을 유지한다.
- Raw command output, log output, quoted source text는 번역하지 않는다. 필요하면 별도로 한국어 설명을 붙인다.

## Inputs

이 스킬은 가능한 한 아래 정보를 입력으로 받는다.

- PR URL 또는 PR number (필수)
- linked issue URL 또는 issue number (권장)
- base branch (기본값 `main`)

다음 정보가 있으면 reviewer 품질이 좋아진다.

- changed files 목록
- branch/worktree 정보
- CI status
- contract doc path

필수 입력이 부족하면 **추측하지 말고 fail closed** 한다.

- linked issue가 없고 PR body/contract docs만으로도 intent가 충분히 복원되지 않으면 기본 verdict는 `needs-human-check`다.
- CI/checks 정보가 비어 있으면 `merge`를 주지 않는다.

## Fixed Review Roles

각 PR에 대해 **반드시 3개 고정 reviewer 역할**을 사용한다. 역할은 서로 겹치지 않게 유지한다.

### 1. Contract reviewer
- 담당 범위:
  - linked issue intent
  - package README / README.ko.md
  - `docs/operations/behavioral-contract-policy.md`
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - 필요 시 release/testing/public-export/platform docs
- 중점 질문:
  - 변경이 문서화된 contract와 맞는가?
  - documented limitation이나 supported behavior를 silent narrowing 했는가?
  - docs/test 동반 갱신이 필요한데 빠지지 않았는가?

### 2. Code reviewer
- 담당 범위:
  - changed files 원문
  - architecture fit
  - local consistency
  - correctness / edge-case logic
- 중점 질문:
  - 구현이 이슈 intent를 제대로 만족하는가?
  - 레이어 경계나 package boundary를 어기지 않는가?
  - 변경이 unnecessarily broad 하거나 더 작은 수정으로 해결 가능한데 과하게 건드리지 않았는가?

### 3. Verification reviewer
- 담당 범위:
  - PR checks
  - tests/build/typecheck diagnostics
  - verifier usage
  - missing regression evidence
- 중점 질문:
  - PR가 실제로 충분히 검증됐는가?
  - 변경 종류에 맞는 canonical verifier를 썼는가?
  - CI가 missing/unstable/irrelevant 상태는 아닌가?

## Workflow

### Phase 1 — Intake
1. PR URL/번호를 해석한다.
2. linked issue와 base branch를 해석한다.
3. 입력이 부족하면 여기서 fail closed 한다.

### Phase 2 — PR context collection
반드시 다음을 수집한다.

- `gh pr view <pr>` 메타데이터
- changed files 목록
- PR body
- linked issue title/body (있으면)
- current CI/checks 상태

### Phase 3 — Contract/document scope mapping
PR 성격에 따라 아래 문서를 읽는다.

기본 공통 문서:
- `CONTRIBUTING.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/operations/behavioral-contract-policy.md`

변경별 보강 문서:
- package/runtime 변경: affected `packages/*/README.md`, 필요 시 `README.ko.md`
- release/tooling/CI 변경:
  - `docs/operations/release-governance.md`
  - `docs/operations/testing-guide.md`
  - `docs/reference/toolchain-contract-matrix.md`
- public export/docs 변경:
  - `docs/operations/public-export-tsdoc-baseline.md`
- platform/runtime consistency 변경:
  - `docs/operations/platform-conformance-authoring-checklist.md`

### Phase 4 — Direct gate review
서브에이전트 실행 전에도 반드시 직접 확인한다.

1. changed files 원문을 읽는다.
2. PR body가 `.github/PULL_REQUEST_TEMPLATE.md` 축을 실질적으로 반영하는지 본다.
3. linked issue intent와 변경 범위가 맞는지 본다.
4. CI/checks 상태를 확인한다.

### Phase 5 — Subagent fan-out
반드시 3개 고정 reviewer를 배경 또는 동기 서브에이전트로 실행한다.

- Contract reviewer
- Code reviewer
- Verification reviewer

각 프롬프트는 반드시 6개 섹션을 따른다.

1. TASK
2. EXPECTED OUTCOME
3. REQUIRED TOOLS
4. MUST DO
5. MUST NOT DO
6. CONTEXT

### Phase 6 — Synthesis
세 reviewer 결과와 직접 검토를 합쳐 최종 verdict를 만든다.

허용 verdict는 세 가지뿐이다.

- `merge`
- `block`
- `needs-human-check`

판단 기준:

- `merge`
  - contract/code/verification reviewer 모두 blocking issue 없음
  - changed files와 PR body가 contract를 충족
  - checks/verification이 merge gate 기준을 충족

- `block`
  - 명확한 correctness / contract / verification hole이 있음
  - fix-back 없이 merge하면 안 됨

- `needs-human-check`
  - contract ambiguity
  - missing CI
  - cross-lane impact
  - unusual release/security/behavior tradeoff

### Phase 7 — Report
최종 보고에는 다음을 포함한다.

- `result: verdict=<merge|block|needs-human-check>`
- PR URL
- linked issue
- summary
- blockers
- non-blocking notes
- `merge only if...` 조건 목록

## behavioral contract guardrail

fluo에서 contract doc은 단순 참고가 아니라 merge gate의 일부다.

- contract doc이 있으면 코드보다 그 문서 intent를 우선한다.
- 문서화된 behavior를 silent narrowing 했으면 기본 verdict는 `block`이다.
- docs/test 동반 갱신이 필요한 변경에서 빠졌으면 기본 verdict는 `block`이다.
- security/privacy ambiguity가 있으면 `needs-human-check`로 escalate 한다.

## Mandatory Rules

- PR 1개만 다룬다.
- read-only로 동작한다.
- branch 생성/수정/merge/cleanup을 수행하지 않는다.
- 계약 문서와 linked issue를 읽기 전에는 verdict를 내리지 않는다.
- 3개 고정 reviewer 역할을 바꾸지 않는다.
- CI/checks가 없거나 불완전하면 추측으로 `merge` 주지 않는다.
- verdict는 반드시 `merge`, `block`, `needs-human-check` 중 하나여야 한다.

## Output Contract

- `result: verdict=<merge|block|needs-human-check>`
- PR URL
- issue
- blockers (있으면)
- non-blocking notes
- merge only if...

## Example Prompts

- `/pr-to-merge https://github.com/fluojs/fluo/pull/123`
- `lane PR #123 중앙 리뷰 게이트 돌려줘`

## Must NOT

- 코드를 수정하지 않는다.
- branch/worktree/PR state를 바꾸지 않는다.
- linked issue intent 없이 PR만 보고 의미를 지어내지 않는다.
- contract doc이 있는데 코드만 보고 merge verdict를 내리지 않는다.
- 3개 reviewer 중 하나라도 빠뜨리고 승인하지 않는다.
