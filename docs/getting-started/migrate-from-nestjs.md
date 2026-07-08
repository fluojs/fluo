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
| `@Sse()` | `@Sse()` from `@fluojs/http` with `SseResponse` for manual streams or `AsyncIterable` for managed streams | fluo maps `@Sse()` to a `GET` route with `text/event-stream` metadata. It can convert `AsyncIterable` values into SSE frames, while NestJS `Observable` return values must still be rewritten to `SseResponse` or an async iterable. |
| `NestFactory.create(AppModule)` | `FluoFactory.create(AppModule, { adapter })` from `@fluojs/runtime` | Bootstrap requires an explicit platform adapter such as `createFastifyAdapter()`. |
| `@Injectable()` provider marker | provider class or provider definition listed in `@Module(...).providers` | fluo does not use `@Injectable()` as a required provider registration step. |
| constructor type reflection via `emitDecoratorMetadata` | `@Inject(TokenA, TokenB)` from `@fluojs/core` | Constructor dependencies are declared explicitly in decorator argument order. |
| `class-validator` / decorator-driven DTO validation | `@fluojs/validation` with Standard Schema support | Current validation direction is Standard Schema based, including Zod and Valibot support. |
| `Pipe`, `ValidationPipe`, or parameter-level transformation | `@RequestDto(...)` with field-level `@FromPath(...)`, `@FromQuery(...)`, `@FromBody(...)`, `@FromHeader(...)`, `@FromCookie(...)`, and `@Convert(...)` from `@fluojs/http` | fluo does not expose a NestJS-style public Pipe stage for controller parameters. Bind one request DTO, declare each field source, use `@Convert(...)` for number/boolean/date/domain conversion, then validate the materialized DTO with the validation package. |
| `createApplicationContext()` standalone bootstrap | `FluoFactory.createApplicationContext(AppModule)` | Standalone application context exists in `@fluojs/runtime`. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `createTestingModule({ rootModule }).overrideModule(...)` from `@fluojs/testing` | fluo testing uses an explicit `rootModule` and replacement compile seam so tests preserve authored module identity without mutating module metadata globally. |
| NestJS request transaction interceptor | Service `@Transaction()` from the persistence package, or explicit `requestTransaction(...)` at the controller/request boundary | fluo does not provide Drizzle or Mongoose `*TransactionInterceptor` exports. Keep business transactions on services; use `DrizzleDatabase.requestTransaction(...)` or `MongooseConnection.requestTransaction(...)` only when the entire request must share one boundary. |
| `@HealthCheck()` controller method with `HealthCheckService.check([...])` | `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` from `@fluojs/terminus` | Module-level registration is the primary API so runtime `/health` and `/ready` routes include indicator and platform diagnostics consistently. |
| NestJS Terminus memory/disk or Redis checks | `@fluojs/terminus/node` and `@fluojs/terminus/redis` | Node.js memory/disk helpers and Redis helpers live on dedicated subpaths. The root package does not make Redis peers or Node filesystem access part of the default import boundary. |
| `@nestjs/throttler` global throttler setup | `ThrottlerModule.forRoot(...)` plus explicit `@UseGuards(ThrottlerGuard)` from `@fluojs/throttler` / `@fluojs/http` | Module registration provides the policy and guard provider; route enforcement starts only where the guard is attached. |
| `@WebSocketGateway()` with `@SubscribeMessage()` and parameter decorators | `@WebSocketGateway()` with `@OnMessage(event?)`, positional handler arguments, and optional `WebSocketRoomService` from `@fluojs/websockets` | fluo websocket handlers receive `(payload, socket, request)` directly. There are no Nest-style `@MessageBody()`, `@ConnectedSocket()`, or `@SubscribeMessage()` parameter/decorator rewrites. |
| NestJS Socket.IO gateway return values or `@WebSocketServer()` | `@fluojs/socket.io` plus `@fluojs/websockets` decorators with `@OnMessage(...)`, explicit acknowledgement callbacks, and `@Inject(SOCKETIO_SERVER)` | Socket.IO handlers do not turn return values into implicit emits or ACK replies. Install/import the websockets companion for `@WebSocketGateway`, `@OnMessage`, and lifecycle decorators; inject `SOCKETIO_SERVER` when migrating gateway-server access, multi-room emits, or volatile delivery. |
| `@nestjs/cache-manager` / `CacheModule.register(...)` | `CacheModule.forRoot(...)`, `CacheService`, and cache decorators from `@fluojs/cache-manager` | fluo cache registration is synchronous. Prepare Redis or custom stores before module registration, inject `CacheService` for manual cache operations, and use `httpKeyStrategy` or `@CacheKey(...)` for request-aware response-cache keys. |
| `@nestjs/event-emitter` / `@OnEvent()` handlers | `EventBusModule.forRoot(...)`, `EventBusLifecycleService`, and `@OnEvent(EventClass)` from `@fluojs/event-bus` | Event routing is class-based, handlers are discovered only from singleton providers/controllers, and bounded awaited publishes still keep underlying handler/transport work in shutdown drain tracking. |
| NestJS Redis async module registration or shared Redis Pub/Sub clients | `RedisModule.forRoot(...)`, named `RedisModule.forRoot({ name, ... })`, and `getRedisClientToken(name)` from `@fluojs/redis` | fluo Redis registration is synchronous. Resolve environment-specific options or externally created clients before registration, and keep Pub/Sub subscribers on a dedicated duplicate or named client instead of reusing the ordinary command client. |
| `@nestjs/schedule` decorators, `SchedulerRegistry`, or `CronJob` handles | `CronModule.forRoot(...)`, public-method `@Cron` / `@Interval` / `@Timeout`, and `SCHEDULING_REGISTRY` from `@fluojs/cron` | fluo starts decorator-discovered tasks during application bootstrap, starts dynamic registry tasks when added to a started registry, and exposes read-only task descriptors instead of live scheduler handles. |
| NestJS-style email async module registration with `imports`, `useClass`, or `useExisting` | `EmailModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/email` | fluo email async registration supports injected factory options only. Register dependencies in the application module graph first, list tokens in `inject`, and set `global: false` only when opting out of the default global provider visibility. |
| NestJS-style notification modules, decorator-discovered channel providers, or implicit queue/event integrations | `NotificationsModule.forRoot({ channels, queue?, events?, global? })` or `NotificationsModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/notifications` | fluo notifications registration uses explicit `NotificationChannel` values passed in `channels`. Queue adapters and event publishers are application-owned seams, not module-owned resources, and `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS` are global by default unless `global: false` is set. |
| NestJS Slack modules that assume a package-level multi-client registry or `isGlobal` | `SlackModule.forRoot({ ..., global? })` or `SlackModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/slack` | fluo Slack registration is singleton-oriented. The package exports `SlackService`, `SlackChannel`, `SLACK`, and `SLACK_CHANNEL` globally by default unless `global: false` is set; compose app-owned modules/providers or facades for multiple Slack clients. |
| NestJS Discord modules that assume `imports`, `useClass`, `useExisting`, `isGlobal`, or custom internal provider tokens | `DiscordModule.forRoot({ ..., global? })` or `DiscordModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/discord` | fluo Discord registration is singleton-oriented and injected-factory-only for async setup. The package exports `DiscordService`, `DiscordChannel`, `DISCORD`, and `DISCORD_CHANNEL` globally by default unless `global: false` is set; internal provider helpers and option tokens are intentionally private. |

