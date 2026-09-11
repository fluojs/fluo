---
"@fluojs/terminus": patch
"@fluojs/runtime": patch
---

Unify Terminus standalone indicator construction on `XHealthIndicator.create(options)`. Remove the dedicated `createHttpHealthIndicator`, `createMemoryHealthIndicator`, `createDiskHealthIndicator`, `createPrismaHealthIndicator`, `createDrizzleHealthIndicator`, and `createRedisHealthIndicator` free factories. Memory and disk indicators are now exported only from `@fluojs/terminus/node`; their root exports and value-provider helpers are removed. Preserve the DI-backed Prisma, Drizzle, and Redis provider factories, class identity, constructors, readiness behavior, response semantics, and timeout-settlement ownership.

Remove the redundant runtime `createHealthModule` compatibility helper. `HealthModule.forRoot(options)` remains the sole runtime health module registration path and continues to expose the same `/health` and `/ready` behavior.

Remove `createHttpHealthIndicatorProvider` as well. Replace its entry in `indicatorProviders` with `HttpHealthIndicator.create(options)` in `TerminusModule.forRoot({ indicators: [...] })`; the HTTP indicator is a standalone instance and does not require DI-backed provider assembly.

Migration: replace `createXHealthIndicator(options)` with `XHealthIndicator.create(options)`. Import `MemoryHealthIndicator` and `DiskHealthIndicator` from `@fluojs/terminus/node`; register standalone instances through `TerminusModule.forRoot({ indicators: [...] })`. Keep `createPrismaHealthIndicatorProvider`, `createDrizzleHealthIndicatorProvider`, and `createRedisHealthIndicatorProvider` only when Terminus must resolve those dependencies from DI. Replace `createHealthModule(options)` with `HealthModule.forRoot(options)`.
