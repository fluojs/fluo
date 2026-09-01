# NestJS → fluo Migration Map

<p><strong><kbd>한국어</kbd></strong> <a href="./migrate-from-nestjs.md"><kbd>English</kbd></a></p>

이 문서는 마이그레이션 계약 맵으로 사용한다. 각 행은 NestJS 구성 요소에 대해 허용되는 가장 가까운 fluo 대상 구성을 지정하고, 아래 규칙은 일대일 치환이 되지 않는 지점을 명시한다.

## 응답 쿠키 마이그레이션

`res.cookie()`와 `res.clearCookie()`를 `@fluojs/http`의 `setCookie(response, name, value, options?)`, `clearCookie(response, name, options?)`로 바꾸세요. 이 free function은 `FrameworkResponse`를 통해 작동하므로 controller가 Express나 Fastify에 결합되지 않습니다.

```ts
// Before: Express를 사용하는 NestJS
res.cookie('session', token, { httpOnly: true, maxAge: 3_600_000 });
res.clearCookie('session');

// After: fluo
setCookie(context.response, 'session', token, {
  httpOnly: true,
  maxAgeSeconds: 3_600,
  path: '/',
});
clearCookie(context.response, 'session', { path: '/' });
```

> **경고:** Express `res.cookie()`의 기본값은 `Path=/`입니다. 이식 가능한 `setCookie()`는 `options.path`를 전달하지 않으면 `Path`를 작성하지 않으므로, Express cookie의 scope를 보존하려면 마이그레이션할 때 `path: '/'`를 전달하세요. `clearCookie()`에도 동일한 `path`(그리고 있을 경우 `domain`)를 반복 전달해야 합니다.

`maxAgeSeconds`에는 명시적인 정수 초 단위 lifetime을 사용하고 Express의 millisecond 값을 그대로 옮기지 마세요. 반복 helper 호출은 독립적이고 순서가 보존되는 `Set-Cookie` field로 유지됩니다. clear operation은 `Max-Age=0`과 과거 `Expires`를 작성하므로 같은 browser cookie를 대상으로 하려면 기존 `path`와 `domain`을 다시 전달해야 합니다.

## 실행 가능한 JWT 학습 경로

완전한 Chapter 14 경로에서는 `JwtModule.forRootAsync(...)`보다 먼저 `ConfigModule.forRoot()`와 global `AuthPersistenceModule`을 import합니다. `AuthPersistenceModule`은 durable `REFRESH_TOKEN_STORE` 및 `CREDENTIALS_VERIFIER` token을 export하고, `AuthModule`은 `AuthService`를 `providers`에, `AuthController`를 `controllers`에 등록합니다. 이는 NestJS dynamic-module configuration이 아니라 application-graph wiring입니다. 전체 실행 가능한 module은 [`book/beginner/ch14-jwt.ko.md`](../../book/beginner/ch14-jwt.ko.md)를 따르세요.

## Decorator metadata 사전 로드 순서

fluo 내장 데코레이터는 runtime record를 framework-owned store에 저장하므로 import 시점의 전역 변경이 필요하지 않습니다. 반면 `context.metadata`를 읽도록 마이그레이션한 사용자 정의 표준 데코레이터와 `@fluojs/serialization` 데코레이터는 decorated class module이 평가되는 동안 `Symbol.metadata`가 필요합니다.

decorated application graph를 static import한 뒤 같은 bootstrap module에서 `ensureMetadataSymbol()`을 호출하면 안 됩니다. ESM은 bootstrap module body보다 static dependency를 먼저 평가하므로 그 호출은 너무 늦습니다. symbol을 설치한 다음 일반 bootstrap graph를 dynamic import하는 preload entrypoint를 사용하세요.

```ts
// preload.ts — 이 파일을 애플리케이션 entrypoint로 설정합니다.
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
await import('./bootstrap.js');
```

## API Correspondence Table

프로덕션 코드를 마이그레이션할 때는 NestJS 원본 패턴이 아니라 두 번째 열의 fluo 구성을 적용한다.

