---
description: search-to-issue — fluo 패키지 감사 범위와 목적을 question tool로만 확정하고, 패키지별 3개 auditor 결과를 묶어 사용자 승인 후 GitHub issue를 등록하는 무인자 command harness.
argument-hint: ""
---

# search-to-issue

이 커맨드는 repo-local package audit의 **harness**다. 감사 역할 자체는 전용 read-only auditor 에이전트가 소유한다. 이 커맨드는 범위/목적 확정, batch orchestration, 결과 dedup/bundling, issue draft, 사용자 승인 gate, 등록 순서 추천만 담당한다.

이 커맨드는 **무인자 전용**이다. `/search-to-issue` 뒤에 package, group, `all`, audit purpose를 받지 않는다. 모든 감사 범위와 목적은 question tool 응답으로만 확정한다.

## 사용법

```
/search-to-issue
```

예시:

- `/search-to-issue`

## 권한 경계

- 이 커맨드는 package audit issue의 **draft 생성 + 사용자 선택 + 선택된 issue 등록**까지만 담당한다.
- auditor 에이전트는 read-only다. 구현, PR 생성, merge, release/publish는 이 커맨드의 범위 밖이다.
- 명시적 승인/선택 없이 `gh issue create`를 실행하지 않는다. issue draft와 severity summary를 사용자에게 보여준 뒤, 승인/선택된 초안에만 실행한다.
- 사용자가 “조사만” 요청하거나 승인 결과가 0건이면 `gh issue create`를 실행하지 않는다.
- 보안 취약점으로 보이는 내용은 public issue로 만들지 말고 `SECURITY.md` 경로를 안내한다.
- 단순 지원/사용법 질문은 issue 대신 `SUPPORT.md`와 Discussions 경로를 안내한다.

## 1. Intake Question Gate — 감사 범위와 목적 확정

커맨드 시작 시 audit target scope와 audit purpose를 `question` tool로 확정한다. invocation 인자는 이 커맨드의 입력 계약이 아니며, package/group/all 또는 목적처럼 보이는 텍스트가 있어도 scope나 purpose로 사용하지 않는다. 질문 응답 없이 감사 실행, package manifest 조회, `gh` 조회, auditor 호출, `all` 확정, batch plan 작성을 시작하지 않는다.

### Question-only 호출 계약

사용자가 `/search-to-issue`를 호출하면 아래 규칙을 따른다.

1. 첫 번째 실행 동작은 반드시 `question` tool 호출이다. package manifest 조회, `gh` 조회, auditor 호출, `all` 확정, batch plan 작성은 질문 응답 전까지 하지 않는다.
2. 첫 `question` tool 호출에는 아래 두 질문을 함께 포함한다.
   - `감사 범위`: 어떤 package, package group, 또는 전체 public packages를 감사할지 묻는다.
   - `감사 목적`: 버그 찾기, 리팩터링 후보, 신기능 추가, 계약/API 정합성 등 어떤 목적의 finding을 우선할지 복수 선택으로 묻는다.
3. `입력된 범위 사용` 또는 `입력된 목적 사용` 선택지는 제공하지 않는다. 이전 메시지나 invocation text를 default로 삼지 않는다.
4. 사용자가 `패키지 그룹 선택`을 고르면 preflight 전에 즉시 후속 `question` tool로 group 이름을 확정한다.
5. 사용자가 `패키지 직접 지정`을 고르고 custom answer에 package 이름을 쓰지 않았으면 preflight 전에 즉시 후속 `question` tool로 package directory name 또는 public package name을 입력받는다.
6. 사용자가 `중단`을 고르거나 후속 질문 뒤에도 scope가 비어 있으면 auditor를 호출하지 않고 종료한다. 빈 입력을 `all`로 해석하지 않는다.
7. raw invocation args가 비어 있지 않으면 해당 텍스트를 `audit_intake.raw_input_ignored`에 기록하고, 사용자에게 “이 커맨드는 인자를 사용하지 않으므로 질문으로 다시 확정한다”고 한 문장으로 알린 뒤 동일한 question-only flow를 진행한다.

