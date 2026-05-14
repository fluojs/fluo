# package chooser — 작업에 맞는 패키지 고르기

<p><a href="./package-chooser.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

> 현재 `fluo new`가 실제로 무엇을 스캐폴딩하는지 찾고 있다면 [fluo new 지원 매트릭스](./fluo-new-support-matrix.ko.md)를 확인하세요. 이 chooser는 현재 스타터 프리셋만이 아니라 더 넓은 패키지 생태계를 다룹니다.

## 새 웹 API 만들기 (Node.js)

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| 기본 애플리케이션 스택이 필요함 | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` | 모든 Node.js 웹 API의 시작점입니다. |
| HTTP 라우팅이 필요함 | `@fluojs/http` | 컨트롤러와 라우트 실행에 필요합니다. |
| GraphQL 엔드포인트가 필요함 | `@fluojs/graphql` | HTTP 스택 위에 추가합니다. |
| 기본 Node.js 어댑터가 필요함 | `@fluojs/platform-fastify` | 대부분의 프로젝트에 권장되는 시작 경로입니다. |
| Express 미들웨어 호환이 필요함 | `@fluojs/platform-express` | Node.js에서 first-class `fluo new` 애플리케이션 스타터로도 제공됩니다. |
| Node.js HTTP를 직접 제어해야 함 | `@fluojs/platform-nodejs` | Node.js에서 first-class `fluo new` 애플리케이션 스타터로도 제공됩니다. |
| 요청 유효성 검사가 필요함 | `@fluojs/validation` | DTO 바인딩과 검증이 필요할 때 추가합니다. |
| 응답 직렬화 또는 output DTO shaping이 필요함 | `@fluojs/serialization` | 응답 DTO의 제어된 field exposure, sensitive-field exclusion, synchronous value transform, HTTP interceptor 기반 response-boundary shaping이 필요할 때 추가합니다. |
| 타입 안전 설정 접근이 필요함 | `@fluojs/config` | 패키지 내부의 직접 `process.env` 접근 대신 사용합니다. |
| localization 또는 i18n service가 필요함 | `@fluojs/i18n` | framework-agnostic internationalization module registration, standalone service 생성, 공유 option/error type, `@fluojs/i18n/icu` ICU MessageFormat plural/select 지원, `@fluojs/i18n/http` HTTP locale helper 및 opt-in `Accept-Language` policy, `@fluojs/i18n/adapters` opt-in non-HTTP locale resolution 및 header policy, `@fluojs/i18n/validation` validation localization, `@fluojs/i18n/loaders/fs`와 `@fluojs/i18n/loaders/remote` catalog loading 및 opt-in remote cache wrapper, `@fluojs/i18n/typegen` catalog key 및 typed translation helper declaration에 사용합니다. NestJS i18n, i18next, next-intl, request/validation convenience parity 결정은 [i18n ecosystem bridge decision record](./i18n-ecosystem-bridges.ko.md)에서 시작하세요. |

## 엣지 / 모던 런타임에 배포

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| Bun 런타임 어댑터가 필요함 | `@fluojs/platform-bun` | 일치하는 `fluo new` runtime/platform 스타터 경로와 연결됩니다. |
| Deno 런타임 어댑터가 필요함 | `@fluojs/platform-deno` | 일치하는 `fluo new` runtime/platform 스타터 경로와 연결됩니다. |
| Cloudflare Workers 어댑터가 필요함 | `@fluojs/platform-cloudflare-workers` | 일치하는 `fluo new` runtime/platform 스타터 경로와 연결됩니다. |

## 마이크로서비스 스타터 만들기

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| 기본 마이크로서비스 스타터가 필요함 | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | TCP가 기본 전송입니다. |
| Redis Streams 스타터가 필요함 | `fluo new my-service --shape microservice --transport redis-streams --runtime node --platform none` | 실행 가능한 스타터 프리셋입니다. |
| NATS 스타터가 필요함 | `fluo new my-service --shape microservice --transport nats --runtime node --platform none` | 실행 가능한 스타터 프리셋입니다. |
| Kafka 스타터가 필요함 | `fluo new my-service --shape microservice --transport kafka --runtime node --platform none` | 실행 가능한 스타터 프리셋입니다. |
| RabbitMQ 스타터가 필요함 | `fluo new my-service --shape microservice --transport rabbitmq --runtime node --platform none` | 실행 가능한 스타터 프리셋입니다. |
| MQTT 스타터가 필요함 | `fluo new my-service --shape microservice --transport mqtt --runtime node --platform none` | 실행 가능한 스타터 프리셋입니다. |
| gRPC 스타터가 필요함 | `fluo new my-service --shape microservice --transport grpc --runtime node --platform none` | 실행 가능한 스타터 프리셋입니다. |

## 영속성 및 데이터 접근 추가

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| Prisma 기반 관계형 접근이 필요함 | `@fluojs/prisma` | Prisma ORM 통합에 사용합니다. |
| Drizzle 기반 관계형 접근이 필요함 | `@fluojs/drizzle` | Drizzle ORM 통합에 사용합니다. |
| 도큐먼트 데이터베이스 접근이 필요함 | `@fluojs/mongoose` | Mongoose 통합에 사용합니다. |
| 캐시 추상화가 필요함 | `@fluojs/cache-manager` | 캐시 기반 읽기와 쓰기에 사용합니다. |
| 공유 Redis 클라이언트/서비스 계층이 필요함 | `@fluojs/redis` | 기본 또는 이름 있는 Redis 등록에 사용합니다. |

`@fluojs/redis`는 하나의 공유 기본 클라이언트(`REDIS_CLIENT` / `RedisService`)를 제공하고, 필요할 때 `RedisModule.forRoot({ name, ... })`로 이름 있는 클라이언트를 추가하는 기준 레이어입니다. 앱 코드에서 특정 이름의 바인딩을 직접 주입해야 한다면 `getRedisClientToken(name)` 또는 `getRedisServiceToken(name)`으로 가져옵니다.

## 보안 및 인증 구현

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| JWT 서명과 검증이 필요함 | `@fluojs/jwt` | 토큰 발급, 검증, principal 정규화에 사용합니다. |
| Passport 전략 통합이 필요함 | `@fluojs/passport` | Passport 기반 인증 흐름을 연결할 때 사용합니다. |
| 요청 제한이 필요함 | `@fluojs/throttler` | 속도 제한과 가드 단계 강제에 사용합니다. |

## 실시간 및 메시징

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| 전송 중립 WebSocket이 필요함 | `@fluojs/websockets` | Raw WebSocket 게이트웨이 작성에 사용합니다. |
| 런타임별 WebSocket lifecycle service가 필요함 | `@fluojs/websockets/node`, `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers` | 런타임 경계와 일치하는 서브패스를 선택합니다. |
| Socket.IO 시맨틱이 필요함 | `@fluojs/socket.io` | Socket.IO 호환 통합에 사용합니다. |
| optional cross-process fan-out이 있는 in-process domain event가 필요함 | `@fluojs/event-bus` + optional `@fluojs/event-bus/redis` 및 `@fluojs/redis` | 하나의 published domain fact가 여러 local handler를 알릴 때 사용하고, 반응이 process boundary를 넘어야 할 때만 Redis Pub/Sub fan-out을 추가합니다. |
| 메시지 패턴 마이크로서비스가 필요함 | `@fluojs/microservices` | 전송 기반 마이크로서비스 핸들러에 사용합니다. |
| 백그라운드 작업이 필요함 | `@fluojs/queue` + `@fluojs/redis` | 큐 워커는 Redis에 의존합니다. |
| 스케줄 작업이 필요함 | `@fluojs/cron` | cron 스타일 스케줄링에 사용합니다. |
| 다중 채널 알림이 필요함 | `@fluojs/notifications` | 공용 알림 오케스트레이션 계층입니다. |
| 이식 가능한 이메일 전송이 필요함 | `@fluojs/email` | 전송 중립 이메일 코어입니다. |
| Node.js SMTP 전송이 필요함 | `@fluojs/email/node` | `@fluojs/email`용 Node 전용 SMTP 전송입니다. |
| queue 기반 대량 이메일 알림이 필요함 | `@fluojs/email/queue` + `@fluojs/queue` | 이메일 알림을 위한 queue adapter와 worker 통합입니다. |
| Slack 전송이 필요함 | `@fluojs/slack` | webhook-first Slack 통합입니다. |
| Discord 전송이 필요함 | `@fluojs/discord` | webhook-first Discord 통합입니다. |

## 관측 가능성 및 문서화

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| OpenAPI 출력이 필요함 | `@fluojs/openapi` | 스키마 생성과 API 문서화에 사용합니다. |
| Prometheus 메트릭이 필요함 | `@fluojs/metrics` | HTTP 및 애플리케이션 메트릭에 사용합니다. |
| 헬스 엔드포인트가 필요함 | `@fluojs/terminus` | 헬스 집계, readiness check, custom endpoint path, `execution.indicatorTimeoutMs` 기반 slow-indicator timeout guardrail에 사용합니다. |
| Node.js memory 또는 disk health indicator가 필요함 | `@fluojs/terminus/node` | Node 전용 memory/disk indicator helper용 subpath입니다. 호환성을 위한 root export도 유지됩니다. |
| Redis 기반 health indicator가 필요함 | `@fluojs/terminus/redis` + `@fluojs/redis` | Terminus용 전용 Redis indicator 통합입니다. |

Redis 기반 패키지 통합은 기능이 `clientName`을 노출하는 경우 기본 Redis 등록을 사용합니다. 이름 있는 Redis 등록이 해당 패키지의 의존성 edge를 맡아야 할 때만 `clientName`을 추가하면 됩니다.

---

전체 패키지 책임에 대해서는 [package-surface.ko.md](./package-surface.ko.md#canonical-runtime-package-matrix)를 참조하세요.
