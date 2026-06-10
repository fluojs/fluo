# NestJS → fluo Migration Map

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>

Use this document as a migration contract map. Each row identifies the closest allowed fluo target for a NestJS construct, and each rule below marks the places where the migration is not one-to-one.

## API Correspondence Table

Apply the fluo construct in the second column, not the NestJS source pattern, when migrating production code.

| NestJS construct | fluo construct | Notes |
| --- | --- | --- |
| `@Module({ imports, controllers, providers, exports })` | `@Module({ imports, controllers, providers, exports })` from `@fluojs/core` | Module boundaries and explicit exports remain the primary composition unit. |
| `@Controller('/users')` | `@Controller('/users')` from `@fluojs/http` | Controller decoration is part of the HTTP package, not the core package. |
| `@Get()`, `@Post()`, other route decorators | `@Get()`, `@Post()`, other route decorators from `@fluojs/http` | HTTP route decoration remains method-based. |
| `@Sse()` | `@Sse()` from `@fluojs/http` plus an explicit `SseResponse` return | fluo's Phase 1 SSE decorator maps to a `GET` route with `text/event-stream` metadata. It does not automatically convert NestJS Observable or `AsyncIterable` return values. |
| `NestFactory.create(AppModule)` | `FluoFactory.create(AppModule, { adapter })` from `@fluojs/runtime` | Bootstrap requires an explicit platform adapter such as `createFastifyAdapter()`. |
| `@Injectable()` provider marker | provider class or provider definition listed in `@Module(...).providers` | fluo does not use `@Injectable()` as a required provider registration step. |
| constructor type reflection via `emitDecoratorMetadata` | `@Inject(TokenA, TokenB)` from `@fluojs/core` | Constructor dependencies are declared explicitly in decorator argument order. |
| `class-validator` / decorator-driven DTO validation | `@fluojs/validation` with Standard Schema support | Current validation direction is Standard Schema based, including Zod and Valibot support. |
| `createApplicationContext()` standalone bootstrap | `FluoFactory.createApplicationContext(AppModule)` | Standalone application context exists in `@fluojs/runtime`. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `createTestingModule({ rootModule }).overrideModule(...)` from `@fluojs/testing` | fluo testing uses an explicit `rootModule` and replacement compile seam so tests preserve authored module identity without mutating module metadata globally. |
| NestJS request transaction interceptor | Service `@Transaction()` from the persistence package, or explicit `requestTransaction(...)` at the controller/request boundary | fluo does not provide Drizzle `*TransactionInterceptor` exports. Keep business transactions on services; use `DrizzleDatabase.requestTransaction(...)` only when the entire request must share one boundary. |
| `@HealthCheck()` controller method with `HealthCheckService.check([...])` | `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` from `@fluojs/terminus` | Module-level registration is the primary API so runtime `/health` and `/ready` routes include indicator and platform diagnostics consistently. |
| NestJS Terminus memory/disk or Redis checks | `@fluojs/terminus/node` and `@fluojs/terminus/redis` | Node.js memory/disk helpers and Redis helpers live on dedicated subpaths. The root package does not make Redis peers or Node filesystem access part of the default import boundary. |
| `@nestjs/throttler` global throttler setup | `ThrottlerModule.forRoot(...)` plus explicit `@UseGuards(ThrottlerGuard)` from `@fluojs/throttler` / `@fluojs/http` | Module registration provides the policy and guard provider; route enforcement starts only where the guard is attached. |

## Breaking Differences

