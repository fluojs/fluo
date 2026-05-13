---
name: docs-sync-guardian
description: "[COMPATIBILITY STUB] 이 스킬은 /docs-sync-guardian 커맨드로 이전됐습니다. 새 진입점: `.opencode/commands/docs-sync-guardian.md`. fluo 저장소의 EN/KO 문서 쌍, docs hub companion update, docs 관련 CI/tooling enforcement, regression-test evidence를 점검하는 repo-local 문서 동기화 가드 스킬."
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: docs-governance
  mode: review
  no_co_author: true
  argument-hint: "<pr-url|pr-number> [linked-issue-url|number] [base-branch]"
  migration_status: compatibility-stub
  replaced_by: ".opencode/commands/docs-sync-guardian.md"
  agent: ".opencode/agents/fluo-docs-sync-guardian.md"
  knowledge_skill: ".opencode/skills/fluo-docs-governance/SKILL.md"
---

# Docs Sync Guardian — Compatibility Stub

> **⚠️ 이 스킬은 compatibility stub입니다.**
>
> 절차적 워크플로의 소유권이 커맨드로 이전됐습니다.
>
> **새 진입점:** `/docs-sync-guardian` 커맨드 (`.opencode/commands/docs-sync-guardian.md`)
>
> 이 스킬을 직접 호출하면 `/docs-sync-guardian` 커맨드를 사용하세요.

## 이전 경로 안내

| 구분 | 이전 위치 | 새 위치 |
| :--- | :--- | :--- |
| 절차적 워크플로 | 이 파일 (레거시) | `/docs-sync-guardian` 커맨드 |
| 문서 동기화 가드 실행 | 이 스킬 | `@fluo-docs-sync-guardian` 에이전트 |
| 문서 거버넌스 지식 | 이 스킬 내 인라인 | `fluo-docs-governance` knowledge skill |

## 새 구조 요약

`/docs-sync-guardian` 커맨드는 다음을 조율합니다.

- **`@fluo-docs-sync-guardian` 에이전트** — EN/KO mirror parity, docs hub companion update, CI/tooling enforcement, regression-test evidence 점검
- **`fluo-docs-governance` knowledge skill** — docs governance 기준, governed docs surface, companion update 규칙, key invariants

## 핵심 불변 규칙 (여전히 유효)

- 이 게이트는 **read-only**입니다. 문서를 직접 수정하지 않습니다.
- 허용 verdict는 `pass` / `block` / `needs-human-check` 세 가지뿐입니다.
- contract-bearing docs 변경에서 regression evidence가 없으면 `pass`를 주지 않습니다.
- tooling/CI 문서가 실제 workflow와 어긋나면 `block`입니다.
- branch/worktree/PR state를 바꾸지 않습니다.

## 사용 방법

```
/docs-sync-guardian https://github.com/fluojs/fluo/pull/123
이 docs PR이 mirror sync 맞는지 봐줘
```

전체 절차는 `.opencode/commands/docs-sync-guardian.md`를 참조하세요.
문서 거버넌스 기준은 `.opencode/skills/fluo-docs-governance/SKILL.md`를 참조하세요.
