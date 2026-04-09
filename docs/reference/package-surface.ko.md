# package surface

<p><strong><kbd>한국어</kbd></strong> <a href="./package-surface.md"><kbd>English</kbd></a></p>

이 페이지는 Konekti 공개 패키지 패밀리와 런타임 매핑의 기준 문서(source of truth)입니다. 패키지 책임에 대한 권위 있는 조회에 활용하세요.

## 공개 패키지 패밀리

| 패밀리 | 설명 | 패키지 |
| --- | --- | --- |
| **Core** | 공유 계약 및 DI. | `@konekti/core`, `@konekti/di`, `@konekti/config`, `@konekti/runtime` |
| **HTTP** | 웹 API 실행 및 라우팅. | `@konekti/http`, `@konekti/graphql`, `@konekti/validation`, `@konekti/serialization`, `@konekti/openapi` |
| **Auth** | 인증 및 인가. | `@konekti/jwt`, `@konekti/passport` |
| **Platform** | 런타임 어댑터. | `@konekti/platform-fastify`, `@konekti/platform-nodejs`, `@konekti/platform-express`, `@konekti/platform-bun`, `@konekti/platform-deno`, `@konekti/platform-cloudflare-workers` |
| **Realtime** | WebSocket 및 Socket.IO. | `@konekti/websockets`, `@konekti/socket.io` |
| **Persistence** | 데이터베이스 및 캐시. | `@konekti/prisma`, `@konekti/drizzle`, `@konekti/mongoose`, `@konekti/redis`, `@konekti/cache-manager` |
| **Patterns** | 메시징 및 아키텍처. | `@konekti/microservices`, `@konekti/cqrs`, `@konekti/event-bus`, `@konekti/cron`, `@konekti/queue`, `@konekti/notifications` |
| **Operations** | 헬스 및 모니터링. | `@konekti/metrics`, `@konekti/terminus`, `@konekti/throttler` |
| **Tooling** | CLI 및 진단. | `@konekti/cli`, `@konekti/studio`, `@konekti/testing` |

## canonical runtime package matrix

Konekti는 전송 중립(transport-neutral) 런타임을 사용합니다. 어댑터가 이 런타임을 특정 호스팅 환경에 연결합니다.

| 런타임 대상 | 어댑터 패키지 | 비고 |
| --- | --- | --- |
| **Node.js (기본)** | `@konekti/platform-fastify` | Node.js에서 고성능을 위한 권장 시작 경로. |
| **Node.js (Bare)** | `@konekti/platform-nodejs` | Node HTTP 리스너를 직접 제어해야 할 때 사용. |
| **Node.js (Express)** | `@konekti/platform-express` | 기존 Express 코드와의 미들웨어 호환성이 필요할 때 사용. |
| **Bun** | `@konekti/platform-bun` | 공식 Bun 네이티브 fetch-style 시작 경로. |
| **Deno** | `@konekti/platform-deno` | 공식 `Deno.serve()` 시작 경로. |
| **Cloudflare Workers** | `@konekti/platform-cloudflare-workers` | fetch-style 어댑터 심(seam) 위에 구축된 stateless isolate 라이프사이클. |

## 패키지 책임

### core
- **`@konekti/core`**: 메타데이터 헬퍼 및 TC39 표준 데코레이터 지원.
- **`@konekti/di`**: 프로바이더 해결, 라이프사이클 스코프, 의존성 그래프 분석.
- **`@konekti/config`**: 환경 인식 설정 로딩 및 타입 안전 접근.
- **`@konekti/runtime`**: 애플리케이션 부트스트랩, 모듈 오케스트레이션, 플랫폼 셸 등록.

### adapters
- **`platform-*`**: `PlatformAdapter` 인터페이스를 구현합니다. 추상 HTTP 호출을 런타임별 리스너에 연결합니다.
- **`@konekti/socket.io`**: 업스트림 Socket.IO 시맨틱을 미러링하는 전용 전송 브랜드 어댑터.

### features
- **`@konekti/http`**: 라우팅, 가드, 인터셉터, 예외 처리.
- **`@konekti/graphql`**: HTTP 추상화 위에서 동작하는 GraphQL 스키마 노출, 리졸버 실행, 구독 지원.
- **`@konekti/jwt`**: HTTP 비종속 JWT 서명, 검증, principal 정규화.
- **`@konekti/passport`**: 전략 비종속 인증 가드, scope 처리, Passport.js 브리지.
- **`@konekti/microservices`**: TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC를 위한 패턴 매칭 전송 추상화.
- **`@konekti/notifications`**: provider별 알림 패키지가 공유하는 채널 계약과 오케스트레이션 계층.
- **`@konekti/websockets`**: 전송 중립 WebSocket 게이트웨이 작성.
- **`@konekti/validation`**: class-validator 기반 입력 구체화(materialization) 및 안전성.
- **`@konekti/prisma` / `@konekti/drizzle`**: ORM 라이프사이클 및 ALS 기반 트랜잭션 컨텍스트.

## 명명 규칙
- **`platform-*`**: `PlatformAdapter`를 구현하는 런타임/프로토콜 어댑터 전용.
- **`*service`**: 비즈니스 로직의 구체적 구현.
- **`*module`**: 패키지 런타임 초기화의 진입점.

아키텍처 정의는 [glossary-and-mental-model.ko.md](./glossary-and-mental-model.ko.md)를 참조하세요.