### 1차 질문: 어떤 package scope를 감사할지

Header: `감사 범위`

질문: `어떤 패키지 범위를 감사할까요?`

기본 선택지:

- `패키지 직접 지정`: package directory name 또는 public package name을 직접 입력받는다. 예: `runtime http`
- `패키지 그룹 선택`: supported package group 중 하나를 고르게 한다.
- `전체 public packages`: `packages/*/package.json` 기준 workspace public packages 전체를 대상으로 한다.
- `중단`: audit을 시작하지 않는다.

`패키지 그룹 선택`을 고르면 후속 질문으로 아래 group 중 하나를 고르게 한다.

- `foundation`
- `http-runtime`
- `request-pipeline`
- `auth`
- `infra-messaging`
- `protocol-adapters`
- `persistence`
- `operations`
- `cli`

`패키지 직접 지정`을 고르면 question custom answer 또는 후속 question 응답을 scope input으로 사용하되, 실제 package 확정은 Scope Resolution 규칙을 따른다.

### 2차 질문: 어떤 목적으로 findings를 찾을지

Header: `감사 목적`

질문: `이번 audit에서 어떤 목적의 문제를 우선 찾을까요? 여러 개를 선택할 수 있습니다.`

`question` tool 호출 시 이 질문은 `multiple: true`로 설정한다. 사용자가 두 개 이상 선택하면 선택된 모든 목적을 `selected_purposes`에 보존한다. `종합 감사`가 다른 목적과 함께 선택되면 `selected_purposes`는 `comprehensive`로 정규화하고, 함께 선택한 목적은 `purpose_note`에 emphasis로 기록한다.

기본 선택지:

- `버그 찾기`: correctness, regression, security-adjacent risk, runtime failure 가능성 우선
- `리팩터링 후보`: maintainability, duplication, package boundary cleanup, public API 정리 우선
- `신기능 추가`: 새 기능을 추가하거나 확장할 때 필요한 contract/API/test/docs gap 우선
- `계약/API 정합성`: README, public API, behavioral contract, docs/CONTEXT 불일치 우선
- `아키텍처/패키지 경계`: layering, dependency direction, resource ownership, environment isolation 우선
- `테스트/엣지 케이스`: regression coverage, edge case, teardown/flake, docs-test mismatch 우선
- `문서/북 동기화`: docs/book/examples companion update 필요성 우선
- `릴리스 영향`: changeset, changelog, release governance, breaking/behavior-change 영향 우선
- `NestJS 차이/마이그레이션`: NestJS와 동일하거나 호환된다고 보지 않고, 표준 데코레이터 기반 fluo로 옮길 때 사용자가 오해하기 쉬운 차이와 migration gap 우선
- `종합 감사`: 위 목적을 모두 열어두고 auditor별 기본 role scope로 감사

선택된 목적들은 auditor의 role scope를 축소하지 않는다. 각 package마다 3개 auditor invocation은 그대로 유지하되, auditor prompt의 `CONTEXT`에 `audit_purposes`로 전달하여 finding 우선순위, issue draft `Why Now`, affected surface 판단에 반영한다.

Intake 확정 결과는 다음 형태로 기록한다.

```yaml
audit_intake:
  raw_input_ignored: <raw invocation args if any | none>
  selected_scope_input: <question-confirmed package/group/all input>
  selected_purposes:
    - bug-finding | refactoring | feature-addition | contract-api | architecture-boundary | tests-edge | docs-book-sync | release-impact | nestjs-migration-gap | comprehensive
  purpose_note: <optional user-entered purpose detail | none>
```

`중단`이 선택되거나 scope가 비어 있으면 auditor를 호출하지 않고 종료한다.

## 2. Scope Resolution — 한 번만 수행

Audit target scope는 Intake Question Gate에서 확정한 `selected_scope_input`을 기준으로 아래 우선순위로 **한 번만** 결정한다. 한 번 결정한 뒤에는 package 선택을 재확장하지 않는다.

