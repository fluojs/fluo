# HTTP runtime benchmark

Runs a small HTTP throughput/latency comparison between published fluo beta packages and NestJS v11 across five targets:

- `Nest+Fastify`
- `Nest+Express`
- `fluo+Fastify`
- `fluo+Express`
- `fluo+Bun`

## Scenarios

- `baseline`: pure controller routing with an identical `{ "ok": true }` JSON response.
- `di-chain`: controller → service → repository constructor injection with an identical user JSON response.
- `di-chain-random-3`, `di-chain-random-5`, `di-chain-random-20`: the same DI path across randomly selected route families, used to expose route matching overhead as route count increases.

## Run

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @fluojs-internal/tooling-benchmarks-http bench
```

The runner starts all servers, warms every target for each scenario, then measures with `autocannon` at 100 connections for 40 seconds. Measurement order rotates by scenario to avoid always giving one framework the same position.

The `fluo+Bun` target requires the `bun` CLI because `@fluojs/platform-bun` uses `globalThis.Bun.serve()` at listen time.

## Correctness gates

Each warm-up and measured run validates the expected response body and fails on:

- connection errors
- timeouts
- non-2xx responses
- body mismatches

The report prints those counters with throughput and latency metrics.

## Scope and caveats

- This measures the released npm beta surface, not unpublished workspace source changes.
- fluo uses TC39 standard decorators without `emitDecoratorMetadata`; NestJS uses legacy decorators with `emitDecoratorMetadata` through `nestjs/tsconfig.json`.
- Fastify and Express adapter comparisons should be read as framework-plus-adapter measurements, not pure framework-core measurements.
- `fluo+Bun` is a runtime comparison, not a same-adapter comparison. Treat it as “same fluo app graph on Bun’s native server” versus the Node.js adapter targets.
- The suite only covers routing and one constructor-DI path. It does not measure validation, serialization plugins, guards, pipes, database access, or production middleware.
