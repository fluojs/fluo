# package surface

<p><strong><kbd>한국어</kbd></strong> <a href="./package-surface.md"><kbd>English</kbd></a></p>

## 공개 패키지 패밀리

| 패밀리 | 설명 | 패키지 |
| --- | --- | --- |
| **Core** | 공유 계약 및 DI. | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/i18n`, `@fluojs/runtime` |
| **HTTP** | 웹 API 실행 및 라우팅. | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| **Auth** | 인증 및 인가. | `@fluojs/jwt`, `@fluojs/passport` |
| **Platform** | 런타임 어댑터. | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| **Realtime** | WebSocket 및 Socket.IO. | `@fluojs/websockets`, `@fluojs/socket.io` |
| **Persistence** | 데이터베이스 및 캐시. | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| **Patterns** | 메시징 및 아키텍처. | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| **Operations** | 헬스 및 모니터링. | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| **Tooling** | CLI 검사 내보내기, Studio를 통한 inspect artifact 보기/렌더링, 테스트 진단, Vite 빌드 통합. | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing`, `@fluojs/vite` |

## canonical runtime package matrix

| 런타임 대상 | 어댑터 패키지 | 비고 |
| --- | --- | --- |
| **Node.js (기본)** | `@fluojs/platform-fastify` | Node.js에서 고성능을 위한 권장 시작 경로. |
| **Node.js (Bare)** | `@fluojs/platform-nodejs` | Node HTTP 리스너를 직접 제어해야 할 때 사용. |
| **Node.js (Express)** | `@fluojs/platform-express` | 기존 Express 코드와의 미들웨어 호환성이 필요할 때 사용. |
| **Bun** | `@fluojs/platform-bun` | 공식 Bun 네이티브 fetch-style 시작 경로. |
| **Deno** | `@fluojs/platform-deno` | 공식 `Deno.serve()` 시작 경로. |
| **Cloudflare Workers** | `@fluojs/platform-cloudflare-workers` | fetch-style 어댑터 심(seam) 위에 구축된 stateless isolate 라이프사이클. |

## 패키지 책임

### core
- **`@fluojs/core`**: 메타데이터 헬퍼 및 TC39 표준 데코레이터 지원.
- **`@fluojs/di`**: 프로바이더 해결, 라이프사이클 스코프, 의존성 그래프 분석.
- **`@fluojs/config`**: 환경 인식 설정 로딩 및 타입 안전 접근.
- **`@fluojs/i18n`**: module registration, standalone service factory, reserved core option/error type, `@fluojs/i18n/icu`를 통한 ICU MessageFormat 지원, `@fluojs/i18n/http`를 통한 HTTP locale helper 및 opt-in `Accept-Language` policy helper, `@fluojs/i18n/adapters`를 통한 opt-in non-HTTP locale adapter 및 header policy helper, `@fluojs/i18n/validation`을 통한 validation localization, `@fluojs/i18n/loaders/fs`와 `@fluojs/i18n/loaders/remote`를 통한 Node filesystem/provider-backed catalog loader 및 opt-in remote cache wrapper, `@fluojs/i18n/typegen`을 통한 catalog key 및 typed translation helper declaration generation을 제공하는 framework-agnostic internationalization package boundary. NestJS i18n, i18next, next-intl, request/validation convenience glue와의 ecosystem parity는 [i18n ecosystem bridge decision record](./i18n-ecosystem-bridges.ko.md)가 관리하며, 향후 opt-in subpath가 bridge acceptance criteria를 만족하기 전까지 documentation-first로 유지합니다.
- **`@fluojs/runtime`**: 애플리케이션 부트스트랩, 모듈 오케스트레이션, 플랫폼 셸 등록, 플랫폼 snapshot 생산. 공개 런타임 헬퍼는 `@fluojs/runtime/node`와 `@fluojs/runtime/web`에서 제공됩니다.