1. **Explicit package names**
   - 사용자가 하나 이상의 package directory name 또는 public package name을 직접 지정하면, group/all 해석을 무시하고 해당 패키지만 감사한다.
   - 허용 예: `core`, `runtime`, `socket.io`, scoped public package name
2. **Package group**
    - explicit package가 없고 지원 group명이 있으면 해당 group에 속한 패키지만 감사한다.
3. **All**
    - 사용자가 `all` 또는 `전체 public packages`를 question gate에서 명시적으로 확정한 경우에만 `packages/*/package.json` 기준 workspace public packages 전체를 감사한다.
    - raw invocation args, 이전 메시지, 빈 `selected_scope_input`은 `all`이 아니다. question gate 응답으로 확정되지 않은 경우 질문을 다시 하거나 종료한다.
    - `all`은 package 이름이 아니라 예약된 scope keyword다. `all` 입력을 `core` 또는 foundation 대표 패키지로 치환하거나 sampling/대표 감사로 축소하면 안 된다.
    - 기본값에는 `examples/*`와 internal tooling workspace를 포함하지 않는다. 사용자가 명시적으로 요청한 경우만 포함한다.
    - package 목록은 하네스가 한 번만 확정한다. OpenCode `glob`/`read` 또는 허용된 `git ls-files*`만 사용하고, `find | xargs`, broad shell pipeline, shell redirection, `-exec`는 사용하지 않는다.
    - `all` mode에서는 확정 직후 전체 package manifest를 사용자/ledger에 출력한다. 현재 기준 expected count는 `41`이며, count가 다르면 감사 시작 전에 `docs/reference/package-surface.md`, `packages/*/package.json`, 이 command의 group table 불일치로 보고하고 중단한다.
    - `all` mode에서는 group table union이 확정 package 목록과 정확히 같아야 한다. 누락 또는 초과 package가 있으면 auditor를 호출하지 않고 mismatch 목록을 먼저 보고한다.

Scope 확정 결과는 다음 형태로 기록하고 이후 모든 phase에서 그대로 사용한다.

```yaml
scope_decision:
  mode: explicit-packages | package-group | all
  input: <question-confirmed selected_scope_input>
  packages: [<pkg>, ...]
  excluded_reason: <group/all ignored because explicit packages were provided | none>
  audit_purposes: <audit_intake.selected_purposes>
  purpose_note: <audit_intake.purpose_note>
```

## 3. Supported Package Groups

- `foundation`: `core`, `config`, `di`, `i18n`, `runtime`
- `http-runtime`: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`
- `request-pipeline`: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`
- `auth`: `jwt`, `passport`
- `infra-messaging`: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- `protocol-adapters`: `websockets`, `socket.io`
- `persistence`: `prisma`, `drizzle`, `mongoose`
- `operations`: `metrics`, `terminus`, `throttler`
- `cli`: `cli`, `studio`, `testing`, `vite`

## 4. Preflight

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

## 5. Batch Orchestration

- 권장 batch size는 4 packages다.
- batch가 여러 개여도 Scope Resolution 결과의 package 목록과 Intake Question Gate의 audit purposes만 사용한다.
- `all` mode의 41개 package는 4개 단위로 11개 batch를 만든다. 마지막 batch는 1개 package가 된다.
- batch 시작 전 아래 manifest를 먼저 작성한다. manifest 없이 auditor를 호출하지 않는다.

```yaml
batch_plan:
  batch_size: 4
  package_count: <scope_decision.packages.length>
  expected_auditor_invocations: <package_count * 3>
  batches:
    - id: 1
      packages: [<pkg>, <pkg>, <pkg>, <pkg>]
      expected_invocations: 12
```

- 각 batch가 끝날 때마다 findings를 수집하고, 중복 후보와 package-level draft를 갱신한다.
- 대규모 audit에서도 선택된 각 패키지마다 정확히 3개 auditor invocation을 유지한다.
- auditor에게 `all` 범위를 직접 위임하지 않는다. 하네스가 확정한 단일 package 이름을 각 auditor invocation의 `package: <pkg>`로 전달한다.
- batch 완료 시 아래 ledger를 갱신한다. `actual_invocations`가 `expected_invocations`와 다르면 그 즉시 실패로 처리하고 다음 batch로 진행하지 않는다.

