---
description: search-issue — fluo 패키지 issue discovery 범위와 목적을 question tool로만 확정하고, purpose별 reviewer/R&D 결과를 registration triage한 뒤 등록 가능한 GitHub issue를 자동 등록하는 무인자 command harness.
argument-hint: ""
---

# search-issue

이 커맨드는 repo-local package issue discovery의 **harness**다. 범위/목적 확정, purpose routing, batch orchestration, issue draft, registration triage, 등록 가능한 issue 자동 등록, `/create-lane` handoff만 담당한다.

이 커맨드는 **무인자 전용**이며, 모든 감사 범위와 목적은 question tool 응답으로만 확정한다.

## 사용법

```
/search-issue
```

예시:

- `/search-issue`

## 권한 경계

- 이 커맨드는 package audit issue의 **draft 생성 + registration triage + 등록 가능한 issue 자동 등록**까지만 담당한다.
- 구현, PR 생성, merge, release/publish는 이 커맨드의 범위 밖이다.
- `/search-issue` 호출은 command harness authority로 간주한다. 사용자별 draft 선택 gate를 열지 않고, `fluo-package-issue-registration-reviewer`가 `register`로 판정한 draft만 `gh issue create`로 등록한다.
- 사용자가 “조사만” 요청했거나 registration triage 결과 `register`가 0건이면 `gh issue create`를 실행하지 않는다.
- 보안 취약점으로 보이는 내용은 public issue로 만들지 말고 `SECURITY.md` 경로를 안내한다.
- 단순 지원/사용법 질문은 issue 대신 `SUPPORT.md`와 Discussions 경로를 안내한다.

## 1. Intake Question Gate — 감사 범위와 목적 확정

커맨드 시작 시 audit target scope와 audit purpose를 `question` tool로 확정한다. 질문 응답 없이 감사 실행, package manifest 조회, `gh` 조회, auditor 호출, batch plan 작성을 시작하지 않는다.

### Question-only 호출 계약

사용자가 `/search-issue`를 호출하면 아래 규칙을 따른다.

1. 첫 번째 실행 동작은 반드시 `question` tool 호출이다.
2. 첫 `question` tool 호출에는 아래 두 질문을 함께 포함한다.
   - `감사 범위`: 어떤 package, package group, 또는 전체 public packages를 감사할지 묻는다.
   - `감사 목적`: 버그 찾기, 리팩터링 후보, 신기능 추가, 계약/API 정합성 등 어떤 목적의 finding을 우선할지 복수 선택으로 묻는다.
3. 사용자가 `패키지 그룹 선택`을 고르면 preflight 전에 즉시 후속 `question` tool로 group 이름을 확정한다.
4. 사용자가 `패키지 직접 지정`을 고르고 custom answer에 package 이름을 쓰지 않았으면 preflight 전에 즉시 후속 `question` tool로 package directory name 또는 public package name을 입력받는다.
5. 사용자가 `중단`을 고르거나 후속 질문 뒤에도 scope가 비어 있으면 auditor를 호출하지 않고 종료한다.

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
- `ui`
- `cli`

`패키지 직접 지정`을 고르면 question custom answer 또는 후속 question 응답을 scope input으로 사용하되, 실제 package 확정은 Scope Resolution 규칙을 따른다.

### 2차 질문: 어떤 목적으로 findings를 찾을지

Header: `감사 목적`

질문: `이번 audit에서 어떤 목적의 문제를 우선 찾을까요? 여러 개를 선택할 수 있습니다.`

`question` tool 호출 시 이 질문은 `multiple: true`로 설정한다. 사용자가 두 개 이상 선택하면 선택된 모든 목적을 `selected_purposes`에 보존한다. `종합 감사`가 단독 선택되면 `selected_purposes`는 `comprehensive`만 기록한다. `종합 감사`가 다른 목적과 함께 선택되면 `comprehensive`와 함께 선택한 목적을 모두 보존하고, `purpose_note`에 emphasis로 기록한다. 이때 `feature-addition`이 함께 있으면 `fluo-package-feature-rd-reviewer` route를 유지해야 한다.

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

선택된 목적들은 reviewer/R&D agent routing key로 사용한다. purpose는 단순 prompt hint가 아니며, Scope Resolution 뒤에 `route_plan`을 만들어 package별 호출 agent, 산출물 타입, non-goals, issue 승격 조건을 확정한다.

Intake 확정 결과는 다음 형태로 기록한다.

