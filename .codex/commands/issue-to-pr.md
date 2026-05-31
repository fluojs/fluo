---
description: issue-to-pr — GitHub issue 1개를 전용 .worktrees/<branch>에서 구현하거나 기존 PR을 fix-back하도록 위임하고 검증, 커밋, PR 생명주기를 조율하는 fluo 실행 하네스.
argument-hint: "<github-issue-url|issue-number> [base-branch] [--fix-back <pr-url|pr-number> <branch-name> <worktree-path>]"
---

# issue-to-pr

이 커맨드는 `issue-to-pr` 스킬의 **얇은 실행 하네스**다. 구현 세부를 직접 소유하는 mega-agent가 아니라, 이슈/branch/worktree/PR 생명주기를 정리하고 실제 구현은 `@fluo-issue-implementer`에 위임한다.

`@fluo-issue-implementer` 라우팅이 현재 런타임에서 불가능하면, 동일한 입력 계약을 가진 기본 build/category executor에 위임하되 아래 worktree 격리, 검증, 커밋, PR 규칙을 그대로 적용한다.

## 사용법

```
/issue-to-pr <github-issue-url|issue-number> [base-branch]
/issue-to-pr <github-issue-url|issue-number> [base-branch] --fix-back <pr-url|pr-number> <branch-name> <worktree-path>
```

상위 `lane-supervisor`의 fix-back 호출에서는 이미 열린 PR/branch/worktree를 재사용하는 보정 모드로 동작할 수 있다. 이 경우 호출 payload에 `EXISTING_PR`, `BRANCH_NAME`, `WORKTREE_PATH`, `BLOCKERS`, `FIX_BACK_ATTEMPT`가 반드시 포함되어야 하며 새 branch/worktree/PR을 만들지 않는다.

예시:

- `/issue-to-pr https://github.com/fluojs/fluo/issues/123`
- `/issue-to-pr 123 main`
- `/issue-to-pr 123 main --fix-back 456 issue-123-example .worktrees/issue-123-example`

## 하네스 책임

1. **대상 해석** — GitHub issue URL 또는 issue number를 해석하고, base branch를 결정한다. base branch 기본값은 `main`이다.
2. **이슈 컨텍스트 수집** — `gh issue view <issue>`로 title/body/URL을 읽고 local repo remote가 대상 repo와 일치하는지 확인한다.
3. **규칙 선독** — 구현 위임 전에 `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`, `.github/PULL_REQUEST_TEMPLATE.md`, 영향받는 `packages/*/README.md`를 읽어 behavioral contract와 release-readiness 영향을 파악한다.
4. **branch/worktree 준비** — 신규 구현이면 branch 이름과 전용 worktree 경로를 만들고 구현 범위를 격리한다. fix-back이면 전달된 기존 branch/worktree/PR을 재사용한다.
5. **구현 위임** — `@fluo-issue-implementer` 또는 fallback executor에 할당 worktree와 이슈 컨텍스트를 전달한다.
6. **검증 확인** — 위임된 executor가 changed files diagnostics와 관련 verifier를 통과했는지 확인한다.
7. **커밋 확인** — worktree branch 위 커밋이 생성되었고 `Co-Authored-By` trailer가 없는지 확인한다.
8. **PR 생성 또는 갱신 확인** — 신규 구현이면 `.github/PULL_REQUEST_TEMPLATE.md` 축을 채운 body로 PR을 열고 반드시 `Closes #<issue-number>`를 포함한다. fix-back이면 새 PR을 만들지 않고 기존 PR head branch에 remediation commit이 추가되었는지 확인한다.
9. **보고** — issue, branch, base branch, worktree, PR URL, 검증 요약, cleanup 상태, fix-back 여부를 보고한다.

## branch/worktree 규칙

- branch name pattern은 반드시 `issue-<number>-<short-title>`이다.
- `<short-title>`은 issue title을 kebab-case로 축약한 값이며 안전하지 않은 문자는 제거한다.
- 구현은 반드시 dedicated worktree에서만 수행한다.
- worktree canonical path는 반드시 `.worktrees/<branch-name>`이다.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
BASE_BRANCH="${BASE_BRANCH:-main}"
BRANCH_NAME="issue-<number>-<short-title>"
WORKTREE_PATH="${REPO_ROOT}/.worktrees/${BRANCH_NAME}"

