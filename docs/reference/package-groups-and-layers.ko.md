# Konekti 패키지 그룹 분류 & 층위 분석

전체 29개 패키지를 8개 그룹으로 분류하고, 의존성 기반 층위를 분석한다.

---

## 패키지 그룹 분류 (8개)

> 의존 컬럼은 `package.json`의 `dependencies` 기준이며, 내부 `peerDependencies`/`devDependencies`는 괄호로 보조 표기한다.

### ① Foundation

모든 것의 근본. 다른 패키지 없이 독립적으로 존재.

| 패키지 | 설명 |
|---|---|
| `core` | 공유 타입, 에러, 데코레이터 정의, 메타데이터 헬퍼. 의존성 없음 |
| `di` | 토큰 기반 DI 컨테이너. `core`만 의존 |

---

### ② Request Pipeline

HTTP 요청이 컨트롤러에 도달하기 전/후에 거치는 처리 단계들.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `dto-validator` | DTO 필드 데코레이터 기반 유효성 검사 | core |
| `serializer` | 응답 필드 직렬화 (`@Exclude`, `@Expose`) | core, http |
| `openapi` | 라우트 메타데이터 → OpenAPI 3.1 스펙 자동 생성 | core, dto-validator, http, runtime |
| `throttler` | 데코레이터 기반 요청 레이트 리미팅 | core, di, http, runtime (+ peer optional: redis) |
| `cache-manager` | HTTP 응답 캐싱 인터셉터 + 범용 캐시 서비스 | core, di, http, runtime (+ peer optional: redis) |

---

### ③ HTTP Runtime & Platforms

HTTP 요청을 실제로 수신하고, 라우팅하고, 디스패치하는 런타임 레이어.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `http` | 라우트 데코레이터, 바인딩, 디스패처, 예외 체인 | core, di, dto-validator |
| `config` | `.env` + 기본값 + 검증 → 타입 안전 설정 딕셔너리 | core |
| `runtime` | 모듈 그래프 컴파일 + DI/HTTP/config 조립 → 앱 셸 | config, core, di, http (+ dev: serializer) |
| `platform-fastify` | Fastify 기반 HTTP 어댑터 (Node 기본 어댑터 대비 ~2x 성능) | http, runtime |
| `terminus` | 의존성 인식 헬스체크 (`/health`, `/ready` 강화) | core, di, http, runtime (+ peer optional: drizzle, prisma, redis) |
| `metrics` | Prometheus `/metrics` 엔드포인트 | di, http, runtime |
| `testing` | 모듈 그래프 빌더 + 프로바이더 오버라이드 테스트 유틸 | config, core, di, http, runtime |

---

### ④ Auth & Identity

인증/인가 전략 실행 + JWT 토큰 코어.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `jwt` | 서명/검증/주체 정규화. HTTP에 무관한 토큰 코어 | core, di |
| `passport` | 전략 무관 AuthGuard + 리프레시 토큰 + 쿠키 인증 + 계정 연결 정책 | core, di, http, jwt |

---

### ⑤ Infra & Messaging

외부 인프라 연동 + 비동기 메시징 + 스케줄링.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `redis` | 앱 스코프 ioredis 클라이언트 + 수명주기 관리 | core, di, runtime |
| `queue` | BullMQ 기반 백그라운드 잡 처리 (데코레이터 워커 발견) | core, di, redis, runtime |
| `cron` | 데코레이터 기반 크론 스케줄러 + Redis 분산 락 옵션 | core, di, redis, runtime |
| `event-bus` | 인-process 이벤트 발행 + 선택적 Redis Pub/Sub transport | core, di, runtime |
| `cqrs` | Command/Query 버스 + 이벤트 발행 위임 + Saga 프로세스 매니저 | core, di, event-bus, runtime |
| `microservices` | Transport 기반 마이크로서비스 메시지 컨슈머 (TCP, Redis, NATS, Kafka, RabbitMQ) | core, di, runtime |

---

### ⑥ Protocol Adapters

HTTP 이외의 프로토콜로 서비스를 노출하는 어댑터.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `websocket` | `ws` 기반 WebSocket 게이트웨이 (공유 HTTP 서버 업그레이드) | core, di, http, runtime (+ dev: platform-fastify) |
| `platform-socket.io` | Socket.IO v4 네임스페이스/룸 어댑터 (websocket 데코레이터 재사용) | core, di, http, runtime, websocket |
| `graphql` | GraphQL Yoga 엔드포인트 + code-first/schema-first 리졸버 | core, di, dto-validator, http, runtime |

---

### ⑦ ORM & Persistence

데이터베이스 연결 생명주기 + 트랜잭션 컨텍스트.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `prisma` | PrismaClient → ALS 트랜잭션 + `$connect`/`$disconnect` 라이프사이클 | core, di, dto-validator, http, runtime |
| `drizzle` | Drizzle 핸들 → ALS 트랜잭션 + 선택적 dispose 훅 | core, di, http, runtime |
| `mongoose` | Mongoose 연결 → 세션 인식 트랜잭션 + 선택적 dispose 훅 | core, di, http, runtime |