```yaml
audit_intake:
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
    - 빈 `selected_scope_input`은 `all`이 아니다. question gate 응답으로 확정되지 않은 경우 질문을 다시 하거나 종료한다.
    - `all`은 package 이름이 아니라 예약된 scope keyword다. `all` 입력을 `core` 또는 foundation 대표 패키지로 치환하거나 sampling/대표 감사로 축소하면 안 된다.
    - 기본값에는 `examples/*`와 internal tooling workspace를 포함하지 않는다. 사용자가 명시적으로 요청한 경우만 포함한다.
    - package 목록은 하네스가 한 번만 확정한다. OpenCode `glob`/`read` 또는 허용된 `git ls-files*`만 사용하고, `find | xargs`, broad shell pipeline, shell redirection, `-exec`는 사용하지 않는다.
    - `all` mode에서는 확정 직후 전체 package manifest를 사용자/ledger에 출력한다. 현재 기준 expected count는 `42`이며, count가 다르면 감사 시작 전에 `docs/reference/package-surface.md`, `packages/*/package.json`, 이 command의 group table 불일치로 보고하고 중단한다.
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
- `ui`: `react`
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

## 5. Purpose Router and Batch Orchestration

- 권장 batch size는 7 packages다.
- batch가 여러 개여도 Scope Resolution 결과의 package 목록과 Intake Question Gate의 audit purposes만 사용한다.
- `all` mode의 42개 package는 7개 단위로 6개 batch를 만든다. 모든 batch는 각각 7개 package가 된다 (`7 × 6 = 42`).
- `all` mode에서 `comprehensive`를 단독 선택하면 package별 primary reviewer triad를 실행하므로 expected primary invocations는 `126`회다 (`42 × 3`). Trigger된 conditional specialist invocation은 이 수치에 별도로 더한다.
- batch 시작 전 package별 `route_plan`을 먼저 작성한다. `route_plan`과 batch manifest 없이 reviewer/R&D agent를 호출하지 않는다.
- `expected_agent_invocations`는 고정 `package_count * 3`이 아니다. 각 package의 `route_plan.primary_agents.length` 합계와 `conditional_agents` 중 실제 trigger된 호출 수를 기준으로 계산한다.

### Purpose routing matrix

| normalized purpose | primary agents | output type | default issue gate |
| --- | --- | --- | --- |
| `bug-finding` | `fluo-package-architecture-reviewer`, `fluo-package-tests-edge-reviewer` | `audit_finding` | evidence-backed P0/P1/P2 only |
| `refactoring` | `fluo-package-architecture-reviewer` | `audit_finding` | concrete maintainability risk only; no style-only issues |
| `feature-addition` | `fluo-package-feature-rd-reviewer` | `rd_brief` | candidate/defer first; issue only after clear user problem and evidence |
| `contract-api` | `fluo-package-contract-api-reviewer` | `audit_finding` | README/API/docs contract mismatch only |
| `architecture-boundary` | `fluo-package-architecture-reviewer` | `audit_finding` | layer, dependency, resource, runtime boundary risk only |
| `tests-edge` | `fluo-package-tests-edge-reviewer` | `audit_finding` | missing regression/edge coverage with contract evidence only |
| `docs-book-sync` | `fluo-package-docs-book-reviewer` | `audit_finding` | docs/book/examples parity or companion gap only |
| `release-impact` | `fluo-package-release-impact-reviewer` | `audit_finding` | public package behavior/API/docs release impact only |
| `nestjs-migration-gap` | `fluo-package-nestjs-migration-reviewer` | `audit_finding` | unsupported NestJS assumption or migration gap only |
| `comprehensive` | `fluo-package-contract-api-reviewer`, `fluo-package-architecture-reviewer`, `fluo-package-tests-edge-reviewer` | `audit_finding` | fixed triad first, specialist agents only on explicit trigger |

Conditional routing rules:

- `comprehensive` starts with the existing 3 reviewer triad, then may call specialist agents only when triad findings identify a docs/book, release, or NestJS migration trigger.
- `comprehensive` combined with any explicit purpose keeps that explicit route. For example, `comprehensive + feature-addition` runs the triad and `fluo-package-feature-rd-reviewer`.
- If multiple selected purposes map to the same agent for the same package, call that agent once and pass all matching purposes in `audit_purposes`.
- `feature-addition` must not use architecture/test findings as a substitute for R&D. It must produce `rd_brief` first; issue drafts from R&D require documented gap evidence and registration triage.
- P0/P1 findings outside the selected purposes may be retained only as `purpose_alignment: unrelated-critical`.

`route_plan` schema:

```yaml
route_plan:
  package: <pkg>
  purposes:
    - bug-finding | refactoring | feature-addition | contract-api | architecture-boundary | tests-edge | docs-book-sync | release-impact | nestjs-migration-gap | comprehensive
  primary_agents:
    - fluo-package-architecture-reviewer
  conditional_agents:
    - agent: fluo-package-contract-api-reviewer
      trigger: "finding indicates README/docs contract mismatch"
  expected_outputs:
    audit_finding: true
    rd_brief: false
  non_goals:
    - "Do not propose speculative features"
    - "Do not report style-only refactors"
