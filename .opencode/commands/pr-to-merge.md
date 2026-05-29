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

## Reviewer read-only allowlist

`@fluo-contract-reviewer`, `@fluo-code-reviewer`, `@fluo-verification-reviewer`는 같은 PR을 반복 검토할 때 아래 read-only 명령을 frontmatter permission에서 사전 허용해야 한다. 새 reviewer 권한을 추가할 때도 이 목록을 우선 갱신해 동일한 PR에서 같은 권한을 반복 요청하지 않도록 한다.

- `gh pr view*`, `gh pr diff*`, `gh pr checks*`, `gh run view*`
- `gh issue view*`, `gh issue list*`, `gh label list*`
- `git status*`, `git diff*`, `git log*`, `git show*`, `git ls-files*`
- `GIT_MASTER=1 git status*`, `GIT_MASTER=1 git diff*`, `GIT_MASTER=1 git log*`, `GIT_MASTER=1 git show*`, `GIT_MASTER=1 git ls-files*`
- `sort*`

Mutating commands such as `gh pr merge*`, `gh pr review*`, `gh pr edit*`, `gh issue comment*`, `gh run cancel*`, `gh run rerun*`, `git push*`, branch/worktree cleanup, and label mutation stay denied or unlisted.

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
- contract/code/verification reviewer 중 하나라도 `BLOCK`이면 최종 verdict는 `block`이다. 이때 `block`은 caller가 remediation에 사용할 수 있는 actionable input이어야 하며, 상위 `lane-supervisor`에게는 그 자체로 lane terminal 상태를 의미하지 않는다.
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
- `block`: 명확한 correctness, contract, release governance, verification hole이 있다. 이 verdict는 caller가 같은 PR/branch/worktree에서 보정할 수 있는 actionable remediation input이며, 그 자체로 `lane-supervisor`의 terminal lane 상태를 의미하지 않는다.
- `needs-human-check`: intent/CI/security/release/cross-lane 판단이 불명확하거나 사람이 정책 판단해야 한다.

`block` verdict를 반환할 때는 상위 caller가 bounded fix-back loop를 수행할 수 있도록 blocker마다 stable signature, evidence, expected fix target을 포함한다. `needs-human-check`는 code/docs/test 수정만으로 해소할 수 없는 정책 판단, 권한 문제, 또는 불충분한 intent에 사용한다.

`block` verdict는 read-only gate의 결론일 뿐이며 branch/worktree/PR state를 변경하지 않는다. caller가 `lane-supervisor`이면 fixable blocker를 `/issue-to-pr --fix-back` 또는 동일 계약 worker에 전달해 같은 PR을 재검토해야 한다. maintainer 결정, scope 재정의, security/privacy 판단처럼 worker가 해결할 수 없는 blocker만 terminal escalation 후보가 된다.

## 출력 계약

최종 응답은 한국어로 작성하고 아래 항목을 포함한다.

- `result: verdict=<merge|block|needs-human-check>`
- PR URL 또는 PR number
- linked issue
- summary
- blockers
- blocker signatures: `<file-or-contract>:<reason>:<required-remediation>` 형식으로 가능한 한 구체적으로 작성
- non-blocking notes
- `merge only if...`

`blockers` 항목은 다음 형태를 따른다.

```yaml
blockers:
  - reviewer: <contract|code|verification>
    signature: <stable blocker identifier>
    evidence: <file/check/doc evidence>
    expected fix target: <code|tests|docs|changeset|ci-evidence|human-policy-decision>
    fix_back_eligible: <true|false>
```

`fix_back_eligible: false`는 maintainer 결정, scope 재정의, security/privacy 판단처럼 worker가 같은 PR head branch에서 해결할 수 없는 경우에만 사용한다.

각 blocker는 다음 의미를 가져야 한다.

- `category`: `contract | code | verification | release | docs | policy`
- `evidence`: 파일 경로, diff hunk, check 이름, 문서 조항, 또는 reviewer finding 근거
- `required remediation`: 같은 PR head branch에서 수행할 구체적 수정
- `fixability`: `fixable-in-pr | needs-maintainer-decision | needs-new-scope`