```yaml
batch_ledger:
  batch_id: <n>
  packages: [<pkg>, ...]
  expected_invocations: <packages.length * 3>
  actual_invocations: <number completed>
  missing_invocations:
    - package: <pkg>
      auditor: fluo-package-contract-api-reviewer | fluo-package-architecture-reviewer | fluo-package-tests-edge-reviewer
```

## 6. Auditor Delegation

선택된 각 package마다 아래 3개 에이전트를 각각 1회 호출한다.

1. `fluo-package-contract-api-reviewer`
2. `fluo-package-architecture-reviewer`
3. `fluo-package-tests-edge-reviewer`

호출은 subagent name을 명시해 수행한다. 커맨드 문서 안에서는 agent 이름 앞에 at-sign을 붙이지 않는다.

커맨드는 auditor role body를 재구현하지 않는다. 각 invocation은 다음 6개 섹션 구조로 최소 컨텍스트만 전달한다.

하네스 self-check:

- 단일 package당 auditor invocation set은 정확히 `{contract-api, architecture, tests-edge}`여야 한다.
- 같은 package/auditor 조합을 중복 호출하지 않는다.
- package 하나라도 3개 결과가 모두 없으면 finding intake, deduplication, issue draft 단계로 넘어가지 않는다.
- auditor 결과가 `[]`이더라도 해당 invocation은 completed로 기록한다.

```md
subagent_type: fluo-package-contract-api-reviewer
load_skills: [fluo-package-audit]

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
- Prioritize findings that match any selected `audit_purposes`, but do not suppress real P0/P1 findings outside those purposes.

## MUST NOT DO
- Do not edit files.
- Do not run `gh issue create`.
- Do not audit outside your role scope.
- Do not expand `all`, list every package, or run `find | xargs`, broad shell pipelines, shell redirection, or `-exec`.

## CONTEXT
- scope_decision: <fixed scope_decision yaml>
- audit_purposes: <audit_intake.selected_purposes and purpose_note>
- package: <pkg>
- canonical docs: <relevant preflight paths>
```

동일한 6개 섹션 구조로 `fluo-package-architecture-reviewer`와 `fluo-package-tests-edge-reviewer`도 호출하되, role-specific 판단은 각 agent 파일의 정의에 맡긴다.

## 7. Finding Intake Schema

Auditor 결과는 다음 필드를 가진 finding만 수집한다.

```yaml
severity: P0 | P1 | P2
package: <package directory name>
evidence: <file:line one or more>
problem: <one sentence>
contract_impact: none | doc-only | behavior-change | breaking
affected_surfaces:
  package: required | needs-check | not-required
  docs: required | needs-check | not-required
  book: required | needs-check | not-required
  examples: required | needs-check | not-required
docs_book_impact: none | needs-check | docs-required | book-required | docs-and-book-required
purpose_alignment: primary | secondary | unrelated-critical
preserve_contract_fix: <contract-preserving fix>
contract_change_needed: <true/false and reason if true>
```

Rules:

- 근거 없는 finding은 버린다.
- `affected_surfaces`에는 canonical path 근거가 있어야 한다.
- user-facing behavior 변경 가능성이 있으면 `docs`와 `book`은 기본 `needs-check`로 다룬다.
- 공개 scoped fluojs package의 release impact 가능성이 있으면 changeset 필요성을 draft에 `required` / `needs-check` / `not-required`로 표시한다.
- `purpose_alignment: unrelated-critical`은 선택된 audit purpose와 직접 맞지 않지만 P0/P1로 놓치면 안 되는 finding에만 사용한다.

## 8. Deduplication

기존 열린 issue 및 batch 내부 findings와 비교한다. 아래 중 2개 이상이 겹치면 중복 후보로 본다.

