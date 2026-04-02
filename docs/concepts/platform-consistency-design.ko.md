# platform consistency design

<p><a href="./platform-consistency-design.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 Konekti의 v1 플랫폼 일관성 규약을 정의합니다. 공식 패키지들이 reflection, autowiring, hidden discovery를 다시 도입하지 않으면서도 설정, 라이프사이클, health/readiness, diagnostics, telemetry, resource ownership, 운영 구성을 같은 방식으로 맞추기 위한 단일 기준 문서입니다.

### 관련 문서

- `./architecture-overview.ko.md`
- `./lifecycle-and-shutdown.ko.md`
- `./observability.ko.md`
- `./auth-and-jwt.ko.md`
- `../reference/package-surface.ko.md`
- `../operations/third-party-extension-contract.ko.md`

## 문서 권한 범위

- **상태**: draft v1
- **정본 언어**: English (`.md`)
- **미러 문서**: 한국어 (`.ko.md`)
- **범위**: 공식 패키지 간 플랫폼 동작만 포함
- **비정본 소스**: 이슈 스레드, 디자인 채팅, 탐색 메모, 아직 공개되지 않은 패키지 의도

이 문서와 패키지 README가 패키지 간 동작에 대해 충돌하면, README가 갱신되기 전까지는 이 문서가 우선합니다. 이 문서와 실제 런타임 구현이 충돌하면, 같은 변경 세트 안에서 구현 또는 문서 중 하나를 반드시 정정해야 합니다.

## 목적

Konekti는 이미 강한 패키지 단위 빌딩 블록을 갖고 있습니다. explicit DI, standard decorators, bootstrap-time graph validation, runtime-owned startup/shutdown, 그리고 점점 강해지는 first-party integration이 그 예입니다. 하지만 실제 서비스에서 이 패키지들이 함께 쓰일 때, 여전히 필요한 것은 안정적인 *platform spine*입니다.

이 문서는 다음 질문에 일관되게 답하기 위해 존재합니다.

> 어떤 공식 패키지든, 애플리케이션 부트스트랩·readiness·shutdown·diagnostics·observability에 참여하려면 최소한 어떤 공통 계약을 만족해야 하는가?

v1의 답은 다음과 같습니다.

1. 모든 공식 플랫폼 패키지는 일관된 설정 및 라이프사이클 계약을 노출해야 합니다.
2. 모든 패키지는 readiness, health, diagnostics, telemetry를 공통 모델로 보고해야 합니다.
3. runtime은 애플리케이션을 platform shell로 오케스트레이션해야 합니다.
4. 패키지는 자신의 리소스 ownership을 유지하면서 explicit wiring을 계속 사용해야 합니다.
5. 설계의 어떤 부분도 reflection, constructor type inference, hidden module discovery, autowiring에 의존해서는 안 됩니다.

## 문제 정의

패키지 간 플랫폼 계약이 없으면, 프레임워크는 각각은 좋은 패키지들의 묶음이지만 운영 경험은 제각각이 될 위험이 있습니다.

- Redis의 ownership/shutdown 의미가 Prisma나 Queue와 다를 수 있습니다.
- Queue는 풍부한 상태를 노출하는데 Event Bus는 그렇지 않을 수 있습니다.
- Metrics와 Studio가 서로 다른 상태 포맷을 소비할 수 있습니다.
- 한 패키지에서 readiness는 단순 ping 성공이고, 다른 패키지에서는 실제 traffic-safe 의미일 수 있습니다.
- DI/bootstrap diagnostics는 강하지만 transport/runtime diagnostics는 약할 수 있습니다.

NestJS는 흔히 ecosystem familiarity와 module habit으로 이깁니다. Konekti는 reflection 기반 편의성을 따라 하기보다, explicitness를 *의식적인 시스템*으로 느끼게 만들어야 합니다.

## 범위

이 문서는 다음 공식 패키지군의 패키지 간 동작에 적용됩니다.

