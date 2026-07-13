# NestJS → fluo Migration Map

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>

Use this document as a migration contract map. Each row identifies the closest allowed fluo target for a NestJS construct, and each rule below marks the places where the migration is not one-to-one.

## API Correspondence Table

Apply the fluo construct in the second column, not the NestJS source pattern, when migrating production code.

| NestJS construct | fluo construct | Notes |
| --- | --- | --- |
| `@Module({ imports, controllers, providers, exports })` | `@Module({ imports, controllers, providers, exports })` from `@fluojs/core` | Module boundaries and explicit exports remain the primary composition unit. |
| `forwardRef(() => OtherModule)` in a Module `imports` array | no direct replacement; extract shared Providers into a third Module or package | fluo rejects circular Module imports during Module Graph compilation. `forwardRef(...)` is only a dependency-Token wrapper for class-level `@Inject(...)` lists and Provider `inject` arrays; it does not make Module or true constructor cycles resolvable. |
| `@Controller('/users')` | `@Controller('/users')` from `@fluojs/http` | Controller decoration is part of the HTTP package, not the core package. |
| `@Get()`, `@Post()`, other route decorators | `@Get()`, `@Post()`, other route decorators from `@fluojs/http` | HTTP route decoration remains method-based. |
| `@Sse()` | `@Sse()` from `@fluojs/http` with `SseResponse` for manual streams or `AsyncIterable` for managed streams | fluo maps `@Sse()` to a `GET` route with `text/event-stream` metadata. It can convert `AsyncIterable` values into SSE frames, while NestJS `Observable` return values must still be rewritten to `SseResponse` or an async iterable. |
| `NestFactory.create(AppModule)` | `FluoFactory.create(AppModule, { adapter })` from `@fluojs/runtime` | Bootstrap requires an explicit platform adapter such as `createFastifyAdapter()`. |
| NestJS HTTP server lifecycle hooks or late WebSocket server mutation when moving to Cloudflare Workers | `@fluojs/platform-cloudflare-workers` plus `CloudflareWorkersWebSocketModule.forRoot()` from `@fluojs/websockets/cloudflare-workers` | Workers expose a host-owned `fetch(request, env, ctx)` boundary rather than a server socket. `listen()` only binds the fluo dispatcher; register the Worker WebSocket module in the application graph so bootstrap configures its binding before that listen boundary. Each accepted request is tracked through `ctx.waitUntil(...)`, and Worker `env` bindings remain application-owned inputs that must be mapped into explicit providers or `@fluojs/config`. |
| `@Injectable()` provider marker | provider class or provider definition listed in `@Module(...).providers` | fluo does not use `@Injectable()` as a required provider registration step. |
| constructor type reflection via `emitDecoratorMetadata` | `@Inject(TokenA, TokenB)` from `@fluojs/core` | Constructor dependencies are declared explicitly in decorator argument order. |
| property injection such as `@Inject(TOKEN) private value` | class-level `@Inject(TOKEN)` plus a matching constructor parameter | fluo's `@Inject(...)` is a standard class Decorator that declares constructor Tokens in parameter order. It is not a property or constructor-parameter Decorator. |
| `class-validator` / decorator-driven DTO validation | `@fluojs/validation` with Standard Schema support, including Zod and Valibot | This is a fluo-native validation surface, not class-validator compatibility. Ordinary validators skip `null` / `undefined`, requiredness uses `@IsDefined()`, plain-object materialization retains safe own enumerable extra properties, and validation groups are unsupported. |
| `SwaggerModule.createDocument(...)` and `SwaggerModule.setup(...)` | `OpenApiModule.forRoot({ title, version, sources, descriptors, ui, swaggerUiAssets })` from `@fluojs/openapi` | OpenAPI adoption is explicit: list every documented controller in `sources`, pass prebuilt HTTP handler mappings in `descriptors`, or use both. fluo does not scan the application module graph for controllers. `/openapi.json` remains available independently, while Swagger UI serves at `/docs` only when `ui: true`; `swaggerUiAssets` can replace the default CSS and JavaScript URLs. |
| `@nestjs/graphql` resolver discovery, reflected return types, and `forRootAsync(...)` | `GraphqlModule.forRoot(...)`, module providers/controllers, `@Resolver`, `@Query`, `@Mutation`, `@Subscription`, and `listOf(...)` from `@fluojs/graphql` | Register resolver classes as providers or controllers in compiled modules. The `resolvers` option is an optional allowlist/filter over those discoverable classes; omitting it or passing an empty list allows every decorated registered candidate. fluo does not infer providers or GraphQL output types from metadata. Object results require `outputType`, arrays require `outputType: listOf(ItemType)`, and omitted output types use GraphQL `String`. There is no `forRootAsync(...)`, object field resolver, or `@Subscription({ topics })` contract. Optional WebSocket subscriptions require a server-backed Node HTTP/S adapter. |
| Controller parameter decorators such as `@Param()`, `@Query()`, `@Body()`, `@Headers()`, `@Req()`, and `@Res()`, plus `Pipe` / `ValidationPipe` transformation | `@RequestDto(...)` with field-level `@FromPath(...)`, `@FromQuery(...)`, `@FromBody(...)`, `@FromHeader(...)`, `@FromCookie(...)`, and `@Convert(...)` from `@fluojs/http`; a `RequestContext` handler parameter for advanced request/response access | fluo does not expose NestJS-style controller parameter decorators or a public parameter Pipe stage. Bind one request DTO, declare each field source, use `@Convert(...)` for number/boolean/date/domain conversion, then validate the materialized DTO with the validation package. |
| `createApplicationContext()` standalone bootstrap | `FluoFactory.createApplicationContext(AppModule)` | Standalone application context exists in `@fluojs/runtime`. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `createTestingModule({ rootModule }).overrideModule(...)` from `@fluojs/testing` | fluo testing uses an explicit `rootModule` and replacement compile seam so tests preserve authored module identity without mutating module metadata globally. |
| NestJS request transaction interceptor | Service `@Transaction()` from the persistence package, or explicit `requestTransaction(...)` at the controller/request boundary | `PrismaTransactionInterceptor` and `MongooseTransactionInterceptor` remain deprecated 1.x compatibility bridges for existing imports. New code should keep business transactions on services and use explicit `requestTransaction(...)` only when the entire request must share one boundary, forwarding `RequestContext.request.signal` when available. Drizzle has no compatibility interceptor export. |
| `@HealthCheck()` controller method with `HealthCheckService.check([...])` | `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` from `@fluojs/terminus` | Module-level registration is the primary API so runtime `/health` and `/ready` routes include indicator and platform diagnostics consistently. |
| NestJS Terminus memory/disk or Redis checks | `@fluojs/terminus/node` and `@fluojs/terminus/redis` | Node.js memory/disk helpers and Redis helpers live on dedicated subpaths. The root package does not make Redis peers or Node filesystem access part of the default import boundary. |
| `@nestjs/throttler` global throttler setup | `ThrottlerModule.forRoot(...)` plus explicit `@UseGuards(ThrottlerGuard)` from `@fluojs/throttler` / `@fluojs/http` | Module registration provides the policy and guard provider; route enforcement starts only where the guard is attached. |
| `@WebSocketGateway()` with `@SubscribeMessage()` and parameter decorators | `@WebSocketGateway()` with `@OnMessage(event?)`, positional handler arguments, and optional `WebSocketRoomService` from `@fluojs/websockets` | fluo websocket handlers receive `(payload, socket, request)` directly. There are no Nest-style `@MessageBody()`, `@ConnectedSocket()`, or `@SubscribeMessage()` parameter/decorator rewrites. |
| NestJS Socket.IO gateway return values or `@WebSocketServer()` | `@fluojs/socket.io` plus `@fluojs/websockets` decorators with `@OnMessage(...)`, explicit acknowledgement callbacks, and `@Inject(SOCKETIO_SERVER)` | Socket.IO handlers do not turn return values into implicit emits or ACK replies. Install/import the websockets companion for `@WebSocketGateway`, `@OnMessage`, and lifecycle decorators; inject `SOCKETIO_SERVER` when migrating gateway-server access, multi-room emits, or volatile delivery. |
| `@nestjs/cache-manager` / `CacheModule.register(...)` | `CacheModule.forRoot(...)`, `CacheService`, and cache decorators from `@fluojs/cache-manager` | fluo cache registration is synchronous. Prepare Redis or custom stores before module registration, inject `CacheService` for manual cache operations, and use `httpKeyStrategy` or `@CacheKey(...)` for request-aware response-cache keys. |
| `@nestjs/event-emitter` / `@OnEvent()` handlers | `EventBusModule.forRoot(...)`, `EventBusLifecycleService`, and `@OnEvent(EventClass)` from `@fluojs/event-bus` | Event routing is class-based, `static eventKey` stabilizes distributed transport channels, handlers are discovered only from singleton providers/controllers, and awaited or background publish work remains in shutdown drain tracking. |
| `@nestjs/cqrs` command/query/event handlers and sagas | `CqrsModule.forRoot(...)`, standard `@CommandHandler(...)`, `@QueryHandler(...)`, `@EventHandler(...)`, and `@Saga(...)` from `@fluojs/cqrs` | CQRS discovery scans singleton providers only, not controllers or emitted design metadata. Commands and queries remain point-to-point; event handlers and sagas fan out by provider token before delegated `@fluojs/event-bus` publication. |
| `ClientsModule.register(...)`, injected `ClientProxy`, and NestJS broker transport options | `MicroservicesModule.forRoot({ transport })`, `MICROSERVICE` typed as `Microservice`, and transport adapters from `@fluojs/microservices/<transport>` | Registration and the programmatic facade stay on root `@fluojs/microservices`; NATS, Kafka, and RabbitMQ collaborators remain application-owned, and `send()`, `emit()`, and `close()` have distinct completion boundaries described below. |
| NestJS Redis async module registration or shared Redis Pub/Sub clients | `RedisModule.forRoot(...)`, named `RedisModule.forRoot({ name, ... })`, and `getRedisClientToken(name)` from `@fluojs/redis` | fluo Redis registration is synchronous and each `forRoot(...)` call creates a client from final options. Resolve environment-specific options before registration; do not pass or expect the module to adopt an externally created client. Keep Pub/Sub subscribers on a dedicated duplicate or named client instead of reusing the ordinary command client. |
| `@nestjs/bull` / `@nestjs/bullmq` processor discovery through `@Processor(...)`, `@Process(...)`, or provider metadata | `RedisModule.forRoot(...)`, `QueueModule.forRoot(...)`, singleton `@QueueWorker(JobClass, options?)` providers, and explicit `@Inject(...)` from `@fluojs/queue`, `@fluojs/redis`, and `@fluojs/core` | fluo discovers only decorated singleton providers/controllers in the compiled module graph. Workers expose `handle(job)`; Queue does not read NestJS metadata or automatically preserve a legacy Bull/BullMQ `queueName`, named job, persisted payload, or their topology. |
| `@nestjs/schedule` decorators, `SchedulerRegistry`, or `CronJob` handles | `CronModule.forRoot(...)`, public-method `@Cron` / `@Interval` / `@Timeout`, and `SCHEDULING_REGISTRY` from `@fluojs/cron` | Rename NestJS `timeZone` to fluo `timezone`. Do not carry `waitForCompletion`: fluo has no such option and always skips a tick when the same task instance is still running. fluo starts decorator-discovered tasks during application bootstrap, starts dynamic registry tasks when added to a started registry, and exposes read-only task descriptors instead of live scheduler handles. |
| NestJS-style email async module registration with `imports`, `useClass`, or `useExisting` | `EmailModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/email` | fluo email async registration supports injected factory options only. Register dependencies in the application module graph first, list tokens in `inject`, and set `global: false` only when opting out of the default global provider visibility. |
| NestJS-style notification modules, decorator-discovered channel providers, or implicit queue/event integrations | `NotificationsModule.forRoot({ channels, queue?, events?, global? })` or `NotificationsModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/notifications` | fluo notifications registration uses explicit `NotificationChannel` values passed in `channels`. Queue adapters and event publishers are application-owned seams, not module-owned resources, and `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS` are global by default unless `global: false` is set. |
| NestJS Slack modules that assume `imports`, `useClass`, `useExisting`, a package-level multi-client registry, or `isGlobal` | `SlackModule.forRoot({ ..., global? })` or `SlackModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/slack` | fluo Slack async registration consumes injected factory options only. Register dependencies in the application module graph first, list their tokens in `inject`, return final Slack options from `useFactory`, and compose app-owned modules/providers or facades for multiple clients. |
| NestJS Discord modules that assume `imports`, `useClass`, `useExisting`, `isGlobal`, or custom internal provider tokens | `DiscordModule.forRoot({ ..., global? })` or `DiscordModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/discord` | fluo Discord registration is singleton-oriented and injected-factory-only for async setup. The package exports `DiscordService`, `DiscordChannel`, `DISCORD`, and `DISCORD_CHANNEL` globally by default unless `global: false` is set; internal provider helpers and option tokens are intentionally private. |

