# fluo 입문서 상위 목차

> **기준 소스**: [repo:README.md] [repo:docs/README.md] [ex:README.md]

이 목차는 저장소가 이미 암시하고 있는 fluo 학습 축을 따른다. 즉, 정체성과 철학, 첫 실행 경험, core runtime과 DI, HTTP 실행, 설정과 검증, 기능 패키지, 런타임 이식성, 테스트, 메인테이너 거버넌스의 순서다 `[repo:docs/README.md]` `[repo:docs/concepts/architecture-overview.md]` `[repo:docs/operations/release-governance.md]`.

## 파트 0. 이 책을 읽는 법

1. Why fluo now
2. Who this book is for
3. How the repository is organized
4. How the examples and docs fit together

## 파트 1. 철학과 멘탈 모델

5. Standard-First as a framework stance
6. Why fluo rejects legacy decorator assumptions
7. Explicit over implicit
8. Module graph as the real shape of the app
9. Platform adapters and runtime neutrality
10. Behavioral contracts and maintainer discipline
11. Glossary and mental model

## 파트 2. 첫 접촉: 0에서 실행까지

12. Installing the CLI
13. What `fluo new` gives you
14. `pnpm dev` and the first request path
15. Starter scaffold anatomy
16. Why the minimal example matters
17. TypeScript configuration and modern decorator posture

## 파트 3. 가장 작은 유용한 fluo 앱

18. AppModule and bootstrapping
19. Controller, service, and route basics
20. First explicit DI example
21. Health and ready endpoints
22. Verifying behavior with tests
23. From starter shape to first feature slice

## 파트 4. 핵심 아키텍처

24. `@fluojs/core` as the metadata spine
25. Standard decorators and stable metadata
26. Token-based DI
27. Providers, tokens, and scopes
28. Module boundaries, imports, and exports
29. Dynamic module patterns
30. Lifecycle and bootstrap phases
31. Reading the module graph like a maintainer

## 파트 5. HTTP 런타임과 요청 흐름

32. Why fluo is explicit about the request pipeline
33. Controllers and routing
34. Request binding and DTO materialization
35. Validation before handler execution
36. Guards, interceptors, and middleware roles
37. Serialization and response boundaries
38. Error responses and exception handling
39. Request context and async boundaries

## 파트 6. 설정과 환경 경계

40. Config as runtime data
41. Loading precedence and failure-at-boot
42. Typed access through `ConfigService`
43. Validation and reload concepts
44. Environment boundaries and portability

## 파트 7. 기능 개발 경로

45. Slice-based architecture
46. Realworld-style CRUD module
47. DTO design and response DTOs
48. Repository pattern and DI boundaries
49. App composition with imports and exports
50. Testing a feature slice end to end

## 파트 8. 영속성, 인증, API 표면

51. Persistence choices: Prisma, Drizzle, Mongoose
52. Transactions and data boundaries
53. JWT and Passport integration
54. Protected routes and principal flow
55. OpenAPI and package selection by task

## 파트 9. 메시징, 실시간, 운영

56. Cache and Redis-backed capabilities
57. Queue and cron background work
58. Event bus and CQRS
59. WebSockets and Socket.IO
60. Notifications and delivery channels
61. Metrics, health, and readiness

## 파트 10. 플랫폼 이식성

62. Fastify as the default path
63. Node vs Bun vs Deno vs Workers mental model
64. Platform consistency as a framework promise
65. How adapters preserve application logic

## 파트 11. 테스트와 메인테이너 작업

66. fluo testing toolbox
67. Unit, slice, e2e-style, and conformance tests
68. `pnpm verify` as a maintainer threshold
69. Public export documentation standards
70. Release governance and stability contracts
71. Contributor-to-maintainer progression

## 파트 12. 부록

72. Package chooser by task
73. Example reading order
74. Package family matrix
75. Suggested next writing splits per chapter

## 왜 이 순서가 저장소와 잘 맞는가

- 문서 허브는 `Quick Start`, `First Feature Path`, `Bootstrap & Startup`, `Glossary & Mental Model`을 초기 공식 경로로 제시한다 `[repo:docs/README.md]`.
- 예제 인덱스는 `minimal → realworld-api → auth-jwt-passport → ops-metrics-terminus`라는 실행 가능한 progression을 이미 정의하고 있다 `[ex:README.md]`.
- Architecture, DI, HTTP는 이미 프레임워크의 핵심 메커니즘으로 문서화되어 있다 `[repo:docs/concepts/architecture-overview.md]` `[repo:docs/concepts/di-and-modules.md]` `[repo:docs/concepts/http-runtime.md]`.
- Testing과 governance 자료는 입문 초반이 아니라 메인테이너 후반부에 두는 편이 자연스럽다 `[repo:docs/operations/testing-guide.md]` `[repo:docs/operations/release-governance.md]` `[repo:CONTRIBUTING.md]`.
