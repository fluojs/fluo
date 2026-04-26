---
name: search-to-issue
description: fluo 저장소의 패키지 또는 패키지 그룹을 감사하고, 패키지당 3개 서브에이전트로 결과를 수집해 GitHub issue 초안을 만들고 사용자 승인 후 등록하는 패키지 감사 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: git-workflow
  mode: execution
  no_co_author: true
  argument-hint: "[패키지명... | 패키지 그룹명 | all]"
---

# Search-to-Issue Workflow

fluo 저장소의 패키지 또는 패키지 그룹을 감사하고, 패키지당 3개 서브에이전트로 결과를 수집해 GitHub issue 초안을 만들고 사용자 승인 후 등록하는 실행형 워크플로다.

이 스킬은 **fluo 저장소의 실제 패키지 구조, 공개 surface 문서, `docs/` 계약 문서, `book/` 학습 경로, behavioral contract 정책, GitHub label 체계**에 맞춘 repo-local 감사 스킬이다.

## Scope

- 사용자가 명시한 패키지 또는 패키지 그룹만 감사한다.
- 패키지 지정이 없고 그룹 지정도 없으면 `all`로 간주하여 전체 패키지를 대상으로 한다.
- 패키지 감사 대상은 입력 scope로 제한하지만, 발견된 이슈의 **수정 범위(change footprint)** 는 package source/test에 한정하지 않는다.
- 기능 추가/수정, 공개 API, documented behavior, 사용자 workflow, tutorial-facing behavior가 바뀔 수 있으면 `docs/`와 `book/` 영향도 반드시 산정한다.
- 각 선택 패키지마다 **고정 3개 서브에이전트**를 실행한다.
- 기본적으로 **패키지당 1개 issue**로 묶는다.
- 중복 issue를 피하고, 사용자 승인 후에만 실제 GitHub issue를 등록한다.

이 스킬은 다음 상황에 사용한다.

- "runtime이랑 http만 감사해서 issue 만들어줘"
- "foundation 그룹만 조사해줘"
- "전체 fluo 패키지 감사하고 issue 초안 뽑아줘"
- "search-to-issue로 package audit 이슈 등록해줘"

다음 상황에는 사용하지 않는다.

- 단일 trivial 버그 수정
- 이미 명확한 구현 이슈 하나만 바로 해결하면 되는 경우
- 단순 코드 설명/리뷰만 필요한 경우

## Repository-Specific Assumptions

이 저장소에서는 다음을 기준으로 삼는다.

1. 패키지 인벤토리는 `packages/*/package.json`이 source of truth다.
2. 공개 surface와 패밀리 설명은 `docs/reference/package-surface.md`를 우선 참조한다.
3. 저장소의 AI/doc navigation과 문서 surface 분류는 `docs/CONTEXT.md`와 `docs/CONTEXT.ko.md`를 기준으로 삼는다.
4. behavioral contract 판단은 `docs/contracts/behavioral-contract-policy.md`를 최우선 지침으로 삼는다.
5. 사람용 학습 흐름과 tutorial coverage는 `book/README.md`, `book/README.ko.md`, 관련 `book/*` 챕터를 기준으로 삼는다.
6. GitHub label은 실제 저장소에 존재하는 라벨만 사용한다.
7. 기본 issue 묶음 단위는 **패키지당 1개**다. 다만 같은 root cause와 같은 fix가 여러 패키지에 진짜로 공통이면 예외적으로 cross-package issue를 허용할 수 있다.
8. 패키지 변경이 버전업/릴리스 준비로 이어질 수 있으면 `docs/contracts/release-governance.md`, root `CHANGELOG.md`, `tooling/release/intents/README.md`를 release metadata 기준으로 삼는다.
9. 이 저장소의 승인된 릴리스 메타데이터 경로는 repo-local release intent JSON이며, Changesets/Beachball은 현재 승인된 경로가 아니다.

