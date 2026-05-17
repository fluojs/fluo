# Observability Spec

<p><strong><kbd>English</kbd></strong> <a href="./observability.ko.md"><kbd>한국어</kbd></a></p>

## Metrics

| Surface | Source | Default contract | Configurable behavior |
| --- | --- | --- | --- |
| Prometheus scrape endpoint | `@fluojs/metrics` via `MetricsModule.forRoot(...)` | `GET /metrics` returns Prometheus text using the active registry content type. | `path` defaults to `'/metrics'`. `path: false` disables the scrape endpoint. A custom string mounts the endpoint at that route. |
| HTTP request metrics | `HttpMetricsMiddleware` inside `@fluojs/metrics` | Records `http_requests_total`, `http_errors_total`, and `http_request_duration_seconds` with `method`, `path`, and `status` labels. | HTTP metrics are enabled when `http` options resolve truthy. `pathLabelMode` defaults to `'template'`. |
| Runtime platform telemetry | `RuntimePlatformTelemetry` inside `@fluojs/metrics` | Scrapes also emit `fluo_component_ready`, `fluo_component_health`, and `fluo_metrics_registry_mode`. | `platformTelemetry.env` and `platformTelemetry.instance` add fixed labels to platform gauge series. |
| Custom application metrics | `MetricsService` or a shared Prometheus `Registry` | Custom counters, gauges, and histograms can share the same registry exposed by the scrape endpoint. | `registry` switches the module to shared-registry mode instead of creating an isolated registry. |
| Package integration meters | `METER_PROVIDER` / `PrometheusMeterProvider` inside `@fluojs/metrics` | First-party integrations can resolve a provider bridge backed by the same active registry. | Application code should prefer `MetricsService`; the provider token is the low-level package-integration seam. |

- `defaultMetrics` defaults to `true`, so Prometheus default process and Node.js collectors are registered once per registry unless `defaultMetrics: false` is set.
- Route-scoped protection for the scrape endpoint is supported through `endpointMiddleware`, which binds class-based middleware only to the configured metrics route and is skipped when `path: false` disables that route.
- Module-level `middleware` is distinct from `endpointMiddleware`: it participates in the module middleware chain after framework HTTP metrics and endpoint-scoped middleware, and it is not the route-scoped protection contract.
- Platform telemetry refreshes on each scrape by resolving `PLATFORM_SHELL` and reading its snapshot. If `PLATFORM_SHELL` is missing, the scrape succeeds without platform telemetry series. Non-missing resolution failures fail the scrape.

## Health Checks

| Surface | Source | Default path contract | Response contract |
| --- | --- | --- | --- |
| Runtime health endpoint | `HealthModule.forRoot(...)` in `@fluojs/runtime` | `GET /health` when no base path is provided. If a base `path` is configured, the route becomes `{path}/health`. | Without a custom health callback, the response body is `{ "status": "ok" }` with HTTP 200. A custom callback may return either a plain body or `{ body, statusCode }`. |
| Runtime readiness endpoint | `HealthModule.forRoot(...)` in `@fluojs/runtime` | `GET /ready` when no base path is provided. If a base `path` is configured, the route becomes `{path}/ready`. | Returns `{ "status": "starting" }` with HTTP 503 until `markReady()` runs and again as soon as application/context shutdown begins. Returns `{ "status": "unavailable" }` with HTTP 503 when any readiness check returns false. Returns `{ "status": "ready" }` with HTTP 200 when the app is ready. |
| Terminus aggregated health endpoint | `@fluojs/terminus` via `TerminusModule.forRoot(...)` | Uses the same health path contract as the runtime health module, defaulting to `GET /health`. | Returns a JSON body with `checkedAt`, `contributors`, `details`, `error`, `info`, `platform`, and `status`. HTTP status is 200 when the aggregated status is `ok`, otherwise 503. |
| Terminus readiness registration | `@fluojs/terminus` readiness hooks layered on runtime readiness checks | Uses the same readiness path contract as the runtime health module, defaulting to `GET /ready`. | Terminus adds readiness checks that combine indicator health and `platformShell.ready()`. The route still returns the runtime readiness body shape of `starting`, `unavailable`, or `ready`. |

- `TerminusHealthService.check()` aggregates registered indicators into `info`, `error`, and `details` maps keyed by indicator result keys.
- `execution.indicatorTimeoutMs` converts slow or hanging indicator probes into `down` results instead of waiting indefinitely.
- Built-in indicator packages include HTTP, memory, disk, Prisma, Drizzle, and Redis variants, with Node-specific memory/disk indicators exported from `@fluojs/terminus/node` and Redis exported from `@fluojs/terminus/redis`.
- `@fluojs/terminus/redis` keeps Redis peer imports on the dedicated subpath and maps `@fluojs/redis` client lifecycle state before issuing `PING`, so shutdown or disconnected Redis clients fail readiness even before a command probe runs.

## Readiness vs Liveness

| Concern | Route | Current repo behavior |
| --- | --- | --- |
| Startup and shutdown readiness gate | `GET /ready` | Owned by `HealthModule.forRoot(...)`. The route stays at HTTP 503 with `{ "status": "starting" }` until the runtime marks the app ready, and it returns to `starting` when shutdown begins. Additional readiness checks can force `{ "status": "unavailable" }`. |
| Runtime dependency readiness | `GET /ready` with `@fluojs/terminus` | Terminus registers an additional readiness check that requires both `TerminusHealthService.isHealthy()` and `platformShell.ready().status === 'ready'`. |
| Aggregated health report | `GET /health` with `@fluojs/terminus` | Terminus computes `status: 'ok'` only when indicator status is `ok`, `platformShell.health().status === 'healthy'`, and `platformShell.ready().status === 'ready'`. Otherwise the route returns HTTP 503 and `status: 'error'`. |
| Metrics-side readiness view | `GET /metrics` | Runtime platform telemetry exports readiness and health as gauge values per component and for `runtime.shell`. |

- The repository exposes separate `/health` and `/ready` routes, but Terminus does not model `/health` as a readiness-free liveness probe. Its aggregated health result includes both platform health and platform readiness.
- If a deployment needs a minimal process-only liveness probe, that contract is not provided by `@fluojs/terminus` out of the box. The runtime health module or an application-specific route must define that narrower behavior explicitly.
- Application state in `@fluojs/runtime` still tracks `bootstrapped`, `ready`, and `closed` independently from Terminus JSON payloads.

## Constraints

- Constraint: observability surfaces in this repository are Prometheus text for metrics and JSON for health endpoints.
- Constraint: metrics endpoint exposure is explicit. Production deployments should either protect the scrape route with `endpointMiddleware` or disable it with `path: false` until an ingress boundary exists.
- Constraint: HTTP metric path labels default to template normalization. Raw path labels require `allowUnsafeRawPathLabelMode: true` and should only be used when path cardinality is bounded.
- Constraint: health endpoints report dependency state through runtime and Terminus contracts, not through ad hoc direct `process.env` checks inside packages.
- Constraint: readiness and health telemetry are tied to `PLATFORM_SHELL` snapshot semantics, so component implementations must keep `ready()`, `health()`, and `snapshot()` deterministic.
- Constraint: request correlation data is available through `RequestContext` and AsyncLocalStorage helpers in `@fluojs/http`, but this document only treats metrics and health endpoints as the repository's built-in observability surfaces.
