---
name: lane-supervisor
description: "[COMPATIBILITY STUB] 이 스킬은 /lane-supervisor 커맨드로 이전됐습니다. 새 진입점: `.opencode/commands/lane-supervisor.md`. fluo 저장소에서 문제를 GitHub issue 단위로 정리하고, lane별로 issue-to-pr를 배정한 뒤, pr-to-merge 기반 중앙 리뷰 게이트와 merge/cleanup/main sync까지 관리하는 repo-local 오케스트레이션."
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: git-workflow
  mode: orchestration
  no_co_author: true
  argument-hint: "<문제 설명 | 이슈 집합> [plan|register|execute|resume] [base-branch]"
  migration_status: compatibility-stub
  replaced_by: ".opencode/commands/lane-supervisor.md"
---

# Lane Supervisor — Compatibility Stub

> **⚠️ 이 스킬은 compatibility stub입니다.**
>
> 절차적 워크플로의 소유권이 커맨드로 이전됐습니다.
>
> **새 진입점:** `/lane-supervisor` 커맨드 (`.opencode/commands/lane-supervisor.md`)
>
> 이 스킬을 직접 호출하면 `/lane-supervisor` 커맨드를 사용하세요.

## 이전 경로 안내

| 구분 | 이전 위치 | 새 위치 |
| :--- | :--- | :--- |
| 절차적 워크플로 | 이 파일 (레거시) | `/lane-supervisor` 커맨드 |
| 오케스트레이션 실행 | 이 스킬 | `.opencode/commands/lane-supervisor.md` |

## 새 구조 요약

`/lane-supervisor` 커맨드는 다음 하위 컴포넌트를 조율합니다.

- **`/issue-to-pr`** — 단일 issue 구현 및 PR 생성
- **`/search-to-issue`** — 패키지 감사 및 issue 발굴/등록
- **`/pr-to-merge`** — PR 중앙 리뷰 게이트 (read-only verdict)
- **`/package-publish`** — 릴리스 준비 handoff

## 핵심 불변 규칙 (여전히 유효)

이 stub을 통해 호출하더라도 다음 규칙은 변경되지 않습니다.

- issue 생성은 사용자 명시적 승인 후에만 수행합니다.
- PR merge는 `pr-to-merge` verdict + merge policy 확인 후에만 수행합니다.
- worktree cleanup은 merge 확인 후에만 수행합니다.
- `Co-Authored-By` trailer를 commit message에 넣지 않습니다.
- 로컬 `npm publish`는 금지됩니다.

## 사용 방법

```
/lane-supervisor 이 문제를 issue로 나누고 lane별로 진행해줘
/lane-supervisor 기존 등록된 이슈들로만 이번 세션 진행해줘
```

전체 절차는 `.opencode/commands/lane-supervisor.md`를 참조하세요.