### adapters
- **`platform-*`**: 저장소 정책상 `PlatformAdapter`라고 부르는 접점을 구현합니다. HTTP 런타임 패키지는 `@fluojs/http`의 `HttpApplicationAdapter`로 이를 충족합니다. 추상 HTTP 호출을 런타임별 리스너에 연결합니다.
- **`@fluojs/socket.io`**: 업스트림 Socket.IO 시맨틱을 미러링하는 전용 전송 브랜드 어댑터.

### features
- **`@fluojs/http`**: 라우팅, 가드, 인터셉터, 예외 처리.
- **`@fluojs/graphql`**: HTTP 추상화 위에서 동작하는 GraphQL 스키마 노출, 리졸버 실행, 구독 지원.
- **`@fluojs/jwt`**: HTTP 비종속 JWT 서명, 검증, principal 정규화.
- **`@fluojs/passport`**: 전략 비종속 인증 가드, scope 처리, Passport.js 브리지.
- **`@fluojs/microservices`**: TCP, Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC를 위한 패턴 매칭 전송 추상화.
- **`@fluojs/event-bus`**: optional Redis Pub/Sub transport, inherited event channel fan-out, bounded publish cancellation/timeout, local publish와 inbound transport callback 모두에 대한 shutdown drain semantic을 갖춘 in-process domain event fan-out.
- **`@fluojs/notifications`**: provider별 알림 패키지가 공유하는 채널 계약과 오케스트레이션 계층.
- **`@fluojs/email`**: 전송 중립(transport-agnostic) 이메일 발송 코어. `@fluojs/email/queue`를 통해 알림 채널 및 큐 워커 통합을 제공합니다.
- **`@fluojs/email/node`**: Nodemailer/SMTP 전송을 제공하는 `@fluojs/email`의 Node.js 전용 서브패스.
- **`@fluojs/slack`**: standalone으로도 동작하고 공식 알림 채널로도 등록할 수 있는 webhook-first Slack 전달 코어.
- **`@fluojs/discord`**: standalone으로도 동작하고 공식 알림 채널로도 등록할 수 있는 webhook-first Discord 전달 코어.
- **`@fluojs/websockets`**: 런타임별 서브패스 `@fluojs/websockets/node`, `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`를 제공하는 WebSocket 게이트웨이 작성 패키지.
- **`@fluojs/validation`**: 표준 데코레이터 기반 입력 검증, DTO 실체화(materialization), request-boundary 안전성.
- **`@fluojs/prisma` / `@fluojs/drizzle`**: ORM 라이프사이클 및 ALS 기반 트랜잭션 컨텍스트.
- **`@fluojs/redis`**: App-scoped Redis client 등록, raw-client injection, JSON-aware `RedisService` facade, named-client token, lifecycle-owned connect/quit timeout guardrail, 그리고 Pub/Sub subscriber는 일반 command client를 공유하지 않고 전용 Redis 연결을 사용해야 한다는 문서 가이드를 담당합니다.
- **`@fluojs/queue`**: decorator로 발견한 singleton worker, Queue가 소유하는 duplicate Redis connection, JSON-object payload serialization, dead-letter retention, bootstrap-ready worker startup, `workerShutdownTimeoutMs` 기반 bounded worker shutdown, lifecycle/readiness status snapshot을 제공하는 Redis-backed BullMQ job processing 패키지입니다.
- **`@fluojs/mongoose`**: Mongoose 라이프사이클 통합과 ALS/session 인지형 transaction boundary, 요청 범위 transaction interceptor, 모델 작업을 위한 명시적 `currentSession()` 접근, 사용 가능한 경우 `connection.transaction(...)`을 통한 ambient-session 위임, 활성 요청/session drain 상태를 보고하는 shutdown snapshot을 담당합니다.

