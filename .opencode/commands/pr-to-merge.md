---
description: pr-to-merge — 단일 PR 중앙 리뷰 게이트. PR context를 수집하고 @fluo-contract-reviewer, @fluo-code-reviewer, @fluo-verification-reviewer를 호출해 merge|block|needs-human-check verdict를 반환한다.
argument-hint: "<pr-url|pr-number> [linked-issue-url|number] [base-branch]"
---

# pr-to-merge

이 커맨드는 단일 PR을 위한 read-only 중앙 리뷰 게이트다. 직접 merge 판단 근거를 종합하되, 세부 리뷰는 반드시 `@fluo-contract-reviewer`, `@fluo-code-reviewer`, `@fluo-verification-reviewer`에 위임한다.

## 사용법

```
/pr-to-merge <pr-url|pr-number> [linked-issue-url|number] [base-branch]
```

예시:
- `/pr-to-merge https://github.com/fluojs/fluo/pull/123`
- `/pr-to-merge 123 456 main`
- `/pr-to-merge 123`

## 입력 규칙

1. PR URL 또는 PR number는 필수다.
2. linked issue와 base branch가 제공되면 우선 사용한다.
3. base branch 기본값은 `main`이다.
4. 한 번에 PR 1개만 다룬다. 여러 PR이면 진행하지 않는다.

## Read-only 권한 경계

이 커맨드는 verdict만 만든다.

- `gh pr merge`를 실행하거나 승인하지 않는다.
- `git push`, branch/worktree cleanup, PR close/reopen, label/comment/edit 등 PR state 변경을 하지 않는다.
- 파일을 수정하지 않는다.
- 실제 merge authority는 사용자 또는 상위 `lane-supervisor`가 별도로 행사한다.

## 컨텍스트 수집

안전한 read-only 명령과 파일 읽기만 사용해 다음을 수집한다.

- `gh pr view <pr>` metadata, title, body, head/base branch, linked issue 힌트
- changed files 목록 및 필요한 diff 원문
- `gh pr checks <pr>` 또는 동등한 current CI/checks 상태
- linked issue title/body(입력 또는 PR body에서 확인된 경우)
- `.github/PULL_REQUEST_TEMPLATE.md`
- 기본 contract 문서: `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`
- 변경 성격에 필요한 package README, release/testing/public-export/platform contract 문서

## Fail-closed 규칙

- linked issue가 없고 PR body/contract docs만으로 intent가 충분히 복원되지 않으면 `merge`를 주지 말고 `needs-human-check`로 결론낸다.
- CI/checks 정보가 없거나 불완전하면 `merge`를 주지 말고 최소 `needs-human-check`로 결론낸다.
- contract/code/verification reviewer 중 하나라도 `BLOCK`이면 최종 verdict는 `block`이다.
- security/privacy ambiguity, unusual release tradeoff, cross-lane impact는 `needs-human-check`로 escalate 한다.

## 에이전트 위임

아래 3개 reviewer를 모두 명시적으로 호출한다. 하나라도 누락되면 `merge` verdict를 낼 수 없다.

```
@fluo-contract-reviewer

TASK: 단일 PR의 linked issue intent, contract docs, PR template axes, release governance 정합성을 read-only로 검토한다.
EXPECTED OUTCOME: verdict_signal: PASS | BLOCK | NEEDS-HUMAN-CHECK 형식의 Contract Review 결과.
REQUIRED TOOLS: read, grep, glob, 허용된 read-only gh/git 명령.
MUST DO: linked issue, `.github/PULL_REQUEST_TEMPLATE.md`, 관련 contract docs와 changed package docs를 근거로 판단한다.
MUST NOT DO: 파일 수정, branch/PR state 변경, merge, push, cleanup을 하지 않는다.
CONTEXT: PR=<pr-url-or-number>; linked issue=<issue-url-or-number | 없음>; base branch=<base-branch>; changed files=<수집한 목록>; checks=<수집한 요약>.
```

```
@fluo-code-reviewer

TASK: 단일 PR의 changed files를 read-only로 검토해 correctness, architecture fit, package boundary, scope discipline 위험을 찾는다.
EXPECTED OUTCOME: verdict_signal: PASS | BLOCK | NEEDS-HUMAN-CHECK 형식의 Code Review 결과.
REQUIRED TOOLS: read, grep, glob, 허용된 read-only gh/git 명령.
MUST DO: 실제 diff와 주변 코드를 근거로 concrete finding만 보고한다.
MUST NOT DO: 파일 수정, branch/PR state 변경, merge, push, cleanup을 하지 않는다.
CONTEXT: PR=<pr-url-or-number>; linked issue=<issue-url-or-number | 없음>; base branch=<base-branch>; changed files=<수집한 목록>; intent summary=<수집한 요약>.
```

```
@fluo-verification-reviewer

TASK: 단일 PR의 CI/checks, canonical verifier 사용, regression evidence를 read-only로 검토한다.
EXPECTED OUTCOME: verdict_signal: PASS | BLOCK | NEEDS-HUMAN-CHECK 형식의 Verification Review 결과.
REQUIRED TOOLS: read, grep, glob, 허용된 read-only gh/git 명령.
MUST DO: checks 존재/통과 여부와 변경 성격에 맞는 검증 근거를 확인한다.
MUST NOT DO: 파일 수정, branch/PR state 변경, merge, push, cleanup을 하지 않는다.
CONTEXT: PR=<pr-url-or-number>; linked issue=<issue-url-or-number | 없음>; base branch=<base-branch>; checks=<수집한 상태>; changed files=<수집한 목록>.
```

## Synthesis

직접 수집한 context와 세 reviewer 결과를 종합해 최종 verdict를 정확히 하나만 반환한다.

허용 verdict set:

```
merge | block | needs-human-check
```

- `merge`: 세 reviewer가 모두 `PASS`이고, linked issue/contract/PR template/checks가 충분하다.
- `block`: 명확한 correctness, contract, release governance, verification hole이 있다.
- `needs-human-check`: intent/CI/security/release/cross-lane 판단이 불명확하거나 사람이 정책 판단해야 한다.

## 출력 계약

최종 응답은 한국어로 작성하고 아래 항목을 포함한다.

- `result: verdict=<merge|block|needs-human-check>`
- PR URL 또는 PR number
- linked issue
- summary
- blockers
- non-blocking notes
- `merge only if...`
