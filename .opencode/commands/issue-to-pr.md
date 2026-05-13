---
description: issue-to-pr — GitHub issue 1개를 전용 .worktrees/<branch>에서 구현하도록 위임하고 검증, 커밋, PR 생성을 조율하는 fluo 실행 하네스.
argument-hint: "<github-issue-url|issue-number> [base-branch]"
---

# issue-to-pr

이 커맨드는 `issue-to-pr` 스킬의 **얇은 실행 하네스**다. 구현 세부를 직접 소유하는 mega-agent가 아니라, 이슈/branch/worktree/PR 생명주기를 정리하고 실제 구현은 `@fluo-issue-implementer`에 위임한다.

`@fluo-issue-implementer` 라우팅이 현재 런타임에서 불가능하면, 동일한 입력 계약을 가진 기본 build/category executor에 위임하되 아래 worktree 격리, 검증, 커밋, PR 규칙을 그대로 적용한다.

## 사용법

```
/issue-to-pr <github-issue-url|issue-number> [base-branch]
```

예시:

- `/issue-to-pr https://github.com/fluojs/fluo/issues/123`
- `/issue-to-pr 123 main`

## 하네스 책임

1. **대상 해석** — GitHub issue URL 또는 issue number를 해석하고, base branch를 결정한다. base branch 기본값은 `main`이다.
2. **이슈 컨텍스트 수집** — `gh issue view <issue>`로 title/body/URL을 읽고 local repo remote가 대상 repo와 일치하는지 확인한다.
3. **규칙 선독** — 구현 위임 전에 `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`, `.github/PULL_REQUEST_TEMPLATE.md`, 영향받는 `packages/*/README.md`를 읽어 behavioral contract와 release-readiness 영향을 파악한다.
4. **branch/worktree 준비** — branch 이름과 전용 worktree 경로를 만들고 구현 범위를 격리한다.
5. **구현 위임** — `@fluo-issue-implementer` 또는 fallback executor에 할당 worktree와 이슈 컨텍스트를 전달한다.
6. **검증 확인** — 위임된 executor가 changed files diagnostics와 관련 verifier를 통과했는지 확인한다.
7. **커밋 확인** — worktree branch 위 커밋이 생성되었고 `Co-Authored-By` trailer가 없는지 확인한다.
8. **PR 생성** — `.github/PULL_REQUEST_TEMPLATE.md` 축을 채운 body로 PR을 열고 반드시 `Closes #<issue-number>`를 포함한다.
9. **보고** — issue, branch, base branch, worktree, PR URL, 검증 요약, cleanup 상태를 보고한다.

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

local-only base branch가 명시된 경우에만 `origin/${BASE_BRANCH}` 대신 `${BASE_BRANCH}`를 사용할 수 있다. 기존 branch 또는 기존 worktree가 충돌하면 자동으로 덮어쓰지 말고 중단한다.

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

Rules:
- Work only inside WORKTREE_PATH.
- Read CONTRIBUTING.md, docs/contracts/behavioral-contract-policy.md, .github/PULL_REQUEST_TEMPLATE.md, and affected package README files before editing.
- Include docs/tests with behavior changes.
- Add .changeset/*.md for public @fluojs/* package user-impacting changes, or report the no-release rationale.
- Run changed-file diagnostics and the closest relevant verifier.
- Commit on BRANCH_NAME without any Co-Authored-By trailer.
- Do not push, open PRs, merge, close, or clean up branches/worktrees.
```

fallback executor를 사용할 때도 동일한 payload를 전달하고, executor가 할당 worktree 밖에서 파일을 수정하지 못하도록 명시한다.

## 검증 게이트

PR 생성 전에 하네스는 executor 보고와 repository state를 기준으로 다음을 확인한다.

- changed files 대상 diagnostics가 통과했다.
- 변경 성격에 맞는 canonical verifier가 통과했다.
  - 일반 코드: `pnpm verify` 또는 관련 package test/build/typecheck
  - docs/governance: `pnpm verify:platform-consistency-governance`
  - release/publish/tooling: `pnpm verify:release-readiness`
  - public export docs: `pnpm lint` 및 필요 시 `pnpm verify:public-export-tsdoc:baseline`
- public `@fluojs/*` package 사용자 영향 변경에는 `.changeset/*.md`가 있거나 PR body에 no-release 근거가 있다.
- 커밋 메시지와 commit body에 `Co-Authored-By` trailer가 없다.

검증 실패, 미실행, 또는 근거 불명확 상태에서는 PR을 생성하지 않는다.

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
result: PR 생성 완료
linked issue: <issue-url>
branch: <branch-name>
base branch: <base-branch>
worktree: <repo-root>/.worktrees/<branch-name>
PR URL: <pull-request-url>
verification summary: <diagnostics/tests/build 결과 요약>
cleanup status: 수행하지 않음 — 별도 명시 승인 또는 상위 gate 필요
```

명시적으로 merge 권한이 주어지고 실제 merge까지 수행된 별도 흐름에서만 `result: PR 생성 및 머지 완료`를 사용할 수 있다.
