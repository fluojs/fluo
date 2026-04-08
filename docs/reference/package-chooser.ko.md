# package chooser — 작업에 맞는 패키지 고르기

<p><a href="./package-chooser.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드를 사용하여 특정 작업에 맞는 Konekti 패키지를 선택하세요. 애플리케이션 스택을 효율적으로 구축할 수 있도록 목표별로 정리되어 있습니다.

## 새 웹 API 만들기 (Node.js)

> _"Node.js에서 표준 REST 또는 GraphQL API를 만들고 싶습니다."_

| 작업 | 추천 패키지 |
| --- | --- |
| **기반** | `@konekti/core`, `@konekti/di`, `@konekti/runtime` |
| **HTTP 라우팅** | `@konekti/http` |
| **Fastify (권장)** | `@konekti/platform-fastify` |
| **Express 호환** | `@konekti/platform-express` |
| **입력 유효성 검사** | `@konekti/validation` |
| **설정** | `@konekti/config` |

## 엣지 / 모던 런타임에 배포

> _"Bun, Deno, 또는 Cloudflare Workers에서 애플리케이션을 실행하고 싶습니다."_

| 대상 | 어댑터 |
| --- | --- |
| **Bun** | `@konekti/platform-bun` |
| **Deno** | `@konekti/platform-deno` |
| **Cloudflare Workers** | `@konekti/platform-cloudflare-workers` |

## 영속성 및 데이터 접근 추가

> _"데이터베이스 또는 캐시에 연결해야 합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **관계형 (Prisma)** | `@konekti/prisma` |
| **관계형 (Drizzle)** | `@konekti/drizzle` |
| **도큐먼트 (Mongoose)** | `@konekti/mongoose` |
| **캐싱** | `@konekti/cache-manager` |
| **Redis 공유 서비스** | `@konekti/redis` |

## 보안 및 인증 구현

> _"라우트를 보호하고 인증을 처리해야 합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **JWT 전략** | `@konekti/jwt` |
| **Passport 통합** | `@konekti/passport` |
| **속도 제한** | `@konekti/throttler` |

## 실시간 및 메시징

> _"WebSocket, Socket.IO, 또는 백그라운드 워커가 필요합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **Raw WebSocket** | `@konekti/websockets` |
| **Socket.IO** | `@konekti/socket.io` |
| **마이크로서비스** | `@konekti/microservices` |
| **백그라운드 작업** | `@konekti/queue` + `@konekti/redis` |
| **크론 / 스케줄링** | `@konekti/cron` |

## 관측 가능성 및 문서화

> _"앱을 모니터링하고 문서를 생성해야 합니다."_

| 목표 | 추천 패키지 |
| --- | --- |
| **OpenAPI / Swagger** | `@konekti/openapi` |
| **메트릭 (Prometheus)** | `@konekti/metrics` |
| **헬스 체크** | `@konekti/terminus` |

---

전체 패키지 책임에 대해서는 [package-surface.ko.md](./package-surface.ko.md)를 참조하세요.
