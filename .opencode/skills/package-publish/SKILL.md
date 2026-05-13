---
name: package-publish
description: "[COMPATIBILITY STUB] 이 스킬은 /package-publish 커맨드로 이전됐습니다. 새 진입점: `.opencode/commands/package-publish.md`. fluo 저장소에서 Changesets 기반 공개 패키지 릴리스 준비와 GitHub Actions 기반 npm publish를 일관되게 관리하는 릴리스 오퍼레이션 스킬."
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: release-operations
  mode: execution
  no_co_author: true
  argument-hint: "<mode> [options] — mode: plan|add-changeset|version|publish|resume"
  migration_status: compatibility-stub
  replaced_by: ".opencode/commands/package-publish.md"
  knowledge_skill: ".opencode/skills/fluo-release-operations/SKILL.md"
---

# Package Publish — Compatibility Stub

> **⚠️ 이 스킬은 compatibility stub입니다.**
>
> 절차적 워크플로의 소유권이 커맨드로 이전됐습니다.
>
> **새 진입점:** `/package-publish` 커맨드 (`.opencode/commands/package-publish.md`)
>
> 이 스킬을 직접 호출하면 `/package-publish` 커맨드를 사용하세요.

## 이전 경로 안내

| 구분 | 이전 위치 | 새 위치 |
| :--- | :--- | :--- |
| 절차적 워크플로 | 이 파일 (레거시) | `/package-publish` 커맨드 |
| 릴리스 운영 지식 | 이 스킬 내 인라인 | `fluo-release-operations` knowledge skill |

## 새 구조 요약

`/package-publish` 커맨드는 다음을 담당합니다.

- Changesets 기반 릴리스 workflow 관리
- `.changeset/*.md` 파일 확인 및 Version Packages PR 상태 점검
- `pnpm verify:release-readiness` 기반 release gate 확인
- publish 결과 및 GitHub Release 확인

`fluo-release-operations` knowledge skill은 Changesets 운영 규칙, branch/worktree 명명 규칙, release gate 기준, changeset 작성 규칙을 제공합니다.

## 핵심 불변 규칙 (여전히 유효)

> **🚫 로컬 `npm publish`는 절대 금지입니다.**

- 배포는 반드시 GitHub Actions workflow로만 합니다.
- canonical publish path: `.github/workflows/release.yml`
- 로컬에서 직접 `npm publish`를 실행하지 않습니다.
- publish 성공 전에 git tag/GitHub Release를 만들지 않습니다.
- changeset 없이 package version만 올린 상태를 릴리스 준비 완료로 판단하지 않습니다.
- Version Packages PR의 package version과 generated changelog가 pending changeset과 일치해야 합니다.
- `Co-Authored-By` trailer를 commit message에 넣지 않습니다.

## 사용 방법

```
/package-publish add-changeset
/package-publish version
/package-publish publish
core 머지됐으니 publish까지 해줘
```

전체 절차는 `.opencode/commands/package-publish.md`를 참조하세요.
릴리스 운영 기준은 `.opencode/skills/fluo-release-operations/SKILL.md`를 참조하세요.
