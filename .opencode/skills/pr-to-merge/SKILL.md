---
name: pr-to-merge
description: "[COMPATIBILITY STUB] 이 스킬은 /pr-to-merge 커맨드로 이전됐습니다. 새 진입점: `.opencode/commands/pr-to-merge.md`. lane-supervisor가 만든 단일 PR을 중앙 게이트로 검토하고, 3개 고정 서브에이전트 리뷰를 수집해 merge/block/needs-human-check verdict를 내리는 fluo repo-local 리뷰 스킬."
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: code-review
  mode: execution
  no_co_author: true
  argument-hint: "<pr-url|pr-number> [linked-issue-url|number] [base-branch]"
  migration_status: compatibility-stub
  replaced_by: ".opencode/commands/pr-to-merge.md"
---

# PR-to-Merge — Compatibility Stub

> **⚠️ 이 스킬은 compatibility stub입니다.**
>
> 절차적 워크플로의 소유권이 커맨드로 이전됐습니다.
>
> **새 진입점:** `/pr-to-merge` 커맨드 (`.opencode/commands/pr-to-merge.md`)
>
> 이 스킬을 직접 호출하면 `/pr-to-merge` 커맨드를 사용하세요.

## 이전 경로 안내

| 구분 | 이전 위치 | 새 위치 |
| :--- | :--- | :--- |
| 절차적 워크플로 | 이 파일 (레거시) | `/pr-to-merge` 커맨드 |
| Contract 리뷰어 | 이 스킬 내 역할 | `@fluo-contract-reviewer` 에이전트 |
| Code 리뷰어 | 이 스킬 내 역할 | `@fluo-code-reviewer` 에이전트 |
| Verification 리뷰어 | 이 스킬 내 역할 | `@fluo-verification-reviewer` 에이전트 |

## 새 구조 요약

`/pr-to-merge` 커맨드는 3개 고정 reviewer 에이전트를 실행합니다.

1. **`@fluo-contract-reviewer`** — linked issue intent, package README, behavioral contract, release governance
2. **`@fluo-code-reviewer`** — changed files, architecture fit, correctness
3. **`@fluo-verification-reviewer`** — PR checks, tests/build/typecheck, verifier usage

## 핵심 불변 규칙 (여전히 유효)

- 이 게이트는 **read-only**입니다. 코드, branch, PR state를 변경하지 않습니다.
- 허용 verdict는 `merge` / `block` / `needs-human-check` 세 가지뿐입니다.
- CI/checks가 없거나 불완전하면 `merge` verdict를 주지 않습니다.
- linked issue intent 없이 PR만 보고 의미를 지어내지 않습니다.
- 3개 reviewer 중 하나라도 빠뜨리고 승인하지 않습니다.
- local `npm publish` path를 도입하는 PR의 기본 verdict는 `block`입니다.

## 사용 방법

```
/pr-to-merge https://github.com/fluojs/fluo/pull/123
lane PR #123 중앙 리뷰 게이트 돌려줘
```

전체 절차는 `.opencode/commands/pr-to-merge.md`를 참조하세요.
