# 갭 분석

> **기준 소스**: [repo:docs/README.md] [repo:docs/reference/package-chooser.md] [ex:README.md]

저장소에는 이미 강한 fluo 입문서를 만드는 데 필요한 재료가 거의 다 있다. 핵심 부족분은 원천 자료의 양이 아니라, 기존 docs, package README, examples, maintainer policy가 아직 하나의 긴 서사로 엮여 있지 않다는 점이다.

## 이미 강한 부분

### 1. 실제 온보딩 축이 이미 있다

The docs hub already gives a beginner-oriented path through quick start, first feature path, bootstrap, and glossary `[repo:docs/README.md]`. The examples index adds a runnable progression from the minimal app to auth and operations `[ex:README.md]`.

### 2. 핵심 개념 이름이 이미 잘 잡혀 있다

Architecture, DI, HTTP runtime, config, auth, and observability all already have official prose documents `[repo:docs/concepts/architecture-overview.md]` `[repo:docs/concepts/di-and-modules.md]` `[repo:docs/concepts/http-runtime.md]` `[repo:docs/concepts/config-and-environments.md]` `[repo:docs/concepts/auth-and-jwt.md]` `[repo:docs/concepts/observability.md]`.

### 3. examples가 무작위가 아니라 큐레이션되어 있다

The examples index explicitly states what each example proves and in what order new readers should approach them `[ex:README.md]`.

## 책이 아직 더 필요로 하는 것

### 1. 자료를 가로지르는 단일 서사 목소리

The current repo has strong documents, but they are split by function: hub pages, concept docs, package READMEs, examples, and governance docs. The book needs to connect them into one reading experience.

### 2. 설명과 구현 사이의 더 강한 다리

The book should repeatedly connect:

- concept docs → runnable examples
- package READMEs → actual source files
- maintainer policy docs → contributor behavior

For example, the HTTP request lifecycle described in `[repo:docs/concepts/http-runtime.md]` should be paired with concrete controller code such as `[ex:realworld-api/src/users/users.controller.ts]` and the HTTP package overview `[pkg:http/README.md]`.

### 3. 더 선명한 “메인테이너로의 상승 경로”

The repo has contributor and governance docs, but a long-form book should make the progression explicit: user → advanced user → contributor → maintainer `[repo:CONTRIBUTING.md]` `[repo:docs/operations/testing-guide.md]` `[repo:docs/operations/release-governance.md]`.

### 4. 챕터 단위의 명시적 출처 규율

The current docs naturally link related pages, but the book should go further and record source provenance for every major factual section. That is why this workspace introduces KSR `[repo:book/source-reference-convention.md]`.

## 챕터 계열별 갭

| 챕터 계열 | 현재 커버리지 | 남은 필요 |
| --- | --- | --- |
| 철학과 멘탈 모델 | strong | tone 통일과 반복 축소 |
| 스타터와 첫 기능 | strong | stepwise chapter lab로 재구성 |
| DI와 HTTP runtime | strong | 메인테이너 관점의 도표와 walkthrough 강화 |
| Config, auth, observability | medium to strong | docs와 example 연결 강화 |
| Persistence와 고급 패키지 | medium | package-level chapter boundary 신중히 설정 |
| Testing과 governance | strong | 왜 학습 후반부에 와야 하는지 설명 강화 |

## 바로 가능한 집필 기회

1. Expand part-level draft chapters into chapter-level files under `book/chapters/`.
2. Add concrete code excerpts with `// source:` comments using the KSR convention `[repo:book/source-reference-convention.md]`.
3. Create chapter checklists that map each chapter to:
   - primary docs
   - example walkthrough files
   - package README references
   - missing diagrams or tables

## 지금 당장의 비목표

- Do not rewrite package READMEs into the book verbatim.
- Do not invent undocumented behavior.
- Do not treat every package as equal in narrative importance.
- Do not start with maintainer policy before the reader understands the runtime shape.
