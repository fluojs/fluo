# NestJS → fluo Migration Map

<p><strong><kbd>한국어</kbd></strong> <a href="./migrate-from-nestjs.md"><kbd>English</kbd></a></p>

이 문서는 마이그레이션 계약 맵으로 사용한다. 각 행은 NestJS 구성 요소에 대해 허용되는 가장 가까운 fluo 대상 구성을 지정하고, 아래 규칙은 일대일 치환이 되지 않는 지점을 명시한다.

## API Correspondence Table

프로덕션 코드를 마이그레이션할 때는 NestJS 원본 패턴이 아니라 두 번째 열의 fluo 구성을 적용한다.

| NestJS 구성 요소 | fluo 구성 요소 | 메모 |
| --- | --- | --- |
| `@Module({ imports, controllers, providers, exports })` | `@fluojs/core`의 `@Module({ imports, controllers, providers, exports })` | 모듈 경계와 명시적 export는 그대로 주요 구성 단위다. |
| `@Controller('/users')` | `@fluojs/http`의 `@Controller('/users')` | 컨트롤러 데코레이터는 코어 패키지가 아니라 HTTP 패키지에 속한다. |
| `@Get()`, `@Post()` 등 라우트 데코레이터 | `@fluojs/http`의 `@Get()`, `@Post()` 등 | HTTP 라우트 선언은 계속 메서드 기반 데코레이터를 사용한다. |
| `@Sse()` | `@fluojs/http`의 `@Sse()`와 수동 stream용 `SseResponse` 또는 managed stream용 `AsyncIterable` | fluo는 `@Sse()`를 `text/event-stream` metadata를 가진 `GET` 라우트로 매핑한다. `AsyncIterable` 값은 SSE frame으로 변환할 수 있지만, NestJS `Observable` 반환값은 여전히 `SseResponse` 또는 async iterable로 재작성해야 한다. |
| `NestFactory.create(AppModule)` | `@fluojs/runtime`의 `FluoFactory.create(AppModule, { adapter })` | 부트스트랩 시 `createFastifyAdapter()` 같은 명시적 플랫폼 어댑터가 필요하다. |
| `@Injectable()` 프로바이더 마커 | `@Module(...).providers`에 등록된 프로바이더 클래스 또는 provider definition | fluo는 필수 프로바이더 등록 단계로 `@Injectable()`을 사용하지 않는다. |
| `emitDecoratorMetadata`를 통한 생성자 타입 리플렉션 | `@fluojs/core`의 `@Inject(TokenA, TokenB)` | 생성자 의존성은 데코레이터 인자 순서대로 명시한다. |
| `class-validator` / 데코레이터 중심 DTO 검증 | Standard Schema를 지원하는 `@fluojs/validation` | 현재 검증 방향은 Zod, Valibot 등을 포함한 Standard Schema 기반이다. |
| `Pipe`, `ValidationPipe`, 또는 parameter-level transformation | `@fluojs/http`의 `@RequestDto(...)`와 field-level `@FromPath(...)`, `@FromQuery(...)`, `@FromBody(...)`, `@FromHeader(...)`, `@FromCookie(...)`, `@Convert(...)` | fluo는 controller parameter에 적용하는 NestJS-style public Pipe 단계를 노출하지 않는다. 하나의 request DTO를 바인딩하고, 각 field source를 선언하며, number/boolean/date/domain conversion에는 `@Convert(...)`를 사용한 뒤 materialized DTO를 validation package로 검증한다. |
| `createApplicationContext()` 단독 부트스트랩 | `FluoFactory.createApplicationContext(AppModule)` | `@fluojs/runtime`에 standalone application context가 존재한다. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `@fluojs/testing`의 `createTestingModule({ rootModule }).overrideModule(...)` | fluo testing은 명시적 `rootModule`과 replacement compile seam을 사용하므로 전역 module metadata를 mutate하지 않고 authored module identity를 보존한다. |
| NestJS 요청 transaction interceptor | 영속성 패키지의 서비스 `@Transaction()` 또는 controller/request 경계의 명시적 `requestTransaction(...)` | fluo는 Drizzle 또는 Mongoose `*TransactionInterceptor` export를 제공하지 않는다. 비즈니스 transaction은 서비스에 두고, 전체 요청이 하나의 경계를 공유해야 할 때만 `DrizzleDatabase.requestTransaction(...)` 또는 `MongooseConnection.requestTransaction(...)`을 사용한다. |
| `HealthCheckService.check([...])`를 호출하는 `@HealthCheck()` 컨트롤러 메서드 | `@fluojs/terminus`의 `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` | Module-level registration이 기본 API이므로 runtime `/health`와 `/ready` route가 indicator 및 platform diagnostics를 일관되게 포함한다. |
| NestJS Terminus memory/disk 또는 Redis check | `@fluojs/terminus/node`와 `@fluojs/terminus/redis` | Node.js memory/disk helper와 Redis helper는 전용 subpath에 있다. Root package는 Redis peer나 Node filesystem access를 기본 import 경계에 포함하지 않는다. |
| `@nestjs/throttler` 전역 throttler 설정 | `@fluojs/throttler` / `@fluojs/http`의 `ThrottlerModule.forRoot(...)`와 명시적 `@UseGuards(ThrottlerGuard)` | Module registration은 정책과 guard provider를 제공한다. Route enforcement는 guard를 붙인 위치에서만 시작된다. |
| `@WebSocketGateway()`와 `@SubscribeMessage()` 및 parameter decorator | `@fluojs/websockets`의 `@WebSocketGateway()`와 `@OnMessage(event?)`, positional handler argument, 선택적 `WebSocketRoomService` | fluo websocket handler는 `(payload, socket, request)`를 직접 받습니다. Nest-style `@MessageBody()`, `@ConnectedSocket()`, `@SubscribeMessage()` parameter/decorator rewrite는 없습니다. |
| NestJS Socket.IO gateway return value 또는 `@WebSocketServer()` | `@fluojs/socket.io`와 `@fluojs/websockets` decorator, `@OnMessage(...)`, 명시적 acknowledgement callback, `@Inject(SOCKETIO_SERVER)` | Socket.IO handler 반환값은 암묵적인 emit 또는 ACK reply가 되지 않습니다. `@WebSocketGateway`, `@OnMessage`, lifecycle decorator에는 websockets companion을 설치하고 import하세요. Gateway server 접근, multi-room emit, volatile delivery를 마이그레이션할 때는 `SOCKETIO_SERVER`를 주입하세요. |
| `@nestjs/cache-manager` / `CacheModule.register(...)` | `@fluojs/cache-manager`의 `CacheModule.forRoot(...)`, `CacheService`, cache decorators | fluo cache registration은 동기 방식이다. Redis 또는 custom store는 module registration 전에 준비하고, manual cache operation에는 `CacheService`를 주입하며, request-aware response-cache key에는 `httpKeyStrategy` 또는 `@CacheKey(...)`를 사용한다. |
| `@nestjs/event-emitter` / `@OnEvent()` handler | `@fluojs/event-bus`의 `EventBusModule.forRoot(...)`, `EventBusLifecycleService`, `@OnEvent(EventClass)` | Event routing은 class 기반이고, handler는 singleton provider/controller에서만 discovery되며, bounded awaited publish는 caller promise가 먼저 settle되어도 underlying handler/transport work를 shutdown drain tracking에 유지한다. |
| NestJS Redis async module registration 또는 shared Redis Pub/Sub client | `@fluojs/redis`의 `RedisModule.forRoot(...)`, named `RedisModule.forRoot({ name, ... })`, `getRedisClientToken(name)` | fluo Redis registration은 동기 방식이다. 환경별 option이나 외부에서 만든 client는 registration 전에 해석하고, Pub/Sub subscriber는 일반 command client를 재사용하지 말고 전용 duplicate 또는 named client로 분리한다. |
| `@Processor(...)`, `@Process(...)` 또는 provider metadata를 통한 `@nestjs/bull` / `@nestjs/bullmq` processor discovery | `@fluojs/queue`, `@fluojs/redis`, `@fluojs/core`의 `RedisModule.forRoot(...)`, `QueueModule.forRoot(...)`, singleton `@QueueWorker(JobClass, options?)` provider, 명시적 `@Inject(...)` | fluo는 compiled module graph의 decorated singleton provider/controller만 discovery한다. Worker는 `handle(job)`을 노출해야 하며, Queue는 NestJS metadata를 읽거나 legacy Bull/BullMQ `queueName`, named job, 영속 payload 또는 그 topology를 자동 보존하지 않는다. |
| `@nestjs/schedule` decorator, `SchedulerRegistry`, 또는 `CronJob` handle | `@fluojs/cron`의 `CronModule.forRoot(...)`, public-method `@Cron` / `@Interval` / `@Timeout`, `SCHEDULING_REGISTRY` | NestJS `timeZone`을 fluo `timezone`으로 바꾼다. fluo에는 `waitForCompletion` 옵션이 없고 같은 task instance가 아직 실행 중이면 항상 해당 tick을 건너뛰므로 이 옵션을 옮기지 않는다. fluo는 decorator로 발견한 task를 application bootstrap 중 시작하고, 이미 시작된 registry에 dynamic task가 추가되면 즉시 시작하며, live scheduler handle 대신 read-only task descriptor를 노출한다. |
| `imports`, `useClass`, `useExisting`를 사용하는 NestJS-style email async module registration | `@fluojs/email`의 `EmailModule.forRootAsync({ inject, useFactory, global? })` | fluo email async registration은 injected factory option만 지원한다. 필요한 의존성은 application module graph에 먼저 등록하고 token을 `inject`에 나열하며, 기본 global provider visibility에서 벗어나야 할 때만 `global: false`를 설정한다. |
| NestJS-style notification module, decorator-discovered channel provider, 또는 implicit queue/event integration | `@fluojs/notifications`의 `NotificationsModule.forRoot({ channels, queue?, events?, global? })` 또는 `NotificationsModule.forRootAsync({ inject, useFactory, global? })` | fluo notifications registration은 `channels`에 전달된 명시적 `NotificationChannel` 값을 사용한다. Queue adapter와 event publisher는 module-owned resource가 아니라 애플리케이션 소유 seam이며, `global: false`를 설정하지 않으면 `NotificationsService`, `NOTIFICATIONS`, `NOTIFICATION_CHANNELS`가 기본 global로 export된다. |
| `imports`, `useClass`, `useExisting`, package-level multi-client registry 또는 `isGlobal`을 가정하는 NestJS Slack module | `@fluojs/slack`의 `SlackModule.forRoot({ ..., global? })` 또는 `SlackModule.forRootAsync({ inject, useFactory, global? })` | fluo Slack async registration은 injected factory option만 소비한다. 필요한 의존성은 application module graph에 먼저 등록하고 token을 `inject`에 나열한 뒤, `useFactory`에서 최종 Slack option을 반환한다. 여러 client에는 app-owned module/provider 또는 facade를 조합한다. |
| `imports`, `useClass`, `useExisting`, `isGlobal`, 또는 custom internal provider token을 가정하는 NestJS Discord module | `@fluojs/discord`의 `DiscordModule.forRoot({ ..., global? })` 또는 `DiscordModule.forRootAsync({ inject, useFactory, global? })` | fluo Discord registration은 singleton 중심이며 async setup은 injected factory만 지원한다. 이 패키지는 `global: false`가 설정되지 않으면 `DiscordService`, `DiscordChannel`, `DISCORD`, `DISCORD_CHANNEL`을 기본 global로 export하고, 내부 provider helper와 option token은 의도적으로 private으로 유지한다. |