- Decorators MUST follow the TC39 standard model. NestJS legacy decorator assumptions do not carry over.
- Dependency injection is NEVER inferred from constructor types. fluo requires explicit `@Inject(...)` declarations for constructor dependencies.
- Bootstrap is adapter-first. `FluoFactory.create(...)` REQUIRES an `adapter` option instead of selecting the HTTP platform implicitly.
- Validation MUST be migrated to the Standard Schema direction instead of keeping a `class-validator`-first contract.
- Controller decorators MUST be imported from `@fluojs/http`, while structural decorators such as `@Module` come from `@fluojs/core`.
- NestJS `@Sse()` handlers that return Observables MUST be rewritten to construct `SseResponse`, call `send(...)` or `comment(...)`, and close the stream from request abort or application cleanup paths.
- Drizzle transaction migration is not an interceptor-for-interceptor replacement. `@fluojs/drizzle` uses service `@Transaction()` as the primary boundary and explicit `DrizzleDatabase.requestTransaction(...)` for rare controller/request-wide compatibility cases.
- Drizzle `@Transaction()` can infer a target from `this.db`, direct host properties, or nested `.db` properties. Services with multiple Drizzle clients MUST use an explicit accessor such as `@Transaction((self) => self.ordersDb)` instead of relying on property discovery.
- Drizzle defaults to fail-open direct execution when the registered handle lacks `database.transaction(...)` and `strictTransactions` is `false`. Set `strictTransactions: true` for migrated production flows that require rollback guarantees so missing transaction support fails readiness and helper calls instead of silently running without atomicity.
- NestJS testing migration is not an implicit imports-array replacement. Use `createTestingModule({ rootModule })`, call `overrideModule(OriginalModule, ReplacementModule)` before `compile()`, and create virtual request HTTP tests with `createTestApp({ rootModule, ...options })` when adapter, provider, filter, or lifecycle options must be forwarded into runtime bootstrap.
- `TestingModuleRef` owns the compiled module context and `createTestApp(...)` returns a request-driven app facade with its own runtime context. Close the returned module or app after each test instead of relying on NestJS-style shared application instance ownership.
- NestJS Terminus controller-level `@HealthCheck()` handlers SHOULD be migrated to `TerminusModule.forRoot(...)` indicator and readiness registration. Direct `TerminusHealthService.check()` calls are available for tests or custom code, but they are not the primary endpoint registration API.
- `@fluojs/terminus` does not create a separate process-only liveness route by default. Keep the default `GET /health` aggregated health route and `GET /ready` readiness gate, and define any narrower process probe at the application or deployment layer.
- Throttler migration is not a global-module-for-global-enforcement replacement. `ThrottlerModule.forRoot(...)` registers defaults, while `ThrottlerGuard` must be activated with guard metadata on protected controllers or handlers.
- `@fluojs/throttler` exposes one module default plus class/method `@Throttle({ ttl, limit })` overrides. Multi-window policies such as burst plus sustained limits require explicit HTTP middleware, a custom `ThrottlerStore`, or an application-owned guard wrapper.
- Forwarded client IP headers are ignored unless `trustProxyHeaders: true` is set behind a trusted proxy that overwrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`.
- The guaranteed throttled response metadata is HTTP `429` with `Retry-After`; add any extra rate-limit headers or body shape at the application boundary.

## Removed Concepts

- `@Injectable()` as the default provider marker. Provider registration happens through the module `providers` array.
- Reflection-driven constructor resolution through `reflect-metadata`.
- Implicit DI based on emitted design-time types.
- Legacy decorator compiler mode as a framework requirement.
- Assuming every documented platform is part of `fluo new`; starter coverage is defined separately in the support matrix.
- Assuming `@nestjs/terminus` controller decorators or a separate default liveness route are one-to-one Terminus migration targets.
- Assuming `@nestjs/throttler` named definitions, global guard registration, or proxy header trust carry over without explicit Fluo wiring.

## CLI Starter and Generator Limits

Use the CLI to create a known-good fluo baseline, then finish NestJS migration with explicit module wiring and package adoption:

- `fluo new` application starters are limited to HTTP projects for exact runtime/platform pairs: Node.js with `fastify`, `express`, or `nodejs`; Bun with `bun`; Deno with `deno`; and Cloudflare Workers with `cloudflare-workers`.
- `fluo new` microservice starters are limited to Node.js + `--platform none` for `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, and `grpc`. The CLI does not accept `redis` as a transport alias; use `redis-streams` or add `@fluojs/redis` manually after scaffolding.
- `fluo new --shape mixed` is the single-package Fastify HTTP + attached TCP microservice starter only. It is not a NestJS-style hybrid application generator for arbitrary transports or monorepo topologies.
- `fluo generate resource` is files-only/manual activation. It writes the generated slice and tests, but it does not import that module into a parent/root module automatically.
- `fluo generate` loads only the built-in `@fluojs/cli/builtin` collection. It does not scan NestJS schematics, app-local collections, workspace config files, or package-owned generator collections.

## tsconfig Changes

Migration MUST remove legacy NestJS-era decorator assumptions from `tsconfig.json`.

```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```

- `experimentalDecorators` is not part of the required fluo baseline and MUST remain disabled.
- `emitDecoratorMetadata` is not used for DI wiring and MUST remain disabled.
- Code that depended on metadata emission or `reflect-metadata` MUST be migrated to explicit tokens and explicit registration.

## CLI Migration Preview

`fluo migrate` runs in dry-run mode by default. Use it to inspect the NestJS-to-fluo codemod report before writing any files:

```bash
fluo migrate ./src
fluo migrate ./src --json
```

Use `--apply` only after reviewing the report and warnings. Use `--only <comma-list>` or `--skip <comma-list>` to focus the enabled transforms when you need a narrower pass:

```bash
fluo migrate ./src --apply
fluo migrate ./src --apply --json
fluo migrate ./src --only imports,inject-params
fluo migrate ./src --skip tests
```

Human-readable output is the default. Add `--json` when CI jobs, dashboards, or migration reports need stable machine-readable output. JSON mode writes only the structured migration report to stdout on success. Parser errors and invalid flag combinations still write their message to stderr, return exit code `1`, and do not emit partial JSON.

The JSON report includes `mode` (`dry-run` or `apply`), `dryRun`, `apply`, enabled `transforms`, `scannedFiles`, `changedFiles`, aggregate `warningCount`, and per-file metadata. Each file entry records `filePath`, whether the file changed, applied transforms, warning count, and warning details with category labels and source line numbers.

The codemod can rewrite imports, remove `@Injectable()`, map provider scopes, migrate constructor parameter `@Inject(...)` usage, rewrite supported bootstrap/listen patterns, update test templates toward `@fluojs/testing`, update decorator compiler flags, and rewrite `baseUrl` path alias configuration. It does not remove the need for manual review. Treat every warning category as a post-codemod checklist item before accepting the migration.

## Related Docs

- [NestJS Parity Gaps](../contracts/nestjs-parity-gaps.md)
- [DI and Modules](../architecture/di-and-modules.md)
- [Decorators and Metadata](../architecture/decorators-and-metadata.md)
- [fluo new Support Matrix](../reference/fluo-new-support-matrix.md)
