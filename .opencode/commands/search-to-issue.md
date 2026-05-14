---
description: search-to-issue — fluo 패키지 감사 범위를 한 번만 확정하고, 패키지별 3개 auditor 결과를 묶어 사용자 승인 후 GitHub issue를 등록하는 커맨드 harness.
argument-hint: "[패키지명... | 패키지 그룹명 | all]"
---

# search-to-issue

이 커맨드는 repo-local package audit의 **harness**다. 감사 역할 자체는 전용 read-only auditor 에이전트가 소유한다. 이 커맨드는 범위 확정, batch orchestration, 결과 dedup/bundling, issue draft, 사용자 승인 gate, 등록 순서 추천만 담당한다.

## 사용법

```
/search-to-issue [패키지명... | 패키지 그룹명 | all]
```

예시:

- `/search-to-issue runtime http`
- `/search-to-issue @fluojs/runtime @fluojs/http`
- `/search-to-issue foundation`
- `/search-to-issue all`

## 권한 경계

- 이 커맨드는 package audit issue의 **draft 생성 + 사용자 선택 + 선택된 issue 등록**까지만 담당한다.
- auditor 에이전트는 read-only다. 구현, PR 생성, merge, release/publish는 이 커맨드의 범위 밖이다.
- 명시적 승인/선택 없이 `gh issue create`를 실행하지 않는다. issue draft와 severity summary를 사용자에게 보여준 뒤, 승인/선택된 초안에만 실행한다.
- 사용자가 “조사만” 요청하거나 승인 결과가 0건이면 `gh issue create`를 실행하지 않는다.
- 보안 취약점으로 보이는 내용은 public issue로 만들지 말고 `SECURITY.md` 경로를 안내한다.
- 단순 지원/사용법 질문은 issue 대신 `SUPPORT.md`와 Discussions 경로를 안내한다.

## 1. Scope Resolution — 한 번만 수행

Audit target scope는 커맨드 시작 시 아래 우선순위로 **한 번만** 결정한다. 한 번 결정한 뒤에는 package 선택을 재확장하지 않는다.

1. **Explicit package names**
   - 사용자가 하나 이상의 package directory name 또는 public package name을 직접 지정하면, group/all 해석을 무시하고 해당 패키지만 감사한다.
   - 허용 예: `core`, `runtime`, `socket.io`, `@fluojs/core`, `@fluojs/runtime`
2. **Package group**
   - explicit package가 없고 지원 group명이 있으면 해당 group에 속한 패키지만 감사한다.
3. **All**
   - explicit package도 group도 없거나 사용자가 `all`만 지정하면 `packages/*/package.json` 기준 workspace public packages 전체를 감사한다.
   - 기본값에는 `examples/*`와 `@fluojs-internal/*` tooling workspace를 포함하지 않는다. 사용자가 명시적으로 요청한 경우만 포함한다.
   - package 목록은 하네스가 한 번만 확정한다. OpenCode `glob`/`read` 또는 허용된 `git ls-files*`만 사용하고, `find | xargs`, broad shell pipeline, shell redirection, `-exec`는 사용하지 않는다.

Scope 확정 결과는 다음 형태로 기록하고 이후 모든 phase에서 그대로 사용한다.

```yaml
scope_decision:
  mode: explicit-packages | package-group | all
  input: <raw user args>
  packages: [<pkg>, ...]
  excluded_reason: <group/all ignored because explicit packages were provided | none>
```

## 2. Supported Package Groups

- `foundation`: `core`, `config`, `di`, `runtime`
- `http-runtime`: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`, `terminus`, `metrics`
- `request-pipeline`: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`, `throttler`
- `auth`: `jwt`, `passport`
- `infra-messaging`: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- `protocol-adapters`: `websockets`, `socket.io`
- `persistence`: `prisma`, `drizzle`, `mongoose`
- `cli`: `cli`, `studio`, `testing`

## 3. Preflight

감사 전 harness는 repo-local 기준 문서를 확인하고, auditor 프롬프트에는 필요한 canonical paths만 전달한다.

필수 기준:

- `docs/CONTEXT.md`
- `docs/CONTEXT.ko.md`
- `docs/contracts/behavioral-contract-policy.md`
- `docs/reference/package-surface.md`
- `docs/reference/package-folder-structure.md`
- `book/README.md`
- `book/README.ko.md`
- 대상 package의 `packages/<pkg>/README.md` 및 필요한 경우 `packages/<pkg>/README.ko.md`

조건부 기준:

- CLI/tooling 계열: `docs/reference/toolchain-contract-matrix.md`
- platform/runtime 계열: `docs/contracts/platform-conformance-authoring-checklist.md`
- public API/docs 영향: `docs/contracts/public-export-tsdoc-baseline.md`
- 테스트 계약 영향: `docs/contracts/testing-guide.md`
- release/versioning 영향: `docs/contracts/release-governance.md`, `.changeset/config.json`, `.github/workflows/release.yml`, package-level `CHANGELOG.md`
- tutorial/user workflow 영향: 관련 `book/*/toc*.md`, `book/*/ch*.md`, `book/*/*.ko.md`

등록 전 확인:

- `gh label list`
- `gh issue list --state open`
- `.github/ISSUE_TEMPLATE/*.yml`
- `SUPPORT.md`
- `SECURITY.md`

## 4. Batch Orchestration

- 권장 batch size는 4 packages다.
- batch가 여러 개여도 Scope Resolution 결과의 package 목록만 사용한다.
- 각 batch가 끝날 때마다 findings를 수집하고, 중복 후보와 package-level draft를 갱신한다.
- 대규모 audit에서도 선택된 각 패키지마다 정확히 3개 auditor invocation을 유지한다.
- auditor에게 `all` 범위를 직접 위임하지 않는다. 하네스가 확정한 단일 package 이름을 각 auditor invocation의 `package: <pkg>`로 전달한다.

## 5. Auditor Delegation

선택된 각 package마다 아래 3개 에이전트를 각각 1회 호출한다.

1. `@fluo-package-contract-api-reviewer`
2. `@fluo-package-architecture-reviewer`
3. `@fluo-package-tests-edge-reviewer`

커맨드는 auditor role body를 재구현하지 않는다. 각 invocation은 다음 6개 섹션 구조로 최소 컨텍스트만 전달한다.

```md
@fluo-package-contract-api-reviewer

## TASK
Audit package `<pkg>` within the already resolved scope.

## EXPECTED OUTCOME
Return schema-compliant findings only.

## REQUIRED TOOLS
Read/grep/glob/list only. Stay read-only. Do not use bash package-discovery pipelines.

## MUST DO
- Use file:line evidence.
- Respect `docs/contracts/behavioral-contract-policy.md`.
- Assess affected surfaces with canonical path reasons.
- Audit only the assigned package `<pkg>` from `scope_decision.packages`.

## MUST NOT DO
- Do not edit files.
- Do not run `gh issue create`.
- Do not audit outside your role scope.
- Do not expand `all`, list every package, or run `find | xargs`, broad shell pipelines, shell redirection, or `-exec`.

## CONTEXT
- scope_decision: <fixed scope_decision yaml>
- package: <pkg>
- canonical docs: <relevant preflight paths>
```

동일한 6개 섹션 구조로 `@fluo-package-architecture-reviewer`와 `@fluo-package-tests-edge-reviewer`도 호출하되, role-specific 판단은 각 agent 파일의 정의에 맡긴다.

## 6. Finding Intake Schema

Auditor 결과는 다음 필드를 가진 finding만 수집한다.

```yaml
severity: P0 | P1 | P2
package: <package directory name>
evidence: <file:line one or more>
problem: <one sentence>
contract_impact: none | doc-only | behavior-change | breaking
  package: required | needs-check | not-required
  docs: required | needs-check | not-required
  book: required | needs-check | not-required
  examples: required | needs-check | not-required
docs_book_impact: none | needs-check | docs-required | book-required | docs-and-book-required
preserve_contract_fix: <contract-preserving fix>
contract_change_needed: <true/false and reason if true>
```

Rules:

- 근거 없는 finding은 버린다.
- `affected_surfaces`에는 canonical path 근거가 있어야 한다.
- user-facing behavior 변경 가능성이 있으면 `docs`와 `book`은 기본 `needs-check`로 다룬다.
- 공개 `@fluojs/*` package의 release impact 가능성이 있으면 changeset 필요성을 draft에 `required` / `needs-check` / `not-required`로 표시한다.

## 7. Deduplication

기존 열린 issue 및 batch 내부 findings와 비교한다. 아래 중 2개 이상이 겹치면 중복 후보로 본다.

- 같은 `area:*` label
- 같은 핵심 theme keyword
- 같은 package 또는 같은 file evidence
- 같은 `contract_impact`
- 같은 `docs/` / `book` affected surface 또는 같은 user-facing workflow

중복 후보는 새 issue로 바로 승격하지 않고, 기존 issue 번호/URL과 함께 보류 목록에 둔다.

## 8. Issue Draft Bundling

