# @fluojs/terminus
<!-- fluo-terminus-contract: registration=application-owned-TerminusModule.forRoot;health=aggregated-diagnostics;ready-admission=binary;ready-body=ready|starting|unavailable;default-liveness=absent;unhealthy-status=503;route-protection=path-scoped-external-boundary;indicator-readiness=opt-out;readiness-checks=additive -->

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Health indicator toolkit for fluo applications. `@fluojs/terminus` layers on top of runtime health/readiness endpoints to provide dependency-aware status reporting.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Built-in Indicators](#built-in-indicators)
  - [DI-Backed Indicators](#di-backed-indicators)
  - [Execution Guardrails](#execution-guardrails)
  - [Failure Semantics](#failure-semantics)
- [NestJS Migration Boundaries](#nestjs-migration-boundaries)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/terminus
```

Install optional peers only for the indicator provider seams you enable:

```bash
pnpm add @fluojs/redis ioredis
pnpm add @fluojs/prisma @prisma/client
pnpm add @fluojs/drizzle drizzle-orm
```

## When to Use

- When you need to monitor external dependencies (databases, Redis, APIs) as part of your application's health status.
- When you want a structured JSON health report that aligns with standard monitoring patterns.
- When you need your `/ready` check to leave rotation while required downstream readiness signals are unavailable.

## Quick Start

Import `TerminusModule.forRoot()` to register health indicators.

```typescript
import { Module } from '@fluojs/core';
import { HttpHealthIndicator, TerminusModule } from '@fluojs/terminus';
import { MemoryHealthIndicator } from '@fluojs/terminus/node';

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [
        new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
        new MemoryHealthIndicator({ key: 'memory', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
class AppModule {}
```

## Common Patterns

### Built-in Indicators

The package provides several indicators out of the box:

- `PrismaHealthIndicator` / `DrizzleHealthIndicator`
- `RedisHealthIndicator` (from `@fluojs/terminus/redis`)
- `HttpHealthIndicator`
- `MemoryHealthIndicator` (root-exported for compatibility and also available from `@fluojs/terminus/node`)
- `DiskHealthIndicator` (root-exported for compatibility and also available from `@fluojs/terminus/node`)

When migrating from `@nestjs/terminus`, keep ownership boundaries explicit: register custom fluo `HealthIndicator` instances in `indicators`, and use the matching `create*HealthIndicatorProvider()` only when the indicator must resolve its dependency from DI through `indicatorProviders`. Import Node memory/disk helpers from `@fluojs/terminus/node` and Redis helpers from `@fluojs/terminus/redis`; Prisma, Drizzle, and HTTP indicators are root exports. The dedicated Redis subpath keeps its optional peer out of the root import boundary, while Node helpers remain root-exported only for compatibility.

### DI-Backed Indicators

To use indicators that require dependencies from the DI container (like Redis or Database clients) without importing peer dependencies at module load time, use the documented provider factories. These helpers create indicator provider entries for `TerminusModule.forRoot({ indicatorProviders })`; they do not replace the module facade.

```typescript
import { TerminusModule } from '@fluojs/terminus';
import { createRedisHealthIndicatorProvider } from '@fluojs/terminus/redis';

TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' })
  ],
});
```

Omit `clientName` to keep probing the default Redis client. If the indicator should use a named Redis connection, pass `clientName` so the provider resolves that named client token instead of the default one.

```typescript
TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' }),
    createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' }),
  ],
});
```

Redis indicators created through `@fluojs/terminus/redis` are lifecycle-aware when they receive a client from `@fluojs/redis`. Terminus maps the Redis connection state with `createRedisPlatformStatusSnapshot(...)` before sending `PING`, so clients in `wait`, `connecting`, `reconnecting`, `close`, or `end` states mark `/health` and `/ready` unavailable instead of relying on a raw ping alone. Custom `ping` callbacks remain supported for manual probes, but lifecycle metadata is only attached when a Redis client exposes its `status`.

For Drizzle, `createDrizzleHealthIndicatorProvider()` prefers the lifecycle-aware `DrizzleDatabase` wrapper exported by `@fluojs/drizzle`. The indicator reports `down` before probing SQL whenever Drizzle is shutting down, stopped, or otherwise not ready according to `DrizzleDatabase.createPlatformStatusSnapshot()`. If only the legacy raw `DRIZZLE_DATABASE` handle is registered, the provider keeps the previous lightweight SQL probe behavior.

For Prisma, `createPrismaHealthIndicatorProvider()` prefers the lifecycle-aware `PrismaService` / `PrismaServiceFacade` token exported by `@fluojs/prisma`, checks `createPlatformStatusSnapshot()` before probing, and then calls `current()` so ambient transaction/lifecycle seams stay visible to the health probe. Omit `name` to target the default Prisma registration, pass `name` to target `PrismaModule.forRoot({ name })`, or pass explicit `serviceToken` / `clientToken` values for manual provider graphs. If only a raw Prisma client token is registered, the provider keeps the previous lightweight query probe behavior without importing the optional Prisma peer from the root package.

Provider factories are repeatable. You may register multiple providers created by the same factory in one `indicatorProviders` array when each instance uses a distinct indicator key or dependency option; Terminus keeps every provider instance under its own DI token instead of letting later same-type providers overwrite earlier ones.

### Readiness Participation

Every indicator participates in both `/health` and `/ready` by default. Set `readiness: false` when a dependency must remain visible in `/health` but must not remove an otherwise ready instance from rotation.

```typescript
TerminusModule.forRoot({
  indicators: [
    new HttpHealthIndicator({
      key: 'search',
      readiness: false,
      url: 'https://search.example.com/health',
    }),
    new MemoryHealthIndicator({ key: 'memory', heapUsedThresholdRatio: 0.9 }),
  ],
});
```

If `search` reports `down`, `/health` returns `503` with its diagnostic while `/ready` continues to evaluate `memory`, custom `readinessChecks`, and platform readiness. A failing indicator whose `readiness` is omitted or `true` continues to make both endpoints unavailable.

### Execution Guardrails

Use `execution.indicatorTimeoutMs` when custom indicators might hang or depend on slow downstreams. When a probe exceeds the configured timeout, Terminus marks that indicator as `down` instead of waiting forever.

Terminus also serializes checks per indicator instance inside each `TerminusHealthService` / application container. If a timed-out or otherwise slow probe is still running when another `/health` or `/ready` request arrives for the same container, Terminus reports that indicator as `down` for the new request instead of starting an overlapping probe against the same downstream. Separate application containers keep independent in-flight state even when tests or multi-app processes reuse the same indicator object. Built-in HTTP indicators abort their `fetch` request when their own timeout expires; other drivers and custom callbacks may not expose cancellation, so they are protected from overlap until the original promise settles.

```typescript
TerminusModule.forRoot({
  execution: {
    indicatorTimeoutMs: 1_500,
  },
  indicators: [
    new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
  ],
});
```

Use `path` to mount the health endpoints under a custom path. Indicators gate `/ready` by default; set an indicator's `readiness: false` to retain its `/health` diagnostics without blocking traffic. `readinessChecks` composes additional application-specific conditions with indicator and platform readiness checks; it does not exclude indicators.

### Failure Semantics

When an indicator returns a `down` result or throws a `HealthCheckError`, the `TerminusHealthService` aggregates the failure into a report:

- `/health` returns the aggregated `HealthCheckReport` diagnostics and returns HTTP `200` only when that report is healthy; any indicator failure returns HTTP `503`.
- `/ready` makes a binary traffic-admission decision: HTTP `200` admits traffic and HTTP `503` removes the instance from rotation. Its JSON body reports `{ status: 'ready' }`, `{ status: 'starting' }`, or `{ status: 'unavailable' }`. An indicator whose `readiness` is omitted or `true` can block the gate; `readiness: false` retains its `/health` diagnostics without blocking `/ready`. Custom `readinessChecks` only add conditions. Platform `critical` metadata stays in `/health` diagnostics, not readiness severity buckets.
- The response body contains a structured JSON object with `status`, `contributors`, `info`, `error`, and `details`.
- Indicators may emit multiple keyed entries in a single check result; `/health` preserves every keyed entry in `details` and in the `contributors.up` / `contributors.down` summaries.
- Unsupported, empty, or non-object indicator results are reported as `down` diagnostics instead of being silently discarded.
- Blank indicator result keys are reported as `down` diagnostics instead of contributing healthy entries.
- If an indicator reuses a key that was already reported earlier in the same run, Terminus keeps the first entry and adds a deterministic `*-duplicate-key-error` contributor instead of silently overwriting data.
- Platform health/readiness failures are surfaced as deterministic `fluo-platform-health` and `fluo-platform-readiness` contributors in `/health` responses. These keys are reserved for platform diagnostics; if a user indicator returns one of them during a platform failure, Terminus keeps the platform payload under the reserved key and adds a deterministic `*-user-key-collision` diagnostic instead of dropping runtime state.
- `/health` responses may include a `platform` block with platform health/readiness details when runtime diagnostics are available.
- Prisma indicators created through the DI provider map `@fluojs/prisma` service lifecycle readiness/health state before querying, so shutdown, stopped, or not-yet-connected integrations mark `/health` and `/ready` unavailable even when the raw client handle is still callable.
- Drizzle indicators created through the DI provider map Drizzle lifecycle readiness/health state before SQL probing, so shutdown or stopped integrations mark `/health` and `/ready` as unavailable even if the underlying driver still accepts a raw ping.
- Redis indicators created through the Redis subpath map `@fluojs/redis` client lifecycle state before `PING`, so shutdown or disconnected Redis clients mark `/health` and `/ready` as unavailable even before command execution.

## NestJS Migration Boundaries

When migrating from `@nestjs/terminus`, treat `TerminusModule.forRoot(...)` as the primary fluo API. fluo does not model controller-level `@HealthCheck()` methods that call `HealthCheckService.check([...])` as the main application contract. You can still call `TerminusHealthService.check()` directly from tests or custom application code, but production endpoint registration should keep indicators and readiness hooks in module options so the runtime `/health` and `/ready` routes include platform diagnostics consistently.

Terminus also does not create a separate process-only liveness route by default. The default route model remains `GET /health` for aggregated diagnostics and `GET /ready` for binary readiness with HTTP `200` or `503`. If your deployment requires a narrow process liveness probe, define that probe at the application or deployment layer instead of assuming Terminus will add a NestJS-style extra route. These runtime-owned routes explicitly reject a NestJS controller's `@HealthCheck()` or `@UseGuards()` metadata; protect them with path-scoped application or adapter middleware, network policy, or a deployment-owned probe boundary.

Runtime-specific indicators are split by subpath. Use `@fluojs/terminus/node` for Node.js memory and disk checks, and use `@fluojs/terminus/redis` for Redis checks. Prisma and Drizzle provider helpers resolve token-only DI seams so the root package stays import-safe when those optional peers are absent, and Node disk filesystem access stays lazy so applications opt into runtime-specific probes explicitly.

## Public API Overview

### `TerminusModule`

- `static forRoot(options: TerminusModuleOptions): ModuleType`
  - Main entry point for registering indicators and providers.
  - Options include `indicators`, `indicatorProviders`, `readinessChecks`, `execution.indicatorTimeoutMs`, and `path`.

### `TerminusHealthService`

- `check(): Promise<HealthCheckReport>`
  - Runs the currently registered indicators and returns the aggregated report.
- `isHealthy(): Promise<boolean>`
  - Returns whether the current aggregated report is fully healthy.
- `isReady(): Promise<boolean>`
  - Returns whether every indicator participating in readiness currently reports `up`.

### `HealthIndicator`

- `readiness?: boolean`
  - Controls whether an indicator participates in `/ready`; it defaults to `true`. All bundled indicator option objects accept this setting.

### Direct helpers and tokens

- `runHealthCheck(...)`, `assertHealthCheck(...)`: Direct aggregation/testing helpers.
- `TERMINUS_HEALTH_INDICATORS`, `TERMINUS_INDICATOR_PROVIDER_TOKENS`: DI tokens for registered indicators and provider tokens. `TerminusModule.forRoot(...)` exports both tokens so downstream modules can inspect the composed indicator/provider-token set without rebuilding Terminus internals.
- Built-in indicators also expose `create*HealthIndicator()` and `create*HealthIndicatorProvider()` helpers. Provider helpers are intentional DI-composition exceptions for `indicatorProviders`, while application registration should still go through `TerminusModule.forRoot(...)`.

### `@fluojs/terminus/redis`

- `RedisHealthIndicator`, `createRedisHealthIndicator()`, `createRedisHealthIndicatorProvider()`
  - Redis-specific indicator helpers are exported from the dedicated subpath so the root package stays import-safe without the optional Redis peer installed.
  - The provider resolves the default `@fluojs/redis` client token by default, or a named token when `clientName` is supplied, and reuses Redis platform status semantics for readiness diagnostics.

### `@fluojs/terminus/node`

- `MemoryHealthIndicator`, `DiskHealthIndicator`, `createMemoryHealthIndicator()`, `createDiskHealthIndicator()`, `createMemoryHealthIndicatorProvider()`, `createDiskHealthIndicatorProvider()`
  - Node-specific indicator helpers remain root-exported for compatibility and are also exported from this dedicated subpath. Filesystem access for disk checks is lazy-loaded so importing the root package does not load Node filesystem modules at module initialization time.


### `HealthCheckError`

- Throw this error within custom indicators to signal a "down" state.

## Related Packages

- `@fluojs/metrics`: Often used together for observability.
- `@fluojs/prisma` / `@fluojs/drizzle` / `@fluojs/redis`: Peer dependencies for specific indicators.

## Example Sources

- `examples/ops-metrics-terminus/src/app.ts`: End-to-end integration of health and metrics.
- `packages/terminus/src/health-check.test.ts`: Demonstrates aggregation and assertion flow.