- platform shell과 orchestration: `@konekti/runtime`
- stateful integrations: `@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`, `@konekti/mongoose`
- async / distributed work: `@konekti/queue`, `@konekti/event-bus`, `@konekti/microservices`, `@konekti/cron`, `@konekti/cqrs`
- operational surfaces: `@konekti/metrics`, `@konekti/throttler`, `@konekti/terminus`, `@konekti/cache-manager`
- security / auth 인접 플랫폼 표면: `@konekti/jwt`, `@konekti/passport`
- tooling / diagnostics 표면: `@konekti/cli`, `@konekti/studio`

`@konekti/http`, `@konekti/graphql` 같은 패키지도 운영 리소스나 상태를 노출할 때 이 문서를 참조할 수 있지만, 이 문서는 해당 패키지의 핸들러/런타임 의미론을 다시 정의하지는 않습니다.

## 비목표

이 설계는 의도적으로 다음을 하지 않습니다.

1. reflection metadata, constructor autowiring, `@Injectable()` 스타일의 암묵적 DI를 되돌려 놓기
2. 모든 패키지가 상속해야 하는 보편적인 base class 만들기
3. 패키지 고유 API를 최소 공통 분모 추상화 뒤로 숨기기
4. 명시적 모듈 구성을 naming convention, 폴더 스캔, “알아서 등록” 동작으로 대체하기
5. Redis Pub/Sub와 Redis Streams처럼 의미론적으로 중요한 차이를 평탄화하기
6. health/readiness를 실제 운영 의미 대신 마케팅 신호처럼 만들기
7. 공유 플랫폼 동작과 직접 관련 없는 미래 기능 폭까지 정의하기

## 용어집

| 용어 | 이 문서에서의 의미 |
|---|---|
| **platform shell** | 공식 플랫폼 컴포넌트를 검증, 시작, 모니터링, 종료하는 runtime 소유 오케스트레이션 계층 |
| **platform component** | 공유 라이프사이클 계약을 통해 플랫폼에 참여하는 패키지 소유 단위 |
| **resource ownership** | 어떤 패키지가 어떤 리소스를 생성하고 정리할 책임을 지는지에 대한 규칙 |
| **validation** | 시작 전에 config, dependency, supported combination, contract safety를 확인하는 bootstrap-time 검사 |
| **health** | 컴포넌트 내부 생존성과 자기 무결성 |
| **readiness** | 의도된 트래픽/작업을 받을 준비가 되었는지 여부 |
| **degraded** | 완전히 죽지는 않았지만, 전체 계약을 다 만족하지 못하는 부분 저하 상태 |
| **snapshot** | diagnostics, CLI, Studio 렌더링을 위해 내보내는 구조화된 상태 payload |
| **platform contract** | 모든 공식 플랫폼 패키지가 따라야 하는 공유 동작과 구조 |

## 설계 원칙

### 1) explicit over implicit

구성은 계속 코드로 합니다. helper, preset, generator는 허용하지만, 숨겨진 의존성 등록은 허용하지 않습니다.

### 2) one lifecycle model

공식 플랫폼 컴포넌트는 패키지별 세부 동작이 다르더라도 동일한 라이프사이클 상태 모델에 참여해야 합니다.

### 3) operational-first

Readiness, diagnostics, telemetry, shutdown은 부가 기능이 아니라 패키지 계약의 일부입니다.

### 4) runtime owns orchestration, packages own resources

runtime은 순서와 집계를 담당하고, 각 패키지는 자신의 리소스를 생성·검증·관측·정리합니다.

### 5) stable spine before feature breadth

더 많은 기능을 추가하기 전에 공유 계약을 안정화해야 합니다. spine 없이 표면만 커지면 운영 일관성이 더 약해집니다.

### 6) less ceremony through tooling, not magic

보일러플레이트 감소는 generator, preset, codemod, explicit composition helper로 해결해야 합니다. 숨겨진 런타임 동작으로 해결하면 안 됩니다.

## 플랫폼 일관성의 정의

Konekti 사용자는 Redis에서 Queue로, Event Bus에서 Prisma로, Metrics로 이동하더라도 다음 기대를 동일하게 가져야 합니다.

- 설정은 어떻게 주입되는가
- 시작 전에 무엇이 검증되는가
- `ready`는 무엇을 의미하는가
- 종료 시 어떤 일이 일어나는가
- 상태는 어디서 어떻게 확인하는가
- telemetry에서 component identity는 어떻게 보이는가
- ownership 경계는 어떻게 드러나는가
- 실패는 어디에 어떤 형태로 나타나는가

