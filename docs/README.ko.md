# docs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 디렉토리는 Konekti의 패키지 간 문서 허브입니다. 여러 패키지에 걸친 프레임워크 수준 정보를 다룹니다. 패키지별 API와 예제는 `../packages/*/README.ko.md`를 참고하세요.

## 시작하기

Konekti를 처음 접하신다면 다음 경로를 따라 첫 애플리케이션을 실행해 보세요.

- `getting-started/quick-start.ko.md` - **표준 시작 경로**: install -> `new` -> `dev`.
- `getting-started/first-feature-path.ko.md` - **공식 다음 단계**: 스타터 앱에서 첫 번째 실제 기능까지.
- `getting-started/bootstrap-paths.ko.md` - 부트스트랩 규칙과 고급 실행 경로.
- `reference/glossary-and-mental-model.ko.md` - 핵심 용어와 멘탈 모델.

## 예제

표준 시작 경로와 주요 패턴을 보여주는 실행 가능한 애플리케이션입니다. 이 디렉토리의 예제는 기본 Node.js + Fastify 스타터 경로를 유지하고, 나머지 공식 런타임은 각 패키지 문서에서 다룹니다.

- `../examples/minimal/` - `konekti new` 출력과 동일한, 가장 작은 실행 가능 앱.
- `../examples/realworld-api/` - DTO 검증, 설정 로딩, CRUD를 포함하는 다중 모듈 앱.
- `../examples/auth-jwt-passport/` - JWT 발급과 passport 기반 보호 라우트를 보여주는 bearer-token auth 예제.
- `../examples/ops-metrics-terminus/` - `/metrics`, `/health`, `/ready`에 초점을 둔 metrics + terminus 예제.
- `../examples/README.ko.md` - 현재 공식 예제와 권장 읽기 순서를 한눈에 보는 인덱스.

## 주요 작업

애플리케이션 실행 후 일상적인 개발에 필요한 실무 가이드입니다.

- `getting-started/generator-workflow.ko.md` - CLI를 사용한 모듈 및 프로바이더 생성.
- `operations/testing-guide.ko.md` - 단위 및 통합 테스트 패턴.
- `operations/platform-conformance-authoring-checklist.ko.md` - 플랫폼-지향 패키지 conformance harness 게이트와 authoring checklist.
- `operations/release-governance.ko.md` - 릴리스 검증 절차, CI 거버넌스 게이트(PR 영향 범위(affected-scope) build/typecheck/test + 안전한 full fallback + governance 게이트 vs `main` full verification + release-readiness 게이트), 그리고 패키지 소스 `process.env` 경계 가드.
- `operations/behavioral-contract-policy.ko.md` - behavioral contract 문서 필수 항목과 CI 거버넌스 강제 규칙, 그리고 패키지 내부의 명시적 env 소유권 규칙.
- `operations/deployment.ko.md` - 로컬 개발에서 운영 환경으로의 배포.
- `concepts/auth-and-jwt.ko.md` - 인증 및 세션 관리 구현.
- `concepts/openapi.ko.md` - API 명세 작성 및 노출.

## 패키지

Konekti는 높은 조합성을 제공합니다. 목적에 맞는 도구를 찾고 선택해 보세요.

공식 런타임/패키지 매트릭스는 `reference/package-surface.ko.md`를 기준으로 확인하세요. 이 허브는 스타터/기본 경로 안내만 짧게 유지하되 기본 `@konekti/platform-fastify` 스타터 경로, raw Node `@konekti/platform-nodejs` 경로, `@konekti/platform-express` Node.js 대안을 함께 가리키고, 런타임별 시작·호스팅 세부사항은 각 어댑터 README로 연결합니다. Raw `@konekti/websockets/node` 지원은 현재 테스트된 server-backed 어댑터(`platform-nodejs`, `platform-fastify`, `platform-express`)로 계속 한정되고, `@konekti/socket.io`는 기존 Node/Fastify/Express server-backed 경로를 유지한 채 공식 Bun 전용 `@konekti/platform-bun` + `@socket.io/bun-engine` 경로를 추가하며, Bun·Deno·Cloudflare Workers raw websocket 호스팅은 계속 전용 `@konekti/websockets/bun`, `@konekti/websockets/deno`, `@konekti/websockets/cloudflare-workers` 바인딩에 머뭅니다.