---

### ⑧ CLI & Scaffolding

프로젝트 생성 + 코드 생성 도구.

| 패키지 | 설명 | 의존 (@konekti/*, dependencies 기준) |
|---|---|---|
| `cli` | `konekti new`, `konekti generate` 커맨드. 프레임워크 패키지에 의존하지 않음 | 없음 (ejs, tsx, typescript만) |

---

## 층위 분석 (Dependency Layers)

```
Layer 0 (Foundation — 모든 것의 뿌리)
  ┌────────────────────────────────────────────────────────┐
  │  core          di          dto-validator     config    │
  └────────────────────────────────────────────────────────┘
                        │
                        ▼
Layer 1 (Core Runtime + Auth — 앱의 뼈대)
  ┌─────────────────────────────────────────────┐
  │  http          jwt                          │
  │  (핵심 런타임)   (HTTP 무관 토큰 코어)            │
  └─────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
Layer 2 (Assembly + Infra — 조립 + 인프라 연결)
  ┌─────────────────────────────────────────────┐
  │  runtime  passport  serializer              │
  │  redis    platform-fastify                  │
  │  event-bus   microservices                  │
  └─────────────────────────────────────────────┘
                        │
                        ▼
Layer 3 (Features — 기능 패키지, runtime 위에 올라감)
  ┌─────────────────────────────────────────────┐
  │  openapi   terminus   metrics               │
  │  cache-manager   throttler                  │
  │  websocket  graphql   platform-socket.io    │
  │  queue     cron       cqrs                  │
  │  drizzle   prisma     mongoose              │
  │  testing                                    │
  └─────────────────────────────────────────────┘
                        │
                        ▼
Layer 4 (Tooling — 위에 떠 있는 도구)
  ┌─────────────────────────────────────────────┐
  │  cli                                        │
  └─────────────────────────────────────────────┘
```

---

## 핵심 관찰

1. **`core`는 여전히 파운데이션이다** — 29개 중 25개 패키지가 `dependencies`에서 `core`를 직접 의존한다(예외: `core`, `cli`, `metrics`, `platform-fastify`). `core`가 흔들리면 대부분의 패키지가 연쇄 영향을 받는다.

2. **`http`가 진짜 허브다** — `runtime`, `passport`, `serializer`, `openapi`, `graphql`, `websocket`, 모든 ORM, 모든 기능 미들웨어가 `http`를 직접 의존한다. Layer 1의 두 축은 `http`와 `di`다.

3. **`runtime`은 조립 레이어다** — `runtime` 자체는 기능이 없다. 모듈 그래프를 컴파일하고 config/di/http를 조립하는 글루 코드. 이것이 Layer 2의 기준점이다.

4. **`redis`는 인프라 레이어의 게이트키퍼다** — `queue`, `cron`은 `dependencies`로 `redis`를 직접 의존하고, `throttler`/`cache-manager`/`terminus`는 `peerDependencies(optional)`로 Redis 통합 지점을 노출한다. `redis`는 `runtime`에 의존하므로 Layer 2에 위치한다.

5. **cli는 외톨이다** — 어떤 `@konekti/*` 패키지도 의존하지 않는다. 순수 코드 생성 도구.

6. **기존 7그룹에서 8그룹으로 나뉠 때** — `terminus`, `metrics`, `cache-manager`, `testing`이 새롭게 추가되거나 재분류가 필요했다. 이들을 "HTTP Runtime & Platforms"로 묶으면서 기존 "HTTP Runtime"과 "Protocol Adapters"의 성격이 구분된다: HTTP Runtime은 요청 처리 + 운영 concerns, Protocol Adapters는 HTTP 외 프로토콜.

---

## 기존 7그룹 ↔ 새 8그룹 매핑

| 기존 그룹 (7개) | 새 그룹 (8개) | 변화 |
|---|---|---|
| Foundation (core, di) | ① Foundation (core, di) | 동일 |
| HTTP Runtime (http, runtime, config, platform-fastify, testing) | ③ HTTP Runtime & Platforms | terminus, metrics 추가 |
| Request Pipeline (dto-validator, serializer, openapi, throttler) | ② Request Pipeline | cache-manager 추가 |
| Auth & Identity (jwt, passport) | ④ Auth & Identity | 동일 |
| Infra / Messaging (redis, queue, cron, event-bus, microservices) | ⑤ Infra & Messaging | cqrs 추가 |
| Protocol Adapters (websocket, graphql, metrics) | ⑥ Protocol Adapters | metrics 제거, platform-socket.io 추가 |
| ORM & CLI (drizzle, prisma, cli) | ⑦ ORM & Persistence + ⑧ CLI & Scaffolding | mongoose 추가, CLI 분리 |