| NestJS 구성 요소 | fluo 구성 요소 | 메모 |
| --- | --- | --- |
| `@Module({ imports, controllers, providers, exports })` | `@fluojs/core`의 `@Module({ imports, controllers, providers, exports })` | 모듈 경계와 명시적 export는 그대로 주요 구성 단위다. |
| 모듈 `imports` 배열의 `forwardRef(() => OtherModule)` | 직접 대응 없음; 공유 프로바이더를 세 번째 모듈 또는 패키지로 추출 | fluo는 모듈 그래프 컴파일 중 순환 모듈 import를 거부한다. `forwardRef(...)`는 클래스 수준 `@Inject(...)` 목록과 프로바이더 `inject` 배열에서만 쓰는 의존성 토큰 wrapper이며, 모듈 순환이나 실제 생성자 순환을 해석 가능하게 만들지 않는다. |
| `@Controller('/users')` | `@fluojs/http`의 `@Controller('/users')` | 컨트롤러 데코레이터는 코어 패키지가 아니라 HTTP 패키지에 속한다. |
| `@Get()`, `@Post()` 등 라우트 데코레이터 | `@fluojs/http`의 `@Get()`, `@Post()` 등 | HTTP 라우트 선언은 계속 메서드 기반 데코레이터를 사용한다. |
| `@Sse()` | `@fluojs/http`의 `@Sse()`와 수동 stream용 `SseResponse` 또는 managed stream용 `AsyncIterable` | fluo는 `@Sse()`를 `text/event-stream` metadata를 가진 `GET` 라우트로 매핑한다. `AsyncIterable` 값은 SSE frame으로 변환할 수 있지만, NestJS `Observable` 반환값은 여전히 `SseResponse` 또는 async iterable로 재작성해야 한다. |
| 반환 DTO, `@Res()`, 또는 passthrough/manual response write와 함께 쓰는 `ClassSerializerInterceptor` | framework-managed 반환값에는 `@fluojs/serialization`의 `SerializerInterceptor`; 명시적인 handler ownership에는 `RequestContext.response` | Response가 commit되지 않은 동안에만 반환값을 직렬화한다. `send(...)`, `redirect(...)`, 또는 수동 stream이 response를 commit하면 `SerializerInterceptor`는 serialization 대신 `next.handle()`에서 받은 값을 그대로 반환한다. 다른 interceptor는 chain 결과를 계속 변환할 수 있으며, dispatcher는 두 번째 success-response write를 건너뛴다. |
| `class-transformer`의 `@Expose()`, `@Exclude()`, `@Transform()` | `@fluojs/serialization`의 `@Expose()`, `@Exclude()`, `@Transform()` | interceptor뿐 아니라 decorator도 교체합니다. fluo transform callback은 동기식이며 field value만 받으므로 여러 field를 조합한 출력은 DTO field를 할당하기 전에 계산하세요. Base metadata는 상속되지만 child override는 base와 sibling DTO에서 분리됩니다. |
| `NestFactory.create(AppModule)` | `@fluojs/runtime`의 `FluoFactory.create(AppModule, { adapter })` | HTTP listen에는 `createFastifyAdapter()` 같은 명시적 platform adapter가 필요하다. `FluoFactory.create(AppModule)`은 adapterless application shell도 만들 수 있지만 그 shell은 `listen()`을 호출할 수 없다. |
| NestJS `beforeApplicationShutdown(signal?)` | 직접 대응 없음; `@fluojs/runtime`의 `onModuleDestroy()` 또는 `onApplicationShutdown(signal?)` 사용 | `beforeApplicationShutdown`은 지원하지 않는다. Application-wide signal phase보다 먼저 수행할 shutdown preparation은 `onModuleDestroy()`에 두고, signal이 필요한 cleanup은 `onApplicationShutdown(signal?)`에 둔다. fluo는 compatibility shim이나 추가 runtime hook을 제공하지 않는다. |
| `@nestjs/config` `ConfigModule.forRoot(...)`, `forRootAsync(...)`, `load`, `validate`, `isGlobal` | `@fluojs/config`의 `ConfigModule.forRoot({ processEnv, schema, global? })` | fluo registration은 동기 방식이다. 명시적 `processEnv` snapshot을 전달하고 동기 Standard Schema validator를 사용하며 visibility에는 기본값이 `true`인 `global?: boolean`을 사용한다. Async factory는 module registration 전에 resolve하되 nested object를 deep merge와 dot-path access를 위해 보존하고, 하나의 validated snapshot을 `ConfigModule`과 HTTP adapter input에 함께 사용한다. `ConfigService.get(key)`와 `getOrThrow(key)`는 key 하나만 받으며, `get(key, defaultValue)`나 `get(key, { infer: true })` 같은 NestJS default-value 및 options overload에 대응하는 fluo API는 없다. 기본값은 `defaults` 또는 `schema` output이 소유하거나, `get(key)` 결과에 call-site `??` fallback을 명시적으로 적용한다. |
| `@nestjs/passport` `PassportModule.register(...)`, `PassportStrategy(...)`, named `AuthGuard(...)`, session, serializer | `@fluojs/passport`의 `createPassportJsStrategyBridge(...)`, `PassportModule.forRoot(...)`, 명시적 bridge provider/named registration, `mapPrincipal(...)` | 명시적으로 제공한 Passport.js strategy를 한 번에 하나씩 adapt한다. `bridge.providers`를 등록하고 `bridge.strategy`를 fluo registry에 전달한 뒤 Passport user를 fluo principal로 map한다. Middleware, sessions, serializers/deserializers, strategy discovery, host integration은 bridge 외부에 남는다. |
| `@nestjs/passport` `PassportModule.registerAsync(...)` | 애플리케이션 소유 비동기 configuration 해석 후 `@fluojs/passport`의 동기 `PassportModule.forRoot(...)` | fluo에는 async Passport registration이나 dynamic-module parity layer가 없다. Application bootstrap/composition boundary에서 secret과 configuration을 resolve하고 최종 값을 검증한 뒤, 해석된 option을 `forRoot(...)`에 전달한다. |
| dynamic-module `imports`, `useClass`, `useExisting` 또는 provider discovery를 사용하는 NestJS JWT async registration | `@fluojs/jwt`의 `JwtModule.forRootAsync({ inject, useFactory, global? })` | `JwtModule.forRootAsync(...)`의 `inject`에 지정한 의존성은 JWT options provider가 resolve되기 전에 application module graph에 먼저 등록해야 하며, `useFactory`는 최종 `JwtVerifierOptions`를 반환한다. 최상위 `global?`은 반환된 module의 가시성을 제어하며, `useFactory`가 반환하는 최종 `JwtVerifierOptions`와는 별개다. NestJS `imports`, `useClass`, `useExisting`은 지원되는 typed configuration의 일부가 아니며 dynamic-module 의미도 없다. 추가 JavaScript object property는 runtime에서 읽지 않을 뿐 validate하거나 reject하지 않는다. `JwtModule.forRootAsync(...)`의 의존성은 global로 visible한 module export 또는 `JwtRuntimeModule`이 resolve할 수 있는 application graph의 bootstrap runtime provider에서 와야 한다. ordinary sibling 또는 parent module의 export만으로는 충분하지 않으며, parent module providers에만 local인 provider도 JWT options provider에서 보이지 않는다. `JwtModule.forRootAsync(...)`는 암묵적 module 또는 provider discovery를 지원하지 않는다. 비대칭 access token과 HMAC refresh token을 함께 사용하면 `refreshToken.algorithms`를 명시적으로 설정하고, refresh token만을 위해 access-token list에 HS 알고리즘을 추가하지 마세요. |
| NestJS `JwtService.signAsync()` / `verifyAsync()` 또는 동기처럼 보이는 `sign()` / `verify()` 마이그레이션 | `@fluojs/jwt`의 `await JwtService.sign(...)` 및 `await JwtService.verify(...)` | fluo는 Promise를 반환하는 `sign()`과 `verify()`를 직접 노출하며 `signAsync()` 또는 `verifyAsync()` alias는 제공하지 않는다. resolve되지 않은 Promise를 token이나 claims 객체로 전달하지 마세요. `decode()`는 동기이지만 검증되지 않은 입력만 parse하므로 권한 결정을 해서는 안 됩니다. durable storage, rotation, endpoint wiring은 완결된 [JWT refresh 학습 경로](../../book/beginner/ch14-jwt.ko.md#145-refresh-token-rotation)를 따르세요. |
| Cloudflare Workers로 이동할 때의 NestJS HTTP server lifecycle hook 또는 late WebSocket server mutation | `@fluojs/platform-cloudflare-workers`와 `@fluojs/websockets/cloudflare-workers`의 `CloudflareWorkersWebSocketModule.forRoot()` | Workers는 server socket 대신 host-owned `fetch(request, env, ctx)` boundary를 노출합니다. `listen()`은 fluo dispatcher만 binding합니다. Application graph에 Worker WebSocket module을 등록하여 bootstrap이 해당 listen boundary 전에 binding을 구성하도록 하세요. 수락된 각 request는 `ctx.waitUntil(...)`로 추적됩니다. Bootstrap에는 미리 선언한 root module과 option만 전달되고 request `env`는 dispatch 중에 연결되므로, `env`는 `ConfigModule.forRoot(...)` 또는 singleton bootstrap provider를 구성할 수 없습니다. 별도로 사용할 수 있는 pre-registration 값만 bootstrap configuration에 두세요. `RequestContext`에서 선택한 fetch-time binding을 읽고 검증하고 좁힌 뒤 application-shaped 값으로 provider method에 전달하세요. |
| `@Injectable()` 프로바이더 마커 | `@Module(...).providers`에 등록된 프로바이더 클래스 또는 provider definition | fluo는 필수 프로바이더 등록 단계로 `@Injectable()`을 사용하지 않는다. |
| `@Injectable({ scope: Scope.REQUEST })` 또는 `@Injectable({ scope: Scope.TRANSIENT })` | `@Scope('request')` / `@Scope('transient')` 또는 provider `scope: 'request'` / `scope: 'transient'`를 사용한 명시적 프로바이더 등록 | 프로바이더의 기본 scope는 singleton이다. Request-scoped provider는 `createRequestScope()` child에서 resolve해야 하며 NestJS-style scope bubbling으로 승격되지 않는다. |
| `@Inject(TOKEN)`과 함께 쓰는 `@Optional()` | `@fluojs/core` 및 `@fluojs/di`의 클래스 수준 `@Inject(optional(TOKEN))` 또는 provider `inject: [optional(TOKEN)]` | `optional(TOKEN)`은 decorator가 아니라 token wrapper다. 등록되지 않은 optional token은 `undefined`로 resolve되므로 constructor parameter는 `undefined`를 허용해야 한다. |
| `emitDecoratorMetadata`를 통한 생성자 타입 리플렉션 | `@fluojs/core`의 `@Inject(TokenA, TokenB)` | 생성자 의존성은 데코레이터 인자 순서대로 명시한다. |
| `@Inject(TOKEN) private value` 같은 속성 주입 | 클래스 수준 `@Inject(TOKEN)`과 이에 대응하는 생성자 매개변수 | fluo의 `@Inject(...)`는 생성자 토큰을 매개변수 순서대로 선언하는 표준 클래스 데코레이터다. 속성 또는 생성자 매개변수 데코레이터가 아니다. |
| `class-validator` / 데코레이터 중심 DTO 검증 | Zod와 Valibot을 포함한 Standard Schema를 지원하는 `@fluojs/validation` | 이는 class-validator 호환 계층이 아니라 fluo 고유 검증 surface다. 일반 validator는 `null` / `undefined`를 건너뛰고, 필수값에는 `@IsDefined()`를 사용하며, plain 객체 materialization은 안전한 own enumerable 추가 속성을 기본적으로 유지하며 `materialize(..., { undeclaredProperties: 'reject' })`를 통한 opt-in 거부를 지원하고 validation group은 지원되지 않는다. |
| `@ValidateNested()`와 class-transformer `@Type(() => ChildDto)` 조합 | `@fluojs/validation`의 `@ValidateNested(() => ChildDto)` | 중첩 DTO target을 decorator argument로 명시합니다. `@Type(...)`과 class-transformer import를 제거하세요. fluo는 class-transformer metadata나 reflected design type을 소비하지 않습니다. |
| `nestjs-i18n` `I18nModule.forRoot(...)`, request locale resolver, request-scoped `I18nContext`, localized validation filter | `@fluojs/i18n`의 `I18nModule.forRoot(...)`; `@fluojs/i18n/http`의 `createAcceptLanguageLocaleResolver(...)`, `resolveHttpLocale(...)`, `getHttpLocale(...)`; `@fluojs/i18n/validation`의 `localizeDtoValidationError(...)` | 아래에서 설명하는 동기 root registration 전에 비동기 catalog와 configuration input을 resolve한다. 그런 다음 application-owned request boundary에서 각 locale을 resolve 및 저장하고 translation과 validation localization에 명시적으로 전달한다. fluo는 NestJS resolver class를 discovery하거나 implicit request-locale global을 노출하지 않는다. |
| `SwaggerModule.createDocument(...)`와 `SwaggerModule.setup(...)` | `@fluojs/openapi`의 `OpenApiModule.forRoot({ title, version, sources, descriptors, documentPath, ui, uiPath, swaggerUiAssets })` | OpenAPI 도입은 명시적이다. 문서화할 모든 controller를 `sources`에 나열하거나, 미리 만든 HTTP handler mapping을 `descriptors`에 전달하거나, 둘 다 사용한다. fluo는 application module graph에서 controller를 scan하지 않는다. `documentPath`와 `uiPath`의 기본값은 `/openapi.json`과 `/docs`이며, 여러 문서를 제공할 때는 module instance마다 서로 다른 값을 지정한다. Swagger UI는 `ui: true`일 때만 제공되고 `swaggerUiAssets`로 기본 CSS와 JavaScript URL을 교체할 수 있다. 정규화된 runtime route가 충돌하면 bootstrap이 `RouteConflictError`로 실패한다. |
| `@nestjs/graphql` resolver discovery, reflected return type, parameter decorator, `forRootAsync(...)` | `@fluojs/graphql`의 `GraphqlModule.forRoot(...)`, module provider/controller, `@Resolver`, root operation decorator, `@FieldResolver`, `@Args`, `@Parent`, `@Context`, `listOf(...)` | Resolver class를 compiled module의 provider 또는 controller로 등록한다. `resolvers` option은 discovery 가능한 class에 적용하는 선택적 allowlist/filter다. 이를 생략하거나 빈 list를 전달하면 등록된 decorated candidate를 모두 허용한다. fluo는 metadata에서 provider나 GraphQL output type을 추론하지 않는다. Object 결과에는 `outputType`, array에는 `outputType: listOf(ItemType)`이 필요하며 생략한 output type은 GraphQL `String`을 사용한다. Object field는 `@Resolver('TypeName')`으로 named code-first output type에 연결한다. TC39 표준 데코레이터는 parameter decorator를 지원하지 않으므로 field resolver method에 서로 다른 index의 `@Args(index?)`, `@Parent(index?)`, `@Context(index?)`를 배치한다. Code-first field argument DTO binding은 `@FieldResolver({ input: InputDto })`, 선택적 `argTypes`, `@Args(index?)`로 지원하며 `input`과 `@Args()`는 서로 필요하고 root operation에서는 유효하지 않다. `forRootAsync(...)`, schema-first field-resolver attachment, `@Subscription({ topics })` 계약은 없다. 선택적 WebSocket subscription에는 server-backed Node HTTP/S adapter가 필요하다. |
| `@Param()`, `@Query()`, `@Body()`, `@Headers()`, `@Req()`, `@Res()` 같은 controller parameter decorator와 `Pipe` / `ValidationPipe` transformation | `@fluojs/http`의 `@RequestDto(...)`와 field-level `@FromPath(...)`, `@FromQuery(...)`, `@FromBody(...)`, `@FromHeader(...)`, `@FromCookie(...)`, `@Convert(...)`; 고급 request/response 접근을 위한 `RequestContext` handler parameter | fluo는 NestJS-style controller parameter decorator나 public parameter Pipe 단계를 노출하지 않는다. 하나의 request DTO를 바인딩하고, 각 field source를 선언하며, number/boolean/date/domain conversion에는 `@Convert(...)`를 사용한 뒤 materialized DTO를 validation package로 검증한다. |
| `createApplicationContext()` 단독 부트스트랩 | `FluoFactory.createApplicationContext(AppModule)` | `@fluojs/runtime`에 standalone application context가 존재한다. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `@fluojs/testing`의 `createTestingModule({ rootModule }).overrideModule(...)` | fluo testing은 명시적 `rootModule`과 replacement compile seam을 사용하므로 전역 module metadata를 mutate하지 않고 authored module identity를 보존한다. |
| NestJS 요청 transaction interceptor | 영속성 패키지의 서비스 `@Transaction()` 또는 controller/request 경계의 명시적 `requestTransaction(...)` | `PrismaTransactionInterceptor`와 `MongooseTransactionInterceptor`는 기존 import를 위한 deprecated 1.x 호환성 bridge로 유지된다. 새 코드는 비즈니스 transaction을 서비스에 두고, 전체 요청이 하나의 경계를 공유해야 할 때만 명시적 `requestTransaction(...)`을 사용하며 가능한 경우 `RequestContext.request.signal`을 전달한다. Drizzle은 호환성 interceptor export를 제공하지 않는다. |
| `HealthCheckService.check([...])`를 호출하는 `@HealthCheck()` 컨트롤러 메서드 | `@fluojs/terminus`의 `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` | Module-level registration이 기본 API이므로 runtime `/health`와 `/ready` route가 indicator 및 platform diagnostics를 일관되게 포함한다. |
| NestJS Terminus memory/disk 또는 Redis check | `@fluojs/terminus/node`와 `@fluojs/terminus/redis` | Node.js memory/disk helper와 Redis helper는 전용 subpath에 있다. Root package는 Redis peer나 Node filesystem access를 기본 import 경계에 포함하지 않는다. |
| `@nestjs/throttler` 전역 throttler 설정 | `@fluojs/throttler` / `@fluojs/http`의 `ThrottlerModule.forRoot(...)`와 명시적 `@UseGuards(ThrottlerGuard)` | Module registration은 정책과 guard provider를 제공한다. Route enforcement는 guard를 붙인 위치에서만 시작된다. |
| `@WebSocketGateway()`와 `@SubscribeMessage()` 및 parameter decorator | `@fluojs/websockets`의 `@WebSocketGateway()`와 `@OnMessage(event?)`, positional handler argument, 선택적 `WebSocketRoomService` | fluo websocket handler는 `(payload, socket, request, socketId)`를 직접 받습니다. 안정적인 `socketId`는 `WebSocketRoomService`에 전달할 수 있습니다. Nest-style `@MessageBody()`, `@ConnectedSocket()`, `@SubscribeMessage()` parameter/decorator rewrite는 없습니다. |
| NestJS Socket.IO gateway return value, gateway `path`, scoped provider 또는 `@WebSocketServer()` | `@fluojs/socket.io`와 `@fluojs/websockets` decorator, `@OnMessage(...)`, 명시적 acknowledgement callback, singleton gateway 등록, `@Inject(SOCKETIO_SERVER)` | Socket.IO handler 반환값은 암묵적인 emit 또는 ACK reply가 되지 않습니다. fluo의 `@WebSocketGateway({ path: '/chat' })`는 Socket.IO namespace `/chat`에 매핑되고 Engine.IO request path는 `/socket.io/`로 유지되므로 NestJS Engine.IO `path` 가정을 옮기지 마세요. Migration한 gateway는 singleton provider/controller로 등록해야 하며 request/transient gateway는 warning 후 skip됩니다. Socket.IO gateway에서 `serverBacked`는 지원하지 않습니다. Decorator에는 websockets companion을 설치/import하고 gateway server 접근, multi-room emit, volatile delivery를 마이그레이션할 때 `SOCKETIO_SERVER`를 주입하세요. |
| `@nestjs/cache-manager` / `CacheModule.register(...)` / `registerAsync(...)` | `@fluojs/cache-manager`의 `CacheModule.forRoot(...)`, `CacheModule.forRootAsync({ inject, useFactory, global? })`, `CacheService`, cache decorators | 최종 store, TTL, namespace, key strategy가 DI나 bootstrap 작업에 의존하면 injected-factory async registration을 사용한다. 의존성은 bootstrap runtime provider 또는 globally visible export에서 와야 하며 NestJS `imports`, `useClass`, `useExisting`은 지원하지 않는다. |
| `@nestjs/event-emitter` / `@OnEvent()` handler | `@fluojs/event-bus`의 `EventBusModule.forRoot(...)`, `EventBusLifecycleService`, `@OnEvent(EventClass)` | Event routing은 class 기반이고, `static eventKey`는 distributed transport channel을 안정적으로 유지하며, handler는 singleton provider/controller에서만 discovery되고 awaited/background publish 작업은 shutdown drain tracking에 남는다. Throw하거나 reject한 listener 실패는 local 및 inbound transport dispatch에서 log되고 격리되므로 다른 matching listener는 계속 실행되며, 그 listener 실패만으로 `publish(...)`가 reject되거나 inbound callback completion을 통해 실패가 외부로 드러나지는 않는다. |
| `@nestjs/cqrs` command/query/event handler와 saga | `@fluojs/cqrs`의 `CqrsModule.forRoot(...)`, 표준 `@CommandHandler(...)`, `@QueryHandler(...)`, `@EventHandler(...)`, `@Saga(...)` | CQRS discovery는 controller나 emitted design metadata가 아니라 singleton provider만 scan합니다. Command와 Query는 point-to-point이고, Event handler와 saga는 위임 `@fluojs/event-bus` 발행 전에 provider token 기준으로 fan-out됩니다. |
| `ClientsModule.register(...)`, 주입된 `ClientProxy`, NestJS broker transport option | `MicroservicesModule.forRoot({ transport })`, `Microservice` 타입의 `MICROSERVICE`, `@fluojs/microservices/<transport>`의 transport adapter | Registration과 programmatic facade는 root `@fluojs/microservices`에 남습니다. NATS, Kafka, RabbitMQ collaborator는 application-owned 상태를 유지하며, `send()`, `emit()`, `close()`는 아래에 설명한 서로 다른 완료 경계를 가집니다. |
| NestJS `@MessagePattern(...)` / `@EventPattern(...)` handler discovery와 provider metadata | `@fluojs/microservices`의 TC39 표준 pattern decorator와 명시적 module `providers` 또는 `controllers` 등록 | fluo는 compiled module graph에 등록된 class의 decorated public instance method만 탐색합니다. NestJS metadata, `reflect-metadata`, emit된 design type은 scan하지 않습니다. |
| NestJS Redis async module registration 또는 shared Redis Pub/Sub client | `@fluojs/redis`의 `RedisModule.forRoot(...)`, named `RedisModule.forRoot({ name, ... })`, `getRedisClientToken(name)` | fluo Redis registration은 동기 방식이며 각 `forRoot(...)` 호출이 최종 option으로 client를 생성한다. 환경별 option은 registration 전에 해석하되 외부에서 만든 client를 전달하거나 module이 채택한다고 기대하면 안 된다. Pub/Sub subscriber는 일반 command client를 재사용하지 말고 전용 duplicate 또는 named client로 분리한다. |
| `@Processor(...)`, `@Process(...)` 또는 provider metadata를 통한 `@nestjs/bull` / `@nestjs/bullmq` processor discovery | `@fluojs/queue`, `@fluojs/redis`, `@fluojs/core`의 `RedisModule.forRoot(...)`, `QueueModule.forRoot(...)`, singleton `@QueueWorker(JobClass, options?)` provider, 명시적 `@Inject(...)` | fluo는 compiled module graph의 decorated singleton provider/controller만 discovery한다. Worker는 `handle(job)`을 노출해야 하며, Queue는 NestJS metadata를 읽거나 legacy Bull/BullMQ `queueName`, named job, 영속 payload 또는 그 topology를 자동 보존하지 않는다. Queue는 필수 runtime dependency와 일치하는 Node.js `>=20.19.3 <21 || >=22.2.0 <27`이 필요하다. |
| `@nestjs/schedule` decorator, `SchedulerRegistry`, 또는 `CronJob` handle | `@fluojs/cron`의 `CronModule.forRoot(...)`, public-method `@Cron` / `@Interval` / `@Timeout`, `SCHEDULING_REGISTRY` | NestJS `timeZone`을 fluo `timezone`으로 바꾼다. fluo에는 `waitForCompletion` 옵션이 없고 같은 task instance가 아직 실행 중이면 항상 해당 tick을 건너뛰므로 이 옵션을 옮기지 않는다. fluo는 decorator로 발견한 task를 application bootstrap 중 시작하고, 이미 시작된 registry에 dynamic task가 추가되면 즉시 시작하며, live scheduler handle 대신 read-only task descriptor를 노출한다. |
| `imports`, `useClass`, `useExisting`를 사용하는 NestJS-style email async module registration | `@fluojs/email`의 `EmailModule.forRootAsync({ inject, useFactory, global? })` | fluo email async registration은 injected factory option만 지원한다. 필요한 의존성은 application module graph에 먼저 등록하고 token을 `inject`에 나열하며, 기본 global provider visibility에서 벗어나야 할 때만 `global: false`를 설정한다. |
| NestJS-style notification module, decorator-discovered channel provider, 또는 implicit queue/event integration | `@fluojs/notifications`의 `NotificationsModule.forRoot({ channels, queue?, events?, global? })` 또는 `NotificationsModule.forRootAsync({ inject, useFactory, global? })` | fluo notifications registration은 `channels`에 전달된 명시적 `NotificationChannel` 값을 사용한다. Queue adapter와 event publisher는 module-owned resource가 아니라 애플리케이션 소유 seam이며, `global: false`를 설정하지 않으면 `NotificationsService`, `NOTIFICATIONS`, `NOTIFICATION_CHANNELS`가 기본 global로 export된다. |
| `imports`, `useClass`, `useExisting`, package-level multi-client registry 또는 `isGlobal`을 가정하는 NestJS Slack module | `@fluojs/slack`의 `SlackModule.forRoot({ ..., global? })` 또는 `SlackModule.forRootAsync({ inject, useFactory, global? })` | fluo Slack async registration은 injected factory option만 소비한다. 필요한 의존성은 application module graph에 먼저 등록하고 token을 `inject`에 나열한 뒤, `useFactory`에서 최종 Slack option을 반환한다. 여러 client에는 app-owned module/provider 또는 facade를 조합한다. |
| `imports`, `useClass`, `useExisting`, `isGlobal`, 또는 custom internal provider token을 가정하는 NestJS Discord module | `@fluojs/discord`의 `DiscordModule.forRoot({ ..., global? })` 또는 `DiscordModule.forRootAsync({ inject, useFactory, global? })` | fluo Discord registration은 singleton 중심이며 async setup은 injected factory만 지원한다. 이 패키지는 `global: false`가 설정되지 않으면 `DiscordService`, `DiscordChannel`, `DISCORD`, `DISCORD_CHANNEL`을 기본 global로 export하고, 내부 provider helper와 option token은 의도적으로 private으로 유지한다. |

## OpenAPI 계약 차이

NestJS Swagger 마이그레이션은 생성 문서 경계에서 일대일 대응이 아닙니다.

- fluo는 명시적으로 선언한 응답을 대체하지 않으면서 기본적으로 `400`, `401`, `403`, `404`, `500` 응답과 `ErrorResponse` schema를 추가합니다. client를 다시 생성하기 전에 생성된 error contract를 검토하거나, legacy client에 주입된 응답이 들어가면 안 되는 경우 `defaultErrorResponsesPolicy: 'omit'`을 선택하세요.
- fluo는 controller tag, handler name, HTTP method, normalized path에서 `operationId`를 만들고 충돌에는 숫자 suffix를 붙입니다. 생성된 client가 legacy operation identifier를 요구하면 문서를 제공하기 전에 `documentTransform`으로 생성된 operation ID를 변경하고 변환된 출력을 client generator로 검증하세요.
- `OpenApiModule.forRootAsync(...)`에서는 `documentPath`와 `uiPath`의 route가 `useFactory(...)`가 resolve되기 전에 compile되므로 두 값은 바깥 registration object에 둡니다. route는 `inject`와 `useFactory` 옆에 두고 factory에서는 document configuration을 반환하세요. factory가 반환한 path로는 등록된 route를 다시 구성할 수 없습니다.

## GraphQL Field Resolver DTO Arguments

Field argument DTO binding에 대한 이전 migration 제한은 code-first object field에서는 더 이상 적용되지 않는다. `InputDto`의 GraphQL argument field에 `@Arg(...)`를 두고 `@FieldResolver({ input: InputDto })`로 전달한 뒤 materialize 및 validate된 DTO를 `@Args(index?)`로 바인딩한다. `@Args()`, `@Parent()`, `@Context()`는 TC39 method decorator이므로 각 binding은 서로 다른 zero-based method index를 사용해야 하며, index 충돌은 decorator evaluation 중 실패한다. Bootstrap은 `@Args()` 없는 `input`, `input` 없는 `@Args()`, root operation에 둔 이 binding들을 모두 거부한다. Request-scoped root 및 field resolver는 하나의 HTTP 또는 subscription operation container를 공유한다. Schema-first field-resolver attachment는 계속 지원하지 않는다.

### Field Resolver DTO 제한

Code-first `@FieldResolver({ input: InputDto })`와 `@Args(index?)` DTO binding은 지원합니다. 남아 있는 제한은 schema-first field-resolver attachment뿐입니다.

## Breaking Differences

- 데코레이터는 반드시 TC39 표준 모델을 따라야 한다. NestJS의 레거시 데코레이터 가정은 그대로 유지되지 않는다.
- 의존성 주입은 생성자 타입에서 절대 추론되지 않는다. fluo는 생성자 의존성에 대해 명시적 `@Inject(...)` 선언을 요구한다.
- NestJS 속성 주입은 반드시 생성자 주입으로 바꾼다. 클래스에 `@Inject(TokenA, TokenB)`를 붙이고 토큰 순서를 생성자 매개변수와 맞추며, 속성이나 매개변수에는 `@Inject(...)`를 붙이지 않는다.
- NestJS provider scope는 scope bubbling이 아니다. fluo provider는 `@Scope('request')`, `@Scope('transient')` 또는 명시적 provider `scope`로 선언하고 singleton은 기본값으로 유지한다. Request-scoped provider는 `createRequestScope()`에서만 resolve해야 한다. Root에서 resolve하면 `RequestScopeResolutionError`가 발생하고 singleton에 주입하면 `ScopeMismatchError`가 발생한다.
- NestJS `@Optional()`은 클래스 수준 `@Inject(...)` token list 또는 provider `inject` 배열의 `optional(Token)`으로 바꾼다. `optional(...)`은 property, parameter, class decorator가 아니며 등록이 없으면 `undefined`로 resolve된다.
- NestJS 모듈 `forwardRef(...)`에 직접 대응하는 fluo 기능은 없다. 공유 프로바이더를 별도 모듈이나 패키지로 추출해 모듈 import 순환을 끊는다. fluo의 `forwardRef(...)`는 클래스 수준 `@Inject(...)` 또는 프로바이더 `inject`에서 의존성 토큰 하나의 조회만 지연하며, 모듈 순환이나 실제 생성자 순환을 해결하지 않는다.
- HTTP listen은 adapter-first 방식이다. `FluoFactory.create(...)`는 platform을 암묵적으로 선택하지 않는다. Adapterless application shell을 만들 수는 있지만 `listen()`에는 명시적 adapter와 함께 생성한 application이 필요하다.
- NestJS `beforeApplicationShutdown`은 지원하지 않으며 fluo의 문서화된 shutdown hook 사이에 새 phase를 추가하지 않는다. Application-wide signal cleanup보다 먼저 준비 작업을 끝내야 하면 `onModuleDestroy()`로 옮기고, signal이 필요하면 `onApplicationShutdown(signal?)`로 옮긴다. Compatibility shim, fallback, alias 또는 새 runtime hook을 도입하면 안 되며 네 hook 계약과 startup/shutdown ordering은 그대로 유지된다.
- `@nestjs/config` migration은 async Dynamic Module 또는 namespace loader를 그대로 복제하지 않는다. `@fluojs/config`는 동기 `ConfigModule.forRoot(...)`를 제공한다. Ambient process value는 명시적 `processEnv` option으로 전달하고, 병합된 snapshot은 동기 Standard Schema `schema`로 검증하며, NestJS `isGlobal` 대신 기본 global visibility를 가진 `global?: boolean`을 사용한다. Remote secret과 NestJS `load` factory는 module graph 구성 전에 application bootstrap boundary에서 await하되 nested object는 `defaults` 또는 `runtimeOverrides`에 그대로 보존한다. Plain object는 deep merge되고 dot-path `ConfigService` lookup으로 계속 접근할 수 있다.
- Configuration은 HTTP adapter 없이 `FluoFactory.create(AppModule)` 또는 `FluoFactory.createApplicationContext(AppModule)`에서 resolve할 수 있다. Adapter requirement는 `listen()`에만 적용된다. `port` 같은 adapter option이 configuration에서 온다면 HTTP application 생성 전에 하나의 validated snapshot을 준비하고, 같은 snapshot을 `ConfigModule`에 등록한 뒤 adapter도 그 값으로 구성한다. `app.listen(port)`가 platform이나 port를 선택하지는 않는다.
- 검증은 `class-validator` 우선 계약을 유지하지 않고 Standard Schema 방향으로 반드시 옮겨야 한다.
- 중첩 DTO 검증은 `@ValidateNested(() => ChildDto)`로 target을 반드시 명시해야 합니다. fluo는 중첩 constructor를 추론하기 위해 class-transformer `@Type(...)`, `reflect-metadata`, emitted design metadata를 소비하지 않습니다.
- NestJS controller parameter decorator, Pipe, `ValidationPipe` migration은 parameter-for-parameter 치환이 아니다. `@Param()`, `@Query()`, `@Body()`, `@Headers()`, `@Req()`, `@Res()` 가정은 하나의 `@RequestDto(...)`, field-level source decorator, `@Convert(...)`, 그리고 low-level 접근이 필요할 때의 명시적 `RequestContext` handler parameter로 바꾼다. 검증은 public controller-parameter Pipe stage가 아니라 DTO materialization 이후에 실행된다.
- Response ownership을 직접 가진 뒤에도 `ClassSerializerInterceptor`처럼 후처리될 것이라고 기대하면 안 된다. `SerializerInterceptor`가 DTO를 shaping해야 한다면 response를 commit하지 말고 DTO를 반환한다. Migrated code가 `RequestContext.response.send(...)`, `redirect(...)`, 또는 수동 streaming helper를 호출한다면 commit 전에 안전한 최종 payload를 만들어야 한다. 이후 `SerializerInterceptor`는 serialization을 우회하고 `next.handle()`에서 받은 값을 그대로 반환하지만, 다른 interceptor는 chain 결과를 계속 변환할 수 있다. Dispatcher는 이와 별개로 두 번째 success-response write를 건너뛴다.
- `ValidationPipe`의 whitelist stripping 가정이나 class-validator group 실행을 그대로 옮기지 않는다. 일반 fluo validator는 `null`과 `undefined`를 건너뛰므로 필수 field에는 `@IsDefined()`를 추가한다. 입력이 plain 객체일 때 `materialize()`는 안전한 own enumerable 추가 속성을 기본적으로 유지한다. 명시적인 재귀 거부 경계가 필요하면 세 번째 인자로 `{ undeclaredProperties: 'reject' }`를 전달한다. 초기화되었거나 metadata가 있는 DTO field와 binding alias는 허용되고 추가 속성은 `UNDECLARED_PROPERTY`를 만들며 어떤 입력도 조용히 제거하지 않는다. 이 정책은 이미 생성된 DTO instance를 검사하지 않는다. Decorator option은 `groups`와 `always`를 지원하지 않는다. Workflow별 규칙에는 별도 DTO, mapped DTO, `@ValidateIf(...)`, class-level validator를 사용한다.
- NestJS i18n request-scoped context와 resolver discovery는 그대로 옮겨지지 않는다. Application-owned request boundary에서 ordered resolver list와 함께 `resolveHttpLocale(...)`을 실행하고, `getHttpLocale(...)`로 해당 `RequestContext`에 저장된 metadata만 읽은 뒤, 그 `locale`을 각 `I18nService` 또는 `localizeDtoValidationError(...)` 호출에 전달한다. Validation helper는 request state나 global locale을 암묵적으로 읽지 않는다.
- NestJS Passport migration은 full NestJS Passport compatibility가 아니다. Passport.js bridge는 명시적으로 등록한 strategy 실행 하나를 fluo `AuthStrategy`로 adapt할 뿐 Passport middleware, sessions, serializers/deserializers, automatic strategy discovery를 설치하지 않는다. Implicit guards, 문서화된 `requestContext.principal` mapping을 넘어서는 request augmentation, host middleware ownership도 추가하지 않는다. Session과 serializer/deserializer migration은 application-owned 상태로 남는다.
- NestJS JWT async registration은 dynamic-module 형태를 그대로 복제하지 않는다. `JwtModule.forRootAsync({ inject, useFactory, global? })`에서 주입할 모든 의존성은 application module graph에 먼저 등록해야 하고, `useFactory`는 최종 `JwtVerifierOptions`를 반환해야 한다. 최상위 `global?`은 반환된 module의 가시성을 제어하며, `useFactory`가 반환하는 최종 `JwtVerifierOptions`와는 별개다. NestJS `imports`, `useClass`, `useExisting`은 지원되는 typed configuration의 일부가 아니며 dynamic-module 의미도 없다. 추가 JavaScript object property는 runtime에서 읽지 않을 뿐 validate하거나 reject하지 않는다. `JwtModule.forRootAsync(...)`의 의존성은 global로 visible한 module export 또는 `JwtRuntimeModule`이 resolve할 수 있는 application graph의 bootstrap runtime provider에서 와야 한다. ordinary sibling 또는 parent module의 export만으로는 충분하지 않으며, `AuthModule.providers`에만 local인 provider는 JWT options provider에서 보이지 않는다. `JwtModule.forRootAsync(...)`는 암묵적 module 또는 provider discovery를 지원하지 않는다. 비대칭 access token과 HMAC refresh token을 함께 사용하면 `refreshToken.algorithms`를 명시적으로 설정하고, refresh token만을 위해 access-token list에 HS 알고리즘을 추가하지 마세요.
- NestJS JWT method name은 동기 경계를 보존하지 않는다. fluo의 `JwtService.sign(...)`과 `JwtService.verify(...)`는 항상 Promise를 반환하므로 모든 migrated 호출에서 `await`를 사용해야 하며 `signAsync()`와 `verifyAsync()` alias는 없다. `JwtService.decode(...)`가 동기인 이유는 서명이나 claim을 검증하지 않고 parse하기 때문입니다. `verify(...)`가 성공할 때까지 decode된 모든 값을 공격자가 제어하는 것으로 취급하고, refresh endpoint를 마이그레이션할 때는 [JWT refresh 학습 경로](../../book/beginner/ch14-jwt.ko.md#145-refresh-token-rotation)를 사용하세요.
- OpenAPI migration은 reflection-driven `SwaggerModule` 치환이 아니다. `OpenApiModule`에는 `title`과 `version`이 필요하며, 문서화할 operation은 명시적 `sources`, 명시적 `descriptors`, 또는 둘 모두에서 와야 한다. Application `controllers`는 자동 추론되지 않는다. Handler 반환값과 TypeScript 반환 타입은 response schema를 만들지 않는다. `@ApiResponse(...)`가 없으면 생성된 success response에는 method-derived 또는 `@HttpCode(...)` status와 `OK` description만 포함된다. Response content가 필요하면 `@ApiResponse(...)`에 `schema` 또는 `type`을 제공한다. 같은 OpenAPI path/method operation이 겹치면 나중 descriptor가 우선하며, module composition은 explicit `descriptors`를 discovered `sources` 뒤에 두므로 충돌 시 explicit descriptor가 이긴다.
- 컨트롤러 데코레이터는 반드시 `@fluojs/http`에서 가져오고, `@Module` 같은 구조 데코레이터는 `@fluojs/core`에서 가져온다.
- Observable을 반환하는 NestJS `@Sse()` 핸들러는 반드시 `SseResponse`를 만들거나 `AsyncIterable`을 반환하도록 재작성해야 한다. 수동 `SseResponse` stream은 `send(...)` 또는 `comment(...)`를 호출하고 request abort 또는 application cleanup 경로에서 닫아야 하며, managed async iterable은 request abort 또는 response stream close 시 dispatcher가 닫는다.
- Drizzle transaction migration은 interceptor-for-interceptor 치환이 아니다. `@fluojs/drizzle`은 서비스 `@Transaction()`을 기본 경계로 사용하고, 드문 controller/request-wide 호환성 사례에만 명시적 `DrizzleDatabase.requestTransaction(...)`을 사용한다.
- Drizzle `@Transaction()`은 `this.db`, 직접 host property, 중첩 `.db` property에서 대상을 추론할 수 있다. Drizzle client가 둘 이상인 서비스는 property discovery에 의존하지 말고 `@Transaction((self) => self.ordersDb)` 같은 명시적 accessor를 반드시 사용한다.
- Drizzle은 등록된 handle에 `database.transaction(...)`이 없고 `strictTransactions`가 `false`이면 fail-open direct execution을 기본값으로 사용한다. rollback 보장이 필요한 production migration 흐름에서는 `strictTransactions: true`를 설정해, transaction 지원 누락이 원자성 없이 조용히 실행되지 않고 readiness 및 helper 호출 실패로 드러나게 한다.
- Vite build transform과 Vitest test transform은 의도적으로 분리되어 있다. 생성된 non-Deno `vite.config.ts`는 애플리케이션 `.ts` 파일에 Babel `{ version: '2023-11' }` decorator transform을 적용하기 위해 `@fluojs/vite`를 사용하고, 생성된 `vitest.config.ts`는 테스트에 `@fluojs/testing/vitest`를 사용한다. 레거시 decorator compiler flag를 다시 켜거나 하나의 transform config가 build와 test 파일을 모두 소유한다고 가정하지 않는다.
- Mongoose transaction migration도 interceptor-for-interceptor 치환이 아니다. 기존 1.x import는 migration 동안 deprecated `MongooseTransactionInterceptor`를 유지할 수 있지만, 비즈니스 원자성에는 서비스 `@Transaction()`을 사용하고 새 request-wide boundary에는 명시적 `MongooseConnection.requestTransaction(...)`을 사용한다.
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
- `@nestjs/throttler`의 TTL 값은 밀리초 단위지만 `@fluojs/throttler`의 `ttl` 값은 초 단위다. 단위를 명시적으로 변환하세요. NestJS의 `ttl: 60_000`은 fluo에서 `ttl: 60`이 된다. 값을 그대로 복사하면 1분 window가 1,000분 window로 바뀐다.
- NestJS의 named skip metadata는 skipped class 아래의 method-level `false`로 throttling을 다시 활성화할 수 있다. fluo의 `@SkipThrottle()`은 인자를 받지 않고 class-와 method-level skip을 additive하게 결합하므로, skipped class 내부의 한 method만 다시 활성화할 수 없다. 보호할 method를 skipped class 밖으로 분리하거나 해당 정책이 필요하면 application-owned guard wrapper를 사용하세요.
- NestJS `ThrottlerModule.forRootAsync(...)` dynamic-module shape은 지원하지 않는다. 비동기 secret, configuration, store 준비는 application bootstrap boundary에서 완료한 뒤, 최종 동기 option을 `ThrottlerModule.forRoot(...)`에 전달하세요.
- `ThrottlerGuard`와 `keyGenerator`는 HTTP `GuardContext`와 `MiddlewareContext`를 소비하므로 WebSocket, GraphQL, RPC, queue transport 정책이 아니다. 각 transport 경계에서 transport-owned guard 또는 middleware로 동등한 제한을 구현하세요.
- NestJS의 persisted throttle window가 fluo에서 계속된다고 가정하면 안 된다. 두 패키지는 서로 다른 bucket key와 storage call contract를 사용하므로 기본 migration은 새 window로 시작한다. 연속성이 필요하면 application-owned compatibility store를 제공하거나 기존 window가 만료되는 것을 허용하는 bounded cutover를 사용하세요.
- `@fluojs/platform-express`는 Node.js `>=20.19.3 <21 || >=22.2.0 <27`이 필요하며 Express를 host engine으로만 보존한다. 이 bounded range는 Node 21, Node 22.2.0 미만, 검증되지 않은 Node 27 이상을 제외해 listener-level RFC `QUERY` ingress를 정확하게 유지한다. NestJS HTTP adapter를 교체하기 전에 controller와 provider를 TC39 표준 데코레이터로 마이그레이션하고, class-level `@Inject(...)`로 constructor token을 선언하며, 명시적 module/provider registration을 사용한다. `experimentalDecorators`와 `emitDecoratorMetadata`는 비활성화한 상태로 유지해야 하며, HTTP host 변경은 NestJS decorator, reflection metadata, implicit dependency-discovery semantics를 보존하지 않는다.
- `@fluojs/platform-express`는 implicit middleware translation layer로 동작하지 않는다. Adapter가 Express application을 직접 생성하고 소유하므로 기존 Express application을 채택하거나 재사용하는 방식은 지원하지 않는다. NestJS 또는 Express migration에서 가져온 native Express/Connect `(req, res, next)` middleware는 Express routing과 fluo dispatch보다 먼저 배열 순서대로 실행되는 adapter의 명시적 `nativeMiddleware` 옵션으로 construction-time에 제공해야 한다. bootstrap 이후 `use(...)`로 native stack에 middleware를 추가하는 방식은 지원하지 않는다. Handler가 `next()`를 호출하면 fluo로 계속 진행하고 response를 끝내면 진행하지 않는다. Native failure는 Express error chain에 남고 native middleware resource는 애플리케이션이 소유한다. 이식 가능한 동작은 fluo `Middleware`로 재작성한 뒤 `fluoFactory.create({ middleware })`에 넣는 방식을 우선한다.
- Proxy 배포를 마이그레이션할 때는 `trustProxy`를 우선 사용하세요. 알려진 proxy 경계를 hop count, CIDR 목록, predicate로 선언하면 그 신뢰된 suffix만 `Forwarded`, `X-Forwarded-For`, host, protocol metadata를 제공할 수 있습니다.
- `trustProxyHeaders: true`는 전체 forwarding chain을 의도적으로 신뢰하는 애플리케이션을 위한 광범위한 legacy compatibility mode입니다. direct-peer-only trust가 아니며 새 배포에는 권장하지 않습니다.
- Malformed forwarding data는 direct transport identity로 fail closed하며 `Forwarded` 또는 `X-Forwarded-For`에서 더 낮은 precedence의 client-IP header로 fall through하지 않습니다.
- Throttling된 응답에서 보장되는 metadata는 HTTP `429`와 `Retry-After`다. 추가 rate-limit header나 body shape는 애플리케이션 경계에서 더한다.
- WebSocket migration은 decorator-for-decorator 치환이 아닙니다. `@fluojs/websockets`의 `@OnMessage(event?)`를 사용하고, handler 입력은 `(payload, socket, request, socketId)` positional argument로 읽으며, room membership 또는 broadcast에는 NestJS gateway server injection이나 parameter decorator가 그대로 이어진다고 가정하지 말고 `WebSocketRoomService`를 사용합니다. `WebSocketRoomService`는 runtime lifecycle service가 구현하는 type-only contract이며, `@Inject(...)`로 lifecycle service token(root entrypoint: `WebSocketGatewayLifecycleService`; 명시적 Node subpath: `NodeWebSocketGatewayLifecycleService`; 다른 runtime subpath: 해당 `*WebSocketGatewayLifecycleService`)을 주입하고 constructor parameter를 `WebSocketRoomService`로 type 지정하세요. Root `@fluojs/websockets`와 `@fluojs/websockets/node` module path는 Node.js default이며 upgrade guard가 `IncomingMessage`를 받습니다. Bun, Deno, Cloudflare Workers migration은 guard/request type과 runtime lifecycle service가 올바른 subpath boundary에 머물도록 `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`에서 import해야 합니다. Room broadcast backpressure는 Node.js 기반 adapter만 적용하며, fetch-style runtime은 room broadcast에 backpressure policy를 적용하지 않습니다. Raw WebSocket gateway 반환값은 기본적으로 await된 뒤 무시됩니다. Reply는 runtime socket argument로 명시적으로 보내거나 `WebSocketModule.forRoot({ replies: { mode: 'event-envelope' } })`로 올바른 `{ event, data? }` return reply를 opt-in하세요.
- Socket.IO migration도 같은 명시적 websocket handler 모델을 유지합니다. `@fluojs/socket.io`는 `@fluojs/websockets`의 `@WebSocketGateway`, `@OnMessage`, lifecycle decorator를 재사용하므로 companion 패키지를 설치하세요. Handler return value는 await된 뒤 무시됩니다. Client가 acknowledgement를 기대하면 제공된 ACK callback을 호출하고, native Socket.IO emit, multi-room fan-out, `.volatile`, `@WebSocketServer()` 대체 코드에는 `@fluojs/socket.io`의 `SOCKETIO_SERVER`를 주입하세요. 이 패키지는 Node.js `>=20.19.3 <21 || >=22.2.0 <27` server-backed adapter와 공식 Bun engine path를 대상으로 하며 Deno와 Workers는 지원하지 않습니다. Bun은 static CORS shape를 요구하고 모든 runtime에서 `@WebSocketGateway({ serverBacked })`를 거부합니다. `@WebSocketGateway({ path })`는 고정된 `/socket.io/` Engine.IO request path가 아니라 Socket.IO namespace를 선택하며 migration한 gateway는 singleton provider/controller여야 합니다. Request/transient registration은 warning 후 skip됩니다.
- Cache-manager migration은 NestJS dynamic-module 형태를 그대로 복제하지 않고 injected-factory 경로인 `CacheModule.forRootAsync({ inject, useFactory, global? })`를 지원한다. 의존성은 bootstrap runtime provider 또는 globally visible module export여야 하며 parent-local provider와 일반 sibling/parent export는 보이지 않는다. `useFactory`에서 `store`, `ttl`, `keyPrefix`, `redis.clientName`, `httpKeyStrategy` 같은 최종 option을 반환한다. Outer `global?`이 module visibility를 제어하며 `imports`, `useClass`, `useExisting`은 지원하지 않는다.
- NestJS-style cache-key customization은 interceptor subclassing 대신 fluo가 문서화한 key seam으로 옮겨야 한다. 애플리케이션 전역 request-aware 정책에는 function-valued `httpKeyStrategy`를 사용하고, handler-local 동작에는 literal key 또는 key factory를 받는 `@CacheKey(...)`를 사용한다.
- Custom cache tooling은 private metadata key를 다시 구현하지 말고 `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, `getCacheEvictMetadata(...)` 같은 exported cache metadata helper를 읽어야 한다.
- Event-bus migration은 string pattern 기반이 아니라 class 기반이다. `@OnEvent(EventClass)`를 사용하고, retry 가능하거나 느린 side effect는 idempotent하게 유지하며, 오래 실행되거나 retry가 중요한 작업은 awaited event handler 안에 숨기지 말고 명시적인 queue handoff로 옮겨야 한다.
- Event-bus publisher completion을 모든 listener의 성공을 확인하는 acknowledgement로 해석하면 안 된다. 일치하는 local listener 실패는 log되고 격리되며, 다른 matching listener는 계속 실행된다. Local listener 실패만으로 `publish(...)`를 reject하지 않는다. Inbound transport listener에는 같은 isolation 규칙이 적용되므로 inbound callback completion은 격리된 listener 실패를 외부로 드러내지 않는다. Publisher completion은 모든 listener가 성공했음을 증명하지 않는다. Timeout, cancellation, transport publication, bootstrap 및 그 밖의 publisher 실패는 이 listener-failure 계약의 범위 밖에 있다. 해당 실패는 각각 별도로 문서화된 동작을 유지한다.
- Distributed routing이 class rename이나 minification 이후에도 유지되어야 하면 직접 선언한 `static eventKey`를 사용한다. Transport publish는 concrete event와 inherited event channel 전체로 fan-out하며, 상속받은 `eventKey`가 subclass channel name을 암묵적으로 대체하지 않는다.
- One-to-many domain-event fan-out에는 `@fluojs/event-bus`를 사용한다. Migration에 point-to-point command/query routing, CQRS event-handler discovery, saga도 필요하면 `@fluojs/cqrs`를 사용한다. CQRS event pipeline은 local CQRS handler와 saga를 실행한 뒤 마지막 publish를 `@fluojs/event-bus`에 위임한다.
- NestJS CQRS migration은 reflection-driven provider scan이 아닙니다. Handler와 saga는 `CqrsModule.forRoot(...)` 뒤의 singleton provider로 등록하세요. Controller는 CQRS discovery에서 제외되며, TC39 standard decorator가 `emitDecoratorMetadata` 없이 명시적인 class metadata를 운반합니다.
- CQRS event handler와 saga fan-out은 provider-token identity를 따릅니다. 하나의 decorated class를 서로 다른 singleton token으로 재사용하면 별도 route가 되고, 같은 token과 event route가 반복 discovery될 때만 deduplicate됩니다. Local event handler가 먼저 완료되고, 일치하는 saga가 두 번째로 완료되며, 위임 `@fluojs/event-bus` 발행이 마지막에 완료됩니다. `publishAll(...)`은 다음 event로 이동하기 전에 이 전체 pipeline을 기다립니다.
- Nested command, query, event, saga dispatch에는 optional `CqrsDispatchContext` 인자를 변경하지 말고 그대로 전달하세요. 이 값은 frozen fieldless value이고 신뢰하는 topology와 shutdown-drain state는 비공개입니다. 직접 생성, 복제, 검사, mutate하지 말고 direct saga dispatch가 shutdown 작업으로 opt-in할 수 있다고 가정하지 마세요.
- Redis migration은 async dynamic-module 치환이 아니다. `@fluojs/redis`는 동기 `RedisModule.forRoot(...)`를 제공하며, 이 호출은 외부 client를 받거나 채택하지 않고 최종 option으로 새 client를 생성한다. Secret, host, TLS option은 application boundary에서 먼저 해석한 뒤 module에 전달하고, 외부 raw client는 module 밖에 두어 application shutdown에서 닫아야 한다.
- Redis Pub/Sub migration은 subscriber 소유권을 명시적으로 유지해야 한다. `client.duplicate()` subscriber는 애플리케이션 소유이므로 만든 코드가 직접 connect, subscribe, close를 책임진다. Subscriber client lifecycle timeout까지 fluo가 소유해야 한다면 named `RedisModule.forRoot({ name: 'subscriber', ... })`와 `getRedisClientToken('subscriber')`를 사용한다.
- Queue migration은 NestJS processor-discovery compatibility layer가 아니다. Redis와 `QueueModule.forRoot(...)`를 등록하고, 각 processor를 `handle(job)`을 구현하는 TC39 표준 `@QueueWorker(JobClass, options?)` class로 바꾸며, singleton module provider로 나열하고 constructor token을 `@Inject(...)`로 선언한다. `global: false`에서는 worker와 Redis provider가 해당 queue registration과 같은 authored module graph를 통해 도달 가능해야 하며 request/transient worker는 건너뛴다. Queue는 processor lifecycle을 소유하고 application bootstrap-ready handoff 이후에만 시작하며 shutdown 중 `workerShutdownTimeoutMs`까지 기다린다. Queue major release를 적용하기 전에 Node.js `20.0.0`–`20.19.2`, Node.js 21, Node.js `22.0.0`–`22.1.x`, 또는 Node.js 27+ 배포를 `>=20.19.3 <21 || >=22.2.0 <27`로 이동하세요.
- Queue는 processor lifecycle과 서로 다른 persistence identity를 소유한다. NestJS Bull/BullMQ는 하나의 `queueName` 아래 여러 named job 값을 저장할 수 있지만 fluo는 한 worker/job type의 `jobName`을 BullMQ queue name과 named job 양쪽에 사용한다. 따라서 `jobName`만 설정해서는 legacy topology를 보존할 수 없고, Queue는 NestJS metadata를 소비하거나 영속 payload를 자동 변환하지 않는다. Producer cutover 전에는 legacy worker로 기존 queue를 drain하거나, payload를 변환해 fluo의 job별 queue로 다시 enqueue하거나, legacy worker가 drain하는 동안 별도 queue name으로 전환한다.
- Queue registration scope는 DI ownership을 격리하지만 BullMQ queue identity를 namespace하지는 않는다. 같은 Redis dependency를 resolve하면서 동일한 `jobName`을 발견하는 두 scope는 worker resource 생성 전 bootstrap에 실패한다. 마이그레이션한 owner마다 서로 다른 `jobName`을 지정하거나 `clientName`으로 서로 다른 named Redis registration을 구성해야 한다.
- Cron migration은 `SchedulerRegistry`/`CronJob` handle을 그대로 보존하는 치환이 아니다. `@Cron`, `@Interval`, `@Timeout`은 public instance method에 사용하고, private 또는 static scheduled work는 공개 provider method 뒤로 옮기며, live `CronJob` handle을 mutate하는 대신 `SCHEDULING_REGISTRY.get(...)` / `getAll()`의 `SchedulingTaskDescriptor` snapshot을 사용한다.
- NestJS cron option도 명시적으로 마이그레이션해야 한다. `timeZone`은 `timezone`으로 바꾼다. fluo는 scheduler-level no-overlap protection과 in-process running guard를 항상 적용하므로 `waitForCompletion`은 생략한다. 같은 task instance가 실행 중일 때 도착한 tick은 queue되지 않고 건너뛴다. NestJS에서 `waitForCompletion: false` 또는 기본 overlapping behavior에 의존한 task는 지원되지 않는 fluo flag를 만들지 말고 concurrent work를 application-owned queue나 worker로 옮겨야 한다. 이 local guard는 application instance 사이의 Redis distributed locking을 대체하지 않는다.
- Email migration은 NestJS dynamic-module 형태를 그대로 복제하지 않는다. `EmailModule.forRootAsync(...)`는 `inject`와 `useFactory`를 받으며, `imports`, `useClass`, `useExisting`는 소비하지 않는다. `EmailModule`은 기본적으로 global이므로 migrated code에 module-local visibility가 필요할 때만 `global: false`를 설정한다.
- Notifications migration은 provider-discovery 또는 decorator-metadata clone이 아니다. 명시적인 `NotificationChannel` 값을 `NotificationsModule.forRoot(...)`에 전달하거나 `NotificationsModule.forRootAsync({ inject, useFactory, global? })`에서 반환해야 한다. 이 패키지는 channel 등록을 위해 NestJS provider, `@Injectable()` metadata, emitted design type을 scan하지 않는다.
- `@fluojs/notifications`는 concrete queue 또는 event-bus resource를 create/import/close/drain하지 않는다. Queue adapter와 event publisher는 애플리케이션 소유 integration이며, status snapshot은 이를 `ownsResources: false`인 externally managed dependency로 보고한다.
- `NotificationsModule`은 기본적으로 `NotificationsService`, `NOTIFICATIONS`, `NOTIFICATION_CHANNELS`에 대해 global이다. Migrated code에 module-local visibility가 필요할 때는 `global: false`를 사용한다.
- Slack migration은 NestJS async dynamic-module 또는 package-level multi-client registry clone이 아니다. `SlackModule.forRootAsync(...)`는 `inject`와 `useFactory`를 받으며, `imports`, `useClass`, `useExisting`은 소비하지 않는다. 필요한 의존성은 application module graph에 등록한 뒤 token을 `inject`에 나열하고, `useFactory`에서 최종 Slack option을 반환한다. `@fluojs/slack`은 singleton compatibility token인 `SLACK`과 `SLACK_CHANNEL`을 노출하고 `createSlackProviders(...)`로 같은 singleton wiring을 재사용하며, NestJS `isGlobal` 대신 기본 global visibility를 가진 `global?: boolean`을 사용한다.
- Discord migration은 NestJS async dynamic-module 또는 custom-provider clone이 아니다. `DiscordModule.forRootAsync(...)`는 `inject`와 `useFactory`를 받으며, `imports`, `useClass`, `useExisting`는 소비하지 않는다. `@fluojs/discord`는 singleton compatibility token인 `DISCORD`와 `DISCORD_CHANNEL`을 노출하고, NestJS `isGlobal` 대신 기본 global visibility를 가진 `global?: boolean`을 사용하며, `createDiscordProviders(...)`, `DISCORD_OPTIONS`, `NormalizedDiscordModuleOptions` 같은 내부 provider helper는 private으로 유지한다.

### Nested DTO and Mapped Type Rewrites

NestJS에서는 class-validator와 class-transformer를 함께 사용하여 reflected metadata 또는 transformer metadata로 중첩 constructor를 제공하는 경우가 많습니다.

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

fluo에서는 constructor를 `@ValidateNested(...)` 안으로 옮기고 이 경계에서 class-transformer를 제거합니다.

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

`@ValidateNested(() => AddressDto)`가 materialization과 재귀 검증에 사용하는 runtime source of truth입니다. fluo는 `@Type(...)`, class-transformer metadata, `reflect-metadata`, `emitDecoratorMetadata`를 읽지 않으므로 legacy decorator compiler flag는 비활성화된 상태로 유지하세요. 이는 compatibility shim이 아니라 명시적인 재작성입니다.

Mapped DTO helper도 fluo import로 옮깁니다.

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

네 helper는 모두 `@fluojs/validation`에서 export되며 전용 mapped-type subpath인 `@fluojs/validation/mapped-types`도 사용할 수 있습니다. `PickType`, `OmitType`, `PartialType`은 적용 가능한 field-level validation과 binding metadata를 보존하지만, subset 또는 optional DTO가 base class-level validator의 field 가정을 더 이상 만족하지 않을 수 있으므로 해당 validator는 의도적으로 복사하지 않습니다. Derived DTO에서도 여전히 유효한 class-level rule은 검토 후 다시 선언하세요. `IntersectionType`은 모든 source contract를 유지하므로 각 input DTO의 field-level 및 class-level validation을 보존합니다. NestJS mapped-type의 class-level metadata 동작이 암묵적으로 이어진다고 가정하지 마세요.

### NestJS Config Registration 및 Bootstrap Migration

동기 registration 호출 전에 async factory를 resolve하되 nested output은 그대로 유지한다. 아래 예시는 `loadConfig(...)`로 문서화된 deep merge, 명시적 `processEnv`, 동기 validation 동작을 적용한 뒤 하나의 validated snapshot을 module registration과 HTTP adapter에 함께 사용한다.

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

`loadConfig(...)`와 `ConfigModule.forRoot(...)`는 ambient `process.env`를 scan하지 않으며 명시적 snapshot만 precedence에 참여한다. Async factory의 plain nested object는 nested 상태를 유지하며 key별로 deep merge된다. Schema output이 최종 snapshot이므로 injected consumer는 같은 port를 `ConfigService.get('http.port')`로 읽을 수 있다. Module은 기본적으로 global이고 `global: false`로 module-local visibility를 선택한다.

NestJS `forRootAsync(...)`와 `load` namespace factory에는 직접 대응하는 registration이 없다. Remote store나 secret manager는 최종 module graph를 정의하기 전에 application-owned bootstrap boundary에서 await하고, nested result는 동기 loader 또는 module option에 그대로 전달한다. Adapterless `FluoFactory.create(AppModule)` application shell과 `FluoFactory.createApplicationContext(AppModule)`도 `ConfigService`를 resolve할 수 있으며 HTTP `listen()`에만 `FluoFactory.create(AppModule, { adapter })`가 필요하다. 최종 HTTP application 전에 공유 validated snapshot을 준비하면 ambient environment를 다시 읽지 않고 adapter와 injected config를 일치시킬 수 있다.

### Fastify 네이티브 확장 마이그레이션

이식 가능한 request 동작에는 fluo `middleware`를 사용하세요. 이는 Fastify plugin API가 아닙니다. NestJS 마이그레이션에서 Fastify 전용 plugin, hook 또는 instance customisation을 유지해야 한다면 listen 전에 `createFastifyAdapter({ configureFastify })`(또는 같은 bootstrap/run option)로 전달합니다.

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

이 hook은 어댑터가 생성한 Fastify 인스턴스마다 한 번 실행되며, fluo가 multipart, raw-body, native-route, wildcard-route 처리를 등록하기 전에 완료됩니다. Reject되면 해당 `listen()` 호출은 시작되지 않습니다. 성공적으로 close한 뒤 relisten하면 새 인스턴스 하나를 생성하고 설정합니다. Adapter는 routing, CORS, logging, response semantics, shutdown의 소유권을 계속 가집니다. Adapter는 fluo response payload를 Fastify에 넘기기 전에 직렬화하므로 instance-level `setReplySerializer(...)`는 fluo response를 customisation하지 않습니다. Post-bootstrap instance mutation, existing-instance adoption, native-route bypass는 이 boundary로 넘기지 마세요.

### NestJS i18n Locale 및 Validation Migration

NestJS i18n의 resolver discovery와 request-scoped context를 하나의 명시적 request-boundary handoff로 바꾼다. Root module로 catalog를 등록하고 HTTP subpath로 request locale을 선택한 뒤 그 locale을 validation subpath에 전달한다.

`I18nModule.forRoot(...)`는 동기 방식이다. 비동기 catalog 또는 configuration loading은 `I18nModule.forRoot(...)` 전에 application-owned bootstrap boundary에서 완료하고, 그 값으로 module graph를 정의한다. 이는 application-owned composition이지 NestJS dynamic-module runtime bridge나 compatibility layer가 아니며, framework-agnostic root contract에 `forRootAsync(...)`를 추가하지 않는다.

#### Catalog Aggregation 및 Fallback Migration

NestJS loader configuration을 fluo registration으로 그대로 전달하지 않는다. Application-owned bootstrap boundary에서 필요한 모든 locale과 namespace를 load한 뒤, 완료된 locale-scoped catalog map을 동기 `I18nModule.forRoot(...)` 호출에 전달한다.

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

각 loader result는 shallow merge하지 않고 해당 namespace 아래에 유지한다. 예를 들어 `locales/ko/common.json`은 `i18n.translate('title', { locale: 'ko', namespace: 'common' })`로 조회한다. Catalog file이 없으면 aggregation은 계속 `I18N_MISSING_CATALOG`으로 reject된다. `fallbackLocales`는 누락된 loader result를 조용히 대체하지 않는다.

NestJS i18n fallback intent는 명시적으로 변환한다.

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

Registration 뒤 메시지 lookup 순서는 결정론적으로 유지된다. 명시적 locale, 해당 locale의 `fallbackLocales` chain, `defaultLocale`, 호출별 `defaultValue`, `missingMessage` 순서다. 위 비동기 aggregation은 동기 registration 전에 완료되며, 이 lookup order를 바꾸거나 `forRootAsync(...)`를 추가하지 않는다.

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

각 custom NestJS resolver class를 `HttpLocaleResolver`로 mapping하고 `FluoFactory.create(...)`에 application-owned `Middleware` 하나를 등록한다. 이 hook은 `Accept-Language`보다 tenant 값을 먼저 resolve하며, downstream translation 또는 validation-error handling은 같은 `RequestContext`에서 결과를 읽는다. `resolveHttpLocale(...)`은 resolver를 배열 순서대로 실행하고 invalid 또는 unsupported result를 무시하며, 아무 것도 match하지 않으면 configured default를 source `default`로 저장한다. `getHttpLocale(...)`은 해당 `RequestContext`만 읽고 global state 또는 다른 request의 locale은 조회하지 않는다.

`localizeDtoValidationError(...)`은 명시적 locale을 사용한 issue message를 포함하는 새 error를 반환한다. 기본 namespace는 `validation`이고 candidate key는 `source.field.code`에서 `code` 순서로 해석되며, `fallbackToIssueMessage: false`를 선택하지 않으면 missing translation은 원래 issue message를 보존한다. 이 helper는 transport-agnostic 상태를 유지한다. 여기서는 HTTP가 locale을 선택하지만 validation localization 자체는 HTTP state를 읽지 않는다.

### Passport.js Bridge Migration

Reflection으로 discovery되는 Passport runtime을 그대로 옮기지 말고 각 NestJS `PassportStrategy(...)`를 독립적으로 migration한다. 다음 순서를 사용한다.

1. Concrete Passport.js strategy를 명시적인 application provider로 구성한다.
2. Stable strategy name, 해당 provider token, `mapPrincipal(...)` mapping으로 `createPassportJsStrategyBridge(...)`를 호출한다.
3. 같은 authored module의 `providers` 배열에 `bridge.providers`를 추가한다.
4. `bridge.strategy`를 `PassportModule.forRoot(...)`에 명시적 named strategy registration으로 전달한다.
5. 인증이 필요한 곳에 fluo `@UseAuth('name')`를 적용하고 `requestContext.principal`에서 mapping된 identity를 읽는다.

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

`mapPrincipal(...)`은 문서화된 유일한 request-identity handoff다. Passport.js `user`를 검증하고 비어 있지 않은 `subject`와 object `claims`를 가진 fluo `Principal`을 반환하면 `AuthGuard`가 이를 `requestContext.principal`에 할당한다. Bridge는 Passport middleware, sessions, serializers, deserializers, automatic strategy discovery를 설치하지 않는다. Full NestJS Passport compatibility, implicit guards, 해당 principal mapping을 넘어서는 request augmentation, host middleware ownership도 제공하지 않는다. Session과 serializer/deserializer migration은 bootstrap 및 request-host boundary에서 application-owned 상태로 남는다.

Cutover 전에 모든 bridged strategy를 다음 request 및 lifecycle boundary에 맞춰 점검하세요.

- Bridge는 가능할 때 `authenticate(request, options)`에 활성 platform adapter의 raw host request를 전달하고, 그렇지 않으면 정규화된 fluo request를 전달합니다.
- Passport-initialized Express request를 생성하지 않습니다. `request.logIn`, `request.user`, session, Passport middleware augmentation, adapter-specific request field 의존성은 application-owned middleware, session, host-adaptation code로 마이그레이션하세요.
- `app.close()`와 application-context `close()`는 unsettled bridge authentication을 취소하고 action timeout을 정리합니다. Shutdown이 시작된 뒤에도 bridge가 timeout까지 기다린다고 가정하는 외부 request 작업을 유지하지 마세요.

### Prisma Request-Wide Transaction Migration

일반적인 비즈니스 원자성은 서비스 `@Transaction()` 메서드에 두세요. 하나의 서비스 boundary로 표현할 수 없는 작업 전체를 migrated controller에서 정말 하나의 transaction으로 묶어야 한다면 wrapper `PrismaService<TClient>`를 주입하고 `requestTransaction(...)`을 명시적으로 호출하며 request cancellation signal을 전달하세요.

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

모든 NestJS interceptor를 이 형태로 옮기지 마세요. Request-wide transaction은 관련 없는 controller 작업 동안에도 lock을 유지할 수 있으므로, 실제 비즈니스 작업 단위를 나타낼 수 있다면 집중된 서비스 `@Transaction()`을 우선 사용하세요.

### GraphQL Resolver Migration

GraphQL migration에서는 schema와 discovery wiring을 명시적으로 유지한다. 모든 resolver class를 authored module의 provider 또는 controller로 등록해 compiled module graph에서 discovery할 수 있게 한다. `GraphqlModule.forRoot({ resolvers: [...] })`는 이 class들을 등록하지 않으며, `resolvers`를 전달하면 해당 allowlist로 discovery를 제한한다. `resolvers`를 생략하거나 빈 list를 전달하면 provider 또는 controller로 이미 등록된 decorated resolver class를 모두 discovery한다. TypeScript 반환 타입이나 NestJS design metadata가 provider를 등록하거나 output type을 만들지 않는다.

Code-first runtime은 두 category로 제한된 resolver surface를 지원한다. Root `Query`, `Mutation`, `Subscription` operation은 `@Query(...)`, `@Mutation(...)`, `@Subscription(...)`을 사용한다. Object field는 `@Resolver('TypeName')`과 `@FieldResolver(...)`로 연결하지만, 해당 named object type이 code-first root operation output에서 도달 가능할 때만 연결된다. Field resolver를 등록해도 임의의 detached type이 도달 가능해지지는 않는다. TC39 표준 데코레이터는 parameter-decorator 문법을 지원하지 않으므로 `@Parent(index?)`와 `@Context(index?)`는 method decorator이며, 기본값으로 parent/source object를 position `0`에, `GraphQLContext`를 position `1`에 바인딩한다. Field argument DTO binding과 schema-first field-resolver attachment는 지원하지 않는다.

Runtime은 `GraphqlModule.forRootAsync(...)`를 제공하지 않고 `@Subscription({ topics })`를 거부하므로 subscription method는 `AsyncIterable`을 반환해야 한다. `@fluojs/graphql`은 Node listener-capable `@fluojs/runtime`을 통한 필수 first-party dependency graph의 유효 범위인 Node.js `>=20.19.3 <21 || >=22.2.0 <27`을 요구하고, `@fluojs/config`는 독립적인 Node.js `>=20.16.0` 하한을 유지한다. HTTP와 SSE는 이 경계 안에서 Web-standard HTTP seam을 사용하고, 선택적 WebSocket subscription에는 upgrade listener를 제공하는 server-backed Node HTTP/S adapter도 필요하다. Dependency metadata 정렬과 native runtime 검증이 없다면 이 내부 seam을 Bun, Deno, Cloudflare Workers package 지원으로 해석해서는 안 된다.

Object와 list 결과가 GraphQL `String`으로 fallback되지 않도록 output을 직접 선언한다:

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

Handler discovery와 NestJS `ClientProxy` migration을 하나의 opaque reflection-driven system으로 그대로 옮기지 말고 명시적 handler registration, facade, adapter, infrastructure ownership으로 분리하세요.

- `@MessagePattern`, `@EventPattern`, streaming pattern decorator는 root `@fluojs/microservices`에서 import합니다. 이들은 TC39 표준 method decorator이며 `reflect-metadata`, `experimentalDecorators`, `emitDecoratorMetadata` 출력을 읽지 않습니다.
- Decorated handler는 public instance method로 유지합니다. Private 및 static decorator target은 유효하지 않습니다.
- 각 handler class를 compiled module의 `providers` 또는 `controllers`에 명시적으로 나열합니다. Class import, method decoration, 남아 있는 NestJS provider metadata만으로는 handler가 등록되지 않습니다.
- 선택한 adapter를 root `MicroservicesModule.forRoot({ transport })`로 등록합니다.
- `listen()`, `send()`, `emit()`, `close()`를 위해 root `MICROSERVICE`를 `Microservice`로 주입합니다. 이 token은 raw adapter가 아니라 lifecycle facade로 resolve됩니다.
- 가능하면 transport 구현을 명시적인 subpath에서 import합니다: `@fluojs/microservices/nats`, `@fluojs/microservices/kafka`, `@fluojs/microservices/rabbitmq`. `RedisStreamsMicroserviceTransport`는 문서화된 root-barrel-only 예외로 남습니다.
- `await microservice.send(...)`는 상관관계가 유지된 원격 응답을 기다리며, 원격 오류, abort, timeout, shutdown 시 reject합니다.
- `await microservice.emit(...)`은 outbound transport publish 연산만 기다립니다. 원격 event handler가 실행되었다는 뜻은 아니며, broker acknowledgement는 caller-provided publish collaborator 자체가 약속하는 범위로 제한됩니다.
- `await microservice.close()`는 transport listener/subscription teardown과 pending-request cleanup을 기다립니다. NATS, Kafka, RabbitMQ adapter는 caller-provided collaborator에서 detach하지만 해당 client, producer, consumer, publisher, channel, connection을 close/disconnect하지 않습니다.

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

Kafka와 RabbitMQ는 handler 실행과 request response publication이 settle할 때까지 inbound consumer callback을 pending 상태로 유지하므로 broker adapter가 acknowledgement 또는 retry를 선택할 수 있습니다. 이 consumer-side boundary는 producer-side `emit()` promise와 분리되어 있습니다. Shutdown 시에는 먼저 `Microservice` facade를 닫고, caller-owned broker resource는 application bootstrap layer에서 close 또는 drain하세요.

## Removed Concepts

- 기본 프로바이더 마커로서의 `@Injectable()`. 프로바이더 등록은 모듈의 `providers` 배열에서 수행된다.
- `reflect-metadata`를 통한 리플렉션 기반 생성자 해석.
- NestJS provider 또는 emit된 design metadata를 통한 reflection-driven microservice handler discovery.
- Passport.js bridge가 NestJS Passport runtime을 재현한다고 가정하는 방식. fluo는 명시적 bridge provider, named strategy registration, route guard metadata, principal mapping을 요구하고 middleware, session, serializer/deserializer, host ownership은 애플리케이션에 남긴다.
- emit된 디자인 타임 타입에 기대는 암묵적 DI.
- 프레임워크 요구 사항으로서의 레거시 데코레이터 컴파일러 모드.
- 생성된 `@fluojs/vite` 애플리케이션 transform과 `@fluojs/testing/vitest` 테스트 transform을 하나의 파일 경계로 합치는 방식.
- 문서화된 모든 플랫폼이 `fluo new`에 포함된다고 가정하는 방식. 스타터 범위는 별도 지원 매트릭스에서 정의된다.
- `@nestjs/terminus` controller decorator나 별도 default liveness route가 Terminus의 일대일 마이그레이션 대상이라고 가정하는 방식.
- `@nestjs/throttler`의 named definition, global guard registration, proxy header trust가 명시적인 Fluo wiring 없이 그대로 유지된다고 가정하는 방식.
- `@nestjs/cache-manager`의 async dynamic-module `imports`, `useClass`, `useExisting`, implicit global cache enforcement, interceptor subclassing이 그대로 유지된다고 가정하는 방식. fluo는 injected-factory-only `CacheModule.forRootAsync({ inject, useFactory, global? })`, 명시적 `CacheInterceptor` placement, 문서화된 key strategy hook을 지원한다.
- Deprecated Mongoose 호환성 interceptor나 암묵적 connection ownership을 주요 migration 대상으로 가정하는 방식. fluo는 connection ownership을 애플리케이션 쪽에 두고 서비스 `@Transaction()`과 명시적 `requestTransaction(...)` 경계를 우선 사용한다.
- NestJS `@SubscribeMessage()`, `@MessageBody()`, `@ConnectedSocket()`, 또는 암묵적 gateway server injection이 fluo websocket gateway에도 있다고 가정하는 방식.
- Socket.IO gateway return value가 암묵적인 client reply가 된다고 가정하는 방식. fluo에서는 명시적 ACK callback 또는 raw `SOCKETIO_SERVER` emit이 필요합니다.
- NestJS-style Redis async module factory나 Pub/Sub command/subscriber client 공유가 그대로 유지된다고 가정하는 방식. fluo는 Redis registration을 동기 방식으로 유지하고 Pub/Sub 연결에는 전용 subscriber 소유권을 요구한다.
- `@nestjs/cqrs` reflection discovery, controller handler, writable execution context, direct shutdown bypass option이 그대로 유지된다고 가정하는 방식. fluo는 singleton provider-only discovery, opaque private dispatch state, 내부에서 authorization된 active-pipeline drain을 사용합니다.
- NestJS/Bull processor decorator, emit된 metadata, request/transient worker scope, 기존 queue persistence compatibility가 그대로 유지된다고 가정하는 방식. fluo는 명시적인 singleton `@QueueWorker(JobClass)` 등록과 drain, payload 변환 후 다시 enqueue, 또는 별도 queue name 격리 중 하나를 택하는 애플리케이션 소유 `queueName`/named job/`jobName` cutover를 요구한다.
- Raw Express/Connect middleware를 fluo application middleware에 직접 전달하는 방식. fluo middleware는 `MiddlewareContext`를 받으므로 native `(req, res, next)` function에는 명시적 wrapper나 platform-owned `createExpressAdapter({ nativeMiddleware })` boundary가 필요하다.
- NestJS HTTP adapter lifecycle hook을 Bun에서 시작 후 live server mutation으로 옮길 수 있다고 가정하는 방식. `@fluojs/platform-bun`은 `listen()`이 시작되기 전에 dispatcher와 realtime seam을 바인딩하고, 중복 `listen()` 호출을 idempotent하게 유지하며, NestJS-style late host mutation 대신 외부 소유 `Bun.serve(...)` host를 위한 동기 `createBunFetchHandler(...)`를 노출한다. 이러한 manual host는 shutdown, websocket upgrade, native `routes` acceleration을 직접 소유한다.
- NestJS HTTP 또는 WebSocket server ownership이 Deno에 그대로 이전된다고 가정하는 방식. Lifecycle owner를 하나만 선택하세요. Managed `app.listen()`은 `Deno.serve(...)`를 시작하고 adapter close/drain을 통한 server shutdown과 configured websocket upgrade를 소유합니다. `runDenoApplication(...)`은 해당 managed adapter lifecycle을 사용하면서 shutdown signal handler도 추가로 등록하고 제거합니다. Signal로 트리거된 애플리케이션 close 실패는 해당 helper가 log한 뒤 swallow하며 exit status를 설정하거나 forced termination을 수행하지 않습니다. Failure-status propagation 또는 forced termination이 필요한 host는 `shutdownSignals: false`를 전달하고 signal과 shutdown을 직접 조율해야 합니다. Host-owned `createDenoFetchHandler(...)` 경로는 request 변환과 dispatch만 수행하며 server를 시작하거나 signal handler를 설치하거나 shutdown을 소유하거나 websocket upgrade를 자동 수행하지 않습니다. 해당 lifecycle seam은 주변 host가 제공해야 합니다.
- NestJS HTTP 또는 WebSocket server ownership이 Cloudflare Workers에도 유지된다고 가정하는 방식. Worker `fetch(request, env, ctx)` entrypoint를 export하고, `listen()`을 socketless dispatcher-binding boundary로 다루며, WebSocket ownership이 listen 전에 frozen되도록 bootstrap 이전에 `CloudflareWorkersWebSocketModule.forRoot()`을 import하세요. Fetch-time `env`는 bootstrap configuration이 아니며, 별도로 사용할 수 있는 pre-registration 값만 bootstrap configuration에 속합니다. Application-owned request boundary의 `RequestContext`에서 request binding을 읽고 검증하고 좁힌 뒤 application-shaped 값만 provider method에 전달하세요. Adapter는 수락된 HTTP, SSE, WebSocket lifecycle work를 `ctx.waitUntil(...)`에 등록하며 post-listen mutation용 live server를 노출하지 않습니다.
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
fluo migrate ./src --only imports,injectable
fluo migrate ./src --skip testing
```

정식 `--only` 및 `--skip` 토큰은 `imports`, `inject-params`, `scope`, `bootstrap`, `tests`, `tsconfig`입니다. 기존 `injectable` 및 `testing` 토큰은 각각 `inject-params` 및 `tests`의 허용되는 별칭으로 유지됩니다.

기본 출력은 사람이 읽는 형식입니다. CI 작업, dashboard, migration report에서 안정적인 machine-readable output이 필요하면 `--json`을 추가하세요. JSON 모드는 성공 시 stdout에 structured migration report만 씁니다. Parser 오류와 잘못된 flag 조합은 기존처럼 stderr에 메시지를 쓰고 exit code `1`을 반환하며 partial JSON을 출력하지 않습니다.

JSON report에는 `mode`(`dry-run` 또는 `apply`), `dryRun`, `apply`, 활성화된 `transforms`, `scannedFiles`, `changedFiles`, 전체 `warningCount`, 파일별 metadata가 포함됩니다. 각 파일 항목은 `filePath`, 파일 변경 여부, 적용된 transform, warning count, category label과 source line number가 포함된 warning detail을 기록합니다.

Adapter-independent transform(`imports`, `injectable`, `scope`, `testing`, `tsconfig`)은 HTTP adapter 없이 실행됩니다. 기본 NestJS bootstrap은 Express를 사용하므로 기본 bootstrap transform은 `NestFactory.create(AppModule)`를 `createExpressAdapter(...)`로 재작성하고 static `listen(port)` 인수를 그 adapter로 접습니다. 마이그레이션한 애플리케이션을 컴파일하기 전에 `@fluojs/platform-express`와 `express`를 설치하세요. bootstrap을 그대로 두려면 독립 transform만 선택하세요:

```bash
fluo migrate ./src --apply --only imports,injectable,scope,testing,tsconfig
```

Codemod는 import 재작성, `@Injectable()` 제거, provider scope 매핑, constructor parameter `@Inject(...)` 사용 migration, 지원되는 bootstrap/listen 패턴 재작성, test template의 `@fluojs/testing` helper 방향 갱신, decorator compiler flag 갱신, `baseUrl` path alias 설정 재작성을 수행할 수 있습니다. 그래도 수동 검토는 필요합니다. 마이그레이션을 수락하기 전에 모든 warning category를 post-codemod checklist 항목으로 처리하세요.

`@Injectable()`을 제거할 때 codemod는 필요한 `import type` binding을 유지하고 obsolete `@Injectable` import binding만 제거합니다. 다른 NestJS runtime value import는 제거하지 않습니다. `Optional`처럼 변환되지 않는 value는 수동 검토를 위해 남습니다. 남아 있는 모든 `@nestjs/common` import를 수동으로 검증한 뒤 NestJS dependency를 제거하기 전에 마이그레이션하거나 제거하세요.

## Related Docs

- [NestJS Parity Gaps](../contracts/nestjs-parity-gaps.ko.md)
- [DI and Modules](../architecture/di-and-modules.ko.md)
- [Decorators and Metadata](../architecture/decorators-and-metadata.ko.md)
- [CQRS Contract](../architecture/cqrs.ko.md)
- [i18n Ecosystem Bridge Decision](../reference/i18n-ecosystem-bridges.ko.md)
- [fluo new Support Matrix](../reference/fluo-new-support-matrix.ko.md)
