# package chooser — 작업에 맞는 패키지 고르기

<p><a href="./package-chooser.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 만들고 싶은 것에 맞는 Konekti 패키지를 찾도록 돕습니다. 알파벳순 목록을 훑는 대신, 달성하려는 작업에서 출발해 추천 패키지 조합을 따르세요.

전체 패키지 목록과 패키지별 책임은 [`package-surface.ko.md`](./package-surface.ko.md)를 참고하세요.
패키지별 API 상세는 각 패키지 디렉토리의 `packages/*/README.md`를 확인하세요.

---

## 이 가이드 읽는 법

아래 각 섹션은 하나의 공통 작업/목표를 나타냅니다. 각 작업 아래에는 다음이 있습니다:

- **설치** — 추가해야 할 패키지.
- **왜 이 조합인가** — 패키지들이 어떻게 함께 동작하는지 간략 설명.
- **사용하지 않는 경우** — 이 조합이 맞지 않는 상황.
- **다음 단계** — 관련 개념 또는 시작 가이드 링크.

★ 표시 패키지는 `konekti new` 스타터 스캐폴드에 포함되어 있어 별도 설치가 필요 없습니다.

---

## 새 HTTP API 만들고 실행하기

> _"라우팅, 유효성 검사, 설정이 갖춰진 HTTP 서버가 필요합니다."_

| 레이어 | 패키지 | 비고 |
|--------|--------|------|
| 부트스트랩 | `@konekti/runtime` ★ | 모듈을 조합하고 앱을 시작 |
| DI | `@konekti/di` ★ | 클래스 우선 및 토큰 기반 의존성 주입 |
| 코어 | `@konekti/core` ★ | 데코레이터, 메타데이터, 공유 계약 |
| HTTP | `@konekti/http` ★ | 라우팅, 가드, 인터셉터, 예외 처리 |
| 플랫폼 | `@konekti/platform-fastify` ★ | Fastify 어댑터 — Node.js에서 동작하는 스타터 기본 HTTP 리스너 |
| 설정 | `@konekti/config` ★ | 타입 안전 설정 로딩 |
| 유효성 검사 | `@konekti/validation` ★ | 입력 DTO 검증 및 구체화 |
| CLI | `@konekti/cli` ★ | `konekti new`, `konekti g`, dev/build 스크립트 |

**왜 이 조합인가:** ★ 패키지는 `konekti new`와 함께 제공됩니다. `runtime`이 모듈 그래프를 조립하고, `http`가 요청 체인을 제공하며, `platform-fastify`가 Node.js 기준 스타터의 기본 adapter-first HTTP 리스너를 담당하고, `validation` + `config`가 입력 안전성과 환경 바인딩을 처리합니다. 새 HTTP 앱은 `KonektiFactory.create(..., { adapter })`로 대상 런타임 어댑터를 명시하는 방식을 우선 사용하세요. 같은 런타임 facade 위에서 bare Node HTTP가 필요하면 `@konekti/platform-nodejs`를 사용하고, `runNodeApplication()` 같은 호환 헬퍼만 `@konekti/runtime/node`에 남겨 두세요.

