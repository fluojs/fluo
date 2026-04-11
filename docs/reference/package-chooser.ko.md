# package chooser — 작업에 맞는 패키지 고르기

<p><a href="./package-chooser.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드를 사용하여 특정 작업에 맞는 fluo 패키지를 선택하세요. 애플리케이션 스택을 효율적으로 구축할 수 있도록 목표별로 정리되어 있습니다.

> 현재 `fluo new`가 실제로 무엇을 스캐폴딩하는지 찾고 있다면 [fluo new 지원 매트릭스](./fluo-new-support-matrix.ko.md)를 확인하세요. 이 chooser는 현재 스타터 프리셋만이 아니라 더 넓은 패키지 생태계를 다룹니다.

## 새 웹 API 만들기 (Node.js)

> _"Node.js에서 표준 REST 또는 GraphQL API를 만들고 싶습니다."_

| 작업 | 추천 패키지 |
| --- | --- |
| **기반** | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` |
| **HTTP 라우팅** | `@fluojs/http` |
| **GraphQL API** | `@fluojs/graphql` |
| **Fastify (권장)** | `@fluojs/platform-fastify` |
| **Express 호환** | `@fluojs/platform-express` *(문서화된 생태계 지원이며, 현재 `fluo new` 스타터 프리셋은 아님)* |
| **입력 유효성 검사** | `@fluojs/validation` |
| **설정** | `@fluojs/config` |

## 엣지 / 모던 런타임에 배포

> _"Bun, Deno, 또는 Cloudflare Workers에서 애플리케이션을 실행하고 싶습니다."_

| 대상 | 어댑터 |
| --- | --- |
| **Bun** | `@fluojs/platform-bun` |
| **Deno** | `@fluojs/platform-deno` |
| **Cloudflare Workers** | `@fluojs/platform-cloudflare-workers` |

이 어댑터 행들은 스캐폴딩 이후 또는 수동 구성에서 사용할 수 있는 지원 패키지 경로를 설명합니다. Bun, Deno, Cloudflare가 현재 `fluo new` 내부 chooser 분기라는 뜻은 아닙니다.

## 영속성 및 데이터 접근 추가

> _"데이터베이스 또는 캐시에 연결해야 합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **관계형 (Prisma)** | `@fluojs/prisma` |
| **관계형 (Drizzle)** | `@fluojs/drizzle` |
| **도큐먼트 (Mongoose)** | `@fluojs/mongoose` |
| **캐싱** | `@fluojs/cache-manager` |
| **Redis 공유 서비스** | `@fluojs/redis` |

## 보안 및 인증 구현

> _"라우트를 보호하고 인증을 처리해야 합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **JWT 전략** | `@fluojs/jwt` |
| **Passport 통합** | `@fluojs/passport` |
| **속도 제한** | `@fluojs/throttler` |

## 실시간 및 메시징

> _"WebSocket, Socket.IO, 또는 백그라운드 워커가 필요합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **Raw WebSocket** | `@fluojs/websockets` |
| **Socket.IO** | `@fluojs/socket.io` |
| **마이크로서비스** | `@fluojs/microservices` |
| **백그라운드 작업** | `@fluojs/queue` + `@fluojs/redis` |
| **크론 / 스케줄링** | `@fluojs/cron` |
| **알림 (Notifications)** | `@fluojs/notifications` |
| **이메일 (Portable)** | `@fluojs/email` |
| **이메일 (Node SMTP)** | `@fluojs/email/node` |
| **슬랙 알림** | `@fluojs/slack` |
| **디스코드 알림** | `@fluojs/discord` |

## 관측 가능성 및 문서화

> _"앱을 모니터링하고 문서를 생성해야 합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **OpenAPI / Swagger** | `@fluojs/openapi` |
| **메트릭 (Prometheus)** | `@fluojs/metrics` |
| **헬스 체크** | `@fluojs/terminus` |

---

전체 패키지 책임에 대해서는 [package-surface.ko.md](./package-surface.ko.md#canonical-runtime-package-matrix)를 참조하세요.
