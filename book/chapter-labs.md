# 챕터 실습 맵

> **기준 소스**: [ex:README.md] [repo:docs/getting-started/first-feature-path.md] [repo:docs/reference/package-chooser.md]

이 파일은 미래의 책 챕터를 실제 fluo 예제 파일에 연결해, 책이 실행 가능한 자료에 계속 발을 붙이고 있도록 만든다.

## 이 파일을 사용하는 법

- 각 챕터는 적어도 하나의 주요 실습 앵커를 가져야 한다.
- 실습 앵커는 실제 example 파일이나 README를 가리켜야 한다.
- 아직 적절한 앵커가 없는 챕터는 범위를 줄이거나 나중에 전용 예제를 만들어야 한다는 신호다.

## 챕터 묶음별 실습 앵커

### 파트 1. 철학과 멘탈 모델

| 예정 챕터 | 주요 실습 앵커 | 이 파일이 중요한 이유 |
| --- | --- | --- |
| Why fluo | `[repo:README.md]` | Defines the standard-first positioning, explicit DI framing, and ecosystem categories |
| Mental model and glossary | `[repo:docs/reference/glossary-and-mental-model.md]` | Gives the core vocabulary used throughout the repo |
| Example learning path | `[ex:README.md]` | Defines the official example reading order |

### 파트 2. 스타터와 첫 번째 앱

| 예정 챕터 | 주요 실습 앵커 | 이 파일이 중요한 이유 |
| --- | --- | --- |
| Bootstrap and AppModule | `[ex:minimal/src/main.ts]` | Smallest explicit runtime bootstrap with a platform adapter |
| Starter scaffold anatomy | `[ex:minimal/README.md]` | Explains the minimal project structure and how it maps to `fluo new` |
| First feature slice | `[repo:docs/getting-started/first-feature-path.md]` | The cleanest official progression from starter to first domain feature |

### 파트 3. DI, 모듈, HTTP 런타임

| 예정 챕터 | 주요 실습 앵커 | 이 파일이 중요한 이유 |
| --- | --- | --- |
| Module graph and DI | `[ex:realworld-api/src/users/users.module.ts]` | Demonstrates imports/exports and feature module boundaries |
| Explicit injection | `[ex:realworld-api/src/users/users.service.ts]` | Shows service wiring in a real feature slice |
| HTTP runtime and DTO flow | `[ex:realworld-api/src/users/users.controller.ts]` | Shows `@Controller`, `@Post`, and `@RequestDto(...)` in use |
| Config boundaries | `[ex:realworld-api/src/app.ts]` | Shows root module composition with config imports |

### 파트 4. 인증과 운영

| 예정 챕터 | 주요 실습 앵커 | 이 파일이 중요한 이유 |
| --- | --- | --- |
| JWT issuance and protected routes | `[ex:auth-jwt-passport/src/auth/auth.service.ts]` | Concrete access token issuance path |
| Auth strategy bridge | `[ex:auth-jwt-passport/src/auth/bearer.strategy.ts]` | Shows how bearer verification is wired |
| Metrics and health | `[ex:ops-metrics-terminus/src/app.ts]` | Demonstrates metrics and terminus module registration |
| Operational route example | `[ex:ops-metrics-terminus/src/ops/ops.controller.ts]` | Shows a route that changes observability state |

### 파트 5. 테스트와 메인테이너 트랙

| 예정 챕터 | 주요 실습 앵커 | 이 파일이 중요한 이유 |
| --- | --- | --- |
| Slice and e2e-style testing | `[repo:docs/operations/testing-guide.md]` | Defines the official testing hierarchy and recipes |
| Example verification | `[ex:minimal/README.md]` `[ex:realworld-api/README.md]` | Confirms examples are validated through repo test runs |
| Maintainer workflow | `[repo:CONTRIBUTING.md]` | Defines `pnpm verify` and worktree-based isolation |

## 아직 더 좋은 앵커가 필요한 주제

이 주제들은 중요하지만, 더 깊은 package README 활용이나 전용 example이 나중에 필요할 수 있다.

- persistence choices across Prisma, Drizzle, and Mongoose `[repo:docs/reference/package-chooser.md]`
- CQRS and event-driven chapters `[repo:docs/reference/package-chooser.md]`
- realtime and messaging families `[repo:docs/reference/package-chooser.md]`
- platform portability beyond the default Fastify path `[repo:README.md]`

## 다음 확장 단계

part-level 파일을 개별 chapter 파일로 쪼갤 때는, 이 맵의 해당 행을 새 챕터로 옮기고 다음 항목으로 바꿔 넣으면 된다.

- `> **주요 구현 앵커**: ...`
- 출처가 달린 작은 코드 발췌 1~2개
- “이 파일부터 먼저 읽어라”라는 짧은 안내
