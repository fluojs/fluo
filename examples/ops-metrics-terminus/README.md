# ops-metrics-terminus example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runnable Konekti operations example focused on `@konekti/metrics` and `@konekti/terminus`. It shows how runtime health/readiness, Prometheus scraping, and one custom metric fit together in a small app.

## what this example demonstrates

- `/metrics` via `MetricsModule.forRoot()`
- `/health` and `/ready` via `createTerminusModule(...)`
- one custom Prometheus counter registered on a shared Registry that is scraped through `MetricsModule`
- runtime-aligned health/readiness semantics exposed through terminus and metrics
- unit, integration, and e2e-style verification with `@konekti/testing`

## routes

- `GET /ops/jobs/trigger` — increments the example custom counter
- `GET /metrics` — Prometheus scrape endpoint
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
│       ├── ops.module.ts
│       ├── ops.controller.ts
│       └── ops-metrics.service.ts
└── README.md
```

## recommended reading order

1. `src/app.ts` — metrics + terminus registration
2. `src/ops/metrics-registry.ts` — shared Registry and custom metric registration
3. `src/ops/ops-metrics.service.ts` — business action that increments the counter
4. `src/ops/ops.controller.ts` — route that mutates metrics state
5. `src/app.test.ts` — `/health`, `/ready`, `/metrics`, and custom route verification

## related docs

- `../README.md` — official examples index
- `../../docs/getting-started/first-feature-path.md`
- `../../docs/concepts/observability.md`
- `../../packages/metrics/README.md`
- `../../packages/terminus/README.md`