## Authority Boundary

- 이 스킬은 **draft issue 생성 + 사용자 선택 + issue 등록**까지만 담당한다.
- 등록된 issue를 실제 구현/PR로 넘기는 일은 `lane-supervisor` 또는 `issue-to-pr`의 책임이다.
- 사용자 선택 전에는 draft issue를 confirmed issue로 승격하지 않는다.

## Language Policy

- 이 스킬이 사용자에게 직접 보여주는 모든 문구는 한국어로 작성한다.
- All user-facing communication produced while using this skill must be written in Korean.
- 질문, 진행 상황, 승인 요청, 보류 설명, 최종 보고까지 모두 포함한다.
- GitHub URL, 브랜치명, 파일 경로, 패키지명, 라벨, 명령어, 코드 식별자, 저장소 고정 문자열은 원문을 유지한다.
- Raw command output, log output, quoted source text는 번역하지 않는다. 필요하면 별도로 한국어 설명을 붙인다.

## Scope Resolution Rules

범위 해석은 반드시 아래 순서를 따른다. **한 번 audit target scope가 결정되면 package 선택은 거기서 멈춘다.**

중요: 이 규칙은 "어떤 패키지를 감사할지"만 결정한다. 발견된 이슈를 해결할 때의 수정 범위는 별도의 **Change Footprint Pointer Map** 섹션을 따라 산정하며, `docs/`와 `book/`을 자동으로 제외하지 않는다.

1. **explicit package names**
   - 사용자가 하나 이상 패키지를 직접 언급하면, 패키지 그룹/`all` 확장은 무시하고 그 패키지들만 감사한다.
   - 다음 형식을 모두 허용한다.
     - 디렉터리명: `core`, `runtime`, `socket.io`
     - 공개 패키지명: `@fluojs/core`, `@fluojs/runtime`

2. **package group**
   - explicit package가 없고, 사용자가 아래 그룹 중 하나를 언급하면 그 그룹에 속한 패키지만 감사한다.

3. **all**
   - explicit package도 없고 group도 없으면 `packages/*/package.json` 기준의 fluo workspace packages 전체를 대상으로 한다.
   - 기본값에는 `examples/*`와 `@fluojs-internal/*` tooling workspace는 포함하지 않는다. 사용자가 명시적으로 요청한 경우만 포함한다.

## Change Footprint Pointer Map

수정 footprint를 스킬 안에서 재정의하지 않는다. 모든 finding은 아래 canonical 문서를 읽고, issue draft에는 `required` / `needs-check` / `not-required` 판단과 근거 path만 남긴다.