```

```yaml
batch_plan:
  batch_size: 7
  package_count: <scope_decision.packages.length>
  expected_agent_invocations: <sum(route_plan.primary_agents) + triggered conditional agents>
  batches:
    - id: 1
      packages: [<pkg>, ...]
      route_plans: [<route_plan>, ...]
      expected_invocations: <sum of route_plan primary agents plus triggered conditional agents>
```

- 각 batch가 끝날 때마다 findings를 수집하고, 중복 후보와 package-level draft를 갱신한다.
- 대규모 audit에서도 선택된 각 패키지마다 확정된 `route_plan`의 primary agent invocation을 완료해야 한다.
- reviewer/R&D agent에게 `all` 범위를 직접 위임하지 않는다. 하네스가 확정한 단일 package 이름을 각 invocation의 `package: <pkg>`로 전달한다.
- batch 완료 시 아래 ledger를 갱신한다. `actual_invocations`가 `expected_invocations`와 다르면 그 즉시 실패로 처리하고 다음 batch로 진행하지 않는다.

```yaml
batch_ledger:
  batch_id: <n>
  packages: [<pkg>, ...]
  expected_invocations: <sum of route_plan invocations>
  actual_invocations: <number completed>
  missing_invocations:
    - package: <pkg>
      agent: <expected reviewer/R&D agent name>
```

## 6. Reviewer/R&D Delegation

선택된 각 package마다 `route_plan.primary_agents`에 포함된 에이전트를 각각 1회 호출한다. 같은 package/agent 조합은 중복 호출하지 않는다. 조건부 agent는 `route_plan.conditional_agents.trigger`가 batch 결과에서 충족된 경우에만 호출하고 ledger에 trigger 근거를 기록한다.

호출은 subagent name을 명시해 수행한다. 커맨드 문서 안에서는 agent 이름 앞에 at-sign을 붙이지 않는다.

커맨드는 reviewer/R&D role body를 재구현하지 않는다. 각 invocation은 다음 6개 섹션 구조로 최소 컨텍스트만 전달한다.

하네스 self-check:

- 단일 package당 invocation set은 `route_plan.primary_agents`와 trigger된 `conditional_agents`의 합계와 정확히 같아야 한다.
- 같은 package/agent 조합을 중복 호출하지 않는다.
- package 하나라도 expected result가 없으면 finding intake, deduplication, issue draft 단계로 넘어가지 않는다.
- reviewer 결과가 `[]`이거나 R&D 결과가 `issue_eligibility: reject`이더라도 해당 invocation은 completed로 기록한다.

```md
subagent_type: <route_plan agent name>
load_skills: [fluo-package-audit]

## TASK
Run the assigned `/search-issue` route for package `<pkg>` within the already resolved scope.

## EXPECTED OUTCOME
Return only the schema required by this route: `audit_finding` for reviewer routes or `rd_brief` for feature R&D routes.

## REQUIRED TOOLS
Read/grep/glob/list only.

## MUST DO
- Use file:line evidence.
- Respect `docs/contracts/behavioral-contract-policy.md`.
- Assess affected surfaces with canonical path reasons.
- Audit only the assigned package `<pkg>` from `scope_decision.packages`.
- Follow the exact `route_plan` for this package and agent.
- Prioritize outputs that match selected `audit_purposes`, but do not suppress real P0/P1 findings outside those purposes.
- For `feature-addition`, return `rd_brief` candidates/deferred/rejected items; do not invent implementation work without evidence.

## MUST NOT DO
- Do not audit outside your role scope or route purpose.
- Do not expand `all` or list every package.

