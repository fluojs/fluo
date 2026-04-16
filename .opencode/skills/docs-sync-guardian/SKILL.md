---
name: docs-sync-guardian
description: fluo 저장소의 EN/KO 문서 쌍, docs hub companion update, docs 관련 CI/tooling enforcement, regression-test evidence를 점검하는 repo-local 문서 동기화 가드 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: docs-governance
  mode: review
  no_co_author: true
  argument-hint: "<pr-url|pr-number> [linked-issue-url|number] [base-branch]"
---

# Docs Sync Guardian Workflow

fluo 저장소의 EN/KO 문서 쌍, docs hub companion update, docs 관련 CI/tooling enforcement, regression-test evidence를 점검하는 repo-local 문서 동기화 가드 스킬이다.

이 스킬은 범용 docs 챗봇이 아니다. **read-only pre-merge gate**로서, 문서가 fluo의 실제 docs governance contract를 만족하는지 확인하고 `pass` / `block` / `needs-human-check` verdict를 낸다.

## Scope

- PR 1개를 입력으로 받는다.
- changed docs surface를 해석한다.
- EN/KO mirror parity를 점검한다.
- docs hub companion update 필요 여부를 점검한다.
- docs 관련 tooling/CI enforcement와 regression-test evidence를 점검한다.
- 최종 verdict를 만든다.

이 스킬은 다음 상황에 사용한다.

- "문서 변경 PR이 docs governance를 통과하는지 봐줘"
- "README / docs sync가 맞는지 중앙 점검해줘"
- "release-governance나 testing-guide 바꿨는데 companion update 빠진 거 없는지 봐줘"

다음 상황에는 사용하지 않는다.

- 일반 기능 코드 리뷰
- 문서 내용 자체를 새로 쓰는 작업
- 구현 변경이 중심인 PR
- branch 생성/수정/merge/cleanup 실행

## Repository-Specific Assumptions

이 저장소에서는 다음을 전제로 한다.

1. docs governance의 canonical checker는 `tooling/governance/verify-platform-consistency-governance.mjs`다.
2. docs regression evidence의 canonical test family는 `packages/testing/src/conformance/platform-consistency-governance-docs.test.ts`다.
3. package/CLI/docs 링크 contract는 다음도 함께 볼 수 있다.
   - `packages/cli/src/runtime-matrix-docs-contract.test.ts`
   - `packages/testing/src/surface.test.ts`
   - `packages/studio/src/contracts.test.ts`
4. PR checklist 기준은 `.github/PULL_REQUEST_TEMPLATE.md`다.
5. docs hub companion pages는 최소 `docs/README.md` / `docs/README.ko.md`다.

## Authority Boundary

- 이 스킬은 **문서 동기화 / 거버넌스 가드**만 담당한다.
- 코드를 수정하지 않는다.
- branch/worktree/PR state를 바꾸지 않는다.
- behavior correctness 자체는 `pr-to-merge` 또는 다른 구현 리뷰 스킬의 책임이다.

## Language Policy

- 이 스킬이 사용자에게 직접 보여주는 모든 문구는 한국어로 작성한다.
- All user-facing communication produced while using this skill must be written in Korean.
- GitHub URL, 브랜치명, 파일 경로, 패키지명, 라벨, 명령어, workflow 이름, 코드 식별자는 원문을 유지한다.
- Raw command output, log output, quoted source text는 번역하지 않는다. 필요하면 별도로 한국어 설명을 붙인다.

## Inputs

가능하면 다음 입력을 받는다.

- PR URL 또는 PR number (필수)
- linked issue URL 또는 issue number (권장)
- base branch (기본값 `main`)
- changed files 목록 (권장)
- CI/checks 상태 (권장)

필수 입력이 부족하거나 changed surface가 불명확하면 **fail closed** 한다.

## What It Owns

이 스킬은 다음을 직접 점검한다.

1. **EN/KO mirror parity**
2. **docs hub companion update**
3. **docs-related CI / tooling enforcement references**
4. **regression-test evidence for contract-bearing docs**

## What It Must Not Own

- runtime behavior correctness 자체
- package architecture correctness 자체
- release publish execution 자체
- broad editorial rewriting
- prose style polishing

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
- current CI/checks 상태

### Phase 3 — Surface classification
changed files를 다음 bucket으로 분류한다.

- governed docs (`docs/operations/*`, `docs/reference/*`, 일부 package README)
- docs hub / companion pages (`docs/README*`, package chooser/surface)
- docs contract tests (`packages/testing/src/conformance/*`, CLI/docs contract tests)
- CI/tooling enforcement (`.github/workflows/*`, `tooling/governance/*`, verifier docs references)

### Phase 4 — Mirror parity check
다음을 우선 본다.

