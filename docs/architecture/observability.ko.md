# Observability Spec

<p><a href="./observability.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Metrics

| Surface | Source | Default contract | Configurable behavior |
| --- | --- | --- | --- |
| Prometheus scrape endpoint | `@fluojs/metrics`의 `MetricsModule.forRoot(...)` | `GET /metrics`는 활성 레지스트리의 content type으로 Prometheus 텍스트를 반환한다. | `path` 기본값은 `'/metrics'`다. `path: false`는 스크레이프 엔드포인트를 비활성화한다. 문자열을 주면 해당 경로에 엔드포인트가 마운트된다. |
| HTTP request metrics | `@fluojs/metrics` 내부 `HttpMetricsMiddleware` | `method`, `path`, `status` 레이블로 `http_requests_total`, `http_errors_total`, `http_request_duration_seconds`를 기록한다. | `http` 옵션이 truthy로 해석되면 HTTP 메트릭이 활성화된다. `pathLabelMode` 기본값은 `'template'`다. |
| Runtime platform telemetry | `@fluojs/metrics` 내부 `RuntimePlatformTelemetry` | 스크레이프는 `fluo_component_ready`, `fluo_component_health`, `fluo_metrics_registry_mode`도 함께 노출한다. | `platformTelemetry.env`, `platformTelemetry.instance`는 플랫폼 gauge 시계열에 고정 레이블을 추가한다. |
| Custom application metrics | `MetricsService` 또는 공유 Prometheus `Registry` | 커스텀 counter, gauge, histogram은 스크레이프 엔드포인트가 노출하는 동일 레지스트리를 공유할 수 있다. | `registry`를 지정하면 모듈은 새 격리 레지스트리 대신 shared-registry 모드로 동작한다. |
| Package integration meters | `@fluojs/metrics` 내부 `METER_PROVIDER` / `PrometheusMeterProvider` | First-party integration은 같은 active Registry를 사용하는 provider bridge를 resolve할 수 있다. | Application code는 `MetricsService`를 우선 사용해야 하며, provider token은 low-level package-integration seam이다. |

- `defaultMetrics` 기본값은 `true`이므로 `defaultMetrics: false`를 주지 않으면 Prometheus 기본 process 및 Node.js collector가 레지스트리당 한 번 등록된다.
- 스크레이프 엔드포인트의 route-scoped 보호는 `endpointMiddleware`로 지원되며, class-based middleware를 설정된 메트릭 경로에만 바인딩하고 `path: false`로 해당 경로가 꺼지면 건너뛴다.
- Module-level `middleware`는 `endpointMiddleware`와 다르다. Framework HTTP metrics 및 endpoint-scoped middleware 뒤의 module middleware chain에 참여하며, route-scoped 보호 계약이 아니다.
- 플랫폼 텔레메트리는 스크레이프마다 `PLATFORM_SHELL`을 resolve하고 snapshot을 읽어 갱신된다. `PLATFORM_SHELL`이 없으면 스크레이프는 성공하지만 플랫폼 텔레메트리 시계열은 빠진다. 토큰이 있는데 해석이 실패하면 스크레이프가 실패한다.

## Health Checks

| Surface | Source | Default path contract | Response contract |
| --- | --- | --- | --- |
| Runtime health endpoint | `@fluojs/runtime`의 `HealthModule.forRoot(...)` | base path가 없으면 `GET /health`다. base `path`가 있으면 경로는 `{path}/health`가 된다. | 커스텀 health callback이 없으면 응답 본문은 `{ "status": "ok" }`이고 HTTP 200이다. 커스텀 callback은 일반 본문 또는 `{ body, statusCode }`를 반환할 수 있다. |
| Runtime readiness endpoint | `@fluojs/runtime`의 `HealthModule.forRoot(...)` | base path가 없으면 `GET /ready`다. base `path`가 있으면 경로는 `{path}/ready`가 된다. | `markReady()`가 실행되기 전과 애플리케이션/컨텍스트 종료가 시작된 뒤에는 `{ "status": "starting" }`과 HTTP 503을 반환한다. readiness check 중 하나라도 false를 반환하면 `{ "status": "unavailable" }`과 HTTP 503을 반환한다. 앱이 준비되면 `{ "status": "ready" }`와 HTTP 200을 반환한다. |
| Terminus aggregated health endpoint | `@fluojs/terminus`의 `TerminusModule.forRoot(...)` | 런타임 health 경로 계약을 그대로 사용하며, 기본값은 `GET /health`다. | JSON 본문은 `checkedAt`, `contributors`, `details`, `error`, `info`, `platform`, `status`를 포함한다. 집계 상태가 `ok`이면 HTTP 200, 아니면 HTTP 503이다. |
| Terminus readiness registration | 런타임 readiness check 위에 추가되는 `@fluojs/terminus` readiness hook | 런타임 readiness 경로 계약을 그대로 사용하며, 기본값은 `GET /ready`다. | Terminus는 indicator 건강 상태와 `platformShell.ready()`를 함께 검사하는 readiness check를 추가한다. 경로의 응답 본문 형태는 여전히 `starting`, `unavailable`, `ready`다. |

