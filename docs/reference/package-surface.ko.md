# package surface

<p><strong><kbd>한국어</kbd></strong> <a href="./package-surface.md"><kbd>English</kbd></a></p>

이 페이지는 Konekti 에코시스템 내의 현재 공개 패키지 제품군에 대한 개요를 제공합니다.

> **작업 기준으로 패키지를 찾으시나요?** [`package-chooser.ko.md`](./package-chooser.ko.md)에서 만들고 싶은 것에 맞는 패키지를 골라보세요.

## public package family

- `@konekti/core`
- `@konekti/config`
- `@konekti/validation`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-nodejs`
- `@konekti/platform-cloudflare-workers`
- `@konekti/platform-fastify`
- `@konekti/platform-express`
- `@konekti/platform-bun`
- `@konekti/platform-deno`
- `@konekti/platform-socket.io`
- `@konekti/microservices`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/mongoose`
- `@konekti/terminus`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/serialization`
- `@konekti/cache-manager`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/cqrs`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/throttler`
- `@konekti/testing`
- `@konekti/cli`
- `@konekti/studio`

## canonical runtime package matrix

이 섹션은 공개 런타임/패키지 가이드의 단일 기준(source of truth)입니다. 작업 중심 문서, 허브 인덱스, 패키지 가이드는 동일한 지원 매트릭스를 반복하지 말고 이 섹션을 링크해야 합니다.

| runtime target | canonical package guide | notes |
| --- | --- | --- |
| Node.js | 스타터 경로는 `@konekti/platform-fastify`, raw Node HTTP는 `@konekti/platform-nodejs`, 미들웨어 호환성 중심 대안은 `@konekti/platform-express` | 스타터 앱과 공식 예제는 기본적으로 Fastify를 유지합니다. 같은 adapter-first 런타임 facade 위에서 bare Node 리스너가 필요할 때는 `platform-nodejs`를 선택하세요. |
| Bun | `packages/platform-bun/README.ko.md` | 공식 Bun 네이티브 fetch-style startup 경로입니다. |
| Deno | `packages/platform-deno/README.ko.md` | 공식 `Deno.serve(...)` startup 경로입니다. |
| Cloudflare Workers | `packages/platform-cloudflare-workers/README.ko.md` | 공식 Worker `fetch` 엔트리포인트와 stateless isolate lifecycle 경로입니다. |

런타임별 동작, startup API, intentional limitation 상세는 각 어댑터 README가 계속 소유합니다.

## `platform-*` 네이밍 규칙

`platform-*` 접두사는 `PlatformAdapter` 인터페이스를 구현하고, Konekti의 추상 HTTP 레이어를 특정 런타임, 서버 라이브러리, 또는 프로토콜 인터페이스에 연결하는 패키지에만 사용합니다.

현재 `platform-*` 패키지:

- `@konekti/platform-bun`
- `@konekti/platform-cloudflare-workers`
- `@konekti/platform-deno`
- `@konekti/platform-express`
- `@konekti/platform-fastify`
- `@konekti/platform-nodejs`
- `@konekti/platform-socket.io`

이 접두사를 사용하는 이유:

- **NestJS 마이그레이션 친숙성**: NestJS도 동일한 `platform-*` 규칙을 사용하므로, NestJS에서 이동하는 팀이 익숙한 패턴을 그대로 찾을 수 있습니다.
- **이름 충돌 방지**: `@konekti/express`나 `@konekti/bun` 같은 이름은 실제 라이브러리 또는 런타임 자체와 혼동될 수 있습니다.
- **어댑터 역할 신호**: 이 접두사는 해당 패키지가 업스트림 런타임/라이브러리 자체가 아니라 `@konekti/runtime`용 어댑터 계층임을 분명히 보여줍니다.

다음에 해당하면 `platform-*`를 사용합니다:

- `PlatformAdapter`를 구현한다
- Konekti 런타임으로 들어오는 런타임/프로토콜 브리지 역할을 한다
- 런타임별 request/response 또는 gateway 통합 시맨틱을 소유한다

다음에 해당하면 `platform-*`를 사용하지 않습니다:

- DI 또는 라이프사이클 소유를 위해 서드파티 라이브러리를 감싸기만 한다
- `PlatformAdapter`를 구현하지 않는다
- 런타임/프로토콜 어댑터가 아닌 통합 인터페이스만 제공한다

예를 들어 `@konekti/redis`는 Redis를 DI/런타임 라이프사이클에 통합하는 클라이언트 래퍼 패키지이며, 런타임 어댑터 경계 자체를 담당하지 않으므로 `platform-*` 패키지로 분류하지 않습니다.

## package responsibilities

Konekti 패키지는 **클래스 우선(class-first)** 공개 인터페이스 규칙을 따릅니다. 구체 서비스, 가드, 인터셉터는 클래스 자체를 주요 주입 토큰으로 사용하며, 심볼과 상수는 인터페이스, 설정 및 런타임 핸들을 위해 예약됩니다.

- **`@konekti/core`**: 공유 계약, 데코레이터, 메타데이터 헬퍼.
- **`@konekti/config`**: 설정 로딩 및 타입 안전성이 보장된 설정 접근.
- **`@konekti/di`**: 프로바이더 해결(resolution) 및 라이프사이클 스코프.
- **`@konekti/http`**: HTTP 실행, 바인딩, 예외, 라우트 메타데이터.
- **`@konekti/runtime`**: 애플리케이션 부트스트랩/런타임 오케스트레이션, 런타임 강제 플랫폼 셸 등록(`platform.components`)과 의존성 순서 start/stop, 공유 플랫폼 계약 spine 타입(`PlatformOptionsBase`, `PlatformComponent`, 라이프사이클/준비상태/헬스/진단/스냅샷 계약), 버전 고정 모듈 진단 내보내기, opt-in 부트스트랩 타이밍, 그리고 좁은 부트스트랩 범위 운영 표면(`createHealthModule()`, `APPLICATION_LOGGER`, 기본 console/JSON logger, `PLATFORM_SHELL`)을 담당합니다. 루트 배럴은 transport-neutral 경계를 유지합니다. raw Node 어댑터 선택과 Node 전용 startup wrapper는 이제 `@konekti/platform-nodejs`, 고급 Node 전용 shutdown/compression helper는 `@konekti/runtime/node`, fetch-style 어댑터 전용 seam은 `@konekti/runtime/web`, metrics와 확장된 health indicator는 `@konekti/metrics`와 `@konekti/terminus`에 남기며, `@konekti/runtime/internal`은 프레임워크 내부 wiring 토큰 전용으로 남기고 어댑터 헬퍼는 명시적인 internal 서브패스로 이동합니다.
- **`@konekti/platform-nodejs`**: raw Node.js HTTP 어댑터를 위한 공개 패키지이며, 기본 bare Node startup surface(`createNodejsAdapter()`)와 Node 전용 호환 wrapper(`bootstrapNodejsApplication()` / `runNodejsApplication()`)를 소유해 process/compression 유틸리티가 기본 시작 경로와 섞이지 않게 유지합니다.
- **`@konekti/platform-cloudflare-workers`**: 공유 `@konekti/runtime/web` fetch-style 어댑터 seam 위에 구축된 Cloudflare Workers HTTP 어댑터이며, eager/lazy Worker fetch 엔트리포인트와 Worker isolate용 명시적 stateless lifecycle semantics를 제공합니다.
- **`@konekti/platform-fastify`**: Fastify 기반 HTTP 어댑터.
- **`@konekti/platform-express`**: Express 기반 HTTP 어댑터.
- **`@konekti/platform-bun`**: 공용 `@konekti/runtime/web` fetch-style 어댑터 seam을 재사용해 fetch-style 런타임 패리티를 제공하는 Bun 기반 HTTP 어댑터.
- **`@konekti/platform-deno`**: 공유 `@konekti/runtime/web` fetch-style 어댑터 seam 위에 구축된 Deno `Deno.serve(...)` 어댑터.
- **`@konekti/platform-socket.io`**: 공용 Konekti 런타임과 websocket 데코레이터 위에 구축된 Socket.IO v4 게이트웨이 어댑터.
- **`@konekti/microservices`**: 트랜스포트 추상화, 패턴 데코레이터, 마이크로서비스 런타임. 서브패스 export는 `./tcp`, `./redis`, `./nats`, `./kafka`, `./rabbitmq`, `./grpc`, `./mqtt` 트랜스포트 엔트리포인트를 포함합니다.
- **`@konekti/validation`**: 유효성 검사 데코레이터, 매핑된 DTO 헬퍼, 검증 엔진.
- **`@konekti/jwt`**: 핵심 JWT 로직.
- **`@konekti/passport`**: 인증 전략 레지스트리 및 범용 가드 연결.
- **`@konekti/openapi`**: 문서 생성 및 OpenAPI 데코레이터.
- **`@konekti/graphql`**: GraphQL 모듈, 스키마 노출, 실행 파이프라인.
- **`@konekti/serialization`**: 클래스 기반 응답 직렬화 및 인터셉터.
- **`@konekti/cache-manager`**: 데코레이터 기반 HTTP 응답 캐시 + 독립형 cache service/store API, 메모리/Redis 백엔드 지원.
- **`@konekti/metrics`**: 기본 격리 registry + 선택적 공유 registry 배선을 지원하는 Prometheus 메트릭 패키지이며, low-cardinality HTTP 메트릭 미들웨어를 제공합니다.
- **`@konekti/cron`**: 분산 락을 지원하는 데코레이터 기반 작업 스케줄링.
- **`@konekti/cqrs`**: 부트스트랩 시점 핸들러 탐색, saga/process-manager 지원, event-bus 위임을 제공하는 command/query 버스.
- **`@konekti/event-bus`**: 프로세스 내 이벤트 발행 및 탐색.
- **`@konekti/websocket`**: transport-neutral WebSocket 게이트웨이 작성용 데코레이터, 메타데이터, 디스크립터, 공용 계약을 제공합니다. 현재 raw `ws` Node 바인딩은 명시적 `@konekti/websocket/node` 서브패스에 있습니다.
- **`@konekti/queue`**: 워커 탐색과 DLQ(Dead Letter Queue)를 지원하는 Redis 기반 백그라운드 작업.
- **`@konekti/redis`**: 앱 범위 Redis lifecycle 소유(`lazyConnect` 부트스트랩 + graceful shutdown), raw 토큰 주입, `getRawClient()` escape hatch가 있는 `RedisService` facade 제공.
- **`@konekti/prisma`**: Prisma lifecycle + ALS 기반 트랜잭션 컨텍스트 통합(비동기 모듈 팩토리, strict transaction 모드, abort-aware request transaction 처리 포함).
- **`@konekti/drizzle`**: Drizzle handle을 ALS 트랜잭션 컨텍스트에 통합(비동기 모듈 팩토리, strict/fallback 트랜잭션 동작, optional `dispose` 셧다운 훅).
- **`@konekti/mongoose`**: 런타임/DI 연결을 위한 Mongoose 통합 패키지.
- **`@konekti/terminus`**: 헬스 인디케이터 조합과 런타임 헬스 응답 집계를 확장하는 운영 헬스 패키지.
- **`@konekti/throttler`**: 인메모리/Redis 스토어 어댑터를 지원하는 데코레이터 기반 속도 제한.
- **`@konekti/testing`**: 모듈/app 테스트 baseline 패키지입니다. 루트 배럴은 `createTestingModule(...)`, `createTestApp(...)`, 모듈 메타데이터 유틸리티에 집중하고, 목/HTTP 헬퍼/portability harness/conformance harness는 전용 subpath로 공개합니다.
- **`@konekti/cli`**: 애플리케이션 부트스트랩/생성/마이그레이션 + 런타임 진단 inspect 명령어이며, 새 HTTP 앱을 adapter-first 트랜스포트 선택으로 안내하는 스타터/마이그레이션 가이드를 포함합니다.
- **`@konekti/studio`**: 런타임 그래프/타이밍 JSON 내보내기를 파일 기반으로 확인하는 diagnostics viewer.

## 공개 DI 엔트리포인트

이 패키지들을 사용할 때는 구체 서비스/가드/인터셉터 클래스를 직접 주입하는 방식을 선호하세요. 내보내기 토큰은 명시적인 추상화나 런타임 경계가 필요한 경우에만 제공됩니다.

- **클래스 선호**: `UsersService`, `AuthGuard`, `RedisService`, `PrismaService`.
- **토큰 선호**: `CONFIG_OPTIONS`, `REDIS_CLIENT`, `EVENT_BUS`, `JWT_SIGN_OPTIONS`.
- **헬퍼 팩토리는 예외로 명시 유지**: class-first 모듈 네이밍 규칙은 `createTestingModule(...)`, `createHealthModule()` 같은 helper builder(테스트/런타임 헬퍼)를 이름 변경 대상으로 보지 않습니다.

클래스 우선 DI의 기술적 원칙에 대해서는 `docs/concepts/di-and-modules.ko.md`를 참조하세요.

## 공개 모듈 문법 시맨틱

공개 런타임 모듈 엔트리포인트는 저장소 전역에서 다음 문법 계약을 따릅니다.

- **`forRoot(...)`**: 런타임 모듈 초기화를 위한 표준(canonical) 엔트리포인트
- **`forRootAsync(...)`**: 옵션 계산이 런타임 입력 대기를 필요로 할 때 사용하는 `forRoot(...)`의 비동기 변형
- **`register(...)`**: 전역 루트 소유권을 주장하지 않는, 스코프/반복 등록용 엔트리포인트
- **`forFeature(...)`**: 이미 초기화된 루트 모듈 아래에서 패키지 로컬 기능 슬라이스를 추가할 때 사용하는 엔트리포인트
- **`create*` helper 예외**: 런타임 모듈 엔트리포인트가 아닌 helper/builder에만 `create*` 네이밍을 유지 (예: `createTestingModule(...)`, `createHealthModule()`, `createPlatformConformanceHarness(...)`, `create*Providers(...)`)

거버넌스 의도:

- 런타임 모듈 엔트리포인트 네이밍을 패키지 README, CLI 출력, 생성기 예시, 마이그레이션 가이드 전반에서 안정적으로 유지합니다.
- 새 패키지/모듈 문서는 공개 모듈 엔트리포인트 네이밍에 대해 이 섹션을 단일 기준(source-of-truth)으로 사용해야 합니다.

## boundary and documentation rules

- 이 목록에는 공개 패키지만 포함됩니다.
- 툴체인 및 스캐폴드 세부 사항은 `./toolchain-contract-matrix.ko.md`에 위치합니다.
- 패키지별 API는 각각의 `README.md` 파일에 문서화되어 있습니다.
- 공개된 `create-konekti` 패키지는 없으며, 부트스트랩에는 `@konekti/cli`를 사용하세요.
