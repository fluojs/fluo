# 파트 매핑

> **기준 소스**: [repo:docs/README.md] [ex:README.md] [repo:docs/reference/package-chooser.md]

이 파일은 현재 책의 각 파트를 fluo 공식 문서, examples, package README, 예상 페이지 분량과 연결한다.

## 예상 분량

총 목표 분량은 약 600~700페이지다.

| 파트 | 초점 | 예상 페이지 |
| --- | --- | ---: |
| 파트 0–2 | 프레이밍, 온보딩, 첫 앱 | 120 |
| 파트 3–5 | core runtime, DI, HTTP, config | 220 |
| 파트 6–9 | 실전 기능과 생태계 확장 | 180 |
| 파트 10–11 | 이식성, 테스트, 거버넌스, 메인테이너 트랙 | 100 |
| 파트 12 | 부록과 내비게이션 보조 자료 | 30 |

## 파트별 매핑

### 파트 0–1. 철학과 멘탈 모델

**목적**: 구현 세부사항에 들어가기 전에 fluo가 무엇을 지향하는지 설명한다.

**주요 소스**

- Framework identity and package families: `[repo:README.md]`
- Docs hub and official learning sequence: `[repo:docs/README.md]`
- Terminology and mental model: `[repo:docs/reference/glossary-and-mental-model.md]`
- Architecture framing: `[repo:docs/concepts/architecture-overview.md]`

**이 파트가 만들어야 하는 것**

- a strong answer to “why fluo exists”
- a stable vocabulary for later chapters
- a clear distinction between standard decorators, explicit DI, and behavioral contracts

### 파트 2. 첫 접촉과 스타터 경로

**목적**: 독자를 설치 단계에서 실제 runtime shape 이해 단계까지 데려간다.

**주요 소스**

- CLI path and starter flow: `[repo:docs/getting-started/quick-start.md]`
- Starter-to-feature path: `[repo:docs/getting-started/first-feature-path.md]`
- Bootstrap path: `[repo:docs/getting-started/bootstrap-paths.md]`
- Minimal example as the canonical runnable shape: `[ex:minimal/README.md]` `[ex:minimal/src/main.ts]`

**설명 전략**

Anchor explanation in the actual minimal bootstrap and starter-aligned example rather than abstract pseudocode `[ex:minimal/src/main.ts]`.

### 파트 3–5. 핵심 애플리케이션 경로

**목적**: fluo가 내부에서 어떻게 동작하는지, 그리고 request boundary에서 어떤 과정을 거치는지 설명한다.

**주요 소스**

- Architecture and request flow: `[repo:docs/concepts/architecture-overview.md]`
- DI and module boundaries: `[repo:docs/concepts/di-and-modules.md]` `[pkg:di/README.md]`
- HTTP execution model: `[repo:docs/concepts/http-runtime.md]` `[pkg:http/README.md]`
- Runtime role and lifecycle: `[pkg:runtime/README.md]`
- Config boundary: `[repo:docs/concepts/config-and-environments.md]` `[pkg:config/README.md]`

**구체적 코드 앵커**

- bootstrap with explicit adapter: `[ex:minimal/src/main.ts]`
- DTO binding in a real controller: `[ex:realworld-api/src/users/users.controller.ts]`

### 파트 6–9. 기능 개발과 생태계 확장

**목적**: core mechanics에서 출발해 실제 feature 구현과 package selection으로 확장한다.

**주요 소스**

- Realworld CRUD slice: `[ex:realworld-api/README.md]`
- Auth path: `[repo:docs/concepts/auth-and-jwt.md]` `[ex:auth-jwt-passport/README.md]`
- Observability path: `[repo:docs/concepts/observability.md]` `[ex:ops-metrics-terminus/README.md]`
- Package selection by task: `[repo:docs/reference/package-chooser.md]`

**강조점**

- feature slices over layer-by-layer tutorial writing
- package choice by problem, not by package list order
- examples as teaching anchors, package READMEs as deep-dive references

### 파트 10–11. 플랫폼, 테스트, 거버넌스, 메인테이너 트랙

**목적**: 능숙한 사용자에서 기여자와 메인테이너로 넘어가게 한다.

**주요 소스**

- Testing architecture: `[repo:docs/operations/testing-guide.md]`
- Release standards and package maturity: `[repo:docs/operations/release-governance.md]`
- Maintainer workflow and worktree guidance: `[repo:CONTRIBUTING.md]`
- Compatibility and package surface references: `[repo:docs/reference/toolchain-contract-matrix.md]` `[repo:docs/reference/package-surface.md]`

**메인테이너 기준선**

The repo explicitly treats `pnpm verify` as the pre-push standard and recommends worktrees for isolated issue work `[repo:CONTRIBUTING.md]`.

## 소스 유형별 집필 규칙

| 소스 유형 | 책에서 가장 적합한 쓰임 |
| --- | --- |
| Root README | 철학과 생태계 프레이밍 |
| docs/README | 공식 학습 순서와 내비게이션 축 |
| Concept docs | 설명형 챕터와 멘탈 모델 |
| Getting-started docs | 첫 실행 경로와 초반 실습 |
| Example READMEs | 챕터 실습과 읽기 순서 |
| Example source files | 코드 발췌와 walkthrough 앵커 |
| Package READMEs | API 심화와 패키지 책임 설명 |
| Operations docs | 메인테이너 챕터와 정책 경계 |