### tooling
- **`@fluojs/cli`**: 프로젝트 스캐폴딩, 생성, codemod, 런타임이 생산한 snapshot에 대한 inspection 내보내기/위임. `fluo inspect`는 CLI argument validation, application bootstrap/close, JSON snapshot serialization, report artifact 쓰기, `--output <path>` file emission, Mermaid rendering을 위한 Studio handoff를 소유합니다.
- **`@fluojs/studio`**: 파일 우선 snapshot/report/timing 뷰어와 CLI 및 자동화 호출자를 위한 canonical 파싱, 필터링, 그래프 렌더링 헬퍼. Studio는 `fluo inspect --json` snapshot, `--timing` 및 `--json --timing` snapshot-plus-timing envelope, `--report` artifact, `renderMermaid(snapshot)`을 통한 Mermaid graph rendering을 소비하는 책임 경계를 소유합니다.
- **`@fluojs/testing`**: 애플리케이션 및 플랫폼 계약을 검증하기 위한 conformance 및 통합 헬퍼.
- **`@fluojs/vite`**: 생성된 starter `vite.config.ts` 파일이 사용하는 유지보수형 `fluoDecoratorsPlugin()`을 포함한 fluo 프로젝트용 Vite 빌드 유틸리티.

## Studio inspect artifact ownership

런타임 패키지는 inspection snapshot과 timing diagnostics의 원천으로 남습니다. CLI는 그 런타임 값을 이동 가능한 artifact로 바꿉니다. Artifact는 raw JSON, snapshot-plus-timing envelope, report artifact, 또는 Studio가 설치된 경우 Mermaid text가 될 수 있습니다. Studio는 사람과 자동화 호출자를 위해 inspect artifact를 읽고, 검증하고, 필터링하고, 보여주고, 렌더링하는 책임을 맡습니다.

이 경계는 graph semantics를 `@fluojs/cli` 밖에 둡니다. CLI는 `@fluojs/studio/contracts`를 찾아 `renderMermaid(snapshot)`을 호출할 수 있지만, 내부 dependency edge와 외부 dependency node를 Mermaid output으로 바꾸는 방식은 Studio가 정의합니다. 지속 보관할 artifact가 필요한 소비자는 raw snapshot에는 `fluo inspect --json --output <path>`, snapshot-plus-timing envelope에는 `fluo inspect --timing --output <path>` 또는 `fluo inspect --json --timing --output <path>`, support report에는 `fluo inspect --report --output <path>`를 사용해야 합니다.

## 명명 규칙
- **`platform-*`**: 문서화된 adapter seam(HTTP transport에서는 `HttpApplicationAdapter`)을 구현하는 런타임/프로토콜 어댑터 전용.
- **`*service`**: 비즈니스 로직의 구체적 구현.
- **`*module`**: 패키지 런타임 초기화의 진입점.

## 공개 API 명명 정책

모듈 및 provider 등록 API는 public `create*` factory 대신 namespace facade를 사용합니다. 애플리케이션-facing module entrypoint는 `XModule.forRoot(...)`, `XModule.forRootAsync(...)`, `XModule.register(...)`, `XModule.forFeature(...)` 형태로 노출해야 하며, provider assembly는 패키지 내부에 남겨 둡니다. 예를 들어 애플리케이션 코드는 저수준 provider/module factory helper를 직접 호출하는 대신 `HealthModule.forRoot(...)`, `QueueModule.forRoot(...)`, `TerminusModule.forRoot(...)`를 import해야 합니다.

`create*`는 모듈이나 provider set을 직접 등록하지 않는, 의도적으로 문서화된 helper/builder API에서 계속 사용할 수 있습니다. 허용되는 예시는 `createFastifyAdapter(...)` 같은 runtime/platform adapter factory, `createNodeHttpAdapter(...)` 같은 Node runtime helper, `createTestingModule(...)` 같은 testing builder, health indicator factory 같은 value-level utility입니다. 모듈 등록 표면과 관련된 `create*` symbol을 호환성 목적으로 유지할 때는 docs와 generated code가 namespace facade를 우선 안내하고, 해당 helper는 compatibility-only로 설명해야 합니다. 예를 들어 `@fluojs/mongoose` 소비자는 애플리케이션 등록에 `MongooseModule.forRoot(...)` / `forRootAsync(...)`를 사용하고, `createMongooseProviders(...)`는 수동 provider composition 호환성 용도로만 남겨야 합니다.

아키텍처 정의는 [glossary-and-mental-model.ko.md](./glossary-and-mental-model.ko.md)를 참조하세요.