git fetch origin
git worktree add -b "${BRANCH_NAME}" "${WORKTREE_PATH}" "origin/${BASE_BRANCH}"
```

local-only base branch가 명시된 경우에만 `origin/${BASE_BRANCH}` 대신 `${BASE_BRANCH}`를 사용할 수 있다. 신규 구현에서 기존 branch 또는 기존 worktree가 충돌하면 자동으로 덮어쓰지 말고 중단한다.

### Fix-back mode

`lane-supervisor`가 `/pr-to-merge`의 `block` verdict를 remediation input으로 넘긴 경우 이 커맨드는 fix-back mode로 동작한다.

필수 입력:

```yaml
ISSUE_URL: <resolved-issue-url>
ISSUE_NUMBER: <issue-number>
EXISTING_PR: <pr-url-or-number>
BASE_BRANCH: <base-branch>
BRANCH_NAME: <existing-pr-head-branch>
WORKTREE_PATH: <repo-root>/.worktrees/<branch-name>
BLOCKERS:
  - reviewer: <contract|code|verification>
    signature: <stable blocker identifier>
    evidence: <file/check/doc evidence>
FIX_BACK_ATTEMPT: <1|2|3>
```

Fix-back mode 규칙:

- `EXISTING_PR`의 head branch가 `BRANCH_NAME`과 일치해야 한다. 불일치하면 `blocked-child-contract-error`로 호출자에게 반환한다.
- `WORKTREE_PATH`는 기존 `.worktrees/<branch-name>`를 가리켜야 한다. 없으면 새 worktree 생성 전에 호출자에게 확인을 요청하거나 하네스가 명시한 재생성 절차를 따른다.
- `WORKTREE_PATH`가 전달된 `BRANCH_NAME`과 일치해야 한다.
- worktree가 전달된 PR의 head branch를 checkout하고 있어야 한다.
- 기존 PR URL/number가 issue와 같은 작업 단위에 연결되어 있어야 한다.
- 새 branch, 새 PR, 새 issue를 만들지 않는다.
- `BLOCKERS`에 포함된 항목만 최소 수정한다. 주변 리팩터링이나 unrelated cleanup은 금지한다.
- 수정 후 같은 branch에 추가 커밋을 만들고 기존 PR이 업데이트되도록 보고한다. push 권한이 없으면 push 필요 상태를 명시한다.
- 결과는 반드시 `fix_back_result: remediated|still-blocked|needs-human-check` 중 하나로 보고한다.
- 기존 branch/worktree/PR이 불일치하거나 손상되어 안전하게 재사용할 수 없으면 자동 복구하지 말고 `result: blocked-child-contract-error`로 중단한다.

## 구현 위임 계약

우선 다음 형식으로 `@fluo-issue-implementer`를 호출한다.

```
@fluo-issue-implementer

ISSUE_URL: <resolved-issue-url>
ISSUE_NUMBER: <issue-number>
ISSUE_TITLE: <issue-title>
BASE_BRANCH: <base-branch>
BRANCH_NAME: <issue-number-short-title-branch>
WORKTREE_PATH: <repo-root>/.worktrees/<branch-name>
MODE: new-pr | fix-back
EXISTING_PR: <pr-url-or-number | 없음>
BLOCKERS: <fix-back mode에서만 필수>

