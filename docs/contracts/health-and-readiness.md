# Health and Readiness Contract
<!-- fluo-terminus-contract: registration=application-owned-TerminusModule.forRoot;health=aggregated-diagnostics;ready-admission=binary;ready-body=ready|starting|unavailable;default-liveness=absent;unhealthy-status=503;route-protection=path-scoped-external-boundary;indicator-readiness=opt-out;readiness-checks=additive -->

<p><strong><kbd>English</kbd></strong> <a href="./health-and-readiness.ko.md"><kbd>한국어</kbd></a></p>

## Scope and ownership

This document and its Korean companion are the canonical Docs owner for `@fluojs/terminus` registration, runtime health responses, and HTTP readiness decisions. The [package README](../../packages/terminus/README.md) retains installation and package-specific API usage and summarizes this contract. Under [Documentation Authority](./documentation-authority.md), the Book, CONTEXT, and migration map explain and follow this owner.

The scope is the current checkout's `@fluojs/terminus` 2.x and `@fluojs/runtime` HTTP dispatcher. The package manifest supports Node.js `>=24.0.0 <27`. Host-owned HTTP also requires the host to connect the dispatcher before routes are reachable. Import safety at the root does not guarantee that Node filesystem, process memory, or Redis drivers work on every host. This document does not claim execution against the latest published packages or external databases.

Terminus composes dependency diagnostics and readiness conditions. It does not own socket listening, signal registration, drain budgets, database client creation/disposal, process exit, or orchestrator rotation/restart policies. Follow [Lifecycle & Shutdown](../architecture/lifecycle-and-shutdown.md) for the complete startup and shutdown contract.

## Prerequisites and public imports

- Import the module returned by `TerminusModule.forRoot(...)` into an existing Fluo application module. Installing the package alone does not register routes or indicators.
- In a registry-based `generated-app`, preserve the generated config and greeting registrations and lifecycle scripts. A fresh generated app registers the basic `HealthModule.forRoot()`, not Terminus. To use Terminus at the same health/readiness paths, replace that basic registration with `TerminusModule.forRoot(...)`, transferring relevant endpoint settings such as `path` and `endpointMiddleware`. Terminus creates its own `HealthModule`; keeping both at the same paths duplicates route registrations. If the application already uses Terminus, extend its existing `TerminusModule.forRoot(...)` registration instead of adding another.
- A workspace-based `repository-example` uses repository dependencies and build prerequisites. Follow the environment distinction and standard decorator/`Symbol.metadata` preparation order in [Bootstrap Paths](../getting-started/bootstrap-paths.md); do not overwrite a generated application with a repository snapshot.
- Install with `pnpm add @fluojs/terminus`. Node memory/disk probes require Node and the target filesystem. Only selected Redis, Prisma, or Drizzle DI probes require their integration package, driver, connection configuration, and dependency-owning module. Custom callbacks own preparation of the resources they access.

| Public import path | APIs and purpose |
| --- | --- |
| `@fluojs/terminus` | `TerminusModule`, `TerminusHealthService`, `HealthCheckError`, `runHealthCheck`, `assertHealthCheck`; types `HealthIndicator`, `HealthIndicatorResult`, `HealthIndicatorState`, `HealthCheckReport`, `HealthCheckExecutionOptions`, `TerminusModuleOptions` |
| `@fluojs/terminus` | `HttpHealthIndicator`, `PrismaHealthIndicator`, `DrizzleHealthIndicator`, and their respective `create*HealthIndicator`, `create*HealthIndicatorProvider`, `*HealthIndicatorOptions` |
| `@fluojs/terminus/node` | `MemoryHealthIndicator`, `DiskHealthIndicator`, and their factories, provider factories, and option types. Also root-exported for compatibility. |
| `@fluojs/terminus/redis` | `RedisHealthIndicator.create`, `createRedisHealthIndicatorProvider`, `RedisHealthIndicatorOptions`. Redis helpers are not root exports. |
| `@fluojs/terminus` | `TERMINUS_HEALTH_INDICATORS`, `TERMINUS_INDICATOR_PROVIDER_TOKENS`: the indicator set and provider-token list exported by the module |
| `@fluojs/runtime` | `ReadinessCheck`: `(ctx: RequestContext) => boolean \| Promise<boolean>`; `HealthModule` is the runtime route facade composed internally by Terminus. |
| `@fluojs/core`, `@fluojs/http` | Application `Module`; types such as `Middleware`, `MiddlewareContext`, and `Next` for endpoint middleware |