- `reference/package-chooser.ko.md` - **여기서 시작하세요**: 특정 유스케이스에 맞는 패키지 선택하기.
- `reference/package-surface.ko.md` - 프레임워크 전반의 공개 API 요약.
- `reference/package-chooser.ko.md#실시간-통신-추가` - raw websocket과 Socket.IO 모두의 현재 지원 어댑터 집합을 포함한 작업 중심 realtime 패키지 가이드.
- `reference/package-surface.ko.md#package-responsibilities` - 정직한 raw websocket 및 Socket.IO 지원 경계를 포함한 표준 패키지 소유권 요약.
- `reference/toolchain-contract-matrix.ko.md` - 에코시스템 버전 관리 및 호환성 매트릭스.
- `../packages/platform-fastify/README.ko.md` - 기본 Node.js 스타터 경로를 위한 `@konekti/platform-fastify` 계약.
- `../packages/platform-nodejs/README.ko.md` - 런타임 facade 위 raw Node.js HTTP 시작 경로를 위한 `@konekti/platform-nodejs` 계약.
- `../packages/platform-express/README.ko.md` - Node.js 호환성 중심 앱을 위한 `@konekti/platform-express` 계약.
- `../packages/websocket/README.ko.md` - `@konekti/websockets` 게이트웨이 작성 계약과 `@konekti/websockets/node`, `@konekti/websockets/bun`, `@konekti/websockets/deno`, `@konekti/websockets/cloudflare-workers`의 런타임별 raw websocket 바인딩 경계.
- `../packages/platform-socket.io/README.ko.md` - 플랫폼이 선택한 realtime capability seam 위 Socket.IO 게이트웨이 동작을 다루는 `@konekti/socket.io` 계약.
- `../packages/platform-bun/README.ko.md` - `@konekti/platform-bun` 계약과 시작 경로.
- `../packages/platform-deno/README.ko.md` - `@konekti/platform-deno` 계약과 시작 경로.
- `../packages/platform-cloudflare-workers/README.ko.md` - `@konekti/platform-cloudflare-workers` 계약과 시작 경로.

## 마이그레이션

기존 애플리케이션을 Konekti 표준 데코레이터 모델로 옮기기 위한 가이드입니다.

- `getting-started/migrate-from-nestjs.ko.md` - NestJS 개발자를 위한 단계별 가이드.
- `operations/nestjs-parity-gaps.ko.md` - 알려진 차이점과 해결 방법.

## 레퍼런스

아키텍처, 런타임 동작 및 거버넌스 정책에 대한 심층 문서입니다.

### 아키텍처 및 런타임
- `concepts/architecture-overview.ko.md`
- `concepts/platform-consistency-design.ko.md`
- `concepts/dev-reload-architecture.ko.md`
- `concepts/di-and-modules.ko.md`
- `concepts/config-and-environments.ko.md`
- `concepts/http-runtime.ko.md`
- `concepts/cqrs.ko.md`
- `concepts/caching.ko.md`
- `concepts/transactions.ko.md`
- `concepts/observability.ko.md`
- `concepts/security-middleware.ko.md`
- `concepts/lifecycle-and-shutdown.ko.md`

### 동작 및 정책
- `concepts/decorators-and-metadata.ko.md`
- `concepts/error-responses.ko.md`
- `operations/release-governance.ko.md`
- `operations/behavioral-contract-policy.ko.md`
- `operations/third-party-extension-contract.ko.md`

## 권한 규칙

- 문서가 출하된 동작을 설명하면 이곳이나 패키지 README에 둡니다.
- 문서가 향후 작업을 설명하면 GitHub Issue에 둡니다.
- 한 패키지가 소유한 주제는 이곳에 중복하지 말고 해당 패키지 README를 우선합니다.