- 기본 단위는 **패키지당 1개 issue**다.
- 같은 package 내부 findings는 P0 → P1 → P2 순서로 정리한다.
- cross-package issue는 아래 4개 조건을 모두 만족할 때만 허용한다.
  1. 같은 root cause
  2. 같은 fix theme
  3. 같은 `contract_impact`
  4. 실제 수정 ownership 공유
- unrelated findings를 mega-issue로 합치지 않는다.

각 draft에는 stable ID를 붙인다: `D1`, `D2`, `D3` ...

### Draft title

```
[audit][area:<area-label>] <짧은 해결 테마> (<priority>)
```

### Draft body

```md
## Context
## Findings
## Contract Impact
## Suggested Resolution
## Affected Packages
## Affected Surfaces
## Why Now
```

`## Findings`에는 severity bucket과 `file:line` evidence를 포함한다. `## Affected Surfaces`에는 package source/test, package README, `docs/`, `book/`, examples, changeset 필요성을 `required` / `needs-check` / `not-required`와 canonical path 근거로 적는다.

## 9. Severity Summary Gate

사용자 승인 전 반드시 최종 findings를 P0 / P1 / P2 bucket으로 보여준다.

각 bucket 항목에는 다음을 포함한다.

- draft ID
- package name
- 짧은 문제 요약
- 대표 `file:line`
- 대응 draft issue title

## 10. User Selection Gate

Severity summary와 draft 목록을 보여준 뒤, 무엇을 실제 issue로 등록할지 한국어로 질문한다.

기본 선택 흐름:

1. 등록 모드 선택
   - `모두 등록`
   - `severity 기준으로 선택`
   - `초안별로 선택`
   - `등록 안 함`
2. 후속 선택
   - `severity 기준으로 선택`: `P0`, `P1`, `P2` 중 하나 이상 선택
   - `초안별로 선택`: draft ID (`D1`, `D2`...) 중 하나 이상 선택

선택되지 않은 severity bucket이나 draft는 등록하지 않는다. `등록 안 함` 또는 승인 결과 0건이면 종료한다.

## 11. Label Allowlist

실제 저장소에 존재하는 아래 allowlist label만 사용한다. 모든 audit issue에는 `source:package-audit`를 붙인다.

- **priority**: `priority:p0`, `priority:p1`, `priority:p2`
- **area**: `area:foundation`, `area:request-pipeline`, `area:auth`, `area:http-runtime`, `area:infra-messaging`, `area:protocol-adapters`, `area:cli`, `area:persistence`
- **type**: `bug`, `enhancement`, `documentation`, `performance`, `tech-debt`, `type:maintainability`
- **scope**: `scope:security`, `scope:nestjs-parity`
- **wave**: `wave:1`, `wave:2`, `wave:3`
- **source**: `source:package-audit`

Package → area mapping:

- `area:foundation`: `core`, `config`, `di`, `runtime`
- `area:http-runtime`: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`, `terminus`, `metrics`
- `area:request-pipeline`: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`, `throttler`
- `area:auth`: `jwt`, `passport`
- `area:infra-messaging`: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- `area:protocol-adapters`: `websockets`, `socket.io`
- `area:persistence`: `prisma`, `drizzle`, `mongoose`
- `area:cli`: `cli`, `studio`, `testing`

## 12. Issue Registration

승인된 draft만 등록한다.

```bash
gh issue create --title "<draft title>" --body "<draft body>" --label "source:package-audit,<priority>,<area>,<type>[,<scope>][,<wave>]"
```

등록 전 `gh label list` 결과에 없는 label은 제거하거나 사용자에게 보류 사유로 보고한다. label을 임의 생성하지 않는다.

## 13. Execution Order Recommendation

등록 후 권장 실행 순서를 제시한다.

정렬 기준:

1. `priority:p0` > `priority:p1` > `priority:p2`
2. `wave:1` > `wave:2` > `wave:3`
3. 기반 layer 우선: `foundation` → `http-runtime` / `request-pipeline` / `auth` → `infra-messaging` / `persistence` / `protocol-adapters` → `cli`
4. 계약 risk 우선: `breaking` / `behavior-change` > `doc-only` / `none`

## 14. Output Contract

최종 보고는 한국어로 작성하고 아래 항목을 포함한다.

- `result: 생성 이슈 N건, 보류 M건, 중복 후보 K건`
- P0 / P1 / P2 요약 표 또는 목록
- 사용자 선택 결과 요약
- draft ID → issue title 매핑 표
- 등록된 이슈 표
- 보류/중복 표
- 권장 실행 순서 1..N과 근거