플랫폼 일관성이란 API가 완전히 같아지는 것을 뜻하지 않습니다. *운영 기대치*가 같아지는 것을 뜻합니다.

## 공유 계약 spine

v1은 일부 핵심 패키지 간 계약만 표준화합니다. 이 계약은 패키지별 모듈과 프로바이더에 직접 적용되거나, 아주 얇은 adapter를 통해 적용되어야 합니다.

### platform options base

모든 플랫폼 패키지는 고유 옵션 앞에 아래와 같은 옵션 envelope를 예약해야 합니다. 일부 필드가 어떤 패키지에서는 미사용이어도 구조는 유지하는 것이 좋습니다.

```ts
interface PlatformOptionsBase {
  id?: string;
  enabled?: boolean;

  readiness?: {
    critical?: boolean;
    timeoutMs?: number;
  };

  shutdown?: {
    timeoutMs?: number;
  };

  diagnostics?: {
    expose?: boolean;
    tags?: Record<string, string>;
  };

  telemetry?: {
    namespace?: string;
    tags?: Record<string, string>;
  };
}
```

#### 규칙

- `id`는 패키지가 singleton/default 동작을 명확히 문서화할 때만 `default`로 기본값을 줄 수 있습니다.
- `enabled: false`는 부분 시작이나 숨겨진 background loop 없이 시작을 우회해야 합니다.
- `readiness.critical`은 애플리케이션 aggregate readiness 실패에 이 컴포넌트가 영향을 주는지 결정합니다.
- `telemetry.namespace`는 분류를 돕기 위한 보조값일 뿐, 패키지 kind를 가리면 안 됩니다.

### platform component 계약

모든 플랫폼 패키지는 최소한 개념적으로 아래 계약을 노출하거나 내부적으로 이 형태에 적응(adapt)할 수 있어야 합니다.

```ts
type PlatformState =
  | 'created'
  | 'validated'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

interface PlatformComponent {
  id: string;
  kind: string;

  state(): PlatformState;
  validate(): Promise<PlatformValidationResult> | PlatformValidationResult;
  start(): Promise<void>;
  ready(): Promise<PlatformReadinessReport>;
  health(): Promise<PlatformHealthReport>;
  snapshot(): PlatformSnapshot;
  stop(): Promise<void>;
}
```

이것은 *계약 모양*이지, 모든 패키지가 동일한 exported type 이름을 가져야 한다는 뜻은 아닙니다. 중요한 것은 runtime이 특별 취급 없이 공통 모델로 적응시킬 수 있어야 한다는 점입니다.

### 라이프사이클 상태 모델

| 상태 | 의미 | 허용 전이 |
|---|---|---|
| `created` | config/module은 등록되었지만 아직 validate 전 | `validated`, `failed` |
| `validated` | bootstrap 계약 검사 통과 | `starting`, `failed` |
| `starting` | 리소스 획득 또는 loop/listener 시작 중 | `ready`, `degraded`, `failed` |
| `ready` | 의도된 작업을 온전히 처리 가능 | `degraded`, `stopping`, `failed` |
| `degraded` | 일부는 동작하지만 전체 계약은 불충족 | `ready`, `stopping`, `failed` |
| `stopping` | 리소스 정리 또는 drain 중 | `stopped`, `failed` |
| `stopped` | 종료 완료 | 없음 |
| `failed` | 치명적 계약/런타임 실패 | `stopping`, `stopped` |

#### 상태 invariant

- `validate()`는 장기 리소스 ownership을 부작용으로 만들면 안 됩니다.
- `start()`는 idempotent하거나, 중복 호출을 deterministic하게 거부해야 합니다.
- `stop()`은 idempotent해야 합니다.
- `snapshot()`은 degraded/failed 상태에서도 안전하게 호출 가능해야 합니다.
- `degraded`는 패키지 문서가 그 의미를 정의한 경우에만 사용할 수 있습니다.

## validation 모델

validation은 traffic acceptance 이전, background loop가 “정상 동작 중”으로 간주되기 전에 수행됩니다.

### validation이 반드시 다뤄야 하는 것