- governed SSOT EN/KO 문서 쌍의 heading structure parity
- section coverage drift
- package lists / publish surface drift
- 서로 참조하는 anchor/link drift

주요 기준 문서:
- `docs/operations/release-governance.md` / `.ko.md`
- `docs/operations/behavioral-contract-policy.md` / `.ko.md`
- `docs/operations/public-export-tsdoc-baseline.md` / `.ko.md`
- `docs/operations/platform-conformance-authoring-checklist.md` / `.ko.md`
- `docs/reference/package-surface.md` / `.ko.md`

### Phase 5 — Companion update check
contract-bearing docs가 바뀌면 companion update도 같이 봐야 한다.

최소 companion surface:
- `docs/README.md`
- `docs/README.ko.md`

필요시 추가 companion surface:
- `docs/reference/package-chooser.md` / `.ko.md`
- package `README.md` / `README.ko.md`
- CLI/toolchain matrix 관련 docs

### Phase 6 — Tooling / CI enforcement check
문서가 말하는 규칙과 실제 CI/tooling이 맞는지 본다.

주요 기준:
- `tooling/governance/verify-platform-consistency-governance.mjs`
- `packages/testing/src/conformance/platform-consistency-governance-docs.test.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/release-single-package.yml`
- `package.json` scripts

### Phase 7 — Regression evidence check
contract-bearing docs 변경은 prose-only로 끝나면 안 된다.

다음 중 적절한 evidence가 같이 있는지 본다.

- docs governance regression test 수정/추가
- related contract test 수정/추가
- CI/workflow enforcement 변경

문서만 바꾸고 아무 evidence도 없으면 기본 verdict는 `block`이다.

### Phase 8 — Synthesis
최종 verdict는 세 가지뿐이다.

- `pass`
- `block`
- `needs-human-check`

판단 기준:

- `pass`
  - mirror parity 문제 없음
  - companion update 문제 없음
  - docs/tooling enforcement와 모순 없음
  - 적절한 regression evidence 있음

- `block`
  - mirror drift
  - docs hub companion 누락
  - tooling/CI enforcement와 문서가 충돌
  - contract-bearing docs인데 regression evidence 없음

- `needs-human-check`
  - docs intent 자체가 바뀌는지 애매함
  - security/legal/translation nuance가 큼
  - 문서 scope가 지나치게 넓어서 단순 sync verdict로 결론 내리기 어려움

### Phase 9 — Report
최종 보고에는 다음을 포함한다.

- `result: verdict=<pass|block|needs-human-check>`
- PR URL
- changed doc surfaces
- missing mirror/companion updates
- missing tooling/CI references
- missing regression evidence

## Key Invariants

이 스킬은 다음 fluo-specific invariant를 우선 보호한다.

1. governed EN/KO docs는 structural parity를 유지해야 한다.
2. release-governance와 package-surface는 같은 publish surface를 설명해야 한다.
3. docs hub는 contract-bearing docs를 discoverable 하게 유지해야 한다.
4. CI/workflow docs는 실제 workflow/job/verifier contract와 맞아야 한다.
5. contract-bearing docs 변경은 regression evidence를 동반해야 한다.

## behavioral contract guardrail

문서화된 behavior와 운영 규칙은 fluo에서 binding contract다.

- `docs/operations/behavioral-contract-policy.md`를 최우선으로 본다.
- package README와 operations docs에 적힌 behavior를 silent narrowing 했으면 `block`이다.
- 문서 변경이 실제 contract change라면 관련 tests/CI/doc companion이 같이 바뀌어야 한다.

## Mandatory Rules

- PR 1개만 다룬다.
- read-only로 동작한다.
- mirror parity를 먼저 보고, 그 다음 companion update를 본다.
- contract-bearing docs 변경에서 evidence가 없으면 `pass`를 주지 않는다.
- tooling/CI 문서가 실제 workflow와 어긋나면 `block`이다.
- prose quality나 스타일 개선을 이유로 scope를 넓히지 않는다.

## Output Contract

- `result: verdict=<pass|block|needs-human-check>`
- PR URL
- changed surfaces
- blockers
- non-blocking notes
- docs hub / mirror / enforcement / evidence 상태 요약

## Example Prompts

- `/docs-sync-guardian https://github.com/fluojs/fluo/pull/123`
- `/docs-sync-guardian 123 456 main`
- `이 docs PR이 mirror sync 맞는지 봐줘`

## Must NOT

- 문서를 직접 수정하지 않는다.
- implementation correctness 전체를 대신 리뷰하지 않는다.
- branch/worktree/PR state를 바꾸지 않는다.
- broad editorial cleanup으로 scope를 넓히지 않는다.
- regression evidence 없는 contract-bearing docs를 승인하지 않는다.
