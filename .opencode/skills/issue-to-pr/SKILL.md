---
name: issue-to-pr
description: "[COMPATIBILITY STUB] 이 스킬은 /issue-to-pr 커맨드로 이전됐습니다. 새 진입점: `.opencode/commands/issue-to-pr.md`. fluo 저장소의 GitHub issue를 전용 worktree에서 해결하고, fluo 거버넌스와 PR 템플릿을 지키는 PR까지 생성하는 repo-local 실행 스킬."
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: git-workflow
  mode: execution
  no_co_author: true
  argument-hint: "<github-issue-link> [base-branch]"
  migration_status: compatibility-stub
  replaced_by: ".opencode/commands/issue-to-pr.md"
---

# Issue-to-PR — Compatibility Stub

> **⚠️ 이 스킬은 compatibility stub입니다.**
>
> 절차적 워크플로의 소유권이 커맨드로 이전됐습니다.
>
> **새 진입점:** `/issue-to-pr` 커맨드 (`.opencode/commands/issue-to-pr.md`)
>
> 이 스킬을 직접 호출하면 `/issue-to-pr` 커맨드를 사용하세요.

## 이전 경로 안내

| 구분 | 이전 위치 | 새 위치 |
| :--- | :--- | :--- |
| 절차적 워크플로 | 이 파일 (레거시) | `/issue-to-pr` 커맨드 |
| 선택적 구현 위임 | — | `@fluo-issue-implementer` 에이전트 (optional) |

## 새 구조 요약

`/issue-to-pr` 커맨드는 다음을 담당합니다.

- branch/worktree 생성 (`.worktrees/` 경로 규칙 준수)
- fluo behavioral contract / release / testing 거버넌스 확인
- PR 생성 (`.github/PULL_REQUEST_TEMPLATE.md` 축 반영)
- 선택적으로 `@fluo-issue-implementer` 에이전트에 구현 위임

## 핵심 불변 규칙 (여전히 유효)

- 기본 base branch는 `main`입니다.
- worktree canonical path는 `.worktrees/`입니다.
- merge authority가 명시적으로 주어지지 않으면 merge/cleanup까지 자동 진행하지 않습니다.
- 중앙 merge 판단은 `/pr-to-merge` 또는 상위 supervisor의 책임입니다.
- `Co-Authored-By` trailer를 commit message에 넣지 않습니다.
- PR body에는 반드시 `Closes #<number>`를 포함합니다.

## 사용 방법

```
/issue-to-pr https://github.com/fluojs/fluo/issues/123
https://github.com/fluojs/fluo/issues/123 해결해서 PR 만들어줘
```

전체 절차는 `.opencode/commands/issue-to-pr.md`를 참조하세요.