- 같은 `area:*` label
- 같은 핵심 theme keyword
- 같은 package 또는 같은 file evidence
- 같은 `contract_impact`
- 겹치는 `audit_purposes` 또는 같은 `purpose_alignment`
- 같은 `docs/` / `book` affected surface 또는 같은 user-facing workflow

중복 후보는 새 issue로 바로 승격하지 않고, 기존 issue 번호/URL과 함께 보류 목록에 둔다.

## 9. Issue Draft Bundling

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
## Audit Purpose
## Findings
## Contract Impact
## Suggested Resolution
## Affected Packages
## Affected Surfaces
## Why Now
```

`## Findings`에는 severity bucket과 `file:line` evidence를 포함한다. `## Affected Surfaces`에는 package source/test, package README, `docs/`, `book/`, examples, changeset 필요성을 `required` / `needs-check` / `not-required`와 canonical path 근거로 적는다.

## 10. Severity Summary Gate

사용자 승인 전 반드시 확정된 audit purpose와 최종 findings를 P0 / P1 / P2 bucket으로 보여준다.

각 bucket 항목에는 다음을 포함한다.

- draft ID
- package name
- 짧은 문제 요약
- purpose alignment
- 대표 `file:line`
- 대응 draft issue title

## 11. User Selection Gate

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

## 12. Label Allowlist

실제 저장소에 존재하는 아래 allowlist label만 사용한다. 모든 audit issue에는 `source:package-audit`를 붙인다.

- **priority**: `priority:p0`, `priority:p1`, `priority:p2`
- **area**: `area:foundation`, `area:request-pipeline`, `area:auth`, `area:http-runtime`, `area:infra-messaging`, `area:protocol-adapters`, `area:cli`, `area:persistence`
- **type**: `bug`, `enhancement`, `documentation`, `performance`, `tech-debt`, `type:maintainability`
- **scope**: `scope:security`, `scope:nestjs-parity`
- **wave**: `wave:1`, `wave:2`, `wave:3`
- **source**: `source:package-audit`

`scope:nestjs-parity`는 기존 GitHub label 이름일 때만 사용한다. Issue title/body와 audit purpose 문구에서는 fluo가 NestJS와 동일하거나 호환된다고 쓰지 말고, `NestJS 차이/마이그레이션` 또는 `NestJS migration gap`으로 표현한다.

Package → area mapping:

- `area:foundation`: `core`, `config`, `di`, `i18n`, `runtime`
- `area:http-runtime`: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`, `terminus`, `metrics`
- `area:request-pipeline`: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`, `throttler`
- `area:auth`: `jwt`, `passport`
- `area:infra-messaging`: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- `area:protocol-adapters`: `websockets`, `socket.io`
- `area:persistence`: `prisma`, `drizzle`, `mongoose`
- `area:cli`: `cli`, `studio`, `testing`, `vite`

## 13. Issue Registration

승인된 draft만 등록한다.

```bash
gh issue create --title "<draft title>" --body "<draft body>" --label "source:package-audit,<priority>,<area>,<type>[,<scope>][,<wave>]"
```

등록 전 `gh label list` 결과에 없는 label은 제거하거나 사용자에게 보류 사유로 보고한다. label을 임의 생성하지 않는다.

## 14. Execution Order Recommendation

등록 후 권장 실행 순서를 제시한다.

정렬 기준:

1. `priority:p0` > `priority:p1` > `priority:p2`
2. `wave:1` > `wave:2` > `wave:3`
3. 기반 layer 우선: `foundation` → `http-runtime` / `request-pipeline` / `auth` → `infra-messaging` / `persistence` / `protocol-adapters` → `cli`
4. 계약 risk 우선: `breaking` / `behavior-change` > `doc-only` / `none`

## 15. Output Contract

최종 보고는 한국어로 작성하고 아래 항목을 포함한다.

- `result: 생성 이슈 N건, 보류 M건, 중복 후보 K건`
- 확정된 audit scope와 audit purpose
- P0 / P1 / P2 요약 표 또는 목록
- 사용자 선택 결과 요약
- draft ID → issue title 매핑 표
- 등록된 이슈 표
- 보류/중복 표
- 권장 실행 순서 1..N과 근거