## CONTEXT
- scope_decision: <fixed scope_decision yaml>
- route_plan: <package route_plan yaml>
- audit_purposes: <audit_intake.selected_purposes and purpose_note>
- package: <pkg>
- canonical docs: <relevant preflight paths>
```

role-specific 판단은 각 agent 파일의 정의에 맡긴다.

## 7. Result Intake Schema

Reviewer 결과는 다음 필드를 가진 `audit_finding`만 수집한다.

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

Feature R&D 결과는 `audit_finding`이 아니라 다음 `rd_brief` schema로 수집한다.

```yaml
rd_brief:
  package: <package directory name>
  purpose: feature-addition
  user_problem: <user/developer problem this would solve>
  evidence_basis: <README/docs/current limitation/open issue evidence>
  current_surface: <current API/docs behavior>
  recommended_option: <minimal viable direction>
  alternatives:
    - <optional alternative and tradeoff>
  contract_impact: none | doc-only | behavior-change | breaking
  tests_docs_release_plan: <summary of needed tests/docs/changeset>
  issue_eligibility: candidate | defer | reject
  anti_speculation_reason: <why defer/reject if not candidate>
```

Rules:

- 근거 없는 finding은 버린다.
- `affected_surfaces`에는 canonical path 근거가 있어야 한다.
- user-facing behavior 변경 가능성이 있으면 `docs`와 `book`은 기본 `needs-check`로 다룬다.
- 공개 scoped fluojs package의 release impact 가능성이 있으면 changeset 필요성을 draft에 `required` / `needs-check` / `not-required`로 표시한다.
- `purpose_alignment: unrelated-critical`은 선택된 audit purpose와 직접 맞지 않지만 P0/P1로 놓치면 안 되는 finding에만 사용한다.
- `rd_brief.issue_eligibility: candidate`라도 바로 등록하지 않는다. documented gap evidence가 있어 draft로 승격되고 registration triage에서 `register` 판정을 받아야 등록한다.
- `file:line` evidence 없는 audit finding, “있으면 좋음” 수준의 feature idea, owner/fix theme이 불명확한 refactor, low-confidence P2는 issue draft로 승격하지 않고 deferred candidates로 둔다.

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
- `rd_brief`는 `issue_eligibility: candidate`만 draft 후보가 될 수 있다. `defer`와 `reject`는 deferred candidates에 남긴다.
- `feature-addition` draft는 audit title 대신 enhancement title을 사용한다: `[feature-rd][area:<area-label>] <사용자 문제/기능 방향> (<priority>)`.
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
## R&D Brief
## Contract Impact
## Suggested Resolution
## Affected Packages
## Affected Surfaces
## Why Now
```

`## Findings`에는 severity bucket과 `file:line` evidence를 포함한다. `## R&D Brief`에는 `user_problem`, `evidence_basis`, `recommended_option`, `anti_speculation_reason`을 포함한다. `## Affected Surfaces`에는 package source/test, package README, `docs/`, `book/`, examples, changeset 필요성을 `required` / `needs-check` / `not-required`와 canonical path 근거로 적는다.

## 10. Registration Triage Gate

Deduplication과 Issue Draft Bundling 뒤에 `fluo-package-issue-registration-reviewer`를 호출해 draft별 등록 가능 여부를 판정한다. 이 triage 결과가 `/search-issue`의 command harness authority를 구체화한다.

Registration triage에 넘기는 입력:

- 확정된 `audit_intake`, `scope_decision`, `batch_ledger`
- draft issue 목록과 stable draft ID
- R&D candidate/deferred/rejected 목록
- 기존 열린 issue 중 중복 후보
- `gh label list`와 `.github/ISSUE_TEMPLATE/*.yml` 확인 결과
- `SECURITY.md`, `SUPPORT.md` 경로

`fluo-package-issue-registration-reviewer`는 draft마다 다음 schema를 반환한다.

```yaml
registration_triage:
  - draft_id: D1
    decision: register | defer | reject
    reason: <evidence-backed reason>
    labels:
      - source:package-audit
      - priority:p1
      - area:foundation
      - bug
    duplicate_of: <issue number/url | none>
    safety_route: public-issue | security-private | support-discussion | none
    confidence: high | medium | low
```

Registration rules:

- `decision: register`만 `gh issue create` 대상이다.
- `decision: defer`와 `decision: reject`는 보류/거절 목록에 남기고 등록하지 않는다.
- 중복 후보가 있으면 기본 `defer`이며, 동일 issue가 명확하면 `reject` + `duplicate_of`로 기록한다.
- security-sensitive 내용은 `reject` 또는 `defer`로 두고 `safety_route: security-private`를 기록한다.
- support/usage 질문은 `reject`로 두고 `safety_route: support-discussion`를 기록한다.
- low-confidence P2, evidence 없는 finding, speculative feature idea, owner/fix theme이 불명확한 refactor는 등록하지 않는다.
- label allowlist 밖 label이 필요하면 `defer`로 두고 사유를 기록한다.