- config shape와 required field
- 지원하지 않는 옵션 조합
- 필수 dependency 누락
- ownership 조합의 안전성
- transport capability mismatch
- bootstrap에서 보이는 scope/lifecycle 제약
- platform component id 충돌

### validation이 해서는 안 되는 것

- 숨겨진 background work 시작
- ownership 추적 없는 orphan resource 생성
- 실패를 삼킨 뒤 정상 지원되는 것처럼 계속 진행

### validation result shape

```ts
interface PlatformValidationResult {
  ok: boolean;
  issues: PlatformDiagnosticIssue[];
  warnings?: PlatformDiagnosticIssue[];
}
```

## health와 readiness 모델

Health와 readiness는 관련 있지만 같은 것이 아닙니다.

### health가 답하는 질문

> 이 컴포넌트는 내부적으로 살아 있고 자기 무결성을 유지하는가?

예시:

- Redis component가 살아 있는 client를 가지고 있고, 가벼운 integrity check가 가능함
- Queue worker loop가 영구 crash 상태가 아님
- Metrics endpoint registry가 여전히 mounted되어 있고 output 렌더링 가능함

### readiness가 답하는 질문

> 이 컴포넌트는 의도된 작업을 지금 안전하게 받을 수 있는가?

예시:

- Prisma는 프로세스 내부적으로는 healthy할 수 있어도 datasource가 안 붙으면 ready는 아님
- Event Bus는 local로는 healthy하지만 external transport가 끊기면 degraded일 수 있음
- Queue는 enqueue는 되지만 critical worker startup이 실패했다면 health와 readiness가 다를 수 있음

### readiness report shape

```ts
interface PlatformReadinessReport {
  status: 'ready' | 'not-ready' | 'degraded';
  critical: boolean;
  reason?: string;
  checks?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'degraded';
    message?: string;
  }>;
}
```

### health report shape

```ts
interface PlatformHealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  reason?: string;
  checks?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'degraded';
    message?: string;
  }>;
}
```

### degraded 의미

v1에서 degraded는 다음 같은 상황에만 허용됩니다.

- partial transport connectivity
- optional non-critical dependency loss
- external integration 상실 후 local-only fallback
- non-blocking observability 기능 저하

패키지는 자신이 선언한 critical workload를 수행할 수 없는데도 `degraded`로 포장해서는 안 됩니다.

## diagnostics 계약

Diagnostics는 플랫폼의 1급 API입니다. bootstrap validation, CLI inspection, Studio rendering, runtime troubleshooting에서 같은 이슈 모델을 써야 합니다.

```ts
interface PlatformDiagnosticIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  componentId: string;
  message: string;
  cause?: string;
  fixHint?: string;
  dependsOn?: string[];
  docsUrl?: string;
}
```

### issue code 규칙

- code는 안정적이고 machine-filterable해야 함
- `REDIS_`, `QUEUE_`, `PLATFORM_`, `AUTH_`처럼 패키지/도메인 prefix를 권장
- fix hint는 짧고 action-oriented해야 함
- 원인을 알면 `dependsOn`에 upstream component를 노출해야 함

### 필수 diagnostic category

- config invalid
- missing dependency
- unsupported combination
- ownership mismatch
- startup failure
- readiness failure
- degraded fallback active
- shutdown timeout

### 예시

```json
{
  "code": "QUEUE_DEPENDENCY_NOT_READY",
  "severity": "error",
  "componentId": "queue.default",
  "message": "Queue startup requires a ready Redis component.",
  "cause": "redis.default readiness check failed during bootstrap.",
  "fixHint": "Verify Redis connectivity or mark the queue as disabled for this environment.",
  "dependsOn": ["redis.default"]
}
```

## telemetry 계약

Telemetry는 패키지 간 플랫폼 동작을 비교 가능하게 만들어야 합니다.

### 공통 label

- `component_id`
- `component_kind`
- `operation`
- `result`
- `env`
- `instance`

### 공통 라이프사이클 metric

- `konekti_component_start_duration_seconds`
- `konekti_component_ready`
- `konekti_component_health`
- `konekti_component_failures_total`
- `konekti_component_stop_duration_seconds`

### tracing / event 이름

패키지가 tracing span이나 structured lifecycle event를 낸다면 다음 이름에 맞춰야 합니다.