Do not import internal `TERMINUS_OPTIONS`, `createTerminusProviders`, or `createTerminusModule` as consumer APIs. Public Node listener helpers belong to `@fluojs/platform-nodejs`, not `@fluojs/runtime/node`.

## Registration inputs and defaults

`TerminusModule.forRoot(options: TerminusModuleOptions = {}): ModuleType` synchronously returns a module class. Completion of that call does not mean DI bootstrap, indicator execution, or listener activation has completed.

| Input | Omitted behavior and scope |
| --- | --- |
| `imports?: readonly ModuleType[]` | `[]`. Makes dependency exports used by `indicatorProviders` visible in Terminus's own module scope. Sibling imports in the parent module alone are insufficient. |
| `indicators?: readonly HealthIndicator[]` | `[]`. Application-created instances are registered first. `check(key: string): Promise<HealthIndicatorResult>` must return keyed `up`/`down` states. |
| `indicatorProviders?: readonly Provider[]` | `[]`. DI-resolved indicators are appended after the instance list. Repeated calls to the same built-in provider factory retain a unique token per call. |
| `readinessChecks?: readonly ReadinessCheck[]` | `[]`. Additional application conditions for `/ready`; they do not replace indicator or platform conditions. |
| `path?: string` | `''`. Defaults to `GET /health` and `GET /ready`; `/internal/` produces normalized `/internal/health` and `/internal/ready`. |
| `endpointMiddleware?: readonly Constructor<Middleware>[]` | `[]`, no access restriction by default. DI-resolved classes apply in declaration order to those two paths only. |
| `execution.indicatorTimeoutMs?: number` | No service-level timeout. Positive finite values are floored to milliseconds; other values leave the timeout unset. Supply a positive integer. This budget applies to indicator execution, not custom readiness callbacks or platform probes. |
| Indicator `key?: string` | Uses an explicit nonblank key, otherwise a class-derived key, otherwise `indicator-N`. Supply unique keys to avoid collisions. |
| Indicator `readiness?: boolean` | Omitted or `true` participates in both `/health` and `/ready`. Only exactly `false` excludes it from the `/ready` indicator set. Every built-in option type accepts this setting. |