Rules:
- Work only inside WORKTREE_PATH.
- In fix-back mode, reuse EXISTING_PR/BRANCH_NAME/WORKTREE_PATH and only remediate BLOCKERS.
- Read CONTRIBUTING.md, docs/contracts/behavioral-contract-policy.md, .github/PULL_REQUEST_TEMPLATE.md, and affected package README files before editing.
- Include docs/tests with behavior changes.
- Add .changeset/*.md for public @fluojs/* package user-impacting changes, or report the no-release rationale.
- Run changed-file diagnostics and the closest relevant verifier.
- Commit on BRANCH_NAME without any Co-Authored-By trailer.
- Do not push, open PRs, merge, close, or clean up branches/worktrees.
```

fallback executor를 사용할 때도 동일한 payload를 전달하고, executor가 할당 worktree 밖에서 파일을 수정하지 못하도록 명시한다.

### Child completion contract

`/issue-to-pr`는 implementer 또는 fallback executor의 **완료 보고**를 받은 뒤에만 PR 생성/갱신 단계로 넘어간다. worktree에 미커밋 변경이 있거나 일부 verifier가 통과했더라도, child가 running 상태이거나 최종 보고를 반환하지 않은 상태는 완료가 아니다.

완료 보고에는 다음 값이 모두 필요하다.

- issue URL/number
- branch name
- worktree path
- changed files
- commit hash 또는 명시적 blocker
- 실행한 verifier와 pass/fail 결과
- `.changeset/*.md` 추가 여부와 근거
- remaining risks
- mode: `new-pr | fix-back`
- fix-back mode라면 `fix_back_result`

완료 보고가 누락되면 같은 child session에 1회 이상 재보고를 요청한다. 그 뒤에도 보고가 없으면 하네스는 부분 변경을 대신 커밋하거나 PR을 만들지 말고 `blocked-child-contract-error`로 반환한다. 이미 존재하는 미커밋 변경은 되돌리지 않는다.

## 검증 게이트

PR 생성 또는 fix-back 완료 보고 전에 하네스는 executor 보고와 repository state를 기준으로 다음을 확인한다.

- changed files 대상 diagnostics가 통과했다.
- 변경 성격에 맞는 canonical verifier가 통과했다.
  - 일반 코드: `pnpm verify` 또는 관련 package test/build/typecheck
  - docs/governance: `pnpm verify:platform-consistency-governance`
  - release/publish/tooling: `pnpm verify:release-readiness`
  - public export docs: `pnpm lint` 및 필요 시 `pnpm verify:public-export-tsdoc:baseline`
- public `@fluojs/*` package 사용자 영향 변경에는 `.changeset/*.md`가 있거나 PR body에 no-release 근거가 있다.
- 커밋 메시지와 commit body에 `Co-Authored-By` trailer가 없다.

검증 실패, 미실행, 또는 근거 불명확 상태에서는 PR을 생성하거나 fix-back 완료로 보고하지 않는다.

## PR body 요구사항

PR 제목은 다음 형식을 사용한다.

```
Resolve #<issue-number>: <issue-title-summary>
```

PR body는 `.github/PULL_REQUEST_TEMPLATE.md` 축을 실질적으로 채우고, 반드시 `Closes #<issue-number>`를 포함한다.

필수 섹션:

- `## Summary`
- `## Changes`
- `## Testing`
- `## Public export documentation`
- `## Behavioral contract`
- `## Platform consistency governance (SSOT)`

해당 없음인 섹션도 비워두지 말고 “해당 없음”과 판단 근거를 적는다.

## merge/cleanup 권한 경계

- 기본 결과는 **PR 생성 완료**다.
- 이 커맨드는 기본 동작으로 merge, PR close, branch 삭제, `git worktree remove`, remote branch 삭제를 수행하지 않는다.
- merge/cleanup은 별도 사용자 명시 승인, `pr-to-merge`, 또는 상위 harness gate가 있을 때만 수행한다.
- merge가 실제로 확인된 뒤에만 cleanup을 고려할 수 있다.

## 출력 계약

최종 보고는 한국어로 작성하고 다음 값을 포함한다.

```
result: PR 생성 완료 | fix-back 완료 | blocked-child-contract-error
linked issue: <issue-url>
branch: <branch-name>
base branch: <base-branch>
worktree: <repo-root>/.worktrees/<branch-name>
PR URL: <pull-request-url>
mode: new-pr | fix-back
fix_back_result: <remediated|still-blocked|needs-human-check|not-applicable>
addressed blockers: <해결한 blocker 목록 또는 not-applicable>
remaining blockers: <남은 blocker 목록 또는 없음>
verification summary: <diagnostics/tests/build 결과 요약>
cleanup status: 수행하지 않음 — 별도 명시 승인 또는 상위 gate 필요
```

명시적으로 merge 권한이 주어지고 실제 merge까지 수행된 별도 흐름에서만 `result: PR 생성 및 머지 완료`를 사용할 수 있다.