- `platform.validate`
- `platform.start`
- `platform.ready`
- `platform.stop`

패키지 전용 연산은 이를 확장할 수 있습니다.

- `redis.connect`
- `queue.enqueue`
- `event_bus.publish`
- `prisma.transaction`

### telemetry 규칙

- component label에 secret이 들어가면 안 됨
- ID는 상관관계를 가능하게 하되 unsafe environment detail을 새면 안 됨
- 패키지 전용 metric이 있어도 공통 label은 유지해야 함
- 기본값은 low-cardinality를 우선해야 함

## resource ownership 규칙

shutdown correctness는 ownership에 달려 있으므로, ownership은 핵심 플랫폼 계약입니다.

### hard rules

1. 패키지는 자신이 만들었거나 ownership을 명시적으로 넘겨받은 리소스만 stop할 수 있습니다.
2. 호출자가 제공한 client/handle은 ownership transfer가 명확히 opt-in되지 않는 한 호출자 소유입니다.
3. ownership 경계는 diagnostics와 snapshot에 운영상 의미가 있을 때 드러나야 합니다.
4. shared resource는 명시적인 owning component 하나와 여러 비소유 consumer를 가질 수 있습니다.
5. `stop()`은 부분적인 `start()` 실패 이후에도 안전해야 합니다.
6. shutdown timeout은 diagnostics로 남아야 하며, 조용히 사라지면 안 됩니다.

### 예시

- `@konekti/redis`는 config로 직접 만든 client는 소유할 수 있지만, 호출자가 주입한 raw client는 ownership transfer가 명시되지 않으면 소유할 수 없습니다.
- `RedisEventBusTransport`는 자신이 등록한 subscription/listener는 정리할 수 있지만, 호출자 소유 Redis client에 `quit()`를 호출하면 안 됩니다.
- `MetricsModule`은 내부 생성 registry는 소유할 수 있지만, 외부 shared registry를 소유한다고 주장하면 안 됩니다.

## package integration model

v1은 **platform shell + explicit adapters** 모델을 사용합니다.

### platform shell 책임

runtime 소유 shell은 다음을 담당합니다.

- explicit package registration에서 platform component 수집
- component identity와 dependency edge 검증
- startup/shutdown ordering
- readiness/health 집계
- diagnostics/snapshot export
- CLI inspect와 Studio visualization의 공통 소스 제공

### package adapter 책임

각 패키지는 다음을 담당합니다.

- 자신의 패키지 런타임을 shared platform contract에 노출하거나 적응시키기
- 패키지 고유 API는 그대로 유지하기
- 패키지 상태를 shared snapshot/diagnostic format으로 번역하기
- explicit resource ownership 유지하기

### dependency wiring 모델

패키지 간 의존성은 반드시 explicit해야 합니다. 예:

- Queue는 Redis에 의존
- Redis-backed throttler store는 Redis에 의존
- Prisma-backed auth token / account-linking storage는 Prisma에 의존 가능
- external Redis transport를 사용하는 Event Bus는 Redis component에 의존
- Studio는 패키지별 bespoke data structure가 아니라 runtime이 내보내는 snapshot schema에 의존

어떤 의존성도 폴더 구조, naming convention, constructor type reflection으로 유추되어서는 안 됩니다.

## startup / shutdown 순서

### startup sequence

1. explicit module graph 구성
2. DI/module graph 검증
3. platform component 수집
4. component config와 dependency edge 검증
5. explicit dependency 기준으로 topological ordering
6. 순서대로 component start
7. critical component readiness polling
8. aggregate status를 runtime/diagnostics surface에 노출

### shutdown sequence

1. application을 stopping으로 마킹
2. 새로운 traffic/work 수락 중단
3. 패키지 semantics에 따라 in-flight work drain 또는 reject
4. reverse dependency order로 platform component stop
5. timeout/cleanup failure를 diagnostics로 기록
6. application을 stopped로 마킹

패키지는 drain behavior를 세부 문서로 설명할 수 있지만, ordering 계약은 공유됩니다.

## shared snapshot schema