## Breaking Differences

- Decorators MUST follow the TC39 standard model. NestJS legacy decorator assumptions do not carry over.
- Dependency injection is NEVER inferred from constructor types. fluo requires explicit `@Inject(...)` declarations for constructor dependencies.
- Bootstrap is adapter-first. `FluoFactory.create(...)` REQUIRES an `adapter` option instead of selecting the HTTP platform implicitly.
- Validation MUST be migrated to the Standard Schema direction instead of keeping a `class-validator`-first contract.
- NestJS Pipe and `ValidationPipe` migration is not a parameter-pipe replacement. Move request input shaping to `@RequestDto(...)` plus field-level source decorators and `@Convert(...)`; validation runs after DTO materialization instead of through a public controller-parameter Pipe stage.
- Controller decorators MUST be imported from `@fluojs/http`, while structural decorators such as `@Module` come from `@fluojs/core`.
- NestJS `@Sse()` handlers that return Observables MUST be rewritten to construct `SseResponse` or return an `AsyncIterable`. Manual `SseResponse` streams should call `send(...)` or `comment(...)` and close from request abort or application cleanup paths; managed async iterables are closed by the dispatcher when the request aborts or the response stream closes.
- Drizzle transaction migration is not an interceptor-for-interceptor replacement. `@fluojs/drizzle` uses service `@Transaction()` as the primary boundary and explicit `DrizzleDatabase.requestTransaction(...)` for rare controller/request-wide compatibility cases.
- Drizzle `@Transaction()` can infer a target from `this.db`, direct host properties, or nested `.db` properties. Services with multiple Drizzle clients MUST use an explicit accessor such as `@Transaction((self) => self.ordersDb)` instead of relying on property discovery.
- Drizzle defaults to fail-open direct execution when the registered handle lacks `database.transaction(...)` and `strictTransactions` is `false`. Set `strictTransactions: true` for migrated production flows that require rollback guarantees so missing transaction support fails readiness and helper calls instead of silently running without atomicity.
- Vite build transforms and Vitest test transforms are intentionally split. Generated non-Deno `vite.config.ts` files use `@fluojs/vite` for Babel's `{ version: '2023-11' }` decorator transform on application `.ts` files, while generated `vitest.config.ts` files use `@fluojs/testing/vitest` for tests. Do not re-enable legacy decorator compiler flags or assume one transform config owns both build and test files.
- Mongoose transaction migration is also not an interceptor-for-interceptor replacement. Use service `@Transaction()` from `@fluojs/mongoose` for business atomicity, and use `MongooseConnection.requestTransaction(...)` only for rare controller/request-wide boundaries that must share one MongoDB session.
- `@fluojs/mongoose` requires the application to provide a concrete connection from Mongoose; it does not create the connection, own model compilation, or close the connection unless a `dispose(connection)` hook is supplied.
- `MongooseConnection.model(...)` auto-binds ambient sessions only for `create`, `find`, `findOne`, `aggregate`, and `bulkWrite`. Unsupported model methods, `doc.save()`, raw `conn.current().model(...)` usage, and external utilities require explicit `conn.currentSession()` plumbing.
- Mongoose defaults to fail-open direct execution when the registered connection lacks both `connection.transaction(...)` and `startSession()` and `strictTransactions` is `false`. Set `strictTransactions: true` for migrated production flows that require MongoDB rollback guarantees so missing transaction support fails readiness and helper calls instead of silently running without atomicity.
- NestJS testing migration is not an implicit imports-array replacement. Use `createTestingModule({ rootModule })`, call `overrideModule(OriginalModule, ReplacementModule)` before `compile()`, and create virtual request HTTP tests with `createTestApp({ rootModule, ...options })` when adapter, provider, filter, or lifecycle options must be forwarded into runtime bootstrap.
- `TestingModuleRef` exposes the compiled module context for assertions, provider resolution, and dispatch helpers; `createTestApp(...)` returns a request-driven app facade with its own `close()` lifecycle. Close the returned test app after each HTTP test instead of relying on NestJS-style shared application instance ownership.
- Testing migrations must keep fluo's explicit `rootModule` assumption, authored module identity, request-level guard/interceptor/filter assertions, and metadata-free boundaries visible in tests. Do not port NestJS specs by assuming design metadata, implicit provider discovery, or a singleton application fixture owns cleanup for every request-path test.
- NestJS Terminus controller-level `@HealthCheck()` handlers SHOULD be migrated to `TerminusModule.forRoot(...)` indicator and readiness registration. Direct `TerminusHealthService.check()` calls are available for tests or custom code, but they are not the primary endpoint registration API.
- `@fluojs/terminus` does not create a separate process-only liveness route by default. Keep the default `GET /health` aggregated health route and `GET /ready` readiness gate, and define any narrower process probe at the application or deployment layer.
- Throttler migration is not a global-module-for-global-enforcement replacement. `ThrottlerModule.forRoot(...)` registers defaults, while `ThrottlerGuard` must be activated with guard metadata on protected controllers or handlers.
- `@fluojs/throttler` exposes one module default plus class/method `@Throttle({ ttl, limit })` overrides. Multi-window policies such as burst plus sustained limits require explicit HTTP middleware, a custom `ThrottlerStore`, or an application-owned guard wrapper.
- `@fluojs/platform-express` preserves Express as a host engine, not as an implicit middleware translation layer. Native Express/Connect `(req, res, next)` middleware from a NestJS or Express migration should stay in platform-specific bootstrap code or be wrapped as fluo `Middleware` before it enters `fluoFactory.create({ middleware })`.
- Forwarded client IP headers are ignored unless `trustProxyHeaders: true` is set behind a trusted proxy that overwrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`.
- The guaranteed throttled response metadata is HTTP `429` with `Retry-After`; add any extra rate-limit headers or body shape at the application boundary.
- WebSocket migration is not a decorator-for-decorator replacement. Use `@OnMessage(event?)` from `@fluojs/websockets`, read handler inputs positionally as `(payload, socket, request)`, and use `WebSocketRoomService` for room membership or broadcasts instead of assuming NestJS gateway server injection or parameter decorators carry over. The root `@fluojs/websockets` and `@fluojs/websockets/node` module paths are the Node.js defaults with `IncomingMessage` upgrade guards; Bun, Deno, and Cloudflare Workers migrations should import from `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, or `@fluojs/websockets/cloudflare-workers` so guard/request types and runtime lifecycle services stay at the correct subpath boundary. Raw WebSocket gateway return values are awaited and then ignored; send replies explicitly with the runtime socket argument.
- Socket.IO migration keeps the same explicit websocket handler model. Install `@fluojs/websockets` because `@fluojs/socket.io` reuses its `@WebSocketGateway`, `@OnMessage`, and lifecycle decorators. A handler return value is awaited and then ignored; call the provided ACK callback when a client expects an acknowledgement, or inject `SOCKETIO_SERVER` from `@fluojs/socket.io` for native Socket.IO emits, multi-room fan-out, `.volatile`, and `@WebSocketServer()` replacement code. The package targets Node.js 20+ server-backed adapters and the official Bun engine path; Deno and Workers are unsupported, and Bun requires static CORS shapes with no `@WebSocketGateway({ serverBacked })`.
- Cache-manager migration is not an async dynamic-module replacement. `@fluojs/cache-manager` exposes synchronous `CacheModule.forRoot(...)`; configure environment-specific clients at the application boundary first, then pass final cache options such as `store`, `ttl`, `keyPrefix`, `redis.clientName`, and `httpKeyStrategy`.
- NestJS-style cache-key customization should move to fluo's documented key seams instead of subclassing the interceptor. Use a function-valued `httpKeyStrategy` for an application-wide request-aware policy, or `@CacheKey(...)` with a literal key or key factory for handler-local behavior.
- Custom cache tooling should read exported cache metadata helpers such as `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, and `getCacheEvictMetadata(...)` rather than reimplementing private metadata keys.
- Event-bus migration is class-based rather than string-pattern based. Use `@OnEvent(EventClass)`, keep retryable or slow side effects idempotent, and move long-running/retry-heavy work to an explicit queue handoff instead of hiding it in an awaited event handler.
- Redis migration is not an async dynamic-module replacement. `@fluojs/redis` exposes synchronous `RedisModule.forRoot(...)`; resolve secrets, hosts, TLS options, or externally created clients at the application boundary before passing final options into the module.
- Redis Pub/Sub migration must keep subscriber ownership explicit. A `client.duplicate()` subscriber is application-owned and must be connected, subscribed, and closed by the code that created it; use named `RedisModule.forRoot({ name: 'subscriber', ... })` plus `getRedisClientToken('subscriber')` when fluo should own the subscriber client's lifecycle timeouts.
- Cron migration is not a `SchedulerRegistry`/`CronJob` handle-preserving replacement. Use public instance methods for `@Cron`, `@Interval`, and `@Timeout`; move private or static scheduled work behind a public provider method; and use `SCHEDULING_REGISTRY.get(...)` / `getAll()` for `SchedulingTaskDescriptor` snapshots rather than mutating live `CronJob` handles.
- Email migration is not a NestJS dynamic-module shape clone. `EmailModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. `EmailModule` is global by default, so set `global: false` only when migrated code requires module-local visibility.
- Notifications migration is not a provider-discovery or decorator-metadata clone. Pass explicit `NotificationChannel` values to `NotificationsModule.forRoot(...)` or return them from `NotificationsModule.forRootAsync({ inject, useFactory, global? })`; the package does not scan NestJS providers, `@Injectable()` metadata, or emitted design types for channels.
- `@fluojs/notifications` does not create, import, close, or drain concrete queue or event-bus resources. Queue adapters and event publishers are application-owned integrations, and status snapshots report them as externally managed dependencies with `ownsResources: false`.
- `NotificationsModule` is global by default for `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS`; use `global: false` when migrated code requires module-local visibility.
- Slack migration is not a package-level multi-client registry clone. `@fluojs/slack` exposes singleton compatibility tokens `SLACK` and `SLACK_CHANNEL`, mirrors that singleton wiring through `createSlackProviders(...)`, and uses `global?: boolean` with default global visibility instead of NestJS `isGlobal`.
- Discord migration is not a NestJS async dynamic-module or custom-provider clone. `DiscordModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. `@fluojs/discord` exposes singleton compatibility tokens `DISCORD` and `DISCORD_CHANNEL`, uses `global?: boolean` with default global visibility instead of NestJS `isGlobal`, and keeps internal provider helpers such as `createDiscordProviders(...)`, `DISCORD_OPTIONS`, and `NormalizedDiscordModuleOptions` private.

## Removed Concepts

- `@Injectable()` as the default provider marker. Provider registration happens through the module `providers` array.
- Reflection-driven constructor resolution through `reflect-metadata`.
- Implicit DI based on emitted design-time types.
- Legacy decorator compiler mode as a framework requirement.
- Collapsing the generated `@fluojs/vite` application transform and `@fluojs/testing/vitest` test transform into one file boundary.
- Assuming every documented platform is part of `fluo new`; starter coverage is defined separately in the support matrix.
- Assuming `@nestjs/terminus` controller decorators or a separate default liveness route are one-to-one Terminus migration targets.
- Assuming `@nestjs/throttler` named definitions, global guard registration, or proxy header trust carry over without explicit Fluo wiring.
- Assuming `@nestjs/cache-manager` async registration, implicit global cache enforcement, or interceptor subclassing carries over. fluo keeps cache setup on synchronous `CacheModule.forRoot(...)`, explicit `CacheInterceptor` placement, and documented key strategy hooks.
- Assuming NestJS/Mongoose request interceptors or implicit connection ownership carry over. fluo keeps Mongoose connection ownership application-side and uses service `@Transaction()` plus explicit `requestTransaction(...)` boundaries.
- Assuming NestJS `@SubscribeMessage()`, `@MessageBody()`, `@ConnectedSocket()`, or implicit gateway server injection exists in fluo websocket gateways.
- Assuming Socket.IO gateway return values become implicit client replies. fluo requires explicit ACK callbacks or raw `SOCKETIO_SERVER` emits.
- Assuming NestJS-style Redis async module factories or shared Pub/Sub command/subscriber clients carry over. fluo keeps Redis registration synchronous and requires dedicated subscriber ownership for Pub/Sub connections.
- Passing raw Express/Connect middleware directly to fluo application middleware. fluo middleware receives `MiddlewareContext`, so native `(req, res, next)` functions need an explicit wrapper or platform-owned integration boundary.
- Assuming NestJS HTTP adapter lifecycle hooks map to Bun by mutating a live server after startup. `@fluojs/platform-bun` binds the dispatcher and realtime seam before `listen()` starts, keeps duplicate `listen()` calls idempotent, and exposes synchronous `createBunFetchHandler(...)` for externally owned `Bun.serve(...)` hosts rather than NestJS-style late host mutation. Those manual hosts own shutdown, websocket upgrades, and native `routes` acceleration themselves.
- Assuming NestJS `SchedulerRegistry` returns mutable `CronJob` handles or that private scheduled methods are valid decorator targets. fluo exposes descriptor-based scheduling controls and requires scheduled decorators on public instance methods.
- Assuming `EmailModule.forRootAsync(...)` accepts NestJS `imports`, `useClass`, or `useExisting`, or assuming email providers are module-local by default. fluo email uses injected factory registration and defaults to global visibility unless `global: false` is set.
- Assuming notification channels are discovered from NestJS provider decorators/metadata, or assuming queue/event-bus resources are owned by the notifications module. fluo requires explicit `channels` and application-owned queue adapter/event publisher lifecycles.
- Assuming Slack exposes a package-level multi-client registry or a NestJS `isGlobal` option. fluo Slack uses singleton `SLACK` / `SLACK_CHANNEL` tokens, `createSlackProviders(...)` for the same singleton provider wiring, and `global?: boolean` for the default-global module visibility opt-out.
- Assuming Discord `forRootAsync(...)` accepts NestJS `imports`, `useClass`, or `useExisting`, assuming Discord providers are module-local by default, or importing internal provider helpers/tokens for custom wiring. fluo Discord uses injected factory registration, singleton `DISCORD` / `DISCORD_CHANNEL` tokens, private internal provider helpers, and `global?: boolean` for the default-global module visibility opt-out.

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
- Bun migrations keep the same metadata rule: runtime-specific fetch hosting does not restore NestJS reflection metadata assumptions, so controllers, providers, and gateways must stay on fluo's standard decorator metadata stores plus explicit module/provider registration.

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
