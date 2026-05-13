---
name: search-to-issue
description: "[COMPATIBILITY STUB] 이 스킬은 /search-to-issue 커맨드로 이전됐습니다. 새 진입점: `.opencode/commands/search-to-issue.md`. fluo 저장소의 패키지 또는 패키지 그룹을 감사하고, 패키지당 3개 서브에이전트로 결과를 수집해 GitHub issue 초안을 만들고 사용자 승인 후 등록하는 패키지 감사 스킬."
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: git-workflow
  mode: execution
  no_co_author: true
  argument-hint: "[패키지명... | 패키지 그룹명 | all]"
  migration_status: compatibility-stub
  replaced_by: ".opencode/commands/search-to-issue.md"
  knowledge_skill: ".opencode/skills/fluo-package-audit/SKILL.md"
---

# Search-to-Issue — Compatibility Stub

> **⚠️ 이 스킬은 compatibility stub입니다.**
>
> 절차적 워크플로의 소유권이 커맨드로 이전됐습니다.
>
> **새 진입점:** `/search-to-issue` 커맨드 (`.opencode/commands/search-to-issue.md`)
>
> 이 스킬을 직접 호출하면 `/search-to-issue` 커맨드를 사용하세요.

## 이전 경로 안내

| 구분 | 이전 위치 | 새 위치 |
| :--- | :--- | :--- |
| 절차적 워크플로 | 이 파일 (레거시) | `/search-to-issue` 커맨드 |
| 패키지 감사 지식 | 이 스킬 내 인라인 | `fluo-package-audit` knowledge skill |
| 3개 감사 서브에이전트 | 이 스킬 내 역할 | `@fluo-package-contract-api-reviewer`, `@fluo-package-architecture-reviewer`, `@fluo-package-tests-edge-reviewer` |

## 새 구조 요약

`/search-to-issue` 커맨드는 다음을 담당합니다.

- 패키지 scope 해석 (explicit package > package group > all)
- 패키지당 3개 고정 서브에이전트 실행 (`@fluo-package-contract-api-reviewer`, `@fluo-package-architecture-reviewer`, `@fluo-package-tests-edge-reviewer`)
- finding 수집 및 issue 초안 작성
- severity summary gate (P0/P1/P2)
- 명시적 사용자 승인/선택 gate (승인 없이 등록 불가)
- 승인된 초안만 `gh issue create`로 등록

`fluo-package-audit` knowledge skill은 패키지 감사 기준, label allowlist, package group 정의, change footprint pointer map을 제공합니다.

## 핵심 불변 규칙 (여전히 유효)

- **사용자 명시적 선택 없이 `gh issue create`를 실행하지 않습니다.**
- 승인된 초안이 0개면 아무 이슈도 만들지 않고 종료합니다.
- 실제 저장소에 없는 라벨을 임의 생성하거나 부착하지 않습니다.
- 보안 취약점을 public issue로 등록하지 않습니다.
- 패키지당 정확히 3개 서브에이전트를 사용합니다.

## 사용 방법

```
/search-to-issue foundation
runtime이랑 http만 조사해서 issue 초안 만들어줘
```

전체 절차는 `.opencode/commands/search-to-issue.md`를 참조하세요.
패키지 감사 기준은 `.opencode/skills/fluo-package-audit/SKILL.md`를 참조하세요.