```ts
interface PlatformSnapshot {
  id: string;
  kind: string;
  state: PlatformState;
  readiness: {
    status: 'ready' | 'not-ready' | 'degraded';
    critical: boolean;
    reason?: string;
  };
  health: {
    status: 'healthy' | 'unhealthy' | 'degraded';
    reason?: string;
  };
  dependencies: string[];
  telemetry: {
    namespace: string;
    tags: Record<string, string>;
  };
  ownership: {
    ownsResources: boolean;
    externallyManaged: boolean;
  };
  details: Record<string, unknown>;
}
```

### snapshot 규칙

- `details`는 sanitize되어 있고 tooling이 소비 가능한 안정성을 가져야 함
- 패키지 전용 필드는 top-level이 아니라 `details`에 둠
- secret, raw credential, access token, PII는 snapshot에 절대 포함되면 안 됨

## 패키지군 매핑

### runtime

`@konekti/runtime`은 platform shell의 진입점입니다. component snapshot을 집계하고, readiness/health를 내보내며, CLI와 Studio에 단일 status view를 제공해야 합니다.

### stateful integrations

`@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`, `@konekti/mongoose`는 다음을 우선해야 합니다.

- explicit ownership
- deterministic connect/disconnect
- 명확한 readiness 의미
- 안정적인 transaction/connection diagnostics

### async / distributed work

`@konekti/queue`, `@konekti/event-bus`, `@konekti/microservices`, `@konekti/cron`, `@konekti/cqrs`는 다음을 우선해야 합니다.

- explicit dependency edge
- 명확한 degraded semantics
- deterministic drain/stop behavior
- pending work, handlers, consumers, failure path에 대한 가시성

### operational surfaces

`@konekti/metrics`, `@konekti/throttler`, `@konekti/terminus`, `@konekti/cache-manager`는 다음을 우선해야 합니다.

- 일관된 telemetry tag
- 실제 traffic behavior와 맞는 readiness semantics
- 표준화된 status output
- runtime status와 operational endpoint 사이의 불일치 방지

### auth / policy surfaces

`@konekti/jwt`, `@konekti/passport`는 다음을 우선해야 합니다.

- policy boundary clarity
- storage/dependency readiness visibility
- auth misconfiguration에 대한 일관된 diagnostics
- framework-owned와 application-owned policy 경계의 명시성

### tooling surfaces

`@konekti/cli`, `@konekti/studio`는 별도의 inspection 포맷을 만들지 말고 shared snapshot/diagnostic model을 소비해야 합니다.

## 패키지별 적용 규칙

### `@konekti/redis`

- internally created client인지 externally supplied client인지 보고해야 함
- connection/readiness state를 명확히 노출해야 함
- credential을 노출하지 않고도 ping latency나 connection health detail을 보여줘야 함
- `lazyConnect`가 readiness에 미치는 영향이 문서화되어야 함

### `@konekti/prisma` / `@konekti/drizzle`

- client/process health와 transaction readiness를 구분해야 함
- ALS transaction context 활성 여부를 노출하는 것이 좋음
- strict/fallback transaction mode를 snapshot details에 보여주는 것이 좋음
- framework dispose와 caller dispose의 ownership 경계를 숨기면 안 됨

### `@konekti/mongoose`

- connection state와 session strategy를 보여줘야 함
- 애플리케이션 코드가 `{ session }` propagation을 계속 책임지는 부분이 문서화되어야 함

### `@konekti/queue`

- worker discovery count, worker readiness, pending failure, DLQ status를 가능한 범위에서 보고해야 함
- singleton-only worker 제약을 diagnostics로 명확히 드러내야 함
- enqueue 가능 여부와 worker readiness가 다를 수 있음을 노출하는 것이 좋음

### `@konekti/event-bus`

- local-only 동작과 transport-backed 동작을 구분해야 함
- subscribed event type, transport connectivity, waiting mode를 노출하는 것이 좋음
- durability, replay, wildcard, ordering guarantee가 non-goal임을 문서에 명시해야 함

### `@konekti/microservices`

- transport kind와 capability limit를 노출해야 함
- Redis Pub/Sub request/reply 같은 unsupported pattern에 대해 명확한 diagnostics를 내야 함
- readiness는 listener/consumer availability 기준이어야 하며, 단순 객체 생성으로 충분하다고 보면 안 됨
- unary-only gRPC 지원은 문서와 diagnostics에 드러나는 것이 좋음