- `TerminusHealthService.check()`는 등록된 indicator를 indicator result key 기준으로 집계하여 `info`, `error`, `details` 맵을 만든다.
- `execution.indicatorTimeoutMs`는 느리거나 멈춘 indicator probe를 무기한 대기하지 않고 `down` 결과로 바꾼다.
- 기본 제공 indicator 패키지에는 HTTP, memory, disk, Prisma, Drizzle, Redis 변형이 포함되며 Node 전용 memory/disk indicator는 `@fluojs/terminus/node`, Redis는 `@fluojs/terminus/redis`에서 export된다.
- `@fluojs/terminus/redis`는 Redis peer import를 dedicated subpath에 유지하고, `PING` 전에 `@fluojs/redis` client lifecycle state를 매핑하므로 종료 중이거나 연결이 끊긴 Redis client는 command probe 실행 전에도 readiness를 실패시킨다.

## Readiness vs Liveness

| Concern | Route | Current repo behavior |
| --- | --- | --- |
| Startup and shutdown readiness gate | `GET /ready` | `HealthModule.forRoot(...)`가 소유한다. 런타임이 앱을 ready로 표시하기 전까지 이 경로는 HTTP 503과 `{ "status": "starting" }`을 유지하고, shutdown이 시작되면 다시 `starting`으로 내려간다. 추가 readiness check는 `{ "status": "unavailable" }`를 강제할 수 있다. |
| Runtime dependency readiness | `@fluojs/terminus`가 붙은 `GET /ready` | Terminus는 `TerminusHealthService.isHealthy()`와 `platformShell.ready().status === 'ready'`를 모두 만족해야 통과하는 추가 readiness check를 등록한다. |
| Aggregated health report | `@fluojs/terminus`가 붙은 `GET /health` | Terminus는 indicator 상태가 `ok`이고, `platformShell.health().status === 'healthy'`이며, `platformShell.ready().status === 'ready'`일 때만 `status: 'ok'`를 계산한다. 그 외에는 HTTP 503과 `status: 'error'`를 반환한다. |
| Metrics-side readiness view | `GET /metrics` | 런타임 플랫폼 텔레메트리는 component별 및 `runtime.shell`용 readiness와 health를 gauge 값으로 내보낸다. |

- 저장소는 `/health`와 `/ready`를 분리해서 노출하지만, Terminus는 `/health`를 readiness가 완전히 배제된 liveness probe로 모델링하지 않는다. 집계 health 결과에 플랫폼 health와 플랫폼 readiness가 모두 포함된다.
- 배포 환경에서 최소한의 process-only liveness probe가 필요하면, 그 계약은 `@fluojs/terminus`가 기본 제공하지 않는다. 더 좁은 동작은 런타임 health 모듈이나 애플리케이션 전용 route가 명시적으로 정의해야 한다.
- `@fluojs/runtime`의 애플리케이션 상태는 Terminus JSON payload와 별개로 `bootstrapped`, `ready`, `closed`를 독립적으로 추적한다.

## Constraints

- Constraint: 이 저장소의 observability 표면은 metrics용 Prometheus text와 health endpoint용 JSON이다.
- Constraint: metrics endpoint 노출은 명시적이어야 한다. 운영 배포에서는 ingress 경계가 준비되기 전까지 `endpointMiddleware`로 스크레이프 경로를 보호하거나 `path: false`로 비활성화해야 한다.
- Constraint: HTTP metric path label은 기본적으로 template 정규화를 사용한다. raw path label은 `allowUnsafeRawPathLabelMode: true`가 필요하며, path cardinality가 제한된 경우에만 사용해야 한다.
- Constraint: health endpoint는 패키지 내부의 임의 `process.env` 검사 대신 런타임과 Terminus 계약을 통해 dependency 상태를 보고한다.
- Constraint: readiness와 health 텔레메트리는 `PLATFORM_SHELL` snapshot 의미론에 연결되므로, component 구현은 `ready()`, `health()`, `snapshot()`을 결정적으로 유지해야 한다.
- Constraint: 요청 상관관계 데이터는 `@fluojs/http`의 `RequestContext` 및 AsyncLocalStorage 헬퍼로 접근할 수 있지만, 이 문서는 metrics와 health endpoint만 저장소의 기본 observability 표면으로 다룬다.
