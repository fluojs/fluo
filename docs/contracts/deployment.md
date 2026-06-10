# Deployment Requirements

<p><strong><kbd>English</kbd></strong> <a href="./deployment.ko.md"><kbd>한국어</kbd></a></p>

## Production Checklist

| Item | Requirement |
| --- | --- |
| Build output | Run `pnpm build` before packaging or publishing. The root script builds all workspace packages under `packages/*`. |
| Type safety | Run `pnpm typecheck` before deployment. The root script checks tooling, examples, and each package typecheck script. |
| Test gate | Run `pnpm verify` for a full local gate, or run the split Vitest project sequence used by release readiness: `pnpm vitest run --project packages`, `apps`, `examples`, and `tooling`. |
| Release gate | For public release preparation, run `pnpm verify:release-readiness`. That gate also runs `pnpm --dir packages/cli sandbox:matrix` and `pnpm verify:platform-consistency-governance`. |
| Adapter bootstrap | Deploy applications through an explicit adapter. Repository examples bootstrap with `FluoFactory.create(AppModule, { adapter: createFastifyAdapter({ port: 3000 }) })`. |
| Health registration | If production probes must report dependency state, register `TerminusModule.forRoot(...)` so `/health` and `/ready` expose runtime and indicator status. |
| Config boundary | Pass process-backed settings through `@fluojs/config` as an explicit `processEnv` snapshot at bootstrap. Package code must not rely on ambient `process.env` reads. |

## Environment Variables

| Variable or source | Requirement |
| --- | --- |
| `NODE_ENV` | Set to `production` for production deployments. The existing deployment example Dockerfile and Cloudflare Workers snippet both use that value. |
| `PORT` | Provide the listener port through application config when the deployment does not use the example default `3000`. The repository examples pass `port: 3000` explicitly to `createFastifyAdapter(...)`. |
| Explicit `processEnv` snapshot | When process-backed configuration is required, pass only the needed keys into `ConfigModule.forRoot({ processEnv: ... })` or `loadConfig(...)`. `@fluojs/config` does not scan ambient `process.env` automatically. |
| Application-specific secrets | Values such as database or API credentials belong in application bootstrap config, not in package internals. Validation should fail fast when required keys are missing. |

## Health Check Endpoints

| Endpoint | Default contract | Source |
| --- | --- | --- |
| `GET /health` | Runtime health endpoint from `HealthModule.forRoot(...)`. With `TerminusModule.forRoot(...)`, the response includes `checkedAt`, `contributors`, `details`, `error`, `info`, `platform`, and `status`. HTTP 200 means aggregated status `ok`. HTTP 503 means aggregated status `error`. | `packages/terminus/src/module.ts`, `docs/architecture/observability.md` |
| `GET /ready` | Runtime readiness endpoint from `HealthModule.forRoot(...)`. It returns HTTP 503 with `{"status":"starting"}` until the app is ready and again as soon as application/context shutdown begins, HTTP 503 with `{"status":"unavailable"}` when a readiness check fails, and HTTP 200 with `{"status":"ready"}` when the app is ready. | `docs/architecture/observability.md` |
| Prefixed health routes | If a base path is configured for the health module, the runtime contracts become `{path}/health` and `{path}/ready`. | `docs/architecture/observability.md` |
| Metrics scrape endpoint | `GET /metrics` returns Prometheus text using the active `prom-client` registry content type when `MetricsModule.forRoot(...)` exposes a scrape path. Production deployments should protect this route with endpoint middleware or disable it with `path: false` until an ingress boundary exists. | `packages/metrics/README.md`, `docs/architecture/observability.md` |
| Repository example coverage | `examples/ops-metrics-terminus/src/app.test.ts` verifies `/health`, `/ready`, `/metrics`, and `GET /ops/jobs/trigger` with HTTP 200 under the current example app configuration. | `examples/ops-metrics-terminus/src/app.test.ts` |

- `TerminusModule.forRoot(...)` combines indicator health, `platformShell.health()`, and `platformShell.ready()` when computing the `/health` response.
- `execution.indicatorTimeoutMs` marks a slow indicator as `down` instead of waiting indefinitely.
- The current repository keeps `/health` and `/ready` as separate routes, but Terminus still folds platform readiness into the aggregated `/health` status.
