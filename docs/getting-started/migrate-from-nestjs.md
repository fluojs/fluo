# NestJS → fluo Migration Map

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>

Use this document as a migration contract map. Each row identifies the closest allowed fluo target for a NestJS construct, and each rule below marks the places where the migration is not one-to-one.

## Executable JWT learning path

For the complete Chapter 14 path, import `ConfigModule.forRoot()` and the global `AuthPersistenceModule` before `JwtModule.forRootAsync(...)`. `AuthPersistenceModule` exports the durable `REFRESH_TOKEN_STORE` and `CREDENTIALS_VERIFIER` tokens, while `AuthModule` registers `AuthService` in `providers` and `AuthController` in `controllers`. This is application-graph wiring, not NestJS dynamic-module configuration; follow [`book/beginner/ch14-jwt.md`](../../book/beginner/ch14-jwt.md) for the complete executable module.

## Decorator metadata preload ordering

Fluo's built-in decorators store their runtime records in framework-owned stores and do not require import-time global mutation. A migrated custom standard decorator that reads `context.metadata` is different, as are `@fluojs/serialization` decorators: their decorated classes need `Symbol.metadata` while the class module is being evaluated.

Do not statically import the decorated application graph and then call `ensureMetadataSymbol()` in the same bootstrap module. ESM evaluates static dependencies before the bootstrap module body, so that call is too late. Use a preload entrypoint that installs the symbol before dynamically importing the ordinary bootstrap graph:

```ts
// preload.ts — configure this as the application entrypoint
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
await import('./bootstrap.js');
```

## API Correspondence Table

Apply the fluo construct in the second column, not the NestJS source pattern, when migrating production code.