## Breaking Differences

- Decorators MUST follow the TC39 standard model. NestJS legacy decorator assumptions do not carry over.
- Dependency injection is NEVER inferred from constructor types. fluo requires explicit `@Inject(...)` declarations for constructor dependencies.
- NestJS property injection MUST become constructor injection. Put `@Inject(TokenA, TokenB)` on the class and keep its Token order aligned with the constructor parameters; do not attach `@Inject(...)` to properties or parameters.
- NestJS Module `forwardRef(...)` has no fluo equivalent. Break Module import cycles by extracting shared Providers into a separate Module or package. fluo's `forwardRef(...)` only defers lookup for one dependency Token in class-level `@Inject(...)` or Provider `inject`; it does not resolve Module cycles or true constructor cycles.
- Bootstrap is adapter-first. `FluoFactory.create(...)` REQUIRES an `adapter` option instead of selecting the HTTP platform implicitly.
- Validation MUST be migrated to the Standard Schema direction instead of keeping a `class-validator`-first contract.
- NestJS controller parameter decorators, Pipe, and `ValidationPipe` migration are not parameter-for-parameter replacements. Replace `@Param()`, `@Query()`, `@Body()`, `@Headers()`, `@Req()`, and `@Res()` assumptions with one `@RequestDto(...)`, field-level source decorators, `@Convert(...)`, and an explicit `RequestContext` handler parameter when low-level access is necessary. Validation runs after DTO materialization instead of through a public controller-parameter Pipe stage.
- Do not carry over `ValidationPipe` whitelist/forbid assumptions or class-validator group execution. Ordinary fluo validators skip `null` and `undefined`, so add `@IsDefined()` for required fields. When its input is a plain object, `materialize()` retains safe own enumerable extra properties rather than stripping or rejecting them; this filtering guarantee does not describe already-created DTO instances. Decorator options do not support `groups` or `always`. Use explicit input shaping and separate DTOs, mapped DTOs, `@ValidateIf(...)`, or class-level validators for workflow-specific rules.
- OpenAPI migration is not a reflection-driven `SwaggerModule` replacement. `OpenApiModule` requires `title` and `version`, and documented operations must come from explicit `sources`, explicit `descriptors`, or both; application `controllers` are not inferred. Handler return values and TypeScript return types do not produce response schemas. Without `@ApiResponse(...)`, the generated success response contains only the method-derived or `@HttpCode(...)` status and an `OK` description; provide `schema` or `type` to `@ApiResponse(...)` for response content. Duplicate OpenAPI path/method operations use later-descriptor precedence, and module composition places explicit `descriptors` after discovered `sources`, so explicit descriptors win collisions.
- Controller decorators MUST be imported from `@fluojs/http`, while structural decorators such as `@Module` come from `@fluojs/core`.
- NestJS `@Sse()` handlers that return Observables MUST be rewritten to construct `SseResponse` or return an `AsyncIterable`. Manual `SseResponse` streams should call `send(...)` or `comment(...)` and close from request abort or application cleanup paths; managed async iterables are closed by the dispatcher when the request aborts or the response stream closes.
- Drizzle transaction migration is not an interceptor-for-interceptor replacement. `@fluojs/drizzle` uses service `@Transaction()` as the primary boundary and explicit `DrizzleDatabase.requestTransaction(...)` for rare controller/request-wide compatibility cases.
- Drizzle `@Transaction()` can infer a target from `this.db`, direct host properties, or nested `.db` properties. Services with multiple Drizzle clients MUST use an explicit accessor such as `@Transaction((self) => self.ordersDb)` instead of relying on property discovery.
- Drizzle defaults to fail-open direct execution when the registered handle lacks `database.transaction(...)` and `strictTransactions` is `false`. Set `strictTransactions: true` for migrated production flows that require rollback guarantees so missing transaction support fails readiness and helper calls instead of silently running without atomicity.
- Vite build transforms and Vitest test transforms are intentionally split. Generated non-Deno `vite.config.ts` files use `@fluojs/vite` for Babel's `{ version: '2023-11' }` decorator transform on application `.ts` files, while generated `vitest.config.ts` files use `@fluojs/testing/vitest` for tests. Do not re-enable legacy decorator compiler flags or assume one transform config owns both build and test files.
- Mongoose transaction migration is also not an interceptor-for-interceptor replacement. Existing 1.x imports may retain the deprecated `MongooseTransactionInterceptor` while migrating; use service `@Transaction()` for business atomicity and explicit `MongooseConnection.requestTransaction(...)` for new request-wide boundaries.
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
- `@fluojs/platform-express` requires Node.js 20+ and preserves Express only as the host engine. Before replacing a NestJS HTTP adapter, migrate controllers and providers to TC39 standard decorators, declare constructor tokens with class-level `@Inject(...)`, and use explicit module/provider registration. Keep `experimentalDecorators` and `emitDecoratorMetadata` disabled; changing the HTTP host does not preserve NestJS decorator, reflection metadata, or implicit dependency-discovery semantics.
- `@fluojs/platform-express` is not an implicit middleware translation layer. Native Express/Connect `(req, res, next)` middleware from a NestJS or Express migration can be passed through the adapter's explicit `nativeMiddleware` option, which runs in array order before Express routing and fluo dispatch. A handler that calls `next()` continues into fluo; a handler that ends the response does not. Native failures stay in the Express error chain, and native middleware resources remain application-owned. Prefer wrapping long-term behavior as fluo `Middleware` before it enters `fluoFactory.create({ middleware })`.
- Forwarded client IP headers are ignored unless `trustProxyHeaders: true` is set behind a trusted proxy that overwrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`.
- The guaranteed throttled response metadata is HTTP `429` with `Retry-After`; add any extra rate-limit headers or body shape at the application boundary.
- WebSocket migration is not a decorator-for-decorator replacement. Use `@OnMessage(event?)` from `@fluojs/websockets`, read handler inputs positionally as `(payload, socket, request)`, and use `WebSocketRoomService` for room membership or broadcasts instead of assuming NestJS gateway server injection or parameter decorators carry over. The root `@fluojs/websockets` and `@fluojs/websockets/node` module paths are the Node.js defaults with `IncomingMessage` upgrade guards; Bun, Deno, and Cloudflare Workers migrations should import from `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, or `@fluojs/websockets/cloudflare-workers` so guard/request types and runtime lifecycle services stay at the correct subpath boundary. Raw WebSocket gateway return values are awaited and then ignored; send replies explicitly with the runtime socket argument.
- Socket.IO migration keeps the same explicit websocket handler model. Install `@fluojs/websockets` because `@fluojs/socket.io` reuses its `@WebSocketGateway`, `@OnMessage`, and lifecycle decorators. A handler return value is awaited and then ignored; call the provided ACK callback when a client expects an acknowledgement, or inject `SOCKETIO_SERVER` from `@fluojs/socket.io` for native Socket.IO emits, multi-room fan-out, `.volatile`, and `@WebSocketServer()` replacement code. The package targets Node.js 20+ server-backed adapters and the official Bun engine path; Deno and Workers are unsupported, and Bun requires static CORS shapes with no `@WebSocketGateway({ serverBacked })`.
- Cache-manager migration is not an async dynamic-module replacement. `@fluojs/cache-manager` exposes synchronous `CacheModule.forRoot(...)`; configure environment-specific clients at the application boundary first, then pass final cache options such as `store`, `ttl`, `keyPrefix`, `redis.clientName`, and `httpKeyStrategy`.
- NestJS-style cache-key customization should move to fluo's documented key seams instead of subclassing the interceptor. Use a function-valued `httpKeyStrategy` for an application-wide request-aware policy, or `@CacheKey(...)` with a literal key or key factory for handler-local behavior.
- Custom cache tooling should read exported cache metadata helpers such as `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, and `getCacheEvictMetadata(...)` rather than reimplementing private metadata keys.
- Event-bus migration is class-based rather than string-pattern based. Use `@OnEvent(EventClass)`, keep retryable or slow side effects idempotent, and move long-running/retry-heavy work to an explicit queue handoff instead of hiding it in an awaited event handler.
- Use a directly declared `static eventKey` when distributed routing must survive class renames or minification. Transport publication fans out across the concrete event and inherited event channels; an inherited `eventKey` does not silently replace the subclass channel name.
- Keep `@fluojs/event-bus` for one-to-many domain-event fan-out. Use `@fluojs/cqrs` when the migration also needs point-to-point command/query routing, CQRS event-handler discovery, or sagas; its event pipeline runs local CQRS handlers and sagas before delegating final publication to `@fluojs/event-bus`.
- NestJS CQRS migration is not a reflection-driven provider scan. Register handlers and sagas as singleton providers behind `CqrsModule.forRoot(...)`; controllers are excluded from CQRS discovery, and TC39 standard decorators carry explicit class metadata without `emitDecoratorMetadata`.
- CQRS event-handler and saga fan-out follows provider-token identity. Reusing one decorated class under distinct singleton tokens creates distinct routes, while repeated discovery of the same token and event route is deduplicated. Local event handlers complete first, matching sagas complete second, and delegated `@fluojs/event-bus` publication completes last; `publishAll(...)` awaits that entire pipeline before advancing.
- Pass the optional `CqrsDispatchContext` argument through nested command, query, event, and saga dispatch unchanged. It is a frozen fieldless value whose trusted topology and shutdown-drain state remains private; do not construct, clone, inspect, or mutate it, and do not expect direct saga dispatch to opt into shutdown work.
- Redis migration is not an async dynamic-module replacement. `@fluojs/redis` exposes synchronous `RedisModule.forRoot(...)`, which creates a new client from final options rather than accepting or adopting an external client. Resolve secrets, hosts, and TLS options at the application boundary before passing them into the module; keep an external raw client outside the module and close it from application shutdown.
- Redis Pub/Sub migration must keep subscriber ownership explicit. A `client.duplicate()` subscriber is application-owned and must be connected, subscribed, and closed by the code that created it; use named `RedisModule.forRoot({ name: 'subscriber', ... })` plus `getRedisClientToken('subscriber')` when fluo should own the subscriber client's lifecycle timeouts.
- Queue migration is not a NestJS processor-discovery compatibility layer. Register Redis and `QueueModule.forRoot(...)`, replace each processor with a TC39 standard `@QueueWorker(JobClass, options?)` class that implements `handle(job)`, list it as a singleton module provider, and declare constructor tokens with `@Inject(...)`. With `global: false`, the worker and Redis provider must remain reachable through the same authored module graph as that queue registration; request/transient workers are skipped. Queue owns processor lifecycle after registration, starts processors only after the application bootstrap-ready handoff, and waits up to `workerShutdownTimeoutMs` during shutdown.
- Queue owns processor lifecycle and a different persistence identity. NestJS Bull/BullMQ can store multiple named job values under one `queueName`; fluo uses `jobName` as both its BullMQ queue name and named job for one worker/job type. Setting `jobName` alone therefore cannot preserve that legacy topology, and Queue does not consume NestJS metadata or automatically transform a persisted payload. Before producer cutover, either drain the legacy queue with its old workers, transform and re-enqueue compatible payloads into fluo's per-job queues, or deploy separate queue names while the legacy workers drain.
- Cron migration is not a `SchedulerRegistry`/`CronJob` handle-preserving replacement. Use public instance methods for `@Cron`, `@Interval`, and `@Timeout`; move private or static scheduled work behind a public provider method; and use `SCHEDULING_REGISTRY.get(...)` / `getAll()` for `SchedulingTaskDescriptor` snapshots rather than mutating live `CronJob` handles.
- NestJS cron options also require an explicit migration. Rename `timeZone` to `timezone`. Omit `waitForCompletion` because fluo always applies scheduler-level no-overlap protection and an in-process running guard; a tick that arrives while the same task instance is running is skipped, not queued. A NestJS task that relied on `waitForCompletion: false` or the default overlapping behavior must move concurrent work to an application-owned queue or worker rather than inventing an unsupported fluo flag. This local guard does not replace Redis distributed locking across application instances.
- Email migration is not a NestJS dynamic-module shape clone. `EmailModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. `EmailModule` is global by default, so set `global: false` only when migrated code requires module-local visibility.
- Notifications migration is not a provider-discovery or decorator-metadata clone. Pass explicit `NotificationChannel` values to `NotificationsModule.forRoot(...)` or return them from `NotificationsModule.forRootAsync({ inject, useFactory, global? })`; the package does not scan NestJS providers, `@Injectable()` metadata, or emitted design types for channels.
- `@fluojs/notifications` does not create, import, close, or drain concrete queue or event-bus resources. Queue adapters and event publishers are application-owned integrations, and status snapshots report them as externally managed dependencies with `ownsResources: false`.
- `NotificationsModule` is global by default for `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS`; use `global: false` when migrated code requires module-local visibility.
- Slack migration is not a NestJS async dynamic-module or package-level multi-client registry clone. `SlackModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. Register dependencies in the application module graph before listing their tokens in `inject`, then return final Slack options from `useFactory`. `@fluojs/slack` exposes singleton compatibility tokens `SLACK` and `SLACK_CHANNEL`, mirrors that singleton wiring through `createSlackProviders(...)`, and uses `global?: boolean` with default global visibility instead of NestJS `isGlobal`.
- Discord migration is not a NestJS async dynamic-module or custom-provider clone. `DiscordModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. `@fluojs/discord` exposes singleton compatibility tokens `DISCORD` and `DISCORD_CHANNEL`, uses `global?: boolean` with default global visibility instead of NestJS `isGlobal`, and keeps internal provider helpers such as `createDiscordProviders(...)`, `DISCORD_OPTIONS`, and `NormalizedDiscordModuleOptions` private.

