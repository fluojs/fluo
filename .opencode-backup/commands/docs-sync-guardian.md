---
description: docs-sync-guardian — fluo 문서 동기화 거버넌스 게이트. PR의 EN/KO parity, companion update, tooling/CI enforcement, regression evidence를 점검하고 pass|block|needs-human-check verdict를 반환한다.
argument-hint: "<pr-url|pr-number> [linked-issue-url|number] [base-branch]"
---

# docs-sync-guardian

이 커맨드는 `@fluo-docs-sync-guardian` 에이전트의 얇은 진입점이다.

전체 리뷰 로직은 에이전트가 소유한다. 이 커맨드는 사용자 인자를 파싱하고 컨텍스트를 수집한 뒤 에이전트에 위임한다.

## 사용법

```
/docs-sync-guardian <pr-url|pr-number> [linked-issue-url|number] [base-branch]
```

예시:
- `/docs-sync-guardian https://github.com/fluojs/fluo/pull/123`
- `/docs-sync-guardian 123 456 main`
- `/docs-sync-guardian 123`

## 이 커맨드가 하는 일

1. **인자 파싱** — PR URL 또는 PR 번호, 선택적 linked issue, 선택적 base branch(기본값 `main`)를 파싱한다.
2. **고수준 컨텍스트 수집** — PR 메타데이터와 changed files 목록을 간략히 확인한다.
3. **에이전트 위임** — `@fluo-docs-sync-guardian`에 모든 리뷰 로직을 위임한다.

이 커맨드는 EN/KO parity 체크, companion update 체크, tooling/CI enforcement 체크, regression evidence 체크를 직접 수행하지 않는다. 그 모든 로직은 `@fluo-docs-sync-guardian` 에이전트가 소유한다.

## 에이전트 위임

아래 컨텍스트를 구성하여 `@fluo-docs-sync-guardian`을 호출한다.

```
@fluo-docs-sync-guardian

PR: <pr-url-or-number>
linked issue: <issue-url-or-number | 없음>
base branch: <base-branch>
```

## Verdict 계약

에이전트는 반드시 다음 세 가지 중 하나를 반환한다.

```
pass | block | needs-human-check
```

## 권한 경계

- 이 커맨드는 파일을 수정하지 않는다.
- branch, worktree, PR state를 변경하지 않는다.
- 구현 정확성, 패키지 아키텍처, 릴리스 실행은 이 커맨드의 범위 밖이다.