| NestJS construct | fluo construct | Notes |
| --- | --- | --- |
| `@Module({ imports, controllers, providers, exports })` | `@Module({ imports, controllers, providers, exports })` from `@fluojs/core` | Module boundaries and explicit exports remain the primary composition unit. |
| `forwardRef(() => OtherModule)` in a Module `imports` array | no direct replacement; extract shared Providers into a third Module or package | fluo rejects circular Module imports during Module Graph compilation. `forwardRef(...)` is only a dependency-Token wrapper for class-level `@Inject(...)` lists and Provider `inject` arrays; it does not make Module or true constructor cycles resolvable. |
| `@Controller('/users')` | `@Controller('/users')` from `@fluojs/http` | Controller decoration is part of the HTTP package, not the core package. |
| `@Get()`, `@Post()`, other route decorators | `@Get()`, `@Post()`, other route decorators from `@fluojs/http` | HTTP route decoration remains method-based. |
| `@Sse()` | `@Sse()` from `@fluojs/http` with `SseResponse` for manual streams or `AsyncIterable` for managed streams | fluo maps `@Sse()` to a `GET` route with `text/event-stream` metadata. It can convert `AsyncIterable` values into SSE frames, while NestJS `Observable` return values must still be rewritten to `SseResponse` or an async iterable. |
| `ClassSerializerInterceptor` with returned DTOs, `@Res()`, or passthrough/manual response writes | `SerializerInterceptor` from `@fluojs/serialization` for framework-managed return values; `RequestContext.response` for explicit handler ownership | Returned values are serialized only while the response is uncommitted. After `send(...)`, `redirect(...)`, or a manual stream commits the response, `SerializerInterceptor` returns the value it received from `next.handle()` unchanged instead of serializing it. Other interceptors may still transform the chain result, while the dispatcher skips a second success-response write. |
| `class-transformer` `@Expose()`, `@Exclude()`, and `@Transform()` | `@Expose()`, `@Exclude()`, and `@Transform()` from `@fluojs/serialization` | Replace the decorators as well as the interceptor. The fluo transform callback is synchronous and receives only the field value; calculate multi-field output before assigning the DTO field. Base metadata is inherited, but child overrides remain isolated from base and sibling DTOs. |
| `NestFactory.create(AppModule)` | `FluoFactory.create(AppModule, { adapter })` from `@fluojs/runtime` | HTTP listening requires an explicit platform adapter such as `createFastifyAdapter()`. `FluoFactory.create(AppModule)` can still build an adapterless application shell, but that shell cannot call `listen()`. |
| NestJS `beforeApplicationShutdown(signal?)` | no direct replacement; use `onModuleDestroy()` or `onApplicationShutdown(signal?)` from `@fluojs/runtime` | `beforeApplicationShutdown` is unsupported. Put shutdown preparation in `onModuleDestroy()` when it belongs before the application-wide signal phase, or in `onApplicationShutdown(signal?)` when cleanup needs the signal. fluo provides no compatibility shim or additional runtime hook. |
| `@nestjs/config` `ConfigModule.forRoot(...)`, `forRootAsync(...)`, `load`, `validate`, and `isGlobal` | `ConfigModule.forRoot({ processEnv, schema, global? })` from `@fluojs/config` | fluo registration is synchronous: pass an explicit `processEnv` snapshot, use a synchronous Standard Schema validator, and use `global?: boolean` (`true` by default) for visibility. Resolve async factories before module registration, preserve their nested objects for deep merging and dot-path access, and share one validated snapshot with both `ConfigModule` and any HTTP adapter inputs. `ConfigService.get(key)` and `getOrThrow(key)` accept a single key only; NestJS default-value and options overloads such as `get(key, defaultValue)` or `get(key, { infer: true })` have no fluo counterpart. Own defaults in `defaults` or the `schema` output, or apply an explicit call-site `??` fallback to the `get(key)` result. |
| `@nestjs/passport` `PassportModule.register(...)`, `PassportStrategy(...)`, named `AuthGuard(...)`, sessions, and serializers | `createPassportJsStrategyBridge(...)`, `PassportModule.forRoot(...)`, explicit bridge providers/named registration, and `mapPrincipal(...)` from `@fluojs/passport` | Adapt one explicitly provided Passport.js strategy at a time. Register `bridge.providers`, pass `bridge.strategy` to the fluo registry, and map the Passport user to a fluo principal. Middleware, sessions, serializers/deserializers, strategy discovery, and host integration remain outside the bridge. |
| NestJS JWT async registration with dynamic-module `imports`, `useClass`, `useExisting`, or provider discovery | `JwtModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/jwt` | `JwtModule.forRootAsync(...)` requires dependencies named by `inject` to be registered in the application module graph before its JWT options provider resolves, and `useFactory` returns the final `JwtVerifierOptions`. The top-level `global?` controls returned module visibility and is distinct from the final `JwtVerifierOptions` returned by `useFactory`. NestJS `imports`, `useClass`, and `useExisting` are not part of the supported typed configuration and have no dynamic-module semantics; extra JavaScript object properties are unread at runtime, not validated or rejected. For `JwtModule.forRootAsync(...)`, dependencies must come from a globally visible module export or bootstrap runtime providers in the application graph that `JwtRuntimeModule` can resolve. An ordinary sibling or parent module export alone, and a provider local only to a parent module's providers, are not visible to the JWT options provider. `JwtModule.forRootAsync(...)` performs no implicit module or provider discovery. When using asymmetric access tokens with HMAC refresh tokens, configure `refreshToken.algorithms` explicitly; do not add HS algorithms to the access-token list solely for refresh tokens. |
| NestJS `JwtService.signAsync()` / `verifyAsync()` or synchronous-looking `sign()` / `verify()` migration | `await JwtService.sign(...)` and `await JwtService.verify(...)` from `@fluojs/jwt` | fluo exposes Promise-returning `sign()` and `verify()` directly; it has no `signAsync()` or `verifyAsync()` aliases. Do not pass either unresolved Promise as a token or claims object. `decode()` remains synchronous, but it only parses unverified input and must never make an authorization decision. Follow the complete [JWT refresh learning path](../../book/beginner/ch14-jwt.md#145-refresh-token-rotation) for durable storage, rotation, and endpoint wiring. |
| NestJS HTTP server lifecycle hooks or late WebSocket server mutation when moving to Cloudflare Workers | `@fluojs/platform-cloudflare-workers` plus `CloudflareWorkersWebSocketModule.forRoot()` from `@fluojs/websockets/cloudflare-workers` | Workers expose a host-owned `fetch(request, env, ctx)` boundary rather than a server socket. `listen()` only binds the fluo dispatcher; register the Worker WebSocket module in the application graph so bootstrap configures its binding before that listen boundary. Each accepted request is tracked through `ctx.waitUntil(...)`. Bootstrap receives only the predeclared root module and options; request `env` is attached during dispatch, so it cannot supply `ConfigModule.forRoot(...)` or singleton bootstrap providers. Keep independently available pre-registration values in bootstrap configuration. Read, validate, and narrow selected fetch-time bindings from `RequestContext`, then pass application-shaped values into provider methods. |
| `@Injectable()` provider marker | provider class or provider definition listed in `@Module(...).providers` | fluo does not use `@Injectable()` as a required provider registration step. |
| constructor type reflection via `emitDecoratorMetadata` | `@Inject(TokenA, TokenB)` from `@fluojs/core` | Constructor dependencies are declared explicitly in decorator argument order. |
| property injection such as `@Inject(TOKEN) private value` | class-level `@Inject(TOKEN)` plus a matching constructor parameter | fluo's `@Inject(...)` is a standard class Decorator that declares constructor Tokens in parameter order. It is not a property or constructor-parameter Decorator. |
| `class-validator` / decorator-driven DTO validation | `@fluojs/validation` with Standard Schema support, including Zod and Valibot | This is a fluo-native validation surface, not class-validator compatibility. Ordinary validators skip `null` / `undefined`, requiredness uses `@IsDefined()`, plain-object materialization retains safe own enumerable extra properties, and validation groups are unsupported. |
| `@ValidateNested()` plus class-transformer `@Type(() => ChildDto)` | `@ValidateNested(() => ChildDto)` from `@fluojs/validation` | The nested DTO target is an explicit decorator argument. Remove `@Type(...)` and the class-transformer import; fluo does not consume class-transformer metadata or reflected design types. |
| `nestjs-i18n` `I18nModule.forRoot(...)`, request locale resolvers, request-scoped `I18nContext`, and localized validation filters | `I18nModule.forRoot(...)` from `@fluojs/i18n`; `createAcceptLanguageLocaleResolver(...)`, `resolveHttpLocale(...)`, and `getHttpLocale(...)` from `@fluojs/i18n/http`; `localizeDtoValidationError(...)` from `@fluojs/i18n/validation` | Resolve asynchronous catalog and configuration inputs before the synchronous root registration described below. Then resolve and store each locale at an application-owned request boundary and pass it explicitly to translation and validation localization. fluo does not discover NestJS resolver classes or expose an implicit request-locale global. |
| `SwaggerModule.createDocument(...)` and `SwaggerModule.setup(...)` | `OpenApiModule.forRoot({ title, version, sources, descriptors, documentPath, ui, uiPath, swaggerUiAssets })` from `@fluojs/openapi` | OpenAPI adoption is explicit: list every documented controller in `sources`, pass prebuilt HTTP handler mappings in `descriptors`, or use both. fluo does not scan the application module graph for controllers. `documentPath` and `uiPath` default to `/openapi.json` and `/docs`; assign distinct values to each module instance when serving multiple documents. Swagger UI serves only when `ui: true`, and `swaggerUiAssets` can replace the default CSS and JavaScript URLs. Normalized runtime route collisions fail bootstrap with `RouteConflictError`. |
| `@nestjs/graphql` resolver discovery, reflected return types, parameter decorators, and `forRootAsync(...)` | `GraphqlModule.forRoot(...)`, module providers/controllers, `@Resolver`, root operation decorators, `@FieldResolver`, `@Args`, `@Parent`, `@Context`, and `listOf(...)` from `@fluojs/graphql` | Register resolver classes as providers or controllers in compiled modules. The `resolvers` option is an optional allowlist/filter over those discoverable classes; omitting it or passing an empty list allows every decorated registered candidate. fluo does not infer providers or GraphQL output types from metadata. Object results require `outputType`, arrays require `outputType: listOf(ItemType)`, and omitted output types use GraphQL `String`. Object fields attach to a named code-first output type through `@Resolver('TypeName')`. Because TC39 standard decorators do not support parameter decorators, place `@Args(index?)`, `@Parent(index?)`, and `@Context(index?)` on the field resolver method with distinct indexes. Code-first field argument DTO binding is supported through `@FieldResolver({ input: InputDto })`, optional `argTypes`, and `@Args(index?)`; `input` and `@Args()` require each other and are invalid on root operations. There is no `forRootAsync(...)`, schema-first field-resolver attachment, or `@Subscription({ topics })` contract. Optional WebSocket subscriptions require a server-backed Node HTTP/S adapter. |
| Controller parameter decorators such as `@Param()`, `@Query()`, `@Body()`, `@Headers()`, `@Req()`, and `@Res()`, plus `Pipe` / `ValidationPipe` transformation | `@RequestDto(...)` with field-level `@FromPath(...)`, `@FromQuery(...)`, `@FromBody(...)`, `@FromHeader(...)`, `@FromCookie(...)`, and `@Convert(...)` from `@fluojs/http`; a `RequestContext` handler parameter for advanced request/response access | fluo does not expose NestJS-style controller parameter decorators or a public parameter Pipe stage. Bind one request DTO, declare each field source, use `@Convert(...)` for number/boolean/date/domain conversion, then validate the materialized DTO with the validation package. |
| `createApplicationContext()` standalone bootstrap | `FluoFactory.createApplicationContext(AppModule)` | Standalone application context exists in `@fluojs/runtime`. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `createTestingModule({ rootModule }).overrideModule(...)` from `@fluojs/testing` | fluo testing uses an explicit `rootModule` and replacement compile seam so tests preserve authored module identity without mutating module metadata globally. |
| NestJS request transaction interceptor | Service `@Transaction()` from the persistence package, or explicit `requestTransaction(...)` at the controller/request boundary | `PrismaTransactionInterceptor` and `MongooseTransactionInterceptor` remain deprecated 1.x compatibility bridges for existing imports. New code should keep business transactions on services and use explicit `requestTransaction(...)` only when the entire request must share one boundary, forwarding `RequestContext.request.signal` when available. Drizzle has no compatibility interceptor export. |
| `@HealthCheck()` controller method with `HealthCheckService.check([...])` | `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` from `@fluojs/terminus` | Module-level registration is the primary API so runtime `/health` and `/ready` routes include indicator and platform diagnostics consistently. |
| NestJS Terminus memory/disk or Redis checks | `@fluojs/terminus/node` and `@fluojs/terminus/redis` | Node.js memory/disk helpers and Redis helpers live on dedicated subpaths. The root package does not make Redis peers or Node filesystem access part of the default import boundary. |
| `@nestjs/throttler` global throttler setup | `ThrottlerModule.forRoot(...)` plus explicit `@UseGuards(ThrottlerGuard)` from `@fluojs/throttler` / `@fluojs/http` | Module registration provides the policy and guard provider; route enforcement starts only where the guard is attached. |
| `@WebSocketGateway()` with `@SubscribeMessage()` and parameter decorators | `@WebSocketGateway()` with `@OnMessage(event?)`, positional handler arguments, and optional `WebSocketRoomService` from `@fluojs/websockets` | fluo websocket handlers receive `(payload, socket, request, socketId)` directly. The stable `socketId` can be passed to `WebSocketRoomService`. There are no Nest-style `@MessageBody()`, `@ConnectedSocket()`, or `@SubscribeMessage()` parameter/decorator rewrites. |
| NestJS Socket.IO gateway return values, gateway `path`, scoped providers, or `@WebSocketServer()` | `@fluojs/socket.io` plus `@fluojs/websockets` decorators with `@OnMessage(...)`, explicit acknowledgement callbacks, singleton gateway registration, and `@Inject(SOCKETIO_SERVER)` | Socket.IO handlers do not turn return values into implicit emits or ACK replies. fluo maps `@WebSocketGateway({ path: '/chat' })` to the Socket.IO namespace `/chat`, while the Engine.IO request path stays `/socket.io/`; do not carry over a NestJS Engine.IO `path` assumption. Register migrated gateways as singleton providers/controllers because request/transient gateways are warned and skipped. `serverBacked` is unsupported for Socket.IO gateways. Install/import the websockets companion for decorators and inject `SOCKETIO_SERVER` when migrating gateway-server access, multi-room emits, or volatile delivery. |
| `@nestjs/cache-manager` / `CacheModule.register(...)` | `CacheModule.forRoot(...)`, `CacheService`, and cache decorators from `@fluojs/cache-manager` | fluo cache registration is synchronous. Prepare Redis or custom stores before module registration, inject `CacheService` for manual cache operations, and use `httpKeyStrategy` or `@CacheKey(...)` for request-aware response-cache keys. |
| `@nestjs/event-emitter` / `@OnEvent()` handlers | `EventBusModule.forRoot(...)`, `EventBusLifecycleService`, and `@OnEvent(EventClass)` from `@fluojs/event-bus` | Event routing is class-based, `static eventKey` stabilizes distributed transport channels, handlers are discovered only from singleton providers/controllers, and awaited or background publish work remains in shutdown drain tracking. A listener that throws or rejects is logged and isolated for local and inbound transport dispatch, so other matching listeners continue; that listener failure alone does not reject `publish(...)` or surface through inbound callback completion. |
| `@nestjs/cqrs` command/query/event handlers and sagas | `CqrsModule.forRoot(...)`, standard `@CommandHandler(...)`, `@QueryHandler(...)`, `@EventHandler(...)`, and `@Saga(...)` from `@fluojs/cqrs` | CQRS discovery scans singleton providers only, not controllers or emitted design metadata. Commands and queries remain point-to-point; event handlers and sagas fan out by provider token before delegated `@fluojs/event-bus` publication. |
| `ClientsModule.register(...)`, injected `ClientProxy`, and NestJS broker transport options | `MicroservicesModule.forRoot({ transport })`, `MICROSERVICE` typed as `Microservice`, and transport adapters from `@fluojs/microservices/<transport>` | Registration and the programmatic facade stay on root `@fluojs/microservices`; NATS, Kafka, and RabbitMQ collaborators remain application-owned, and `send()`, `emit()`, and `close()` have distinct completion boundaries described below. |
| NestJS `@MessagePattern(...)` / `@EventPattern(...)` handler discovery and provider metadata | TC39 standard pattern decorators from `@fluojs/microservices` plus explicit module `providers` or `controllers` registration | fluo discovers decorated public instance methods only on classes registered in the compiled module graph. It does not scan NestJS metadata, `reflect-metadata`, or emitted design types. |
| NestJS Redis async module registration or shared Redis Pub/Sub clients | `RedisModule.forRoot(...)`, named `RedisModule.forRoot({ name, ... })`, and `getRedisClientToken(name)` from `@fluojs/redis` | fluo Redis registration is synchronous and each `forRoot(...)` call creates a client from final options. Resolve environment-specific options before registration; do not pass or expect the module to adopt an externally created client. Keep Pub/Sub subscribers on a dedicated duplicate or named client instead of reusing the ordinary command client. |
| `@nestjs/bull` / `@nestjs/bullmq` processor discovery through `@Processor(...)`, `@Process(...)`, or provider metadata | `RedisModule.forRoot(...)`, `QueueModule.forRoot(...)`, singleton `@QueueWorker(JobClass, options?)` providers, and explicit `@Inject(...)` from `@fluojs/queue`, `@fluojs/redis`, and `@fluojs/core` | fluo discovers only decorated singleton providers/controllers in the compiled module graph. Workers expose `handle(job)`; Queue does not read NestJS metadata or automatically preserve a legacy Bull/BullMQ `queueName`, named job, persisted payload, or their topology. |
| `@nestjs/schedule` decorators, `SchedulerRegistry`, or `CronJob` handles | `CronModule.forRoot(...)`, public-method `@Cron` / `@Interval` / `@Timeout`, and `SCHEDULING_REGISTRY` from `@fluojs/cron` | Rename NestJS `timeZone` to fluo `timezone`. Do not carry `waitForCompletion`: fluo has no such option and always skips a tick when the same task instance is still running. fluo starts decorator-discovered tasks during application bootstrap, starts dynamic registry tasks when added to a started registry, and exposes read-only task descriptors instead of live scheduler handles. |
| NestJS-style email async module registration with `imports`, `useClass`, or `useExisting` | `EmailModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/email` | fluo email async registration supports injected factory options only. Register dependencies in the application module graph first, list tokens in `inject`, and set `global: false` only when opting out of the default global provider visibility. |
| NestJS-style notification modules, decorator-discovered channel providers, or implicit queue/event integrations | `NotificationsModule.forRoot({ channels, queue?, events?, global? })` or `NotificationsModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/notifications` | fluo notifications registration uses explicit `NotificationChannel` values passed in `channels`. Queue adapters and event publishers are application-owned seams, not module-owned resources, and `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS` are global by default unless `global: false` is set. |
| NestJS Slack modules that assume `imports`, `useClass`, `useExisting`, a package-level multi-client registry, or `isGlobal` | `SlackModule.forRoot({ ..., global? })` or `SlackModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/slack` | fluo Slack async registration consumes injected factory options only. Register dependencies in the application module graph first, list their tokens in `inject`, return final Slack options from `useFactory`, and compose app-owned modules/providers or facades for multiple clients. |
| NestJS Discord modules that assume `imports`, `useClass`, `useExisting`, `isGlobal`, or custom internal provider tokens | `DiscordModule.forRoot({ ..., global? })` or `DiscordModule.forRootAsync({ inject, useFactory, global? })` from `@fluojs/discord` | fluo Discord registration is singleton-oriented and injected-factory-only for async setup. The package exports `DiscordService`, `DiscordChannel`, `DISCORD`, and `DISCORD_CHANNEL` globally by default unless `global: false` is set; internal provider helpers and option tokens are intentionally private. |

## GraphQL Field Resolver DTO Arguments

The prior migration limitation for field argument DTO binding is superseded for code-first object fields. Put GraphQL argument fields on an `InputDto` with `@Arg(...)`, pass it through `@FieldResolver({ input: InputDto })`, and bind the materialized, validated DTO with `@Args(index?)`. `@Args()`, `@Parent()`, and `@Context()` are TC39 method decorators, so every binding must use a distinct zero-based method index; duplicate indexes fail during decorator evaluation. Bootstrap rejects `input` without `@Args()`, `@Args()` without `input`, and every one of these bindings on root operations. Request-scoped root and field resolvers share one HTTP or subscription operation container. Schema-first field-resolver attachment remains unsupported.

### Field Resolver DTO Limitation

Code-first `@FieldResolver({ input: InputDto })` with `@Args(index?)` is supported. The remaining limitation is schema-first field-resolver attachment only.

## Breaking Differences

- Decorators MUST follow the TC39 standard model. NestJS legacy decorator assumptions do not carry over.
- Dependency injection is NEVER inferred from constructor types. fluo requires explicit `@Inject(...)` declarations for constructor dependencies.
- NestJS property injection MUST become constructor injection. Put `@Inject(TokenA, TokenB)` on the class and keep its Token order aligned with the constructor parameters; do not attach `@Inject(...)` to properties or parameters.
- NestJS Module `forwardRef(...)` has no fluo equivalent. Break Module import cycles by extracting shared Providers into a separate Module or package. fluo's `forwardRef(...)` only defers lookup for one dependency Token in class-level `@Inject(...)` or Provider `inject`; it does not resolve Module cycles or true constructor cycles.
- HTTP listening is adapter-first. `FluoFactory.create(...)` does not select a platform implicitly: it may build an adapterless application shell, but `listen()` requires an application created with an explicit adapter.
- NestJS `beforeApplicationShutdown` is unsupported and does not add a phase between fluo's documented shutdown hooks. Move preparation to `onModuleDestroy()` when it must precede application-wide signal cleanup, or to `onApplicationShutdown(signal?)` when it needs the signal. Do not introduce a compatibility shim, fallback, alias, or new runtime hook; the four-hook contract and its startup/shutdown ordering remain unchanged.
- `@nestjs/config` migration is not an async Dynamic Module or namespace-loader clone. `@fluojs/config` exposes synchronous `ConfigModule.forRoot(...)`; pass ambient process values through the explicit `processEnv` option, validate the merged snapshot with a synchronous Standard Schema `schema`, and use `global?: boolean` with default global visibility instead of NestJS `isGlobal`. Await remote secrets and NestJS `load` factories at the application bootstrap boundary before module graph construction, but preserve their nested objects in `defaults` or `runtimeOverrides`; plain objects deep-merge and remain available through dot-path `ConfigService` lookups.
- Configuration can be resolved in `FluoFactory.create(AppModule)` or `FluoFactory.createApplicationContext(AppModule)` without an HTTP adapter. Only `listen()` has the adapter requirement. When an adapter option such as `port` comes from configuration, prepare one validated snapshot before HTTP application creation, register that same snapshot with `ConfigModule`, and construct the adapter from it. `app.listen(port)` does not select a platform or port.
- Validation MUST be migrated to the Standard Schema direction instead of keeping a `class-validator`-first contract.
- Nested DTO validation MUST name its target explicitly with `@ValidateNested(() => ChildDto)`. fluo does not consume class-transformer `@Type(...)`, `reflect-metadata`, or emitted design metadata to infer nested constructors.
- NestJS controller parameter decorators, Pipe, and `ValidationPipe` migration are not parameter-for-parameter replacements. Replace `@Param()`, `@Query()`, `@Body()`, `@Headers()`, `@Req()`, and `@Res()` assumptions with one `@RequestDto(...)`, field-level source decorators, `@Convert(...)`, and an explicit `RequestContext` handler parameter when low-level access is necessary. Validation runs after DTO materialization instead of through a public controller-parameter Pipe stage.
- Do not expect `ClassSerializerInterceptor`-style post-processing after taking direct response ownership. Return DTOs without committing the response when `SerializerInterceptor` should shape them. If migrated code calls `RequestContext.response.send(...)`, `redirect(...)`, or a manual streaming helper, it must produce the final safe payload before that commit. Afterward, `SerializerInterceptor` bypasses serialization and returns the value it received from `next.handle()` unchanged; other interceptors may still transform the chain result. The dispatcher independently skips a second success-response write.
- Do not carry over `ValidationPipe` whitelist/forbid assumptions or class-validator group execution. Ordinary fluo validators skip `null` and `undefined`, so add `@IsDefined()` for required fields. When its input is a plain object, `materialize()` retains safe own enumerable extra properties rather than stripping or rejecting them; this filtering guarantee does not describe already-created DTO instances. Decorator options do not support `groups` or `always`. Use explicit input shaping and separate DTOs, mapped DTOs, `@ValidateIf(...)`, or class-level validators for workflow-specific rules.
- NestJS i18n request-scoped context and resolver discovery do not carry over. Run `resolveHttpLocale(...)` with an ordered resolver list at an application-owned request boundary, read only the metadata stored on that `RequestContext` with `getHttpLocale(...)`, and pass its `locale` to each `I18nService` or `localizeDtoValidationError(...)` call. The validation helper does not read request state or a global locale implicitly.
- NestJS Passport migration is not full NestJS Passport compatibility. The Passport.js bridge adapts one explicitly registered strategy execution to fluo `AuthStrategy`; it does not install Passport middleware, sessions, serializers/deserializers, or automatic strategy discovery. It adds no implicit guards, request augmentation beyond the documented `requestContext.principal` mapping, or host middleware ownership. Session and serializer/deserializer migration remains application-owned.
- NestJS JWT async registration is not a dynamic-module shape clone. `JwtModule.forRootAsync({ inject, useFactory, global? })` requires every injected dependency to be registered in the application module graph first, and `useFactory` must return the final `JwtVerifierOptions`. The top-level `global?` controls returned module visibility and is distinct from the final `JwtVerifierOptions` returned by `useFactory`. NestJS `imports`, `useClass`, and `useExisting` are not part of the supported typed configuration and have no dynamic-module semantics; extra JavaScript object properties are unread at runtime, not validated or rejected. For `JwtModule.forRootAsync(...)`, dependencies must come from a globally visible module export or bootstrap runtime providers in the application graph that `JwtRuntimeModule` can resolve. An ordinary sibling or parent module export alone, and a provider local only to `AuthModule.providers`, are not visible to the JWT options provider. `JwtModule.forRootAsync(...)` performs no implicit module or provider discovery. When using asymmetric access tokens with HMAC refresh tokens, configure `refreshToken.algorithms` explicitly; do not add HS algorithms to the access-token list solely for refresh tokens.
- NestJS JWT method names do not preserve a synchronous boundary. fluo's `JwtService.sign(...)` and `JwtService.verify(...)` always return Promises, so every migrated call must use `await`; `signAsync()` and `verifyAsync()` aliases do not exist. `JwtService.decode(...)` is synchronous only because it parses without signature or claim verification. Treat every decoded value as attacker-controlled until `verify(...)` succeeds, and use the [JWT refresh learning path](../../book/beginner/ch14-jwt.md#145-refresh-token-rotation) when migrating refresh endpoints.
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
- `@nestjs/throttler` TTL values are milliseconds, while `@fluojs/throttler` `ttl` values are seconds. Convert the unit explicitly: `ttl: 60_000` in NestJS becomes `ttl: 60` in fluo. Copying the value directly changes a one-minute window into a 1,000-minute window.
- NestJS named skip metadata can use a method-level `false` value to reactivate throttling below a skipped class. fluo `@SkipThrottle()` has no argument and class- and method-level skips combine additively, so a skipped class cannot be reactivated on one method. Restructure the controller so the protected method is outside the skipped class, or use an application-owned guard wrapper when that policy is required.
- NestJS `ThrottlerModule.forRootAsync(...)` dynamic-module shapes are unsupported. Resolve async secrets, configuration, and store preparation at the application bootstrap boundary, then pass final synchronous options to `ThrottlerModule.forRoot(...)`.
- `ThrottlerGuard` and `keyGenerator` consume the HTTP `GuardContext` and `MiddlewareContext`; they are not WebSocket, GraphQL, RPC, or queue transport policies. Move equivalent limits to transport-owned guards or middleware at each of those boundaries.
- Do not assume persisted NestJS throttle windows continue in fluo. The packages use different bucket keys and storage call contracts, so the default migration starts a new window. When continuity is required, provide an application-owned compatibility store or use a bounded cutover that permits the existing windows to expire.
- `@fluojs/platform-express` requires Node.js `>=20.19.3 <21 || >=22.2.0 <27` and preserves Express only as the host engine. This bounded range excludes Node 21, Node 22 before 22.2.0, and unverified Node 27+ to keep listener-level RFC `QUERY` ingress truthful. Before replacing a NestJS HTTP adapter, migrate controllers and providers to TC39 standard decorators, declare constructor tokens with class-level `@Inject(...)`, and use explicit module/provider registration. Keep `experimentalDecorators` and `emitDecoratorMetadata` disabled; changing the HTTP host does not preserve NestJS decorator, reflection metadata, or implicit dependency-discovery semantics.
- `@fluojs/platform-express` is not an implicit middleware translation layer. The adapter constructs and owns its Express application; adopting or reusing an existing Express application is unsupported. Native Express/Connect `(req, res, next)` middleware from a NestJS or Express migration must be supplied through the adapter's explicit `nativeMiddleware` option at construction time, which runs in array order before Express routing and fluo dispatch. After bootstrap, calling `use(...)` to append to the native stack is not a supported surface. A handler that calls `next()` continues into fluo; a handler that ends the response does not. Native failures stay in the Express error chain, and native middleware resources remain application-owned. Prefer rewriting portable behavior as fluo `Middleware` before it enters `fluoFactory.create({ middleware })`.
- Forwarded client IP headers are ignored unless `trustProxyHeaders: true` is set behind a trusted proxy that overwrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`.
- The guaranteed throttled response metadata is HTTP `429` with `Retry-After`; add any extra rate-limit headers or body shape at the application boundary.
- WebSocket migration is not a decorator-for-decorator replacement. Use `@OnMessage(event?)` from `@fluojs/websockets`, read handler inputs positionally as `(payload, socket, request, socketId)`, and use `WebSocketRoomService` for room membership or broadcasts instead of assuming NestJS gateway server injection or parameter decorators carry over. `WebSocketRoomService` is a type-only contract implemented by the runtime lifecycle service; inject the lifecycle service token with `@Inject(...)` (root entrypoint: `WebSocketGatewayLifecycleService`; explicit Node subpath: `NodeWebSocketGatewayLifecycleService`; other runtime subpaths: the matching `*WebSocketGatewayLifecycleService`) and type the constructor parameter as `WebSocketRoomService`. The root `@fluojs/websockets` and `@fluojs/websockets/node` module paths are the Node.js defaults with `IncomingMessage` upgrade guards; Bun, Deno, and Cloudflare Workers migrations should import from `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, or `@fluojs/websockets/cloudflare-workers` so guard/request types and runtime lifecycle services stay at the correct subpath boundary. Room broadcast backpressure is applied only by the Node.js-backed adapter; the fetch-style runtimes do not apply a backpressure policy to room broadcasts. Raw WebSocket gateway return values are awaited and then ignored by default; send replies explicitly with the runtime socket argument, or opt into valid `{ event, data? }` return replies with `WebSocketModule.forRoot({ replies: { mode: 'event-envelope' } })`.
- Socket.IO migration keeps the same explicit websocket handler model. Install `@fluojs/websockets` because `@fluojs/socket.io` reuses its `@WebSocketGateway`, `@OnMessage`, and lifecycle decorators. A handler return value is awaited and then ignored; call the provided ACK callback when a client expects an acknowledgement, or inject `SOCKETIO_SERVER` from `@fluojs/socket.io` for native Socket.IO emits, multi-room fan-out, `.volatile`, and `@WebSocketServer()` replacement code. The package targets Node.js `>=20.19.3 <21 || >=22.2.0 <27` server-backed adapters and the official Bun engine path; Deno and Workers are unsupported, Bun requires static CORS shapes, and every runtime rejects `@WebSocketGateway({ serverBacked })`. `@WebSocketGateway({ path })` selects a Socket.IO namespace rather than the fixed `/socket.io/` Engine.IO request path, and migrated gateways must be singleton providers/controllers because request/transient registrations are warned and skipped.
- Cache-manager migration is not an async dynamic-module replacement. `@fluojs/cache-manager` exposes synchronous `CacheModule.forRoot(...)`; configure environment-specific clients at the application boundary first, then pass final cache options such as `store`, `ttl`, `keyPrefix`, `redis.clientName`, and `httpKeyStrategy`.
- NestJS-style cache-key customization should move to fluo's documented key seams instead of subclassing the interceptor. Use a function-valued `httpKeyStrategy` for an application-wide request-aware policy, or `@CacheKey(...)` with a literal key or key factory for handler-local behavior.
- Custom cache tooling should read exported cache metadata helpers such as `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, and `getCacheEvictMetadata(...)` rather than reimplementing private metadata keys.
- Event-bus migration is class-based rather than string-pattern based. Use `@OnEvent(EventClass)`, keep retryable or slow side effects idempotent, and move long-running/retry-heavy work to an explicit queue handoff instead of hiding it in an awaited event handler.
- Event-bus publisher completion is not an acknowledgement that every listener succeeded. Matching local listener failures are logged and isolated, while other matching listeners continue. A local listener failure alone does not reject `publish(...)`. Inbound transport listeners follow the same isolation rule, so inbound callback completion does not surface isolated listener failures. Publisher completion does not prove that every listener succeeded. Timeout, cancellation, transport publication, bootstrap, and other publisher failures are outside this listener-failure contract. Those failures retain their own separately documented behavior.
- Use a directly declared `static eventKey` when distributed routing must survive class renames or minification. Transport publication fans out across the concrete event and inherited event channels; an inherited `eventKey` does not silently replace the subclass channel name.
- Keep `@fluojs/event-bus` for one-to-many domain-event fan-out. Use `@fluojs/cqrs` when the migration also needs point-to-point command/query routing, CQRS event-handler discovery, or sagas; its event pipeline runs local CQRS handlers and sagas before delegating final publication to `@fluojs/event-bus`.
- NestJS CQRS migration is not a reflection-driven provider scan. Register handlers and sagas as singleton providers behind `CqrsModule.forRoot(...)`; controllers are excluded from CQRS discovery, and TC39 standard decorators carry explicit class metadata without `emitDecoratorMetadata`.
- CQRS event-handler and saga fan-out follows provider-token identity. Reusing one decorated class under distinct singleton tokens creates distinct routes, while repeated discovery of the same token and event route is deduplicated. Local event handlers complete first, matching sagas complete second, and delegated `@fluojs/event-bus` publication completes last; `publishAll(...)` awaits that entire pipeline before advancing.
- Pass the optional `CqrsDispatchContext` argument through nested command, query, event, and saga dispatch unchanged. It is a frozen fieldless value whose trusted topology and shutdown-drain state remains private; do not construct, clone, inspect, or mutate it, and do not expect direct saga dispatch to opt into shutdown work.
- Redis migration is not an async dynamic-module replacement. `@fluojs/redis` exposes synchronous `RedisModule.forRoot(...)`, which creates a new client from final options rather than accepting or adopting an external client. Resolve secrets, hosts, and TLS options at the application boundary before passing them into the module; keep an external raw client outside the module and close it from application shutdown.
- Redis Pub/Sub migration must keep subscriber ownership explicit. A `client.duplicate()` subscriber is application-owned and must be connected, subscribed, and closed by the code that created it; use named `RedisModule.forRoot({ name: 'subscriber', ... })` plus `getRedisClientToken('subscriber')` when fluo should own the subscriber client's lifecycle timeouts.
- Queue migration is not a NestJS processor-discovery compatibility layer. Register Redis and `QueueModule.forRoot(...)`, replace each processor with a TC39 standard `@QueueWorker(JobClass, options?)` class that implements `handle(job)`, list it as a singleton module provider, and declare constructor tokens with `@Inject(...)`. With `global: false`, the worker and Redis provider must remain reachable through the same authored module graph as that queue registration; request/transient workers are skipped. Queue owns processor lifecycle after registration, starts processors only after the application bootstrap-ready handoff, and waits up to `workerShutdownTimeoutMs` during shutdown.
- Queue owns processor lifecycle and a different persistence identity. NestJS Bull/BullMQ can store multiple named job values under one `queueName`; fluo uses `jobName` as both its BullMQ queue name and named job for one worker/job type. Setting `jobName` alone therefore cannot preserve that legacy topology, and Queue does not consume NestJS metadata or automatically transform a persisted payload. Before producer cutover, either drain the legacy queue with its old workers, transform and re-enqueue compatible payloads into fluo's per-job queues, or deploy separate queue names while the legacy workers drain.
- Queue registration scopes isolate DI ownership but do not namespace BullMQ queue identity. Two scopes that resolve the same Redis dependency and discover the same `jobName` fail bootstrap before worker resources are created. Give migrated owners distinct `jobName` values or configure distinct named Redis registrations through `clientName`.
- Cron migration is not a `SchedulerRegistry`/`CronJob` handle-preserving replacement. Use public instance methods for `@Cron`, `@Interval`, and `@Timeout`; move private or static scheduled work behind a public provider method; and use `SCHEDULING_REGISTRY.get(...)` / `getAll()` for `SchedulingTaskDescriptor` snapshots rather than mutating live `CronJob` handles.
- NestJS cron options also require an explicit migration. Rename `timeZone` to `timezone`. Omit `waitForCompletion` because fluo always applies scheduler-level no-overlap protection and an in-process running guard; a tick that arrives while the same task instance is running is skipped, not queued. A NestJS task that relied on `waitForCompletion: false` or the default overlapping behavior must move concurrent work to an application-owned queue or worker rather than inventing an unsupported fluo flag. This local guard does not replace Redis distributed locking across application instances.
- Email migration is not a NestJS dynamic-module shape clone. `EmailModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. `EmailModule` is global by default, so set `global: false` only when migrated code requires module-local visibility.
- Notifications migration is not a provider-discovery or decorator-metadata clone. Pass explicit `NotificationChannel` values to `NotificationsModule.forRoot(...)` or return them from `NotificationsModule.forRootAsync({ inject, useFactory, global? })`; the package does not scan NestJS providers, `@Injectable()` metadata, or emitted design types for channels.
- `@fluojs/notifications` does not create, import, close, or drain concrete queue or event-bus resources. Queue adapters and event publishers are application-owned integrations, and status snapshots report them as externally managed dependencies with `ownsResources: false`.
- `NotificationsModule` is global by default for `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS`; use `global: false` when migrated code requires module-local visibility.
- Slack migration is not a NestJS async dynamic-module or package-level multi-client registry clone. `SlackModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. Register dependencies in the application module graph before listing their tokens in `inject`, then return final Slack options from `useFactory`. `@fluojs/slack` exposes singleton compatibility tokens `SLACK` and `SLACK_CHANNEL`, mirrors that singleton wiring through `createSlackProviders(...)`, and uses `global?: boolean` with default global visibility instead of NestJS `isGlobal`.
- Discord migration is not a NestJS async dynamic-module or custom-provider clone. `DiscordModule.forRootAsync(...)` accepts `inject` plus `useFactory`; it does not consume `imports`, `useClass`, or `useExisting`. `@fluojs/discord` exposes singleton compatibility tokens `DISCORD` and `DISCORD_CHANNEL`, uses `global?: boolean` with default global visibility instead of NestJS `isGlobal`, and keeps internal provider helpers such as `createDiscordProviders(...)`, `DISCORD_OPTIONS`, and `NormalizedDiscordModuleOptions` private.

### Nested DTO and Mapped Type Rewrites

NestJS commonly combines class-validator with class-transformer so reflected or transformer metadata supplies the nested constructor:

```typescript
import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';

class AddressDto {
  @IsString()
  city = '';
}

class CreateUserDto {
  @ValidateNested()
  @Type(() => AddressDto)
  address = new AddressDto();
}
```

In fluo, move that constructor into `@ValidateNested(...)` and remove class-transformer from this boundary:

```typescript
import { IsString, ValidateNested } from '@fluojs/validation';

class AddressDto {
  @IsString()
  city = '';
}

class CreateUserDto {
  @ValidateNested(() => AddressDto)
  address = new AddressDto();
}
```

`@ValidateNested(() => AddressDto)` is the runtime source of truth for materialization and recursive validation. fluo does not read `@Type(...)`, class-transformer metadata, `reflect-metadata`, or `emitDecoratorMetadata`; keep the legacy decorator compiler flags disabled. This is an explicit rewrite, not a compatibility shim.

Mapped DTO helpers also move to fluo imports:

```typescript
import {
  IntersectionType,
  OmitType,
  PartialType,
  PickType,
} from '@fluojs/validation';

class UpdateUserDto extends PartialType(CreateUserDto) {}
class PublicUserDto extends OmitType(CreateUserDto, ['address']) {}
class AddressOnlyDto extends PickType(CreateUserDto, ['address']) {}
class UserWithAuditDto extends IntersectionType(CreateUserDto, AuditDto) {}
```

All four helpers are exported from `@fluojs/validation`; `@fluojs/validation/mapped-types` is also available as the dedicated mapped-type subpath. `PickType`, `OmitType`, and `PartialType` preserve applicable field-level validation and binding metadata but intentionally do not copy base class-level validators, because a subset or optionalized DTO may no longer satisfy those validators' field assumptions. Audit and redeclare any class-level rule that is still valid on the derived DTO. `IntersectionType` preserves field-level and class-level validation from every input DTO because the intersection retains all source contracts. Do not assume NestJS mapped-type class-level metadata behavior carries over implicitly.

### NestJS Config Registration and Bootstrap Migration

Resolve asynchronous factories before the synchronous registration call, but keep their nested output intact. The example below uses `loadConfig(...)` for the documented deep-merge, explicit `processEnv`, and synchronous validation behavior, then registers that one validated snapshot and uses it for the HTTP adapter:

```typescript
import {
  ConfigModule,
  loadConfig,
  type ConfigModuleOptions,
} from '@fluojs/config';
import { Module } from '@fluojs/core';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { z } from 'zod';

async function loadNamespacedConfig() {
  return {
    database: { url: 'postgresql://localhost/fluo' },
    http: { port: 3000 },
  };
}

const ConfigSchema = z
  .object({
    database: z.object({ url: z.string().url() }),
    http: z.object({
      port: z.coerce.number().int().min(1).max(65_535),
    }),
    PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  })
  .transform(({ PORT, database, http }) => ({
    database,
    http: { ...http, port: PORT ?? http.port },
  }));

const namespacedDefaults = await loadNamespacedConfig();
const configSources = {
  defaults: namespacedDefaults,
  processEnv: { PORT: process.env.PORT },
  schema: ConfigSchema,
} satisfies ConfigModuleOptions;
const validatedConfig = ConfigSchema.parse(loadConfig(configSources));

const moduleOptions = {
  defaults: validatedConfig,
  schema: ConfigSchema,
  global: true,
} satisfies ConfigModuleOptions;

@Module({
  imports: [ConfigModule.forRoot(moduleOptions)],
})
class AppModule {}

const adapter = createFastifyAdapter({ port: validatedConfig.http.port });
const app = await FluoFactory.create(AppModule, { adapter });

await app.listen();
```

`loadConfig(...)` and `ConfigModule.forRoot(...)` do not scan ambient `process.env`; only the explicit snapshot participates in precedence. Plain nested objects from the async factory remain nested and deep-merge by key. The schema's output is the final snapshot, so injected consumers can read the same port with `ConfigService.get('http.port')`. The module is global by default, while `global: false` opts into module-local visibility.

NestJS `forRootAsync(...)` and `load` namespace factories have no direct registration equivalent. Await remote stores or secret managers at the application-owned bootstrap boundary before defining the final module graph, then pass their nested results to the synchronous loader or module options. An adapterless `FluoFactory.create(AppModule)` application shell and `FluoFactory.createApplicationContext(AppModule)` can resolve `ConfigService`; only HTTP `listen()` requires `FluoFactory.create(AppModule, { adapter })`. Preparing a shared validated snapshot before the final HTTP application avoids a second ambient environment read and keeps the adapter and injected config aligned.

### Fastify Native Extension Migration

Use fluo `middleware` for portable request behavior; it is not a Fastify plugin API. If a NestJS migration must retain a Fastify-native plugin, hook, or instance customization, pass it through `createFastifyAdapter({ configureFastify })` (or the same bootstrap/run option) before listening:

```typescript
const adapter = createFastifyAdapter({
  configureFastify: async (fastify) => {
    fastify.addHook('onRequest', async (request, reply) => {
      reply.header('x-native-request-id', request.id);
    });
  },
  port: validatedConfig.http.port,
});
```

The hook runs once per adapter-created Fastify instance before fluo registers multipart, raw-body, native-route, and wildcard-route handling. Rejection prevents that `listen()` call; a successful close followed by relisten creates and configures one new instance. The adapter still owns routing, CORS, logging, response semantics, and shutdown. It serializes fluo response payloads before handing them to Fastify, so an instance-level `setReplySerializer(...)` does not customize fluo responses. Do not carry post-bootstrap instance mutation, existing-instance adoption, or native-route bypasses across this boundary.

### NestJS i18n Locale and Validation Migration

Replace NestJS i18n's resolver discovery and request-scoped context with one explicit request-boundary handoff. Register catalogs through the root module, select the request locale with the HTTP subpath, and pass that locale into the validation subpath:

`I18nModule.forRoot(...)` is synchronous. Finish asynchronous catalog or configuration loading at the application-owned bootstrap boundary before `I18nModule.forRoot(...)`, then define the module graph with the completed values. This is application-owned composition, not a NestJS dynamic-module runtime bridge or compatibility layer; the framework-agnostic root contract does not gain `forRootAsync(...)`.

#### Catalog Aggregation and Fallback Migration

Do not pass a NestJS loader configuration through to fluo registration. Load every required locale and namespace at the application-owned bootstrap boundary, then pass the completed locale-scoped catalog map to the synchronous `I18nModule.forRoot(...)` call:

```ts
import { Module } from '@fluojs/core';
import { I18nModule } from '@fluojs/i18n';
import { createFileSystemI18nLoader } from '@fluojs/i18n/loaders/fs';

const locales = ['en', 'ko'] as const;
const namespaces = ['common', 'validation'] as const;
const catalogLoader = createFileSystemI18nLoader({
  rootDir: new URL('./locales', import.meta.url).pathname,
});

const catalogEntries = await Promise.all(
  locales.map(async (locale) => {
    const namespaceEntries = await Promise.all(
      namespaces.map(async (namespace) => [
        namespace,
        await catalogLoader.load(locale, namespace),
      ] as const),
    );

    return [locale, Object.fromEntries(namespaceEntries)] as const;
  }),
);
const catalogs = Object.fromEntries(catalogEntries);

@Module({
  imports: [
    I18nModule.forRoot({
      defaultLocale: 'en',
      supportedLocales: locales,
      fallbackLocales: { ko: ['en'] },
      catalogs,
    }),
  ],
})
class AppModule {}
```

Each loader result stays below its namespace instead of being shallow-merged. For example, `locales/ko/common.json` is addressed with `i18n.translate('title', { locale: 'ko', namespace: 'common' })`. A missing catalog file still rejects aggregation with `I18N_MISSING_CATALOG`; `fallbackLocales` does not silently substitute a missing loader result.

Convert NestJS i18n fallback intent explicitly:

```ts
// NestJS i18n
I18nModule.forRoot({
  fallbackLanguage: 'en',
  fallbacks: { ko: 'en' },
});

// fluo
I18nModule.forRoot({
  defaultLocale: 'en',
  fallbackLocales: { ko: ['en'] },
  catalogs,
});
```

After registration, message lookup remains deterministic: the explicit locale, that locale's `fallbackLocales` chain, `defaultLocale`, the per-call `defaultValue`, then `missingMessage`. The asynchronous aggregation above completes before synchronous registration; it does not change that lookup order or add `forRootAsync(...)`.

```typescript
import { Module } from '@fluojs/core';
import { I18nModule, type I18nService } from '@fluojs/i18n';
import {
  createAcceptLanguageLocaleResolver,
  getHttpLocale,
  resolveHttpLocale,
  type HttpLocaleResolver,
} from '@fluojs/i18n/http';
import { localizeDtoValidationError } from '@fluojs/i18n/validation';
import type { Middleware, RequestContext } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { createNodeHttpAdapter } from '@fluojs/runtime/node';
import type { DtoValidationError } from '@fluojs/validation';

const acceptLanguage = createAcceptLanguageLocaleResolver();

class TenantLocaleResolver {
  resolve(context: RequestContext) {
    const locale = context.request.headers['x-tenant-locale'];
    return typeof locale === 'string' ? { locale, source: 'tenant-header' } : undefined;
  }
}

const tenantLocaleResolver = new TenantLocaleResolver();
const mapTenantLocaleResolver: HttpLocaleResolver = ({ context }) => tenantLocaleResolver.resolve(context);

@Module({
  imports: [
    I18nModule.forRoot({
      defaultLocale: 'en',
      supportedLocales: ['en', 'ko'],
      catalogs: {
        en: { validation: { email: { EMAIL: '{{ field }} must be a valid email address.' } } },
        ko: { validation: { email: { EMAIL: '{{ field }}에는 올바른 이메일 주소가 필요합니다.' } } },
      },
    }),
  ],
})
class AppModule {}

const requestLocaleHook: Middleware = {
  async handle({ requestContext }, next) {
    resolveHttpLocale(requestContext, {
      defaultLocale: 'en',
      supportedLocales: ['en', 'ko'],
      resolvers: [mapTenantLocaleResolver, acceptLanguage],
    });
    await next();
  },
};

const app = await FluoFactory.create(AppModule, {
  adapter: createNodeHttpAdapter({ port: 3000 }),
  middleware: [requestLocaleHook],
});
await app.listen();

function localizeValidationFailure(
  i18n: I18nService,
  error: DtoValidationError,
  context: RequestContext,
): DtoValidationError {
  const locale = getHttpLocale(context)?.locale ?? 'en';
  return localizeDtoValidationError(i18n, error, { locale });
}
```

Map each custom NestJS resolver class to an `HttpLocaleResolver` and register one application-owned `Middleware` in `FluoFactory.create(...)`. The hook resolves the tenant value before `Accept-Language`, then downstream translation or validation-error handling reads the result from the same `RequestContext`. `resolveHttpLocale(...)` runs resolvers in array order, ignores invalid or unsupported results, and stores the configured default with source `default` when none match. `getHttpLocale(...)` reads only that `RequestContext`; it does not consult global state or another request's locale.

`localizeDtoValidationError(...)` returns a new error whose issue messages use the explicit locale. Its default namespace is `validation`, candidate keys run from `source.field.code` through `code`, and missing translations preserve the original issue message unless `fallbackToIssueMessage: false` is selected. The helper remains transport-agnostic: HTTP chooses the locale here, but validation localization never reads HTTP state itself.

### Passport.js Bridge Migration

Migrate each NestJS `PassportStrategy(...)` independently instead of carrying over a reflection-discovered Passport runtime. Use this sequence:

1. Configure the concrete Passport.js strategy as an explicit application provider.
2. Call `createPassportJsStrategyBridge(...)` with a stable strategy name, that provider token, and a `mapPrincipal(...)` mapping.
3. Add `bridge.providers` to the same authored module's `providers` array.
4. Pass `bridge.strategy` to `PassportModule.forRoot(...)` as the explicit named strategy registration.
5. Apply fluo `@UseAuth('name')` where authentication is required and read the mapped identity from `requestContext.principal`.

```typescript
import { Module } from '@fluojs/core';
import type { Principal } from '@fluojs/http';
import {
  createPassportJsStrategyBridge,
  PassportModule,
} from '@fluojs/passport';

import { GoogleStrategy } from './google.strategy.js';

function mapGoogleUser(user: unknown): Principal {
  if (
    typeof user !== 'object'
    || user === null
    || !('id' in user)
    || typeof user.id !== 'string'
    || user.id.length === 0
  ) {
    throw new TypeError('Google strategy returned a user without a string id.');
  }

  return { claims: { ...user }, subject: user.id };
}

const googleBridge = createPassportJsStrategyBridge('google', GoogleStrategy, {
  mapPrincipal: ({ user }) => mapGoogleUser(user),
});

@Module({
  imports: [
    PassportModule.forRoot(
      { defaultStrategy: 'google' },
      [googleBridge.strategy],
    ),
  ],
  providers: [GoogleStrategy, ...googleBridge.providers],
})
export class AuthModule {}
```

`mapPrincipal(...)` is the only documented request-identity handoff: validate the Passport.js `user`, return a fluo `Principal` with a non-empty `subject` and object `claims`, and let `AuthGuard` assign it to `requestContext.principal`. The bridge does not install Passport middleware, sessions, serializers, deserializers, or automatic strategy discovery. It does not provide full NestJS Passport compatibility, implicit guards, request augmentation beyond that principal mapping, or host middleware ownership. Session and serializer/deserializer migration remains application-owned at the bootstrap and request-host boundaries.

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

GraphQL migration keeps schema and discovery wiring explicit. Register every resolver class as a provider or controller in an authored module so it is discoverable from the compiled module graph. `GraphqlModule.forRoot({ resolvers: [...] })` does not register those classes; when supplied, `resolvers` filters discovery to that allowlist. Omit `resolvers` or pass an empty list to discover every decorated resolver class already registered as a provider or controller. Neither TypeScript return types nor NestJS design metadata register providers or build output types.

The code-first runtime supports a constrained resolver surface in two categories. Root `Query`, `Mutation`, and `Subscription` operations use `@Query(...)`, `@Mutation(...)`, and `@Subscription(...)`. Object fields attach through `@Resolver('TypeName')` plus `@FieldResolver(...)`, but only when that named object type is reachable from a code-first root operation output; an arbitrary detached type is not made reachable by registering a field resolver. TC39 standard decorators do not support parameter-decorator syntax, so `@Parent(index?)` and `@Context(index?)` are method decorators whose defaults bind the parent/source object at position `0` and `GraphQLContext` at position `1`. Field argument DTO binding and schema-first field-resolver attachment remain unsupported.

The runtime exposes no `GraphqlModule.forRootAsync(...)`, rejects `@Subscription({ topics })`, and requires subscription methods to return an `AsyncIterable`. `@fluojs/graphql` requires Node.js `>=20.19.3 <21 || >=22.2.0 <27`, the effective range of its mandatory first-party dependency graph through the Node listener-capable `@fluojs/runtime`; `@fluojs/config` independently retains Node.js `>=20.16.0`. HTTP and SSE use a Web-standard HTTP seam within that boundary, while optional WebSocket subscriptions additionally require a server-backed Node HTTP/S adapter with upgrade listeners. Do not treat that internal seam as Bun, Deno, or Cloudflare Workers package support without aligned dependency metadata and native runtime verification.

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

### Microservices Handler and Transport Migration

Split handler discovery and NestJS `ClientProxy` migration into explicit handler registration, facade, adapter, and infrastructure ownership instead of carrying over one opaque reflection-driven system.

- Import `@MessagePattern`, `@EventPattern`, and streaming pattern decorators from root `@fluojs/microservices`. They are TC39 standard method decorators and do not read `reflect-metadata`, `experimentalDecorators`, or `emitDecoratorMetadata` output.
- Keep decorated handlers on public instance methods. Private and static decorator targets are invalid.
- List each handler class explicitly in a compiled module's `providers` or `controllers`. Importing the class, decorating a method, or retaining NestJS provider metadata does not register the handler.
- Register the selected adapter with root `MicroservicesModule.forRoot({ transport })`.
- Inject root `MICROSERVICE` as `Microservice` for `listen()`, `send()`, `emit()`, and `close()`. The token resolves the lifecycle facade, not the raw adapter.
- Import transport implementations from their explicit subpaths when possible: `@fluojs/microservices/nats`, `@fluojs/microservices/kafka`, and `@fluojs/microservices/rabbitmq`. `RedisStreamsMicroserviceTransport` remains the documented root-barrel-only exception.
- `await microservice.send(...)` waits for the correlated remote response or rejects for a remote error, abort, timeout, or shutdown.
- `await microservice.emit(...)` waits only for the outbound transport publish operation. It does not prove that a remote event handler ran; any broker acknowledgement is limited to what the caller-provided publish collaborator itself promises.
- `await microservice.close()` waits for transport listener/subscription teardown and pending-request cleanup. NATS, Kafka, and RabbitMQ adapters detach from caller-provided collaborators but do not close or disconnect those clients, producers, consumers, publishers, channels, or connections.

```typescript
import { Module } from '@fluojs/core';
import { MessagePattern, MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';

class OrdersHandler {
  @MessagePattern('orders.find')
  public findOrder(payload: { orderId: string }) {
    return { id: payload.orderId };
  }
}

@Module({
  imports: [MicroservicesModule.forRoot({ transport: new TcpMicroserviceTransport({ port: 4000 }) })],
  providers: [OrdersHandler],
})
class OrdersMicroserviceModule {}
```

Kafka and RabbitMQ keep inbound consumer callbacks pending until handler execution and any request response publication settle, so the broker adapter can choose acknowledgement or retry. That consumer-side boundary remains separate from the producer-side `emit()` promise. During shutdown, close the `Microservice` facade first, then close or drain caller-owned broker resources from the application bootstrap layer.

## Removed Concepts

- `@Injectable()` as the default provider marker. Provider registration happens through the module `providers` array.
- Reflection-driven constructor resolution through `reflect-metadata`.
- Reflection-driven microservice handler discovery from NestJS provider or emitted design metadata.
- Assuming a Passport.js bridge recreates the NestJS Passport runtime. fluo requires explicit bridge providers, named strategy registration, route guard metadata, and principal mapping while the application retains middleware, session, serializer/deserializer, and host ownership.
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
- Assuming NestJS HTTP or WebSocket server ownership transfers unchanged to Deno. Choose one lifecycle owner. Managed `app.listen()` starts `Deno.serve(...)` and owns server shutdown through adapter close/drain plus configured websocket upgrades. `runDenoApplication(...)` uses that managed adapter lifecycle and additionally installs and removes shutdown signal handlers. Signal-triggered application-close failures are logged and swallowed by that helper; it sets no exit status and does not force termination. Hosts that need failure-status propagation or forced termination must pass `shutdownSignals: false` and coordinate signals and shutdown themselves. The host-owned `createDenoFetchHandler(...)` path only translates and dispatches requests; it does not start a server, install signal handlers, own shutdown, or automatically perform websocket upgrades. The surrounding host must provide those lifecycle seams.
- Assuming NestJS HTTP or WebSocket server ownership carries over to Cloudflare Workers. Export the Worker `fetch(request, env, ctx)` entrypoint, treat `listen()` as a socketless dispatcher-binding boundary, and import `CloudflareWorkersWebSocketModule.forRoot()` before bootstrap so WebSocket ownership is frozen before listen. Fetch-time `env` is not bootstrap configuration; only independently available pre-registration values belong there. Read, validate, and narrow request bindings from `RequestContext` at an application-owned request boundary, then pass only application-shaped values into provider methods. The adapter registers accepted HTTP, SSE, and WebSocket lifecycle work with `ctx.waitUntil(...)`; it does not expose a live server for post-listen mutation.
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
- [i18n Ecosystem Bridge Decision](../reference/i18n-ecosystem-bridges.md)
- [fluo new Support Matrix](../reference/fluo-new-support-matrix.md)
