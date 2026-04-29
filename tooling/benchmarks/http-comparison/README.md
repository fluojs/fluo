# HTTP runtime benchmark

Runs a small HTTP throughput/latency comparison between published fluo beta packages and NestJS v11 across three targets:

- `Nest+Fastify`
- `fluo+Fastify`
- `fluo+Bun`

## Scenarios

- `di-chain-random-20`: the same DI path (Controller → Service → Repository) across randomly selected 20-route families, used to expose route matching overhead.

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
- `fluo+Bun` is a runtime comparison, not a same-adapter comparison. Treat it as “same fluo app graph on Bun’s native server” versus the Node.js adapter targets.
- The suite only covers routing and one constructor-DI path. It does not measure validation, serialization plugins, guards, pipes, database access, or production middleware.
