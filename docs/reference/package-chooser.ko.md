# package chooser — 작업에 맞는 패키지 고르기

<p><a href="./package-chooser.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

> 현재 `fluo new`가 실제로 무엇을 스캐폴딩하는지 찾고 있다면 [fluo new 지원 매트릭스](./fluo-new-support-matrix.ko.md)를 확인하세요. 이 chooser는 현재 스타터 프리셋만이 아니라 더 넓은 패키지 생태계를 다룹니다.

## 새 웹 API 만들기 (Node.js)

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| 기본 애플리케이션 스택이 필요함 | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` | 모든 Node.js 웹 API의 시작점입니다. |
| HTTP 라우팅이 필요함 | `@fluojs/http` | 컨트롤러와 라우트 실행에 필요합니다. |
| GraphQL 엔드포인트가 필요함 | `@fluojs/graphql` | HTTP 스택 위에 추가합니다. |
| 기본 Node.js 어댑터가 필요함 | `@fluojs/platform-fastify` | 대부분의 Node.js 20+ 프로젝트에 권장되는 시작 경로이며, package는 `engines.node >=20.0.0`을 선언합니다. |
| Fastify가 HTTPS/TLS 시작을 직접 소유해야 함 | `@fluojs/platform-fastify` | 프로세스가 TLS를 직접 소유할 때 adapter/bootstrap startup surface에 Node.js `https` server option을 전달하세요. Load balancer, ingress, gateway가 TLS를 종료한다면 해당 경계 뒤에서 adapter를 일반 HTTP로 유지하세요. |
| Express host 호환이 필요함 | `@fluojs/platform-express` | Node.js에서 first-class `fluo new` 애플리케이션 스타터로도 제공됩니다. Application pipeline에는 fluo `Middleware`를 사용하고, migration 전용 Express/Connect handler는 adapter의 pre-router `nativeMiddleware` 옵션에 등록하거나 portable fluo 계약 뒤에 감싸세요. |
| Node.js HTTP를 직접 제어해야 함 | `@fluojs/platform-nodejs` | Node.js에서 first-class `fluo new` 애플리케이션 스타터로도 제공됩니다. |
| 요청 유효성 검사가 필요함 | `@fluojs/validation` | DTO 바인딩과 검증이 필요할 때 추가합니다. |
| 응답 직렬화 또는 output DTO shaping이 필요함 | `@fluojs/serialization` | 응답 DTO의 제어된 field exposure, sensitive-field exclusion, synchronous value transform, HTTP interceptor 기반 response-boundary shaping이 필요할 때 추가합니다. |
| 타입 안전 설정 접근이 필요함 | `@fluojs/config` | 패키지 내부의 직접 `process.env` 접근 대신 사용합니다. |
| localization 또는 i18n service가 필요함 | `@fluojs/i18n` | framework-agnostic internationalization module registration, standalone service 생성, 공유 option/error type, `@fluojs/i18n/icu` ICU MessageFormat plural/select 지원, `@fluojs/i18n/http` HTTP locale helper 및 opt-in `Accept-Language` policy, `@fluojs/i18n/adapters` opt-in non-HTTP locale resolution 및 header policy, `@fluojs/i18n/validation` validation localization, `@fluojs/i18n/loaders/fs`와 `@fluojs/i18n/loaders/remote` catalog loading 및 opt-in remote cache wrapper, `@fluojs/i18n/typegen` catalog key 및 typed translation helper declaration에 사용합니다. NestJS i18n, i18next, next-intl, request/validation convenience parity 결정은 [i18n ecosystem bridge decision record](./i18n-ecosystem-bridges.ko.md)에서 시작하세요. |

## React page를 stable SSR로 렌더링

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| HTTP가 소유하는 React page handler와 Web Streams SSR이 필요함 | `@fluojs/react` + `@fluojs/http` | Page를 기존 fluo module/controller pipeline에 유지해야 할 때 root `@fluojs/react` package를 사용합니다. `@Router(...)`와 `@Path(...)`는 HTTP metadata 위의 lexical React facade입니다. URL matching, route grammar, DTO-bound path/search param, validation, guard, interceptor, middleware, header, request lifecycle은 `@fluojs/http`가 계속 소유합니다. 이것은 Next.js App Router, TanStack route tree, Angular `Routes[]`, file routing, RSC, Server Functions, React-owned `routes: []` model이 아닙니다. |
| Stable SSR용 hydration asset이 필요함 | `@fluojs/react` 또는 `@fluojs/react/vite` | `createReactServerEntry(...)`에 명시적인 `bootstrapScripts`, `bootstrapModules`, 신뢰된 `bootstrapScriptContent`, `nonce`, `identifierPrefix`, 신뢰된 `assetMap` snapshot을 직접 전달하거나, `@fluojs/react/vite`로 이미 로드한 Vite manifest를 같은 hydration contract용 deterministic CSS, JavaScript bootstrap asset, asset map, trusted bootstrap data, diagnostics로 파싱합니다. RSC와 Server Functions는 future `@fluojs/react/experimental/rsc`의 책임입니다. |
| Hydrated React page에 navigation과 URL state가 필요함 | `@fluojs/react/client` + `@fluojs/http` | Request-owned `createReactRouteSnapshot(...)`을 전달한 `ReactClientRouterProvider`로 shared document를 감싼 뒤 실제 anchor를 렌더링하는 `Link`, `useRouter()`, `usePathname()`, `useParams()`, `useSearchParams()`, `useNavigation()`, `useRouterState()`를 사용합니다. Navigation은 same-origin full-document 방식이므로 server HTTP matching, DTO validation, guard, redirect, failure가 계속 authoritative합니다. Client route table, SPA document swap, data cache, prefetch contract는 없습니다. |

## 엣지 / 모던 런타임에 배포

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| Bun 런타임 어댑터가 필요함 | `@fluojs/platform-bun` | 일치하는 `fluo new` runtime/platform 스타터 경로와 연결됩니다. |
| Deno 런타임 어댑터가 필요함 | `@fluojs/platform-deno` | 일치하는 `fluo new` runtime/platform 스타터 경로와 연결됩니다. |
| Cloudflare Workers 어댑터가 필요함 | `@fluojs/platform-cloudflare-workers` | 일치하는 `fluo new` runtime/platform 스타터 경로와 연결됩니다. |

## 빌드 도구 설정

| 조건 | 패키지 선택 | 비고 |
| --- | --- | --- |
| TC39 표준 데코레이터가 포함된 TypeScript를 Vite로 빌드해야 함 | `@fluojs/vite` | `vite.config.ts`에서 `fluoDecoratorsPlugin()`을 사용해 Babel의 `@babel/plugin-proposal-decorators` transform을 `{ version: '2023-11' }`로 적용하고 `@babel/preset-typescript`도 함께 실행하면서 test, declaration, dependency, non-TypeScript 파일에 대한 fluo의 Vite 파일 경계 skip을 유지합니다. `vitest.config.ts`는 `@fluojs/testing/vitest` 경로에 두세요. Vite 플러그인은 eligible 애플리케이션 파일에서만 Babel을 lazy load하고 누락된 Babel peer를 transform hook에서 진단합니다. |

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
| Node.js에서 Prisma 기반 관계형 접근이 필요함 | `@fluojs/prisma` | Node.js 20+용 Prisma ORM 통합에 사용합니다. Root wrapper는 transaction context에 host `AsyncLocalStorage`와 `engines.node >=20.0.0` 계약을 사용하므로, 호환 ALS 경계가 없는 런타임에서는 runtime-specific transaction-context adapter가 문서화되기 전까지 raw Prisma-compatible handle을 애플리케이션 소유 provider 뒤에 등록하세요. |
| Node.js에서 Drizzle 기반 관계형 접근이 필요함 | `@fluojs/drizzle` | Node.js 20+용 Drizzle ORM 통합에 사용합니다. Root wrapper는 Node의 `node:async_hooks` transaction context와 `engines.node >=20.0.0` 계약을 사용하므로, Bun SQL, Cloudflare D1 같은 비 Node Drizzle driver는 비 Node context adapter가 문서화되기 전까지 현재 fluo wrapper 범위 밖입니다. 그런 런타임에서는 이 wrapper를 import하지 말고 raw Drizzle driver handle을 런타임별 fluo provider(`useFactory` 또는 `useValue`) 뒤에 등록하세요. |
| Node.js에서 도큐먼트 데이터베이스 접근이 필요함 | `@fluojs/mongoose` | Node.js 20+용 Mongoose 통합에 사용합니다. Root wrapper는 Node의 `node:async_hooks` transaction context와 `engines.node >=20.0.0` 계약을 사용하므로, 비 Node 런타임에서는 runtime-specific transaction-context adapter가 문서화되기 전까지 raw Mongoose-compatible handle을 애플리케이션 소유 provider 뒤에 등록하세요. |
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
| 런타임별 WebSocket lifecycle service가 필요하거나 루트 Node.js 기본값 없이 fetch-style gateway authoring이 필요함 | `@fluojs/websockets/node`, `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers` | 런타임 경계와 일치하는 서브패스를 선택합니다. 각 서브패스도 공유 gateway decorator와 metadata helper를 노출합니다. |
| Socket.IO 시맨틱이 필요함 | `@fluojs/socket.io` + `@fluojs/websockets` | Node.js 20+ server-backed adapter 또는 공식 Bun engine path의 Socket.IO 호환 통합에 사용합니다. Socket.IO gateway authoring은 `@fluojs/websockets`의 `@WebSocketGateway`, `@OnMessage`, lifecycle decorator를 재사용하므로 companion 패키지를 함께 설치하세요. Native Socket.IO emit 또는 ACK 중심 migration seam에는 `SOCKETIO_SERVER`를 주입합니다. Deno와 Workers는 지원하지 않으며, Bun은 static CORS shape를 요구하고 `@WebSocketGateway({ serverBacked })`를 지원하지 않습니다. |
| optional cross-process fan-out이 있는 in-process domain event가 필요함 | `@fluojs/event-bus` + optional `@fluojs/event-bus/redis` 및 `@fluojs/redis` | 하나의 published domain fact가 여러 local handler를 알릴 때 사용하고, 반응이 process boundary를 넘어야 할 때만 Redis Pub/Sub fan-out을 추가합니다. |
| 메시지 패턴 마이크로서비스가 필요함 | `@fluojs/microservices` | 전송 기반 마이크로서비스 핸들러에 사용합니다. |
| 백그라운드 작업이 필요함 | `@fluojs/queue` + `@fluojs/redis` | 큐 워커는 Redis에 의존합니다. |
| 스케줄 작업이 필요함 | `@fluojs/cron` | cron 스타일 스케줄링에 사용하고, distributed lock을 활성화할 때만 `@fluojs/redis`를 추가합니다. |
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