- package surface / family: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/package-folder-structure.md`
- behavior / README / test contract: `docs/contracts/behavioral-contract-policy.md`, `docs/contracts/testing-guide.md`, affected package `README.md` / `README.ko.md`
- release / versioning / publish metadata: `docs/contracts/release-governance.md`, `tooling/release/intents/README.md`, root `CHANGELOG.md`, `.github/workflows/release-single-package.yml`
- public API / platform contract: `docs/contracts/public-export-tsdoc-baseline.md`, `docs/contracts/platform-conformance-authoring-checklist.md`
- architecture / onboarding docs: `docs/CONTEXT.md`, `docs/CONTEXT.ko.md`, relevant `docs/architecture/*`, `docs/guides/*`, `docs/getting-started/*`
- book / tutorial path: `book/README.md`, `book/README.ko.md`, relevant `book/*/toc*.md`, relevant `book/*/ch*.md` / `.ko.md`
- examples / templates: `examples/README.md`, relevant `examples/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*.yml`

기능 추가/수정 또는 user-facing behavior 변경 가능성이 있으면 `docs/`와 `book/`은 기본 `needs-check`로 시작한다. 제외할 때만 위 문서 중 하나를 근거로 `not-required`를 적는다.
공개 `@fluojs/*` 패키지의 release-impact 가능성이 있으면 issue draft에 release-intent 필요성(`required` / `needs-check` / `not-required`)도 명시한다. `1.0.0-beta.2` 이상 후보 릴리스는 package별 `release` / `no-release` / `downstream-evaluate` 판단이 필요하다.

## Supported Package Groups

### `foundation`
- `core`
- `config`
- `di`
- `runtime`

### `http-runtime`
- `http`
- `platform-fastify`
- `platform-nodejs`
- `platform-express`
- `platform-bun`
- `platform-deno`
- `platform-cloudflare-workers`
- `terminus`
- `metrics`

### `request-pipeline`
- `validation`
- `serialization`
- `openapi`
- `graphql`
- `cache-manager`
- `throttler`

### `auth`
- `jwt`
- `passport`

### `infra-messaging`
- `redis`
- `queue`
- `cron`
- `cqrs`
- `event-bus`
- `microservices`
- `notifications`
- `email`
- `slack`
- `discord`

### `protocol-adapters`
- `websockets`
- `socket.io`

### `persistence`
- `prisma`
- `drizzle`
- `mongoose`

### `cli`
- `cli`
- `studio`
- `testing`

## Three-Subagent Fan-out Model

선택된 각 패키지마다 **반드시 3개 서브에이전트**를 만든다. 역할은 고정이며 서로 겹치지 않게 한다.

### 1. Contract/API reviewer
- 담당 범위:
  - package `README.md` / `README.ko.md`
  - package public API surface
  - `docs/reference/package-surface.md`
  - relevant `docs/reference/*`
  - relevant `docs/contracts/*`
  - `docs/CONTEXT.md` / `docs/CONTEXT.ko.md`
  - relevant `book/*` tutorial chapters and TOCs when the package appears in learning flows
- 중점 질문:
  - 문서화된 지원 기능이 실제 구현과 맞는가?
  - lifecycle guarantee / runtime invariant가 문서대로 지켜지는가?
  - intentional limitation이 깨졌거나 문서와 어긋나지 않았는가?
  - 이 이슈의 해결이 `docs/` 또는 `book/` 업데이트를 요구하거나 최소 확인해야 하는가?

### 2. Implementation/architecture reviewer
- 담당 범위:
  - package 구현 코드
  - internal layering / dependency direction
  - resource ownership / cleanup
  - environment isolation / configuration entry points
- 중점 질문:
  - 레이어 침범이나 공개 API boundary 누수가 있는가?
  - 자원 정리, shutdown, lifecycle ownership이 불명확한가?
  - `process.env` 직접 접근, implicit global state, adapter 경계 위반이 있는가?

### 3. Tests/edge-case reviewer
- 담당 범위:
  - package test suite
  - regression coverage
  - edge-case / flake / timeout / teardown risk
  - docs-test mismatch
- 중점 질문:
  - 문서화된 contract를 지키는 회귀 테스트가 있는가?
  - 중요한 edge case가 빠졌는가?
  - 기존 테스트가 flake-prone 하거나 lifecycle leak을 숨기고 있지는 않은가?

## Batching Rules

- 패키지 수가 많아도 **패키지당 3개 서브에이전트** 규칙은 유지한다.
- 다만 `all` 또는 대규모 그룹 실행 시에는 결과 품질을 위해 **패키지 batch 단위**로 나눠 진행한다.
- 권장 batch 크기: **4 packages at a time**
- 각 batch를 끝낼 때마다 수집/중복 제거/초안 묶기를 수행한다.

## Workflow

### Phase 1 — Intake

1. 사용자의 입력에서 explicit package / group / all 여부를 판정한다.
2. 위의 **Scope Resolution Rules**로 정확한 대상 패키지 목록을 만든다.
3. 범위가 크면 batching 계획을 먼저 만든다.

### Phase 2 — Preflight

1. 감사 전에 반드시 다음을 읽는다.
   - `docs/CONTEXT.md`
   - `docs/CONTEXT.ko.md`
   - `docs/contracts/behavioral-contract-policy.md`
   - `docs/reference/package-surface.md`
   - `docs/reference/package-folder-structure.md`
   - `book/README.md`
   - `book/README.ko.md`
   - 영향받는 패키지들의 `packages/*/README.md`
   - 필요한 경우 해당 `README.ko.md`
   - CLI/tooling 계열이면 `docs/reference/toolchain-contract-matrix.md`
   - platform/runtime 계열이면 `docs/contracts/platform-conformance-authoring-checklist.md`
   - public API/docs 계열이면 `docs/contracts/public-export-tsdoc-baseline.md`
   - 사용자 workflow나 튜토리얼 예제가 영향을 받을 수 있으면 관련 `book/*/toc*.md`, `book/*/ch*.md`, `book/*/*.ko.md`
2. GitHub issue 등록 전에는 반드시 다음을 확인한다.
   - `gh label list`
   - `gh issue list --state open`
   - `.github/ISSUE_TEMPLATE/*.yml`
   - `SUPPORT.md`
   - `SECURITY.md`

### Phase 3 — Package Fan-out

선택된 각 패키지마다 3개 서브에이전트를 실행한다.

- Contract/API reviewer
- Implementation/architecture reviewer
- Tests/edge-case reviewer

각 서브에이전트 프롬프트는 반드시 6개 섹션 형식을 따른다.

1. TASK
2. EXPECTED OUTCOME
3. REQUIRED TOOLS
4. MUST DO
5. MUST NOT DO
6. CONTEXT

### Phase 4 — Finding Schema

각 서브에이전트는 다음 필드를 포함하는 finding만 반환한다.

- `severity`: `P0` | `P1` | `P2`
- `package`: 패키지명
- `evidence`: `file:line` 하나 이상
- `problem`: 무엇이 문제인지 한 문장
- `contract_impact`: `none` | `doc-only` | `behavior-change` | `breaking`
- `affected_surfaces`: package/docs/book/examples별 `required` | `needs-check` | `not-required`와 canonical 문서 근거
- `docs_book_impact`: `none` | `needs-check` | `docs-required` | `book-required` | `docs-and-book-required`
- `preserve_contract_fix`: 계약을 유지한 수정안
- `contract_change_needed`: 계약 변경이 정말 필요한지 여부와 이유

### Phase 5 — Package-level Bundling

- 기본값은 **패키지당 1개 issue**다.
- 한 패키지 안에서는 severity 순서대로 findings를 정리한다.
- 서로 다른 severity를 한 묶음에 섞어도 되지만, body에서 severity를 분명히 분리한다.
- 초안 요약 단계에서는 반드시 findings를 **P0 / P1 / P2 buckets** 로 다시 정리해서 보여준다.
- 단, 아래 조건을 모두 만족할 때만 여러 패키지를 하나의 issue로 묶을 수 있다.
  1. 같은 root cause다.
  2. 같은 fix theme이다.
  3. 같은 contract impact다.
  4. 실제 수정 ownership이 공유된다.

### Phase 6 — Dedup

기존 열린 GitHub 이슈와 비교할 때는 다음 중 2개 이상이 겹치면 중복 후보로 본다.

- 같은 `area:*` 라벨
- 같은 핵심 테마 키워드
- 같은 패키지 또는 같은 파일 근거
- 같은 계약 영향 유형
- 같은 `docs/` / `book/` affected surface 또는 같은 사용자-facing workflow

중복 후보가 있으면 새 이슈를 바로 만들지 말고, 기존 이슈 번호와 함께 사용자에게 보여준다.

### Phase 7 — Issue Draft Format

모든 초안은 아래 고정 형식을 따른다.

각 초안에는 반드시 **stable draft ID**를 붙인다.

- 형식: `D1`, `D2`, `D3` ...
- severity summary와 `question` selection에서 title 대신 이 ID를 1차 식별자로 사용한다.

**Title 형식**
- `[audit][area:<area-label>] <짧은 해결 테마> (<priority>)`

**Body 형식**
- `## Context`
- `## Findings`
- `## Contract Impact`
- `## Suggested Resolution`
- `## Affected Packages`
- `## Affected Surfaces`
- `## Why Now`

`## Findings`에는 핵심 findings를 severity 순으로 정리하고, 각 항목에 `file:line` 근거를 넣는다.

`## Affected Surfaces`에는 package source/test뿐 아니라 package README, `docs/`, `book/`, examples 여부를 간단히 적고 관련 canonical path를 링크한다. `docs/` 또는 `book/`이 필요 없다고 판단한 경우에도 `not-required`와 근거 path를 명시한다.

### Phase 8 — Severity Summary Gate

- 초안 작성 후에는 반드시 최종 findings를 **P0 / P1 / P2** 순서로 다시 요약해서 사용자에게 먼저 보여준다.
- 이 요약은 "지금 당장 수정이 필요한 것들" 목록처럼 읽혀야 한다.
- 각 severity bucket에는 최소 다음을 포함한다.
  - draft ID
  - 패키지명
  - 짧은 문제 요약
  - 대표 `file:line`
  - 대응될 draft issue title

### Phase 9 — User Selection Gate (`question` tool)

- 초안 작성 후에는 반드시 `question` 도구를 사용해 **무엇을 실제 issue로 등록할지** 물어본다.
- 질문/헤더/선택지/설명은 모두 한국어로 작성한다.
- 기본 selection flow는 2단계다.

1. **등록 모드 선택**
   - `모두 등록`
   - `severity 기준으로 선택`
   - `초안별로 선택`
   - `등록 안 함`

2. **후속 선택**
   - `severity 기준으로 선택`이면 `P0`, `P1`, `P2` 중 하나 이상을 고르게 한다.
   - `초안별로 선택`이면 draft ID (`D1`, `D2`...) 목록 중 하나 이상을 고르게 한다.

- 사용자가 선택하지 않은 severity bucket이나 초안은 등록하지 않는다.
- `등록 안 함` 또는 승인 결과 0건이면 issue를 만들지 않고 종료한다.

### Phase 10 — Issue Registration

- `question` 결과로 선택된 초안만 `gh issue create --title ... --body ... --label ...` 형식으로 등록한다.
- 허용된 라벨만 사용한다.
- 실제 저장소에 없는 라벨은 임의 생성하지 않는다.

### Phase 11 — Execution Order Recommendation

등록 후에는 반드시 권장 실행 순서를 제시한다.

기본 정렬 규칙:
1. `priority:p0` > `priority:p1` > `priority:p2`
2. `wave:1` > `wave:2` > `wave:3`
3. 기반 레이어 우선: `foundation` → `http-runtime` / `request-pipeline` / `auth` → `infra-messaging` / `persistence` / `protocol-adapters` → `cli`
4. 계약 리스크 우선: `breaking` / `behavior-change` > `doc-only` / `none`

## behavioral contract guardrail

이슈 발굴 및 생성 시, 저장소의 `docs/contracts/behavioral-contract-policy.md`를 최우선 지침으로 삼는다.

- 패키지 README에 정의된 지원 기능을 제거/축소하는 수정안을 기본값으로 삼지 않는다.
- intentional limitation을 오류로 오인하여 수정 이슈를 만들지 않는다.
- 계약 변경이 필요한 경우 `## Contract Impact`에 필요성과 영향을 구체적으로 적는다.
- 계약 보존형 대안이 있으면 그 대안을 먼저 `## Suggested Resolution`에 적는다.
- 계약 또는 사용자 workflow가 바뀔 수 있으면 `## Affected Surfaces`에서 package README, `docs/`, `book/`, tests를 함께 다룬다.

## Safety Defaults

- 사용자가 “조사만” 요청하면 초안까지만 만들고 등록하지 않는다.
- 기본적으로 `source:package-audit` 라벨을 모든 이슈에 붙인다.
- 사용자의 명시적 선택 없이 이슈를 등록하지 않는다.
- `question` 결과에서 승인된 초안이 0개면 아무 이슈도 만들지 않고 종료한다.
- 보안 취약점으로 보이는 내용은 public issue로 만들지 않고 `SECURITY.md` 경로를 우선 안내한다.
- 단순 사용법 질문/지원 요청은 public issue 대신 `SUPPORT.md`와 Discussions 경로를 우선 안내한다.

## Mandatory Rules

- **audit target scope는 한 번만 결정하고 package 선택은 멈춘다.**
  - explicit package > package group > all
- **change footprint는 별도로 산정한다.**
  - package/docs/book/examples를 `required` / `needs-check` / `not-required`로만 표시하고 canonical path를 링크한다.
  - `docs/` 또는 `book/`을 제외하려면 `not-required` 근거 path를 남긴다.
- explicit package가 하나라도 있으면 group/all 해석을 하지 않는다.
- 선택된 **각 패키지마다 정확히 3개 서브에이전트**를 만든다.
- 역할은 반드시 고정한다.
  - contract/API
  - implementation/architecture
  - tests/edge cases
- 기본 issue 단위는 **패키지당 1개**다.
- 실제 저장소 라벨만 사용한다.

### Label Allowlist (Strict)

- **priority**: `priority:p0`, `priority:p1`, `priority:p2`
- **area**: `area:foundation`, `area:request-pipeline`, `area:auth`, `area:http-runtime`, `area:infra-messaging`, `area:protocol-adapters`, `area:cli`, `area:persistence`
- **type**: `bug`, `enhancement`, `documentation`, `performance`, `tech-debt`, `type:maintainability`
- **scope**: `scope:security`, `scope:nestjs-parity`
- **wave**: `wave:1`, `wave:2`, `wave:3`
- **source**: `source:package-audit` (필수)

### Package → area label mapping

- `foundation`: `core`, `config`, `di`, `runtime`
- `http-runtime`: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`, `terminus`, `metrics`
- `request-pipeline`: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`, `throttler`
- `auth`: `jwt`, `passport`
- `infra-messaging`: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- `protocol-adapters`: `websockets`, `socket.io`
- `persistence`: `prisma`, `drizzle`, `mongoose`
- `cli`: `cli`, `studio`, `testing`

## Output Contract

- `result: 생성 이슈 N건, 보류 M건, 중복 후보 K건`
- P0 / P1 / P2 요약 표 또는 목록
- `question` 선택 결과 요약
- draft ID → issue title 매핑 표
- 등록된 이슈 표
- 보류/중복 표
- 권장 실행 순서 1..N과 근거

## Example Prompts

- `/search-to-issue foundation`
- `runtime이랑 http만 조사해서 issue 초안 만들어줘`

## Must NOT

- explicit package와 group/all을 동시에 확장하지 않는다.
- 패키지당 3개보다 적거나 많은 reviewer 역할을 임의로 바꾸지 않는다.
- 전역 Konekti 전제를 그대로 남겨두지 않는다.
- `examples/*`와 `@fluojs-internal/*`를 `all`에 암묵적으로 포함하지 않는다.
- audit target scope가 package로 결정됐다는 이유만으로 `docs/` 또는 `book/` 영향 평가를 생략하지 않는다.
- 실제 저장소에 없는 라벨을 임의 생성하거나 부착하지 않는다.
- `question` 기반 사용자 선택 없이 `gh issue create`를 실행하지 않는다.
- 보안 취약점을 public issue로 등록하지 않는다.
- 근거 없는 추측만으로 이슈를 만들지 않는다.
- unrelated findings를 무리하게 mega-issue로 합치지 않는다.