### Prisma Request-Wide Transaction Migration

Keep ordinary business atomicity on service `@Transaction()` methods. If a migrated controller genuinely needs one transaction around work that cannot be expressed as a single service boundary, inject the wrapper `PrismaService<TClient>`, call `requestTransaction(...)` explicitly, and forward the request cancellation signal:

```typescript
@Inject(PrismaService, CheckoutService)
@Controller('/checkout')
export class CheckoutController {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Post('/')
  checkout(input: CheckoutInput, context: RequestContext) {
    const { request } = context;
    return this.prisma.requestTransaction(
      () => this.checkoutService.checkout(input),
      request.signal,
    );
  }
}
```

Do not migrate every NestJS interceptor into this shape. Request-wide transactions can keep locks open through unrelated controller work; prefer a focused service `@Transaction()` whenever it represents the actual business unit of work.

### GraphQL Resolver Migration

GraphQL migration keeps schema and discovery wiring explicit. Register each resolver class as a provider or controller in an authored module so it is discoverable from the compiled module graph. `GraphqlModule.forRoot({ resolvers: [...] })` does not register those classes; when supplied, `resolvers` filters discovery to that allowlist. Omit `resolvers` or pass an empty list to discover every decorated resolver class already registered as a provider or controller. Neither TypeScript return types nor NestJS design metadata register providers or build output types. The current runtime supports root operations only, exposes no `GraphqlModule.forRootAsync(...)`, rejects `@Subscription({ topics })`, and requires subscription methods to return an `AsyncIterable`. HTTP and SSE use the portable HTTP path, while optional WebSocket subscriptions require a server-backed Node HTTP/S adapter with upgrade listeners.