**표준 런타임 매트릭스:** 공식 런타임/패키지 매핑은 [`package-surface.ko.md`](./package-surface.ko.md#canonical-runtime-package-matrix)를 기준으로 삼으세요. 이 가이드는 작업 기준 패키지 선택에만 집중하고, 런타임별 시작 세부사항은 각 어댑터 README로 연결합니다.

**사용하지 않는 경우:**
- Node.js에서 Express 미들웨어 호환이 필요하면 `platform-fastify` 대신 `@konekti/platform-express`로 교체하세요.
- Fastify나 Express 없이 bare Node 리스너가 필요하면 `@konekti/platform-nodejs`를 선택하세요.
- 비-HTTP 서비스(순수 메시지 소비자 등)를 만든다면 `http`와 `platform-*`을 건너뛰세요 — [마이크로서비스 소비자 실행](#마이크로서비스-소비자-실행)을 참고하세요.

**다음 단계:** [`getting-started/quick-start.ko.md`](../getting-started/quick-start.ko.md) · [`concepts/architecture-overview.ko.md`](../concepts/architecture-overview.ko.md)

---

## 인증 추가하기

> _"JWT 기반 인증과 전략 독립적 가드가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/jwt` | JWT 토큰 서명 및 검증 |
| `@konekti/passport` | 전략 레지스트리 및 범용 `AuthGuard` |

**왜 이 조합인가:** `jwt`는 HTTP에 결합되지 않고 토큰 메커닉을 처리합니다. `passport`는 모든 `AuthStrategy` 구현을 범용 가드를 통해 요청 컨텍스트에 연결하므로, 컨트롤러 코드를 변경하지 않고 전략(로컬, OAuth, API 키)을 교체할 수 있습니다.

**사용하지 않는 경우:**
- 가드 연결 없이 토큰 검증만 필요한 경우(예: 게이트웨이에서 온 토큰을 검증하는 마이크로서비스), `@konekti/jwt` 단독으로 충분합니다.
- 전략/가드 패턴에 맞지 않는 커스텀 인증 흐름을 만든다면 `@konekti/http` 데코레이터로 가드를 직접 구현하세요.

**다음 단계:** [`concepts/auth-and-jwt.ko.md`](../concepts/auth-and-jwt.ko.md) · [`concepts/decorators-and-metadata.ko.md`](../concepts/decorators-and-metadata.ko.md)

---

## 관계형 데이터베이스 연결

> _"Prisma 또는 Drizzle을 트랜잭션 지원과 함께 연결하고 싶습니다."_

### 선택 A — Prisma

| 패키지 | 역할 |
|--------|------|
| `@konekti/prisma` | Prisma 라이프사이클, ALS 기반 트랜잭션, 비동기 모듈 팩토리 |

### 선택 B — Drizzle

| 패키지 | 역할 |
|--------|------|
| `@konekti/drizzle` | Drizzle handle + ALS 트랜잭션 컨텍스트 + optional dispose 훅 |

**왜 이 패키지들인가:** 두 패키지 모두 ORM 라이프사이클을 Konekti의 부트스트랩/셧다운 시퀀스에 통합하고, AsyncLocalStorage 기반 트랜잭션 인지 `current()` 심(seam)을 노출합니다. 기존 스키마 도구에 맞는 것을 선택하세요.

**사용하지 않는 경우:**
- Mongoose(도큐먼트 저장소)를 사용한다면 [도큐먼트 데이터베이스 연결](#도큐먼트-데이터베이스-연결)을 참고하세요.
- 트랜잭션이 필요 없는 읽기 전용 데이터베이스 접근이라면 전용 통합 패키지 없이 `@konekti/di`를 통해 raw 클라이언트를 연결할 수 있습니다.

**다음 단계:** [`concepts/transactions.ko.md`](../concepts/transactions.ko.md)

---

## 도큐먼트 데이터베이스 연결

> _"세션 인지 트랜잭션이 있는 Mongoose가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/mongoose` | Mongoose 연결 라이프사이클, 세션 인지 트랜잭션 심, optional dispose 훅 |

**사용하지 않는 경우:**
- 관계형 데이터베이스(PostgreSQL, MySQL, SQLite)는 [관계형 데이터베이스 연결](#관계형-데이터베이스-연결)을 참고하세요.

**다음 단계:** [`concepts/transactions.ko.md`](../concepts/transactions.ko.md)

---

## OpenAPI 스펙 및 문서 UI 노출

> _"데코레이터에서 자동 생성되는 OpenAPI 3.1 문서가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/openapi` | 데코레이터 기반 OpenAPI 문서 생성, `/openapi.json` 엔드포인트, `/docs`의 Swagger UI 뷰어(선택) |

**왜 이 패키지인가:** 컨트롤러와 핸들러에 OpenAPI 데코레이터를 붙이면 `OpenApiModule`이 스펙과 선택적 UI를 자동으로 서빙합니다.

**사용하지 않는 경우:**
- 수동으로 관리하는 스펙 파일을 정적 에셋으로 서빙하기만 한다면 일반 파일 서빙 라우트가 더 간단합니다.

**다음 단계:** [`concepts/openapi.ko.md`](../concepts/openapi.ko.md)

---

## GraphQL 엔드포인트 추가

> _"리졸버가 있는 `/graphql` 엔드포인트가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/graphql` | GraphQL Yoga 마운트, code-first(`@Resolver`, `@Query`, `@Mutation`, `@Subscription`) 및 schema-first 지원 |

**사용하지 않는 경우:**
- API가 순수 REST/HTTP라면 이 패키지는 불필요한 복잡성을 추가합니다.
- 독립 엔드포인트가 아닌 페더레이션 게이트웨이가 필요하다면, 채택 전에 현재 모듈이 게이트웨이 요구사항을 충족하는지 확인하세요.

---

## 마이크로서비스 소비자 실행

> _"Kafka / RabbitMQ / NATS / gRPC / Redis / MQTT / TCP에서 메시지를 소비해야 합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/microservices` | 트랜스포트 추상화, 패턴 데코레이터, 마이크로서비스 런타임 |

필요한 트랜스포트별 엔트리포인트를 가져오세요: `@konekti/microservices/kafka`, `@konekti/microservices/rabbitmq`, `@konekti/microservices/nats`, `@konekti/microservices/grpc`, `@konekti/microservices/redis`, `@konekti/microservices/mqtt`, 또는 `@konekti/microservices/tcp`.

**왜 이 패키지인가:** 단일 패키지가 모든 지원 트랜스포트에 대해 핸들러 탐색, 패턴 매칭, 라이프사이클 관리를 제공합니다. 서브패스 export로 실제 사용 트랜스포트에만 번들이 집중됩니다.

**사용하지 않는 경우:**
- 순수 HTTP API를 만든다면 [`@konekti/http`](#새-http-api-만들고-실행하기)를 사용하세요.
- 전체 마이크로서비스 런타임 없이 간단한 Redis pub/sub만 필요하다면 [프로세스 내 이벤트 발행/구독](#프로세스-내-이벤트-발행구독)에서 `@konekti/event-bus` + Redis 어댑터를 참고하세요.

**다음 단계:** [`concepts/architecture-overview.ko.md`](../concepts/architecture-overview.ko.md)

---

## 실시간 통신 추가

> _"WebSocket 게이트웨이 또는 Socket.IO 룸이 필요합니다."_

### 선택 A — raw WebSocket

| 패키지 | 역할 |
|--------|------|
| `@konekti/websocket` | 데코레이터 기반 게이트웨이 탐색, Node HTTP/S 업그레이드 연결 |

### 선택 B — Socket.IO

| 패키지 | 역할 |
|--------|------|
| `@konekti/platform-socket.io` | 공유 Konekti 런타임 위의 Socket.IO v4 게이트웨이 어댑터 |

**사용하지 않는 경우:**
- 실시간 요구가 서버 전송 이벤트(SSE)에 한정된다면 `@konekti/http`의 표준 HTTP 스트리밍 응답으로 충분할 수 있습니다.

---

## 응답 또는 데이터 캐싱

> _"데코레이터 기반 HTTP 캐싱이나 독립형 캐시 API가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/cache-manager` | 데코레이터 기반 HTTP 응답 캐시, 독립형 cache service/store API, 메모리/Redis 백엔드 |

Redis 백엔드 선택 시 `@konekti/redis`와 함께 사용하세요 — `cache-manager`가 항목을 저장할 Redis 연결이 필요합니다.

**사용하지 않는 경우:**
- Redis를 캐시가 아닌 데이터 저장소로만 사용한다면 `@konekti/redis`를 직접 사용하세요.

**다음 단계:** [`concepts/caching.ko.md`](../concepts/caching.ko.md)

---

## 속도 제한 추가

> _"라우트별로 요청 속도를 제한하고 싶습니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/throttler` | 데코레이터 기반 속도 제한, 인메모리/Redis 스토어 어댑터 |

인스턴스 간 분산 속도 제한을 위해 Redis 스토어 선택 시 `@konekti/redis`와 함께 사용하세요.

**사용하지 않는 경우:**
- 속도 제한이 업스트림 API 게이트웨이나 로드 밸런서에서 처리된다면 인앱 throttler는 중복 강제를 추가합니다.

---

## 백그라운드 작업 스케줄링

> _"크론 작업, 인터벌, 지연 작업이 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/cron` | `@Cron`, `@Interval`, `@Timeout` 데코레이터, 런타임 레지스트리, optional 분산 락 |

여러 인스턴스 실행 시 분산 락을 위해 `@konekti/redis`와 함께 사용하세요 — 중복 실행을 방지합니다.

**사용하지 않는 경우:**
- 재시도/DLQ가 있는 영속적 작업 큐가 필요하다면 [백그라운드 작업 처리](#백그라운드-작업-처리)를 참고하세요.
- 크론 스케줄링은 인프로세스입니다. 앱 외부의 중앙 집중형 스케줄러가 필요하다면 인프라 수준 솔루션을 사용하세요.

---

## 백그라운드 작업 처리

> _"워커와 데드 레터 처리가 있는 Redis 기반 작업 큐가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/queue` | 작업 등록, 워커 탐색, DLQ 지원, 라이프사이클 관리 |
| `@konekti/redis` | 공유 Redis 연결(큐에 필요) |

**사용하지 않는 경우:**
- 영속성 없는 단순 반복 작업이라면 `@konekti/cron`이 더 가볍습니다.
- 작업 처리가 메시지 브로커(Kafka, RabbitMQ)를 통해 이뤄진다면 대신 `@konekti/microservices`를 사용하세요.

---

## 프로세스 내 이벤트 발행/구독

> _"모듈 간 직접 import 없이 이벤트로 통신하고 싶습니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/event-bus` | 프로세스 내 이벤트 발행, 데코레이터 기반 핸들러 탐색, optional 외부 트랜스포트 어댑터 |

**사용하지 않는 경우:**
- 크로스 프로세스 메시징이 필요하다면 `event-bus`에 외부 트랜스포트 어댑터를 연결하거나 `@konekti/microservices`를 직접 사용하세요.

---

## CQRS 구현

> _"사가 지원이 있는 분리된 커맨드/쿼리 버스가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/cqrs` | 커맨드/쿼리 디스패치, 부트스트랩 시점 핸들러 탐색, 사가/프로세스 매니저 지원 |
| `@konekti/event-bus` | 이벤트 발행(cqrs에 의해 위임됨) |

**왜 이 조합인가:** `cqrs`는 이벤트 전달을 위해 `event-bus`에 의존합니다. 커맨드와 쿼리는 별도 디스패치 파이프라인을 갖고, 이벤트는 공유 버스를 통해 흐릅니다.

**사용하지 않는 경우:**
- 별도의 커맨드/쿼리 모델이 없는 단순 요청/응답 API라면 표준 컨트롤러 + 서비스로 충분합니다.

**다음 단계:** [`concepts/cqrs.ko.md`](../concepts/cqrs.ko.md)

---

## Prometheus 메트릭 노출

> _"기본 Node.js 메트릭이 포함된 `/metrics` 엔드포인트가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/metrics` | Prometheus 스크레이프 대상, 격리 registry, low-cardinality HTTP 미들웨어 |

**사용하지 않는 경우:**
- Prometheus가 아닌 관측 스택을 사용한다면 이 패키지의 출력 형식이 수집기와 맞지 않을 수 있습니다.

**다음 단계:** [`concepts/observability.ko.md`](../concepts/observability.ko.md)

---

## 헬스 체크 추가

> _"`/health`에서 데이터베이스, Redis, 외부 서비스 준비 상태를 확인하고 싶습니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/terminus` | 헬스 인디케이터 조합, 의존성 인지 체크, 런타임 건강 집계 확장 |

**왜 이 패키지인가:** 런타임이 이미 `/health`와 `/ready`를 노출합니다. `terminus`는 그 위에 의존성별 인디케이터(DB 핑, Redis 핑, 커스텀 체크)를 조합해 헬스 응답에 추가합니다.

**사용하지 않는 경우:**
- 의존성 체크 없이 기본 `/health`와 `/ready` 스텁만 필요하다면 스타터 스캐폴드에 이미 포함되어 있습니다 — 추가 패키지 불필요.

---

## 응답 직렬화

> _"인터셉터를 사용한 클래스 기반 응답 형태 변환이 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/serialization` | 출력 측 응답 직렬화, 클래스 기반 변환기, 인터셉터 통합 |

**사용하지 않는 경우:**
- 응답이 클래스 기반 변환 규칙이 필요 없는 단순 JSON 객체라면 핸들러에서 직접 반환하는 것으로 충분합니다.

---

## Redis를 공유 서비스로 사용

> _"모듈 간 공유되는 Redis 연결이 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/redis` | 앱 범위 라이프사이클(`lazyConnect` + graceful shutdown), raw `ioredis` 토큰 주입, `RedisService` facade |

**왜 이 패키지인가:** 한 번 등록하고 어디서나 주입하세요. 다른 패키지(`cache-manager`, `queue`, `throttler`, `cron`)가 Redis 백엔드 사용 시 이 공유 연결에 의존합니다.

**사용하지 않는 경우:**
- 상위 패키지(예: 메모리 백엔드의 `cache-manager`)를 통해서만 Redis에 접근한다면 `redis`를 별도 설치할 필요가 없을 수 있습니다.

---

## 런타임 검사 및 디버그

> _"모듈 그래프와 부트스트랩 타이밍을 시각화하고 싶습니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/cli` ★ | `konekti inspect`으로 런타임 진단 |
| `@konekti/studio` | 런타임 그래프/타이밍 JSON 내보내기를 파일 기반으로 확인하는 진단 뷰어 |

**사용하지 않는 경우:**
- 이것들은 개발/디버깅 도구입니다. `@konekti/studio`를 프로덕션 의존성에 포함하지 마세요.

---

## 테스트 작성 및 실행

> _"테스트용 모듈 구성 헬퍼와 프로바이더 오버라이드가 필요합니다."_

| 패키지 | 역할 |
|--------|------|
| `@konekti/testing` | `TestModule` 빌더, 프로바이더 오버라이드 헬퍼, 라이프사이클 유틸리티 |

**다음 단계:** [`operations/testing-guide.ko.md`](../operations/testing-guide.ko.md)

---

## 자주 쓰는 페어링 패턴

아래 표는 스타터 스캐폴드 외에 자주 결합되는 패키지를 정리합니다:

| 목표 | 패키지 | 비고 |
|------|--------|------|
| REST API + Prisma + 인증 | `prisma` + `jwt` + `passport` | 가장 일반적인 풀스택 웹 API 셋업 |
| REST API + Drizzle + 인증 | `drizzle` + `jwt` + `passport` | Prisma 대신 Drizzle을 쓰는 동일 패턴 |
| 마이크로서비스 + Redis 큐 | `microservices` + `queue` + `redis` | 영속적 작업 재시도가 있는 메시지 주도 처리 |
| 실시간 + 캐싱 | `platform-socket.io` 또는 `websocket` + `cache-manager` + `redis` | 캐시된 데이터와 라이브 푸시 업데이트 |
| CQRS + 이벤트 소싱 | `cqrs` + `event-bus` + `prisma` 또는 `drizzle` | 영속적 이벤트 저장소를 가진 커맨드/쿼리 분리 |
| 운영 준비 API | `metrics` + `terminus` + `openapi` | 프로덕션 관측성, 헬스 체크, API 문서 |
| 스케줄링 워커 | `cron` + `redis` + `queue` | 분산 락과 영속적 큐 폴백이 있는 시간 기반 작업 |

---

## 기본, 고급, 통합 경로

- **기본 경로:** 위에서 ★ 표시된 패키지는 `konekti new`와 함께 제공됩니다. 모든 새 프로젝트의 출발점입니다.
- **고급 경로:** 아키텍처가 단순 요청/응답을 넘어서면 `cqrs`, `event-bus`, `microservices`, `graphql`, `metrics`를 추가하세요.
- **통합 경로:** `prisma`, `drizzle`, `mongoose`, `redis`, `passport`, `cache-manager`는 Konekti를 외부 시스템에 연결합니다. 프로젝트에 필요한 통합만 선택하세요.

---

## 다음으로 이동

- [`package-surface.ko.md`](./package-surface.ko.md) — 전체 패키지 목록 및 패키지별 책임
- [`toolchain-contract-matrix.ko.md`](./toolchain-contract-matrix.ko.md) — 툴체인 및 스캐폴드 상세
- [`glossary-and-mental-model.ko.md`](./glossary-and-mental-model.ko.md) — 용어 참고
- [`../getting-started/quick-start.ko.md`](../getting-started/quick-start.ko.md) — 첫 실행 가이드
- [`../concepts/architecture-overview.ko.md`](../concepts/architecture-overview.ko.md) — 패키지 경계 및 런타임 흐름