Expose DI-backed dependency modules directly through `TerminusModule.forRoot({ imports: [ownerModule], indicatorProviders: [...] })` or an appropriate global export. Named Redis modules are scoped and require Terminus `imports`. Omitting Redis provider `clientName` selects the default client; supplying it selects a named client. Prisma provider `name` likewise selects default/named registration, while `serviceToken`/`clientToken` select explicit tokens. Follow the [README DI composition examples](../../packages/terminus/README.md#composing-di-backed-indicators-with-dependency-modules) for concrete configurations.

### Optional probes

None of these probes is registered automatically. Select the class instance or provider factory you need. All option types and DI examples connect to the [package API](../../packages/terminus/README.md#public-api-overview); this table fixes the default behavior relevant to probe selection.

| Probe | Inputs, defaults, and results |
| --- | --- |
| HTTP | Requires `url`; `method: 'GET'`, accepted status `200..299`, `timeoutMs: 2_000`. Override with `headers` and `expectedStatus` (number, number array, or predicate). Results include `url`, `statusCode`, and `responseTimeMs`; its own timeout aborts `fetch`. |
| Memory | Uses the Node memory sampler when `memoryUsage` is omitted. `heapUsedThresholdRatio: 0.95`; `heapUsedThresholdBytes` and `rssThresholdBytes` are unset by default. Fails at or above a byte limit, or at or above the heap ratio when `heapTotal > 0`. |
| Disk | `path: '.'`, `minFreeRatio: 0.1`; `minFreeBytes` is unset. Fails below a minimum available-byte or ratio threshold; reports `freeBytes`, `totalBytes`, `freeRatio`, and `path`. Lazily imports `node:fs/promises` when probing. |
| Prisma | `timeoutMs: 2_000`. The DI provider prefers the lifecycle-aware service, checks its snapshot, then runs `SELECT 1` against the client from `current()`. Raw clients and custom `ping` are supported, but a probe without a service does not gain lifecycle metadata. |
| Drizzle | `timeoutMs: 2_000`, default `query: 'select 1'`. The DI provider prefers the lifecycle-aware handle provider, checks its snapshot, then probes the database from `current()`. Raw `database.execute` and custom `query`/`ping` are supported. |
| Redis | `timeoutMs: 2_000`. Maps client `status` to a platform snapshot before `PING`. `wait`, `connecting`, `reconnecting`, `close`, and `end` report a connection that is not ready. Custom `ping` is supported, but lifecycle metadata requires `client.status`. |

Built-in HTTP/Prisma/Drizzle/Redis `timeoutMs` must be positive and finite, is floored, and has a minimum of `1` ms. Invalid values become check failures. This differs from the service's `execution.indicatorTimeoutMs` input boundary, which ignores invalid values.

## Results and readiness decisions

| Call or endpoint | Result and completion boundary |
| --- | --- |
| `TerminusHealthService.check(): Promise<HealthCheckReport>` | Aggregates after all current indicators complete or reach a configured timeout. `checkedAt` is an ISO string at aggregation time, `status` is `ok` or `error`, `contributors.up/down` are key arrays, and `info/error/details` are state maps. |
| `isHealthy(): Promise<boolean>` | Checks whether a fresh `check()` has `status === 'ok'`. |
| `isReady(): Promise<boolean>` | Runs a fresh check of indicators with `readiness !== false`. Does not include the runtime marker, custom `readinessChecks`, or platform readiness. |
| `runHealthCheck(indicators, executionOptions = {})` | `Promise<HealthCheckReport>`. Each call has an isolated execution scope; it does not serialize overlaps across calls. |
| `assertHealthCheck(report, message = 'Health check failed.')` | Returns the healthy report itself. Throws `new HealthCheckError(message, report.error)` when `status: 'error'`. |
| `GET /health` | Collects the service report, `platformShell.ready()`, and `platformShell.health()` in parallel. Returns `200` for a final `ok` report, otherwise `503`, with `platform: { health, readiness }` in the body. Direct service/helper results do not include this platform composition. |
| `GET /ready` | A starting marker returns `503` and `{ status: 'starting' }`. A ready marker with any `false` condition returns `503` and `{ status: 'unavailable' }`. All conditions passing returns `200` and `{ status: 'ready' }`. |

HTTP readiness admission is **binary**. The three body states are not severity buckets. Custom `readinessChecks` are awaited in declaration order and stop at the first `false`. The Terminus check registered by its bootstrap hook follows those checks, collecting indicator readiness and platform readiness in parallel. Platform status must be exactly `ready`, so even `degraded` with `critical: false` blocks HTTP `/ready`.

`readiness: false` excludes only that indicator's probe from `/ready`. If the same dependency is registered separately as a platform component and fails readiness, the gate still fails. Conversely, a custom readiness failure and a platform-health-only failure are not the same condition. Custom readiness callbacks do not execute on `/health`; unhealthy platform health can coexist with `/ready` returning `200` when platform readiness and all other conditions pass.

### Scoped module example

This application module fragment demonstrates the endpoint distinction without external services. `searchAvailable` and `acceptingTraffic` are illustrative application state, not framework configuration APIs. Configure the execution host and decorator prerequisites through [Bootstrap Paths](../getting-started/bootstrap-paths.md).

```typescript
import { Module } from '@fluojs/core';
import { TerminusModule, type HealthIndicator } from '@fluojs/terminus';

let searchAvailable = false;
let acceptingTraffic = true;

const search: HealthIndicator = {
  key: 'search',
  readiness: false,
  async check(key) {
    return { [key]: { status: searchAvailable ? 'up' : 'down' } };
  },
};

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [search],
      readinessChecks: [() => acceptingTraffic],
    }),
  ],
})
export class AppModule {}
```

After successful bootstrap and platform readiness, the initial `/health` returns `503`, `status: 'error'`, and `contributors.down: ['search']`, while `/ready` returns `200` and `{ status: 'ready' }`. If the application sets `acceptingTraffic = false`, `/ready` returns `503` and `{ status: 'unavailable' }`. A configuration omitting `search.readiness` returns `503` on `/ready` for the search failure alone. Configure deployment probes to consume these HTTP results before expecting removal from rotation.

## Startup, request, shutdown order, and resource owners

1. The application composes modules and dependency instances/providers. Runtime validates the module graph, creates the container, registers runtime tokens, and resolves lifecycle instances.
2. Runtime sets health markers to starting, then awaits all `onModuleInit()` hooks followed by all `onApplicationBootstrap()` hooks. The Terminus bootstrap registrar adds its indicator/platform readiness condition at this point.
3. After `platformShell.start()` succeeds, runtime marks the modules ready and creates the dispatcher. This does not mean a listener is open. Bootstrap failure resets markers to starting and attempts `bootstrap-failed` cleanup and container disposal.
4. HTTP activation belongs to the adapter/host boundary. `Application.listen()` awaits the `Application.ready()` platform gate and adapter listen, then changes public state to `ready` on success. That startup gate does not execute Terminus indicators or custom HTTP readiness callbacks and is not equivalent to HTTP `/ready`.
5. Each probe request executes the endpoint logic above after middleware. Indicators within one aggregation execute in parallel. An unfinished probe for the same indicator instance in the same service/container makes a new request report `down` instead of overlapping execution. Different application containers have independent in-flight state.
6. Starting close shuts the terminal admission gate for new `Application.dispatch()`, provider access, listen, and other runtime operations. After pending listen settlement and connected microservice close, parent teardown resets health markers to starting, then runs runtime cleanup callbacks, reverse-order `onModuleDestroy()`, reverse-order `onApplicationShutdown(signal)`, adapter close, and container disposal. A starting response can be observed while an existing dispatcher/adapter still reaches the probe; this does not promise responses through a closed listener.
7. Cleanup failure does not reopen admission or readiness. Only successful close changes public state to `closed`. Explicit close retries skip completed runtime phases and follow each stage's retry rules. Hosts/adapters own signals, drain budgets, and process exit; dependency modules dispose their owned clients. Terminus does not take over those policies or resources.

A timeout does not guarantee driver cancellation or connection recovery. Unlike an HTTP indicator's own abort, custom callbacks/database drivers may keep running; the service prevents overlap until the original probe settles. Later requests may probe again, but there is no automatic retry loop, result cache, or runtime-active indicator graph mutation.

## Failure modes and intentional limitations

| Condition | Observable result and response |
| --- | --- |
| Indicator `down` or ordinary exception | Aggregates a `down` diagnostic into `error/details`; unhealthy `/health` returns HTTP `503`. A readiness-participating indicator also makes `/ready` unavailable. |
| `HealthCheckError(message, causes)` | Normalizes every cause entry to `down`. Even a cause originally marked `up` cannot turn the failure into a healthy result. |
| Empty result, non-object, unsupported status, blank key | Adds `down` diagnostics instead of silently discarding them. Preserves valid keys in multi-entry results as well. |
| Duplicate result key | Keeps the first registered result and adds `*-duplicate-key-error`, using a numeric suffix when needed to distinguish diagnostic keys. |
| Platform health/readiness failure colliding with a user key | Keeps platform payloads under `fluo-platform-health` and `fluo-platform-readiness` and adds `*-user-key-collision`. `critical` is diagnostic metadata, not HTTP readiness severity. |
| Timeout or unfinished probe for the same instance | Reports that indicator as `down`. Does not start an overlapping probe and retains ownership until the underlying operation settles. |
| Missing Redis dependency token | Bootstrap fails with `MODULE_VISIBILITY_ERROR` during module-graph validation rather than deferring failure to a health request. |
| Prisma/Drizzle tokens absent from the whole graph | Optional injection permits bootstrap, but without an actual dependency or custom probe the indicator reports `down` at request time. |
| Prisma/Drizzle token exists in an inaccessible sibling | Optional injection does not bypass visibility: bootstrap fails with `MODULE_VISIBILITY_ERROR`. Expose the owner module through Terminus `imports`. |
| Custom readiness callback throws/rejects | The runtime readiness loop does not convert it into boolean failure. It propagates through HTTP error handling, so return `false` for an expected unavailable condition. The service indicator timeout does not cover the callback. |
| No endpoint protection | Endpoints are unprotected by default. Protect them with `endpointMiddleware` or path-scoped application/adapter middleware, network policy, or a deployment probe boundary. Do not transfer NestJS controller `@HealthCheck()`/`@UseGuards()` metadata onto these routes. |
| Process-only liveness required | No separate liveness route exists by default. Define a narrowly scoped probe in the application/deployment layer. Do not reinterpret `/health` as a process-only check. |

## Implementation, test evidence, and related documents

| Review subject | Implementation | Execution evidence |
| --- | --- | --- |
| Module registration, `503`, platform composition, readiness opt-out and additive conditions | [module.ts](../../packages/terminus/src/module.ts), [types.ts](../../packages/terminus/src/types.ts) | [module.test.ts](../../packages/terminus/src/module.test.ts): healthy/failing endpoints, opt-out, custom checks, non-critical degraded readiness, shutdown, reserved-key collision |
| Reports, exception normalization, timeout/overlap | [health-check.ts](../../packages/terminus/src/health-check.ts), [errors.ts](../../packages/terminus/src/errors.ts) | [health-check.test.ts](../../packages/terminus/src/health-check.test.ts), [request-regressions.test.ts](../../packages/terminus/src/request-regressions.test.ts) |
| DI visibility and optional dependencies | [Prisma](../../packages/terminus/src/indicators/prisma.ts), [Drizzle](../../packages/terminus/src/indicators/drizzle.ts), [Redis](../../packages/terminus/src/indicators/redis.ts) | [module-sibling-composition.test.ts](../../packages/terminus/src/module-sibling-composition.test.ts), [Prisma](../../packages/terminus/src/indicators/prisma.test.ts), [Drizzle](../../packages/terminus/src/indicators/drizzle.test.ts), [Redis](../../packages/terminus/src/indicators/redis.test.ts) |
| HTTP/Node probe defaults | [HTTP](../../packages/terminus/src/indicators/http.ts), [Memory](../../packages/terminus/src/indicators/memory.ts), [Disk](../../packages/terminus/src/indicators/disk.ts) | [HTTP](../../packages/terminus/src/indicators/http.test.ts), [Memory](../../packages/terminus/src/indicators/memory.test.ts), [Disk](../../packages/terminus/src/indicators/disk.test.ts) |
| Runtime markers, startup gate, close admission and order | [health.ts](../../packages/runtime/src/health/health.ts), [bootstrap.ts](../../packages/runtime/src/bootstrap.ts), [platform-shell.ts](../../packages/runtime/src/platform-shell.ts) | [health.test.ts](../../packages/runtime/src/health/health.test.ts), [application.test.ts](../../packages/runtime/src/application.test.ts), [platform-shell.test.ts](../../packages/runtime/src/platform-shell.test.ts) |
| Public exports and import boundaries | [package.json](../../packages/terminus/package.json), [index.ts](../../packages/terminus/src/index.ts), [node.ts](../../packages/terminus/src/node.ts), [redis.ts](../../packages/terminus/src/redis.ts) | [public-surface.test.ts](../../packages/terminus/src/public-surface.test.ts), [public-subpaths.test.ts](../../packages/terminus/src/public-subpaths.test.ts), [root-import-runtime-safety.test.ts](../../packages/terminus/src/root-import-runtime-safety.test.ts) |
| Contract sentinel and regression guard | [Terminus guard](../../tooling/governance/terminus-runtime-health-contract.mjs), [source guard](../../tooling/governance/terminus-runtime-health-source-contract.mjs) | [terminus-runtime-health-contract.test.ts](../../tooling/governance/terminus-runtime-health-contract.test.ts) |

Run relevant verification from a workspace root with repository dependencies prepared. The command below is a verification procedure, not an execution receipt. In-process dispatcher request tests do not replace checks of deployment network policy or real database connectivity.

```bash
pnpm exec vitest run packages/terminus/src packages/runtime/src/health/health.test.ts tooling/governance/terminus-runtime-health-contract.test.ts
```

- [NestJS Migration Map](../getting-started/migrate-from-nestjs.md): the boundary from controller-owned health checks to module composition.
- [Ops Metrics/Terminus example](../../examples/ops-metrics-terminus/src/app.ts): actual module registration and endpoint middleware composition.
- [Volume 1, Chapter 23](../../book/01-fluoblog/ch23-lifecycle-and-readiness.md): applying lifecycle/readiness in a product. The [previous-edition health chapter](../../book/beginner/ch18-health.md) remains available as reference material; these Docs are the canonical owner.