Declare object and list outputs directly so they do not fall back to GraphQL `String`:

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { Module } from '@fluojs/core';
import { GraphqlModule, listOf, Query, Resolver } from '@fluojs/graphql';

const ProductType = new GraphQLObjectType({
  name: 'Product',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

@Resolver()
class ProductResolver {
  @Query({ outputType: ProductType })
  async product() {
    return productService.findFeatured();
  }

  @Query({ outputType: listOf(ProductType) })
  async products() {
    return productService.findAll();
  }
}

@Module({
  imports: [GraphqlModule.forRoot()],
  providers: [ProductResolver],
})
class AppModule {}
```

### Microservices Transport Migration

Split NestJS `ClientProxy` migration into registration, facade, adapter, and infrastructure ownership instead of treating it as one opaque client object.

- Register the selected adapter with root `MicroservicesModule.forRoot({ transport })`.
- Inject root `MICROSERVICE` as `Microservice` for `listen()`, `send()`, `emit()`, and `close()`. The token resolves the lifecycle facade, not the raw adapter.
- Import transport implementations from their explicit subpaths when possible: `@fluojs/microservices/nats`, `@fluojs/microservices/kafka`, and `@fluojs/microservices/rabbitmq`. `RedisStreamsMicroserviceTransport` remains the documented root-barrel-only exception.
- `await microservice.send(...)` waits for the correlated remote response or rejects for a remote error, abort, timeout, or shutdown.
- `await microservice.emit(...)` waits only for the outbound transport publish operation. It does not prove that a remote event handler ran; any broker acknowledgement is limited to what the caller-provided publish collaborator itself promises.
- `await microservice.close()` waits for transport listener/subscription teardown and pending-request cleanup. NATS, Kafka, and RabbitMQ adapters detach from caller-provided collaborators but do not close or disconnect those clients, producers, consumers, publishers, channels, or connections.

Kafka and RabbitMQ keep inbound consumer callbacks pending until handler execution and any request response publication settle, so the broker adapter can choose acknowledgement or retry. That consumer-side boundary remains separate from the producer-side `emit()` promise. During shutdown, close the `Microservice` facade first, then close or drain caller-owned broker resources from the application bootstrap layer.

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
- Assuming the deprecated Mongoose compatibility interceptor or implicit connection ownership should become the primary migration target. fluo keeps connection ownership application-side and prefers service `@Transaction()` plus explicit `requestTransaction(...)` boundaries.
- Assuming NestJS `@SubscribeMessage()`, `@MessageBody()`, `@ConnectedSocket()`, or implicit gateway server injection exists in fluo websocket gateways.
- Assuming Socket.IO gateway return values become implicit client replies. fluo requires explicit ACK callbacks or raw `SOCKETIO_SERVER` emits.
- Assuming NestJS-style Redis async module factories or shared Pub/Sub command/subscriber clients carry over. fluo keeps Redis registration synchronous and requires dedicated subscriber ownership for Pub/Sub connections.
- Assuming `@nestjs/cqrs` reflection discovery, controller handlers, writable execution contexts, or direct shutdown bypass options carry over. fluo uses singleton provider-only discovery, opaque private dispatch state, and internally authorized active-pipeline drain.
- Assuming NestJS/Bull processor decorators, emitted metadata, request/transient worker scopes, or existing queue persistence compatibility carry over. fluo requires explicit singleton `@QueueWorker(JobClass)` registration and an application-owned `queueName`/named job/`jobName` payload cutover that drains, transforms and re-enqueues, or isolates legacy work on separate queue names.
- Passing raw Express/Connect middleware directly to fluo application middleware. fluo middleware receives `MiddlewareContext`, so native `(req, res, next)` functions need an explicit wrapper or the platform-owned `createExpressAdapter({ nativeMiddleware })` boundary.
- Assuming NestJS HTTP adapter lifecycle hooks map to Bun by mutating a live server after startup. `@fluojs/platform-bun` binds the dispatcher and realtime seam before `listen()` starts, keeps duplicate `listen()` calls idempotent, and exposes synchronous `createBunFetchHandler(...)` for externally owned `Bun.serve(...)` hosts rather than NestJS-style late host mutation. Those manual hosts own shutdown, websocket upgrades, and native `routes` acceleration themselves.
- Assuming NestJS HTTP or WebSocket server ownership carries over to Cloudflare Workers. Export the Worker `fetch(request, env, ctx)` entrypoint, treat `listen()` as a socketless dispatcher-binding boundary, import `CloudflareWorkersWebSocketModule.forRoot()` before bootstrap so WebSocket ownership is frozen before listen, and map request `env` bindings into explicit application providers or `@fluojs/config`. The adapter registers accepted HTTP, SSE, and WebSocket lifecycle work with `ctx.waitUntil(...)`; it does not expose a live server for post-listen mutation.
- Assuming NestJS `SchedulerRegistry` returns mutable `CronJob` handles or that private scheduled methods are valid decorator targets. fluo exposes descriptor-based scheduling controls and requires scheduled decorators on public instance methods.
- Assuming `EmailModule.forRootAsync(...)` accepts NestJS `imports`, `useClass`, or `useExisting`, or assuming email providers are module-local by default. fluo email uses injected factory registration and defaults to global visibility unless `global: false` is set.
- Assuming notification channels are discovered from NestJS provider decorators/metadata, or assuming queue/event-bus resources are owned by the notifications module. fluo requires explicit `channels` and application-owned queue adapter/event publisher lifecycles.
- Assuming `SlackModule.forRootAsync(...)` accepts NestJS `imports`, `useClass`, or `useExisting`, or that Slack exposes a package-level multi-client registry or a NestJS `isGlobal` option. fluo Slack uses injected factory registration, singleton `SLACK` / `SLACK_CHANNEL` tokens, `createSlackProviders(...)` for the same singleton provider wiring, and `global?: boolean` for the default-global module visibility opt-out.
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
- [CQRS Contract](../architecture/cqrs.md)
- [fluo new Support Matrix](../reference/fluo-new-support-matrix.md)