### `@konekti/metrics`

- isolated/shared registry mode를 보고해야 함
- lifecycle metric을 공통 schema에 맞추는 것이 좋음
- 호출자가 명시적으로 opt-out하지 않는 한 low-cardinality 기본값을 유지해야 함

### `@konekti/throttler`

- store kind와 backing store readiness 영향을 노출해야 함
- 향후 local fallback과 distributed store가 공존할 경우 이를 구분할 수 있어야 함

### `@konekti/terminus`

- shared readiness/health semantics를 소비해야 하며, 별도 의미 체계를 만들면 안 됨
- aggregate application readiness가 platform shell과 충돌하지 않도록 해야 함

### `@konekti/cache-manager`

- store type과 ownership mode를 보여주는 것이 좋음
- cache가 critical path일 때만 readiness에 반영해야 함

### `@konekti/jwt` / `@konekti/passport`

- framework-owned primitive와 application-owned policy를 분리해서 보여줘야 함
- strategy registration, refresh token backing dependency, preset readiness를 명확히 드러내는 것이 좋음
- framework가 login/session policy까지 표준화한 것처럼 오해를 주면 안 됨

### `@konekti/studio` / `@konekti/cli`

- shared diagnostic/snapshot schema를 직접 소비해야 함
- 특정 패키지 상태를 이해하려면 Studio만 봐야 하는 구조가 되면 안 됨
- component dependency chain과 fix hint를 1급 개념으로 보여주는 것이 좋음

## 예시

### 예시: conceptual component adapter

```ts
class RedisPlatformComponent implements PlatformComponent {
  readonly id = 'redis.default';
  readonly kind = 'redis';

  private currentState: PlatformState = 'created';

  state(): PlatformState {
    return this.currentState;
  }

  validate(): PlatformValidationResult {
    // validate config, ownership mode, and dependency assumptions
    this.currentState = 'validated';
    return { ok: true, issues: [] };
  }

  async start(): Promise<void> {
    this.currentState = 'starting';
    // create or attach client, then connect if owned
    this.currentState = 'ready';
  }

  async ready(): Promise<PlatformReadinessReport> {
    return { status: 'ready', critical: true };
  }

  async health(): Promise<PlatformHealthReport> {
    return { status: 'healthy' };
  }

  snapshot(): PlatformSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      state: this.currentState,
      readiness: { status: 'ready', critical: true },
      health: { status: 'healthy' },
      dependencies: [],
      telemetry: { namespace: 'redis', tags: {} },
      ownership: { ownsResources: true, externallyManaged: false },
      details: { mode: 'owned-client' },
    };
  }

  async stop(): Promise<void> {
    this.currentState = 'stopping';
    // quit owned client if needed
    this.currentState = 'stopped';
  }
}
```

### 예시: snapshot payload

```json
{
  "id": "queue.default",
  "kind": "queue",
  "state": "degraded",
  "readiness": {
    "status": "degraded",
    "critical": true,
    "reason": "Worker startup partially failed; enqueue remains available."
  },
  "health": {
    "status": "degraded",
    "reason": "One of three workers failed to start."
  },
  "dependencies": ["redis.default"],
  "telemetry": {
    "namespace": "queue",
    "tags": {
      "env": "production"
    }
  },
  "ownership": {
    "ownsResources": true,
    "externallyManaged": false
  },
  "details": {
    "workersDiscovered": 3,
    "workersReady": 2,
    "deadLetterEnabled": true
  }
}
```

## rollout phase

### P0 — spine 정의

산출물:

- shared lifecycle state
- shared readiness/health semantics
- shared diagnostic schema
- shared telemetry label
- shared snapshot schema
- package authoring checklist

완료 기준:

- runtime이 공통 field 기준으로 heterogeneous component를 집계할 수 있음
- Studio와 CLI가 같은 top-level snapshot model을 렌더링할 수 있음

### P1 — stateful integration 정렬

