# package surface

<p><strong><kbd>한국어</kbd></strong> <a href="./package-surface.md"><kbd>English</kbd></a></p>

## 공개 패키지 패밀리

| 패밀리 | 설명 | 패키지 |
| --- | --- | --- |
| **Core** | 공유 계약 및 DI. | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime` |
| **HTTP** | 웹 API 실행 및 라우팅. | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| **Auth** | 인증 및 인가. | `@fluojs/jwt`, `@fluojs/passport` |
| **Platform** | 런타임 어댑터. | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| **Realtime** | WebSocket 및 Socket.IO. | `@fluojs/websockets`, `@fluojs/socket.io` |
| **Persistence** | 데이터베이스 및 캐시. | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| **Patterns** | 메시징 및 아키텍처. | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| **Operations** | 헬스 및 모니터링. | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| **Tooling** | CLI 검사 내보내기, Studio 그래프 보기/렌더링, 테스트 진단. | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing` |

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
- **`@fluojs/runtime`**: 애플리케이션 부트스트랩, 모듈 오케스트레이션, 플랫폼 셸 등록, 플랫폼 snapshot 생산.

### adapters
- **`platform-*`**: `PlatformAdapter` 인터페이스를 구현합니다. 추상 HTTP 호출을 런타임별 리스너에 연결합니다.
- **`@fluojs/socket.io`**: 업스트림 Socket.IO 시맨틱을 미러링하는 전용 전송 브랜드 어댑터.

### features
- **`@fluojs/http`**: 라우팅, 가드, 인터셉터, 예외 처리.
- **`@fluojs/graphql`**: HTTP 추상화 위에서 동작하는 GraphQL 스키마 노출, 리졸버 실행, 구독 지원.
- **`@fluojs/jwt`**: HTTP 비종속 JWT 서명, 검증, principal 정규화.
- **`@fluojs/passport`**: 전략 비종속 인증 가드, scope 처리, Passport.js 브리지.
- **`@fluojs/microservices`**: TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC를 위한 패턴 매칭 전송 추상화.
- **`@fluojs/notifications`**: provider별 알림 패키지가 공유하는 채널 계약과 오케스트레이션 계층.
- **`@fluojs/email`**: 전송 중립(transport-agnostic) 이메일 발송 코어. 알림 채널 및 큐 워커 통합을 제공합니다.
- **`@fluojs/email/node`**: Nodemailer/SMTP 전송을 제공하는 `@fluojs/email`의 Node.js 전용 서브패스.
- **`@fluojs/slack`**: standalone으로도 동작하고 공식 알림 채널로도 등록할 수 있는 webhook-first Slack 전달 코어.
- **`@fluojs/discord`**: standalone으로도 동작하고 공식 알림 채널로도 등록할 수 있는 webhook-first Discord 전달 코어.
- **`@fluojs/websockets`**: 전송 중립 WebSocket 게이트웨이 작성.
- **`@fluojs/validation`**: class-validator 기반 입력 구체화(materialization) 및 안전성.
- **`@fluojs/prisma` / `@fluojs/drizzle`**: ORM 라이프사이클 및 ALS 기반 트랜잭션 컨텍스트.

### tooling
- **`@fluojs/cli`**: 프로젝트 스캐폴딩, 생성, codemod, 런타임이 생산한 snapshot에 대한 inspection 내보내기/위임.
- **`@fluojs/studio`**: 파일 우선 snapshot 뷰어와 CLI 및 자동화 호출자를 위한 canonical 파싱, 필터링, 그래프 렌더링 헬퍼.
- **`@fluojs/testing`**: 애플리케이션 및 플랫폼 계약을 검증하기 위한 conformance 및 통합 헬퍼.

## 명명 규칙
- **`platform-*`**: `PlatformAdapter`를 구현하는 런타임/프로토콜 어댑터 전용.
- **`*service`**: 비즈니스 로직의 구체적 구현.
- **`*module`**: 패키지 런타임 초기화의 진입점.

아키텍처 정의는 [glossary-and-mental-model.ko.md](./glossary-and-mental-model.ko.md)를 참조하세요.