등록 전 보고에는 확정된 audit purpose와 최종 findings를 P0 / P1 / P2 bucket으로 보여준다. `rd_brief` 결과는 severity bucket과 분리해 `R&D candidates`, `Deferred R&D`, `Rejected R&D`로 보여준다. 이어서 registration triage의 `register/defer/reject` 요약을 출력한다.

각 bucket 항목에는 다음을 포함한다.

- draft ID
- package name
- 짧은 문제 요약
- purpose alignment
- 대표 `file:line`
- 대응 draft issue title

R&D candidate 항목에는 다음을 포함한다.

- draft ID 또는 deferred ID
- package name
- user problem
- recommended option
- issue eligibility
- evidence basis

Registration triage 항목에는 다음을 포함한다.

- draft ID
- decision
- reason
- labels
- duplicate_of
- safety_route
- confidence

## 11. Automated Registration

Registration triage에서 `decision: register`로 판정된 draft는 모두 등록한다. `register`가 0건이면 side effect 없이 종료하고 보류/거절 사유를 보고한다.

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
- `area:http-runtime`: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`, `terminus`, `metrics`, `react`
- `area:request-pipeline`: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`, `throttler`
- `area:auth`: `jwt`, `passport`
- `area:infra-messaging`: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- `area:protocol-adapters`: `websockets`, `socket.io`
- `area:persistence`: `prisma`, `drizzle`, `mongoose`
- `area:cli`: `cli`, `studio`, `testing`, `vite`

Package group과 GitHub `area:*` label은 1:1 대응이 아니다. `operations` package group은 별도 `area:operations` label이 없으므로 위 mapping에 따라 `metrics`/`terminus`는 `area:http-runtime`, `throttler`는 `area:request-pipeline`로 분류한다. `ui` package group도 별도 `area:ui` label이 없으므로 HTTP dispatch와 server rendering 경계를 소유하는 `react`는 `area:http-runtime`으로 분류한다.

## 13. Issue Registration

Registration triage에서 `decision: register`로 판정된 draft만 등록한다.

```bash
gh issue create --title "<draft title>" --body "<draft body>" --label "source:package-audit,<priority>,<area>,<type>[,<scope>][,<wave>]"
```

등록 전 `gh label list` 결과에 없는 label은 제거하거나 보류 사유로 보고한다. label을 임의 생성하지 않는다. `fluo-package-issue-registration-reviewer`가 `security-private`, `support-discussion`, duplicate, low-confidence, 또는 label mismatch로 `defer`/`reject`한 draft는 등록하지 않는다.

## 14. Create-lane Handoff Recommendation

등록 후 이 커맨드는 구현 순서를 직접 lane으로 확정하지 않는다. 생성된 issue 목록과 보류/중복 후보를 요약하고, 사람이 다음 단계에서 `/create-lane`으로 실행 범위를 확정할 수 있도록 handoff command를 제안한다.

Search ledger를 생성한 경우 `.sisyphus/search-issue/<run-id>.json` 경로와 `search_run_id`를 최종 출력에 포함한다. Ledger를 생성하지 않은 단순 issue-number handoff라면 `search_run_id: none`을 명시하고 `/create-lane <created issue numbers> <base-branch>` 형태만 제안한다.

정렬 기준:

1. `priority:p0` > `priority:p1` > `priority:p2`
2. `wave:1` > `wave:2` > `wave:3`
3. 기반 layer 우선: `foundation` → `http-runtime` / `request-pipeline` / `ui` / `auth` → `infra-messaging` / `persistence` / `protocol-adapters` → `cli`
4. 계약 risk 우선: `breaking` / `behavior-change` > `doc-only` / `none`

정렬은 `/create-lane` 입력 제안일 뿐이며, 실제 lane queue와 dependency graph는 `/create-lane`의 사용자 gate를 통과한 뒤에만 확정된다.

## 15. Output Contract

최종 보고는 한국어로 작성하고 아래 항목을 포함한다.

- `result: 생성 이슈 N건, 보류 M건, 중복 후보 K건`
- 확정된 audit scope와 audit purpose
- P0 / P1 / P2 요약 표 또는 목록
- R&D candidate/deferred/rejected 요약
- registration triage 결과 요약
- draft ID → issue title 매핑 표
- 등록된 이슈 표
- 보류/중복 표
- search ledger path 또는 `search_run_id: none`
- `/create-lane <created issue numbers> <base-branch>` handoff command
- handoff 정렬 근거와 `/create-lane`에서 다시 확인해야 할 suggested additions