우선 패키지:

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/mongoose`

완료 기준:

- ownership과 readiness semantics가 명시적이며 문서화됨
- shutdown behavior가 deterministic하고 test coverage가 있음

### P2 — async / distributed work 정렬

우선 패키지:

- `@konekti/queue`
- `@konekti/event-bus`
- `@konekti/microservices`
- `@konekti/cron`
- `@konekti/cqrs`

완료 기준:

- dependency edge가 explicit함
- degraded state가 지원된다면 문서화됨
- partial startup / transport mismatch diagnostics가 있음

### P3 — operational surface 정렬

우선 패키지:

- `@konekti/metrics`
- `@konekti/throttler`
- `@konekti/terminus`
- `@konekti/cache-manager`
- `@konekti/jwt`
- `@konekti/passport`

완료 기준:

- telemetry label이 일관됨
- operational endpoint가 내보내는 readiness가 shared contract와 일치함

### P4 — tooling convergence

우선 패키지:

- `@konekti/cli`
- `@konekti/studio`

완료 기준:

- tooling이 shared snapshot/diagnostic schema를 직접 소비함
- 특정 패키지를 이해하려고 private one-off visualization path가 필요하지 않음

## 거버넌스 및 갱신 규칙

이 문서는 장기 유지 문서입니다. 출하된 패키지 간 동작이 바뀌면 함께 진화해야 합니다.

### 이 문서를 갱신해야 하는 경우

- 새로운 공식 플랫폼 패키지가 추가될 때
- 어떤 패키지가 readiness/health aggregation에 새로 참여할 때
- lifecycle state 의미가 바뀔 때
- snapshot 또는 diagnostic schema가 바뀔 때
- ownership 규칙이 바뀔 때
- Studio 또는 CLI가 기대하는 status export contract가 바뀔 때

### 함께 갱신해야 하는 문서/자산

이 문서가 의미 있게 바뀌면 같은 변경 세트에서 다음도 같이 갱신해야 합니다.

- 영향받는 package README
- discoverability가 바뀌면 `docs/README.md` / `docs/README.ko.md`
- 변경된 플랫폼 계약의 테스트 커버리지
- snapshot/diagnostic issue를 소비하는 tooling schema 문서

### 변경 discipline

- English 파일 먼저, Korean mirror 나중
- 한국어 미러를 구조적으로 stale한 상태로 두지 않기
- 아직 출하되지 않은 future work는 이 문서의 규범 요구사항으로 숨기지 말고 issue에 두기
- 이미 출하된 동작은 계속 tentative하게 서술하지 않기

## anti-pattern

다음은 이 설계와 양립할 수 없습니다.

1. **reflection-based autowiring**
   - constructor type inference를 hidden dependency metadata로 사용하는 것

2. **hidden discovery**
   - naming convention, folder layout, side-effect import로 패키지를 등록하는 것

3. **ownership ambiguity**
   - 명시적 합의 없이 caller-owned resource를 패키지가 닫는 것

4. **status dishonesty**
   - 실제 traffic-safe behavior가 불가능한데 `ready`를 보고하는 것

5. **tool-specific truth**
   - Studio나 CLI가 runtime snapshot과 다른 private data model을 요구하는 것

6. **silent downgrade**
   - 기능 축소 fallback이 활성화되었는데 degraded status나 diagnostic issue가 없는 것

## 공식 패키지 수용 체크리스트

패키지가 platform consistency alignment를 주장하려면 아래 질문에 모두 “yes”라고 답할 수 있어야 합니다.

- explicit config와 bootstrap validation이 있는가?
- deterministic start/stop path가 있는가?
- readiness와 health를 구분해서 설명할 수 있는가?
- fix hint를 포함한 structured diagnostics를 낼 수 있는가?
- sanitized snapshot을 내보낼 수 있는가?
- dependency와 ownership semantics를 명확히 선언하는가?
- shared telemetry label과 lifecycle event에 맞추는가?
- CLI와 Studio가 package-specific interpretation 없이 상태를 소비할 수 있는가?

## 최종 규칙

Konekti는 더 나은 tooling과 더 강한 composition helper로 ceremony를 줄여야 하지만, 더 짧은 reflection-driven 프레임워크를 흉내 내기 위해 explicitness, ownership clarity, fail-fast validation을 포기해서는 안 됩니다. v1의 플랫폼 일관성은 공식 패키지가 더 운영하기 쉬워지면서도, 동시에 더 추론 가능해질 때만 성공입니다.
