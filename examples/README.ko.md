# examples

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 디렉터리는 fluo의 공식 실행 예제를 모아 둔 곳입니다. 연속 학습은 [FluoBlog 튜토리얼](../apps/docs/content/docs/tutorial/index.ko.mdx)과 [단계별 완성 코드](./fluo-blog/README.ko.md)에서 시작하세요. 다른 예제는 독립적인 기능 참고자료이며 해당 프로젝트의 후속 장이 아닙니다. AI 도구이거나 계약 레퍼런스가 필요하다면 `../docs/CONTEXT.ko.md`를 출발점으로 삼으세요.

이 예제들은 생성 스캐폴드와 runnable 예제가 계속 일치하도록 의도적으로 공개된 `fluo new` v2 매트릭스의 HTTP 쪽 경로를 유지합니다. 다른 first-class 스타터 계약은 Express, raw Node.js HTTP, Bun, Deno, Cloudflare Workers용 runnable 애플리케이션 스타터 변형, 실행 가능한 microservice starter 경로들(TCP 기본값, 그리고 Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC), 그리고 mixed single-package 경로(Fastify HTTP 앱 + attached TCP microservice)입니다.

## 현재 공식 예제

- [`./fluo-blog/`](./fluo-blog/README.ko.md) — 게시글, 명시적 DI, 검증, 오류, 테스트를 위한 연속 튜토리얼의 단계별 코드
- `./minimal/` — 기본/명시적 HTTP 스타터 경로와 같은 가장 작은 실행 가능 앱
- `./realworld-api/` — config, DTO validation, explicit DI, CRUD를 포함한 보다 현실적인 다중 모듈 HTTP API
- `./auth-jwt-passport/` — JWT 발급과 passport core 기반 보호 라우트를 보여주는 bearer-token auth 예제
- `./ops-metrics-terminus/` — `/metrics`, `/health`, `/ready`에 초점을 둔 운영 예제
- `./openapi-multiple-documents/` — 서로 다른 라우트의 OpenAPI JSON 문서 두 개와 Swagger UI 페이지
- `./graphql/` — GraphQL module registration, resolver discovery, operation 범위 DataLoader, SSE subscription
- `./react-stable-ssr/` — HTTP-owned route, DTO-bound params/search, lifecycle middleware, 명시적인
  hydration asset을 포함한 안정 `@fluojs/react` SSR MVP 예제
- `./react-vite-ssr/` — manifest-fed asset, streamed Suspense, hydration, HTTP-first client
  navigation, JavaScript-optional native form mutation을 포함한 Vite-backed React SSR 예제

## 권장 읽기 순서

fluo를 처음 배운다면 [FluoBlog 튜토리얼](../apps/docs/content/docs/tutorial/index.ko.mdx)을 먼저 완성하세요. 그다음 필요한 기능에 따라 독립적인 예제를 고르세요.

1. `./minimal/README.ko.md` — 가장 작은 bootstrap과 request path
2. `./realworld-api/README.ko.md` — 첫 실제 도메인 모듈과 DTO 경계
3. `./auth-jwt-passport/README.ko.md` — auth, JWT 발급, 보호 라우트 경로
4. `./ops-metrics-terminus/README.ko.md` — metrics와 health/readiness 경로
5. `./openapi-multiple-documents/README.ko.md` — 여러 OpenAPI JSON 및 Swagger UI 라우트
6. `./graphql/README.ko.md` — code-first GraphQL query, DataLoader, SSE subscription 흐름
7. `./react-stable-ssr/README.ko.md` — HTTP-owned handler로서의 안정 React SSR page
8. `./react-vite-ssr/README.ko.md` — SSR baseline 위에 Vite build manifest와 hydration 추가

[Book](../book/README.ko.md)은 개념과 내부 구조를 다루는 보충 자료입니다. 기존 장의 project-state 표기는 이 디렉터리의 스냅샷을 가리키지 않습니다.

## 예제가 문서에서 맡는 역할

- `minimal`은 기본 경로와 flags-first 명시 경로 모두에서 `fluo new` HTTP 스타터 shape를 증명합니다
- `realworld-api`는 그 HTTP 스타터 기준선 이후 첫 실전 module/DTO/test 경로를 보여줍니다
- `auth-jwt-passport`는 현재 공식 bearer-token auth 경로를 증명합니다
- `ops-metrics-terminus`는 현재 markdown-first observability/health 경로를 증명합니다
- `openapi-multiple-documents`는 하나의 앱이 독립적으로 구성된 OpenAPI JSON과 Swagger UI 라우트를 제공할 수 있음을 증명합니다
- `graphql`은 resolver discovery, operation 범위 DataLoader 재사용, 기본 SSE subscription lifecycle을 증명합니다
- `react-stable-ssr`은 안정 `@fluojs/react` root contract를 증명합니다. `@Router`/`@Path`는
  `@fluojs/http` 위의 lexical facade이고, URL matching과 route grammar는 HTTP-owned 상태로 남으며,
  DTO validation과 request lifecycle은 보존되고, hydration asset은 명시적이며, RSC/server functions는
  stable root 밖에 남습니다.
- `react-vite-ssr`은 Vite hydration과 `@fluojs/react/client` phase를 증명합니다. 같은 HTTP-owned
  route와 DTO contract가 streamed Suspense HTML을 만들고, 이미 로드한 Vite manifest가 hydration
  asset을 공급하며, full-document client navigation은 server DTO validation을 authoritative하게
  유지합니다. Native form은 SPA document swapping, file-based routing, compiled action을 약속하지 않고
  guarded/intercepted `POST`, validation, mutation, `303` redirect boundary를 통과합니다.

예제는 `../docs/contracts/testing-guide.ko.md`의 canonical fluo TDD ladder도 고정합니다. 빠른 unit 테스트는 `src/**` 가까이에 작성하고, DI wiring이나 provider override가 중요할 때는 `createTestingModule({ rootModule })` 기반 slice/module 테스트를 추가하며, app-level e2e 스타일 request-pipeline 점검에는 `createTestApp({ rootModule })`와 `app.request(...).send()`를 사용합니다. `minimal/src/app.test.ts`, `auth-jwt-passport/src/app.test.ts`, `ops-metrics-terminus/src/app.test.ts` 같은 기존 파일은 그 ladder의 app-level 끝단을 보여줍니다.

다른 v2 스타터 계약은 CLI README에서 명령을 확인하고, 전체 계약 명세는 매트릭스 문서를 참고하세요.

- `../packages/cli/README.ko.md` — HTTP, microservice, mixed, interactive wizard 흐름의 명령 예시
- `../docs/reference/toolchain-contract-matrix.ko.md` — 공개 스타터 계약 매트릭스

이 예제들은 한 번에 읽을 수 있을 정도로 작게 유지하는 것이 목적이며, 패키지 README를 대체하지는 않습니다.

## 레포 루트에서 실행하기

```bash
pnpm install
pnpm vitest run examples/fluo-blog
pnpm vitest run examples/minimal
pnpm vitest run examples/realworld-api
pnpm vitest run examples/auth-jwt-passport
pnpm vitest run examples/ops-metrics-terminus
pnpm vitest run examples/openapi-multiple-documents
pnpm vitest run examples/graphql
pnpm vitest run examples/react-stable-ssr
pnpm vitest run examples/react-vite-ssr
```

## 관련 문서

- `../README.ko.md`
- `../book/README.ko.md`
- `../docs/CONTEXT.ko.md`
- `../docs/getting-started/quick-start.ko.md`
- `../docs/getting-started/first-feature-path.ko.md`
