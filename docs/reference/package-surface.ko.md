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
- `@konekti/platform-fastify`
- `@konekti/platform-express`
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

## package responsibilities

- **`@konekti/core`**: 공유 계약, 데코레이터, 메타데이터 헬퍼.
- **`@konekti/config`**: 설정 로딩 및 타입 안전성이 보장된 설정 접근.
- **`@konekti/di`**: 프로바이더 해결(resolution) 및 라이프사이클 스코프.
- **`@konekti/http`**: HTTP 실행, 바인딩, 예외, 라우트 메타데이터.
- **`@konekti/runtime`**: 애플리케이션 부트스트랩/런타임 오케스트레이션, 런타임 강제 플랫폼 셸 등록(`platform.components`)과 의존성 순서 start/stop, 공유 플랫폼 계약 spine 타입(`PlatformOptionsBase`, `PlatformComponent`, 라이프사이클/준비상태/헬스/진단/스냅샷 계약), 버전 고정 모듈 진단 내보내기, opt-in 부트스트랩 타이밍.
- **`@konekti/platform-fastify`**: Fastify 기반 HTTP 어댑터.
- **`@konekti/platform-express`**: Express 기반 HTTP 어댑터.
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
- **`@konekti/websocket`**: 데코레이터 기반 WebSocket 게이트웨이 탐색 및 Node 업그레이드 연결.
- **`@konekti/queue`**: 워커 탐색과 DLQ(Dead Letter Queue)를 지원하는 Redis 기반 백그라운드 작업.
- **`@konekti/redis`**: 앱 범위 Redis lifecycle 소유(`lazyConnect` 부트스트랩 + graceful shutdown), raw 토큰 주입, `getRawClient()` escape hatch가 있는 `RedisService` facade 제공.
- **`@konekti/prisma`**: Prisma lifecycle + ALS 기반 트랜잭션 컨텍스트 통합(비동기 모듈 팩토리, strict transaction 모드, abort-aware request transaction 처리 포함).
- **`@konekti/drizzle`**: Drizzle handle을 ALS 트랜잭션 컨텍스트에 통합(비동기 모듈 팩토리, strict/fallback 트랜잭션 동작, optional `dispose` 셧다운 훅).
- **`@konekti/mongoose`**: 런타임/DI 연결을 위한 Mongoose 통합 패키지.
- **`@konekti/terminus`**: 헬스 인디케이터 조합과 런타임 헬스 응답 집계를 확장하는 운영 헬스 패키지.
- **`@konekti/throttler`**: 인메모리/Redis 스토어 어댑터를 지원하는 데코레이터 기반 속도 제한.
- **`@konekti/testing`**: 테스트 모듈 및 헬퍼 유틸리티, 그리고 라이프사이클/진단/스냅샷 계약 검증을 위한 공유 platform conformance harness(`createPlatformConformanceHarness`).
- **`@konekti/cli`**: 애플리케이션 부트스트랩/생성/마이그레이션 + 런타임 진단 inspect 명령어.
- **`@konekti/studio`**: 런타임 그래프/타이밍 JSON 내보내기를 파일 기반으로 확인하는 diagnostics viewer.

## boundary and documentation rules

- 이 목록에는 공개 패키지만 포함됩니다.
- 툴체인 및 스캐폴드 세부 사항은 `./toolchain-contract-matrix.ko.md`에 위치합니다.
- 패키지별 API는 각각의 `README.md` 파일에 문서화되어 있습니다.
- 공개된 `create-konekti` 패키지는 없으며, 부트스트랩에는 `@konekti/cli`를 사용하세요.