## Breaking Differences

- 데코레이터는 반드시 TC39 표준 모델을 따라야 한다. NestJS의 레거시 데코레이터 가정은 그대로 유지되지 않는다.
- 의존성 주입은 생성자 타입에서 절대 추론되지 않는다. fluo는 생성자 의존성에 대해 명시적 `@Inject(...)` 선언을 요구한다.
- 부트스트랩은 adapter-first 방식이다. `FluoFactory.create(...)`는 HTTP 플랫폼을 암묵적으로 고르는 대신 `adapter` 옵션을 반드시 받아야 한다.
- 검증은 `class-validator` 우선 계약을 유지하지 않고 Standard Schema 방향으로 반드시 옮겨야 한다.
- NestJS Pipe와 `ValidationPipe` migration은 parameter-pipe 치환이 아니다. Request input shaping은 `@RequestDto(...)`, field-level source decorator, `@Convert(...)`로 옮긴다. 검증은 public controller-parameter Pipe stage가 아니라 DTO materialization 이후에 실행된다.
- 컨트롤러 데코레이터는 반드시 `@fluojs/http`에서 가져오고, `@Module` 같은 구조 데코레이터는 `@fluojs/core`에서 가져온다.
- Observable을 반환하는 NestJS `@Sse()` 핸들러는 반드시 `SseResponse`를 만들거나 `AsyncIterable`을 반환하도록 재작성해야 한다. 수동 `SseResponse` stream은 `send(...)` 또는 `comment(...)`를 호출하고 request abort 또는 application cleanup 경로에서 닫아야 하며, managed async iterable은 request abort 또는 response stream close 시 dispatcher가 닫는다.
- Drizzle transaction migration은 interceptor-for-interceptor 치환이 아니다. `@fluojs/drizzle`은 서비스 `@Transaction()`을 기본 경계로 사용하고, 드문 controller/request-wide 호환성 사례에만 명시적 `DrizzleDatabase.requestTransaction(...)`을 사용한다.
- Drizzle `@Transaction()`은 `this.db`, 직접 host property, 중첩 `.db` property에서 대상을 추론할 수 있다. Drizzle client가 둘 이상인 서비스는 property discovery에 의존하지 말고 `@Transaction((self) => self.ordersDb)` 같은 명시적 accessor를 반드시 사용한다.
- Drizzle은 등록된 handle에 `database.transaction(...)`이 없고 `strictTransactions`가 `false`이면 fail-open direct execution을 기본값으로 사용한다. rollback 보장이 필요한 production migration 흐름에서는 `strictTransactions: true`를 설정해, transaction 지원 누락이 원자성 없이 조용히 실행되지 않고 readiness 및 helper 호출 실패로 드러나게 한다.
- Vite build transform과 Vitest test transform은 의도적으로 분리되어 있다. 생성된 non-Deno `vite.config.ts`는 애플리케이션 `.ts` 파일에 Babel `{ version: '2023-11' }` decorator transform을 적용하기 위해 `@fluojs/vite`를 사용하고, 생성된 `vitest.config.ts`는 테스트에 `@fluojs/testing/vitest`를 사용한다. 레거시 decorator compiler flag를 다시 켜거나 하나의 transform config가 build와 test 파일을 모두 소유한다고 가정하지 않는다.
- Mongoose transaction migration도 interceptor-for-interceptor 치환이 아니다. 비즈니스 원자성에는 `@fluojs/mongoose`의 서비스 `@Transaction()`을 사용하고, 하나의 MongoDB session을 전체 request boundary에서 공유해야 하는 드문 경우에만 `MongooseConnection.requestTransaction(...)`을 사용한다.
- `@fluojs/mongoose`는 애플리케이션이 Mongoose의 concrete connection을 제공해야 한다. 이 패키지는 연결을 생성하거나, model compilation을 소유하거나, `dispose(connection)` hook이 제공되지 않은 연결을 닫지 않는다.
- `MongooseConnection.model(...)`은 `create`, `find`, `findOne`, `aggregate`, `bulkWrite`에만 ambient session을 자동 바인딩한다. 지원되지 않는 model 메서드, `doc.save()`, raw `conn.current().model(...)` 사용, 외부 유틸리티에는 명시적인 `conn.currentSession()` 배관이 필요하다.
- Mongoose는 등록된 connection에 `connection.transaction(...)`과 `startSession()`이 모두 없고 `strictTransactions`가 `false`이면 fail-open direct execution을 기본값으로 사용한다. MongoDB rollback 보장이 필요한 production migration 흐름에서는 `strictTransactions: true`를 설정해 transaction 지원 누락이 원자성 없이 조용히 실행되지 않고 readiness 및 helper 호출 실패로 드러나게 한다.
- NestJS testing migration은 암묵적 imports-array 치환이 아니다. `createTestingModule({ rootModule })`을 사용하고, `compile()` 전에 `overrideModule(OriginalModule, ReplacementModule)`을 호출하며, adapter, provider, filter, lifecycle option을 runtime bootstrap으로 전달해야 하는 virtual request HTTP 테스트에서는 `createTestApp({ rootModule, ...options })`를 사용한다.
- `TestingModuleRef`는 assertion, provider resolution, dispatch helper를 위한 컴파일된 module context를 노출하고, `createTestApp(...)`은 자체 `close()` lifecycle을 가진 request-driven app facade를 반환한다. NestJS-style 공유 application instance 소유권에 의존하지 말고 각 HTTP 테스트 뒤에 반환된 test app을 닫아야 한다.
- Testing migration에서는 fluo의 명시적 `rootModule` 가정, authored module identity, request-level guard/interceptor/filter assertion, metadata-free boundary를 테스트 안에 드러내야 한다. NestJS spec을 옮길 때 design metadata, 암묵적 provider discovery, 모든 request-path 테스트의 cleanup을 소유하는 singleton application fixture를 가정하지 않는다.
- NestJS Terminus의 controller-level `@HealthCheck()` handler는 `TerminusModule.forRoot(...)` 기반 indicator 및 readiness registration으로 옮기는 것이 좋다. 직접 `TerminusHealthService.check()` 호출은 test나 custom code에서 사용할 수 있지만, 기본 endpoint registration API는 아니다.
- `@fluojs/terminus`는 별도의 process-only liveness route를 기본으로 만들지 않는다. 기본 `GET /health` aggregated health route와 `GET /ready` readiness gate를 유지하고, 더 좁은 process probe가 필요하면 애플리케이션 또는 배포 계층에서 정의한다.
- Throttler migration은 global module을 global enforcement로 치환하는 방식이 아니다. `ThrottlerModule.forRoot(...)`는 default를 등록하고, `ThrottlerGuard`는 보호할 controller나 handler의 guard metadata로 활성화해야 한다.
- `@fluojs/throttler`는 하나의 module default와 class/method `@Throttle({ ttl, limit })` override를 제공한다. burst와 sustained limit 같은 multi-window 정책은 HTTP middleware, custom `ThrottlerStore`, 또는 애플리케이션이 소유한 guard wrapper로 명시적으로 구현해야 한다.
- `@fluojs/platform-express`는 Express를 host engine으로 보존하지만 implicit middleware translation layer로 동작하지 않는다. NestJS 또는 Express migration에서 가져온 native Express/Connect `(req, res, next)` middleware는 platform-specific bootstrap code에 두거나 fluo `Middleware`로 감싼 뒤 `fluoFactory.create({ middleware })`에 넣어야 한다.
- Forwarded client IP header는 `Forwarded`, `X-Forwarded-For`, `X-Real-IP`를 신뢰 가능한 proxy가 덮어쓰는 배포에서 `trustProxyHeaders: true`를 설정한 경우에만 사용된다.
- Throttling된 응답에서 보장되는 metadata는 HTTP `429`와 `Retry-After`다. 추가 rate-limit header나 body shape는 애플리케이션 경계에서 더한다.
- WebSocket migration은 decorator-for-decorator 치환이 아닙니다. `@fluojs/websockets`의 `@OnMessage(event?)`를 사용하고, handler 입력은 `(payload, socket, request)` positional argument로 읽으며, room membership 또는 broadcast에는 NestJS gateway server injection이나 parameter decorator가 그대로 이어진다고 가정하지 말고 `WebSocketRoomService`를 사용합니다. Root `@fluojs/websockets`와 `@fluojs/websockets/node` module path는 Node.js default이며 upgrade guard가 `IncomingMessage`를 받습니다. Bun, Deno, Cloudflare Workers migration은 guard/request type과 runtime lifecycle service가 올바른 subpath boundary에 머물도록 `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`에서 import해야 합니다. Raw WebSocket gateway 반환값은 await된 뒤 무시됩니다. Reply는 runtime socket argument로 명시적으로 보내세요.
- Socket.IO migration도 같은 명시적 websocket handler 모델을 유지합니다. `@fluojs/socket.io`는 `@fluojs/websockets`의 `@WebSocketGateway`, `@OnMessage`, lifecycle decorator를 재사용하므로 companion 패키지를 설치하세요. Handler return value는 await된 뒤 무시됩니다. Client가 acknowledgement를 기대하면 제공된 ACK callback을 호출하고, native Socket.IO emit, multi-room fan-out, `.volatile`, `@WebSocketServer()` 대체 코드에는 `@fluojs/socket.io`의 `SOCKETIO_SERVER`를 주입하세요. 이 패키지는 Node.js 20+ server-backed adapter와 공식 Bun engine path를 대상으로 하며, Deno와 Workers는 지원하지 않습니다. Bun은 static CORS shape를 요구하고 `@WebSocketGateway({ serverBacked })`를 지원하지 않습니다.
- Cache-manager migration은 async dynamic-module 치환이 아니다. `@fluojs/cache-manager`는 동기 `CacheModule.forRoot(...)`를 제공한다. 환경별 client는 먼저 application boundary에서 구성하고, `store`, `ttl`, `keyPrefix`, `redis.clientName`, `httpKeyStrategy` 같은 최종 cache option을 전달한다.
- NestJS-style cache-key customization은 interceptor subclassing 대신 fluo가 문서화한 key seam으로 옮겨야 한다. 애플리케이션 전역 request-aware 정책에는 function-valued `httpKeyStrategy`를 사용하고, handler-local 동작에는 literal key 또는 key factory를 받는 `@CacheKey(...)`를 사용한다.
- Custom cache tooling은 private metadata key를 다시 구현하지 말고 `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, `getCacheEvictMetadata(...)` 같은 exported cache metadata helper를 읽어야 한다.
- Event-bus migration은 string pattern 기반이 아니라 class 기반이다. `@OnEvent(EventClass)`를 사용하고, retry 가능하거나 느린 side effect는 idempotent하게 유지하며, 오래 실행되거나 retry가 중요한 작업은 awaited event handler 안에 숨기지 말고 명시적인 queue handoff로 옮겨야 한다.
- Redis migration은 async dynamic-module 치환이 아니다. `@fluojs/redis`는 동기 `RedisModule.forRoot(...)`를 제공한다. Secret, host, TLS option, 외부에서 만든 client는 application boundary에서 먼저 해석한 뒤 최종 option을 module에 전달한다.
- Redis Pub/Sub migration은 subscriber 소유권을 명시적으로 유지해야 한다. `client.duplicate()` subscriber는 애플리케이션 소유이므로 만든 코드가 직접 connect, subscribe, close를 책임진다. Subscriber client lifecycle timeout까지 fluo가 소유해야 한다면 named `RedisModule.forRoot({ name: 'subscriber', ... })`와 `getRedisClientToken('subscriber')`를 사용한다.
- Queue migration은 NestJS processor-discovery compatibility layer가 아니다. Redis와 `QueueModule.forRoot(...)`를 등록하고, 각 processor를 `handle(job)`을 구현하는 TC39 표준 `@QueueWorker(JobClass, options?)` class로 바꾸며, singleton module provider로 나열하고 constructor token을 `@Inject(...)`로 선언한다. `global: false`에서는 worker와 Redis provider가 해당 queue registration과 같은 authored module graph를 통해 도달 가능해야 하며 request/transient worker는 건너뛴다. Queue는 processor lifecycle을 소유하고 application bootstrap-ready handoff 이후에만 시작하며 shutdown 중 `workerShutdownTimeoutMs`까지 기다린다.
- Queue는 processor lifecycle과 서로 다른 persistence identity를 소유한다. NestJS Bull/BullMQ는 하나의 `queueName` 아래 여러 named job 값을 저장할 수 있지만 fluo는 한 worker/job type의 `jobName`을 BullMQ queue name과 named job 양쪽에 사용한다. 따라서 `jobName`만 설정해서는 legacy topology를 보존할 수 없고, Queue는 NestJS metadata를 소비하거나 영속 payload를 자동 변환하지 않는다. Producer cutover 전에는 legacy worker로 기존 queue를 drain하거나, payload를 변환해 fluo의 job별 queue로 다시 enqueue하거나, legacy worker가 drain하는 동안 별도 queue name으로 전환한다.
- Cron migration은 `SchedulerRegistry`/`CronJob` handle을 그대로 보존하는 치환이 아니다. `@Cron`, `@Interval`, `@Timeout`은 public instance method에 사용하고, private 또는 static scheduled work는 공개 provider method 뒤로 옮기며, live `CronJob` handle을 mutate하는 대신 `SCHEDULING_REGISTRY.get(...)` / `getAll()`의 `SchedulingTaskDescriptor` snapshot을 사용한다.
- NestJS cron option도 명시적으로 마이그레이션해야 한다. `timeZone`은 `timezone`으로 바꾼다. fluo는 scheduler-level no-overlap protection과 in-process running guard를 항상 적용하므로 `waitForCompletion`은 생략한다. 같은 task instance가 실행 중일 때 도착한 tick은 queue되지 않고 건너뛴다. NestJS에서 `waitForCompletion: false` 또는 기본 overlapping behavior에 의존한 task는 지원되지 않는 fluo flag를 만들지 말고 concurrent work를 application-owned queue나 worker로 옮겨야 한다. 이 local guard는 application instance 사이의 Redis distributed locking을 대체하지 않는다.
- Email migration은 NestJS dynamic-module 형태를 그대로 복제하지 않는다. `EmailModule.forRootAsync(...)`는 `inject`와 `useFactory`를 받으며, `imports`, `useClass`, `useExisting`는 소비하지 않는다. `EmailModule`은 기본적으로 global이므로 migrated code에 module-local visibility가 필요할 때만 `global: false`를 설정한다.
- Notifications migration은 provider-discovery 또는 decorator-metadata clone이 아니다. 명시적인 `NotificationChannel` 값을 `NotificationsModule.forRoot(...)`에 전달하거나 `NotificationsModule.forRootAsync({ inject, useFactory, global? })`에서 반환해야 한다. 이 패키지는 channel 등록을 위해 NestJS provider, `@Injectable()` metadata, emitted design type을 scan하지 않는다.
- `@fluojs/notifications`는 concrete queue 또는 event-bus resource를 create/import/close/drain하지 않는다. Queue adapter와 event publisher는 애플리케이션 소유 integration이며, status snapshot은 이를 `ownsResources: false`인 externally managed dependency로 보고한다.
- `NotificationsModule`은 기본적으로 `NotificationsService`, `NOTIFICATIONS`, `NOTIFICATION_CHANNELS`에 대해 global이다. Migrated code에 module-local visibility가 필요할 때는 `global: false`를 사용한다.
- Slack migration은 NestJS async dynamic-module 또는 package-level multi-client registry clone이 아니다. `SlackModule.forRootAsync(...)`는 `inject`와 `useFactory`를 받으며, `imports`, `useClass`, `useExisting`은 소비하지 않는다. 필요한 의존성은 application module graph에 등록한 뒤 token을 `inject`에 나열하고, `useFactory`에서 최종 Slack option을 반환한다. `@fluojs/slack`은 singleton compatibility token인 `SLACK`과 `SLACK_CHANNEL`을 노출하고 `createSlackProviders(...)`로 같은 singleton wiring을 재사용하며, NestJS `isGlobal` 대신 기본 global visibility를 가진 `global?: boolean`을 사용한다.
- Discord migration은 NestJS async dynamic-module 또는 custom-provider clone이 아니다. `DiscordModule.forRootAsync(...)`는 `inject`와 `useFactory`를 받으며, `imports`, `useClass`, `useExisting`는 소비하지 않는다. `@fluojs/discord`는 singleton compatibility token인 `DISCORD`와 `DISCORD_CHANNEL`을 노출하고, NestJS `isGlobal` 대신 기본 global visibility를 가진 `global?: boolean`을 사용하며, `createDiscordProviders(...)`, `DISCORD_OPTIONS`, `NormalizedDiscordModuleOptions` 같은 내부 provider helper는 private으로 유지한다.

## Removed Concepts

- 기본 프로바이더 마커로서의 `@Injectable()`. 프로바이더 등록은 모듈의 `providers` 배열에서 수행된다.
- `reflect-metadata`를 통한 리플렉션 기반 생성자 해석.
- emit된 디자인 타임 타입에 기대는 암묵적 DI.
- 프레임워크 요구 사항으로서의 레거시 데코레이터 컴파일러 모드.
- 생성된 `@fluojs/vite` 애플리케이션 transform과 `@fluojs/testing/vitest` 테스트 transform을 하나의 파일 경계로 합치는 방식.
- 문서화된 모든 플랫폼이 `fluo new`에 포함된다고 가정하는 방식. 스타터 범위는 별도 지원 매트릭스에서 정의된다.
- `@nestjs/terminus` controller decorator나 별도 default liveness route가 Terminus의 일대일 마이그레이션 대상이라고 가정하는 방식.
- `@nestjs/throttler`의 named definition, global guard registration, proxy header trust가 명시적인 Fluo wiring 없이 그대로 유지된다고 가정하는 방식.
- `@nestjs/cache-manager`의 async registration, implicit global cache enforcement, interceptor subclassing이 그대로 유지된다고 가정하는 방식. fluo는 cache setup을 동기 `CacheModule.forRoot(...)`, 명시적 `CacheInterceptor` placement, 문서화된 key strategy hook에 둔다.
- NestJS/Mongoose request interceptor나 암묵적 connection ownership이 그대로 유지된다고 가정하는 방식. fluo는 Mongoose connection ownership을 애플리케이션 쪽에 두고 서비스 `@Transaction()`과 명시적 `requestTransaction(...)` 경계를 사용한다.
- NestJS `@SubscribeMessage()`, `@MessageBody()`, `@ConnectedSocket()`, 또는 암묵적 gateway server injection이 fluo websocket gateway에도 있다고 가정하는 방식.
- Socket.IO gateway return value가 암묵적인 client reply가 된다고 가정하는 방식. fluo에서는 명시적 ACK callback 또는 raw `SOCKETIO_SERVER` emit이 필요합니다.
- NestJS-style Redis async module factory나 Pub/Sub command/subscriber client 공유가 그대로 유지된다고 가정하는 방식. fluo는 Redis registration을 동기 방식으로 유지하고 Pub/Sub 연결에는 전용 subscriber 소유권을 요구한다.
- NestJS/Bull processor decorator, emit된 metadata, request/transient worker scope, 기존 queue persistence compatibility가 그대로 유지된다고 가정하는 방식. fluo는 명시적인 singleton `@QueueWorker(JobClass)` 등록과 drain, payload 변환 후 다시 enqueue, 또는 별도 queue name 격리 중 하나를 택하는 애플리케이션 소유 `queueName`/named job/`jobName` cutover를 요구한다.
- Raw Express/Connect middleware를 fluo application middleware에 직접 전달하는 방식. fluo middleware는 `MiddlewareContext`를 받으므로 native `(req, res, next)` function에는 명시적 wrapper나 platform-owned integration boundary가 필요하다.
- NestJS HTTP adapter lifecycle hook을 Bun에서 시작 후 live server mutation으로 옮길 수 있다고 가정하는 방식. `@fluojs/platform-bun`은 `listen()`이 시작되기 전에 dispatcher와 realtime seam을 바인딩하고, 중복 `listen()` 호출을 idempotent하게 유지하며, NestJS-style late host mutation 대신 외부 소유 `Bun.serve(...)` host를 위한 동기 `createBunFetchHandler(...)`를 노출한다. 이러한 manual host는 shutdown, websocket upgrade, native `routes` acceleration을 직접 소유한다.
- NestJS `SchedulerRegistry`가 mutable `CronJob` handle을 반환하거나 private scheduled method가 유효한 decorator target이라고 가정하는 방식. fluo는 descriptor 기반 scheduling control을 노출하고 scheduled decorator는 public instance method에 요구한다.
- `EmailModule.forRootAsync(...)`가 NestJS `imports`, `useClass`, `useExisting`를 받거나 email provider가 기본적으로 module-local이라고 가정하는 방식. fluo email은 injected factory registration을 사용하며, `global: false`가 설정되지 않으면 기본 global visibility를 사용한다.
- Notification channel이 NestJS provider decorator/metadata에서 discovery되거나, queue/event-bus resource를 notifications module이 소유한다고 가정하는 방식. fluo는 명시적 `channels`와 애플리케이션 소유 queue adapter/event publisher lifecycle을 요구한다.
- `SlackModule.forRootAsync(...)`가 NestJS `imports`, `useClass`, `useExisting`을 받거나 Slack package-level multi-client registry 또는 NestJS `isGlobal` option이 존재한다고 가정하는 방식. fluo Slack은 injected factory registration, singleton `SLACK` / `SLACK_CHANNEL` token, 같은 singleton provider wiring을 위한 `createSlackProviders(...)`, 기본 global module visibility에서 벗어나기 위한 `global?: boolean`을 사용한다.
- Discord `forRootAsync(...)`가 NestJS `imports`, `useClass`, `useExisting`를 받거나, Discord provider가 기본적으로 module-local이거나, custom wiring을 위해 내부 provider helper/token을 import할 수 있다고 가정하는 방식. fluo Discord는 injected factory registration, singleton `DISCORD` / `DISCORD_CHANNEL` token, private 내부 provider helper, 기본 global module visibility에서 벗어나기 위한 `global?: boolean`을 사용한다.

## CLI Starter and Generator Limits

CLI로 검증 가능한 fluo baseline을 만든 뒤, NestJS 마이그레이션의 나머지 부분은 명시적 module wiring과 package 채택으로 마무리하세요:

- `fluo new` application starter는 정확한 runtime/platform 쌍의 HTTP 프로젝트로 제한됩니다. Node.js는 `fastify`, `express`, `nodejs` platform을 사용하고, Bun은 `bun`, Deno는 `deno`, Cloudflare Workers는 `cloudflare-workers` platform을 사용합니다.
- `fluo new` microservice starter는 Node.js + `--platform none` 기준의 `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, `grpc`로 제한됩니다. CLI는 `redis`를 transport alias로 받지 않습니다. `redis-streams`를 사용하거나 스캐폴딩 후 `@fluojs/redis`를 수동으로 추가하세요.
- `fluo new --shape mixed`는 single-package Fastify HTTP + attached TCP microservice starter 하나뿐입니다. 임의 transport나 monorepo topology를 위한 NestJS-style hybrid application generator가 아닙니다.
- `fluo generate resource`는 파일만 생성하고 수동 활성화를 요구합니다. 생성된 slice와 test를 작성하지만, 해당 module을 parent/root module에 자동으로 import하지 않습니다.
- `fluo generate`는 built-in `@fluojs/cli/builtin` collection만 로드합니다. NestJS schematic, app-local collection, workspace config file, package-owned generator collection은 스캔하지 않습니다.

