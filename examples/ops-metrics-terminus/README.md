# ops-metrics-terminus example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runnable fluo operations example focused on `@fluojs/metrics` and `@fluojs/terminus`. It shows how runtime health/readiness, Prometheus scraping, and one custom metric fit together in a small app.

## what this example demonstrates

- `/metrics` via `MetricsModule.forRoot(...)` with HTTP instrumentation and endpoint middleware
- `/health` and `/ready` via `TerminusModule.forRoot(...)`
- one custom Prometheus counter registered through the application-facing `MetricsService` on an intentionally shared Registry
- template-normalized HTTP request labels and token-protected metrics scraping
- runtime-aligned health/readiness semantics exposed through terminus and metrics
- unit, integration, and e2e-style verification with `@fluojs/testing`

## routes

- `GET /ops/jobs/trigger` — increments the example custom counter
- `GET /metrics` — Prometheus scrape endpoint protected by `x-metrics-token: secret-token` in this runnable example
- `GET /health`
- `GET /ready`

## how to run

From the repository root:

```sh
pnpm install
pnpm vitest run examples/ops-metrics-terminus
```

## project structure

```text
examples/ops-metrics-terminus/
├── src/
│   ├── app.ts
│   ├── main.ts
│   ├── app.test.ts
│   └── ops/
│       ├── metrics-registry.ts
│       ├── ops.module.ts
│       ├── ops.controller.ts
│       └── ops-metrics.service.ts
├── README.md
└── README.ko.md
```

## recommended reading order

1. `src/app.ts` — metrics + terminus registration, HTTP instrumentation, and scrape endpoint protection
2. `src/ops/metrics-registry.ts` — shared Registry ownership passed into `MetricsModule.forRoot({ registry })`
3. `src/ops/ops-metrics.service.ts` — application-facing `MetricsService` custom counter registration and reuse
4. `src/ops/ops.controller.ts` — route that mutates metrics state
5. `src/app.test.ts` — `/health`, `/ready`, `/metrics`, and custom route verification through `createTestApp(...).request(...).send()`

## related docs

- `../README.md` — official examples index
- `../../docs/getting-started/first-feature-path.md`
- `../../docs/architecture/observability.md`
- `../../packages/metrics/README.md`
- `../../packages/terminus/README.md`