## tsconfig Changes

마이그레이션 과정에서는 `tsconfig.json`에서 NestJS 시절의 레거시 데코레이터 가정을 반드시 제거해야 한다.

```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```

- `experimentalDecorators`는 fluo 기준선에서 요구되지 않으며 반드시 비활성 상태를 유지해야 한다.
- `emitDecoratorMetadata`는 DI 연결에 사용되지 않으므로 반드시 비활성 상태를 유지해야 한다.
- 메타데이터 emit이나 `reflect-metadata`에 의존하던 코드는 반드시 명시적 토큰과 명시적 등록 방식으로 옮겨야 한다.
- Bun 마이그레이션도 같은 metadata rule을 유지합니다. Runtime-specific fetch hosting이 NestJS reflection metadata 가정을 되살리지 않으므로 controller, provider, gateway는 fluo의 standard decorator metadata store와 명시적 module/provider registration에 머물러야 합니다.

## CLI Migration Preview

`fluo migrate`는 기본적으로 dry-run 모드로 실행됩니다. 파일을 쓰기 전에 NestJS-to-fluo codemod report를 확인하려면 다음 명령을 사용하세요:

```bash
fluo migrate ./src
fluo migrate ./src --json
```

Report와 warning을 검토한 뒤에만 `--apply`를 사용하세요. 더 좁은 pass가 필요하면 `--only <comma-list>` 또는 `--skip <comma-list>`로 활성 transform을 제한할 수 있습니다:

```bash
fluo migrate ./src --apply
fluo migrate ./src --apply --json
fluo migrate ./src --only imports,inject-params
fluo migrate ./src --skip tests
```

기본 출력은 사람이 읽는 형식입니다. CI 작업, dashboard, migration report에서 안정적인 machine-readable output이 필요하면 `--json`을 추가하세요. JSON 모드는 성공 시 stdout에 structured migration report만 씁니다. Parser 오류와 잘못된 flag 조합은 기존처럼 stderr에 메시지를 쓰고 exit code `1`을 반환하며 partial JSON을 출력하지 않습니다.

JSON report에는 `mode`(`dry-run` 또는 `apply`), `dryRun`, `apply`, 활성화된 `transforms`, `scannedFiles`, `changedFiles`, 전체 `warningCount`, 파일별 metadata가 포함됩니다. 각 파일 항목은 `filePath`, 파일 변경 여부, 적용된 transform, warning count, category label과 source line number가 포함된 warning detail을 기록합니다.

Codemod는 import 재작성, `@Injectable()` 제거, provider scope 매핑, constructor parameter `@Inject(...)` 사용 migration, 지원되는 bootstrap/listen 패턴 재작성, test template의 `@fluojs/testing` helper 방향 갱신, decorator compiler flag 갱신, `baseUrl` path alias 설정 재작성을 수행할 수 있습니다. 그래도 수동 검토는 필요합니다. 마이그레이션을 수락하기 전에 모든 warning category를 post-codemod checklist 항목으로 처리하세요.

## Related Docs

- [NestJS Parity Gaps](../contracts/nestjs-parity-gaps.ko.md)
- [DI and Modules](../architecture/di-and-modules.ko.md)
- [Decorators and Metadata](../architecture/decorators-and-metadata.ko.md)
- [fluo new Support Matrix](../reference/fluo-new-support-matrix.ko.md)
