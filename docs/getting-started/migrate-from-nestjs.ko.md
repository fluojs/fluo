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
| `@Sse()` | `@fluojs/http`의 `@Sse()`와 명시적인 `SseResponse` 반환 | fluo의 Phase 1 SSE 데코레이터는 `text/event-stream` metadata를 가진 `GET` 라우트로 매핑된다. NestJS Observable 또는 `AsyncIterable` 반환값을 자동 변환하지 않는다. |
| `NestFactory.create(AppModule)` | `@fluojs/runtime`의 `FluoFactory.create(AppModule, { adapter })` | 부트스트랩 시 `createFastifyAdapter()` 같은 명시적 플랫폼 어댑터가 필요하다. |
| `@Injectable()` 프로바이더 마커 | `@Module(...).providers`에 등록된 프로바이더 클래스 또는 provider definition | fluo는 필수 프로바이더 등록 단계로 `@Injectable()`을 사용하지 않는다. |
| `emitDecoratorMetadata`를 통한 생성자 타입 리플렉션 | `@fluojs/core`의 `@Inject(TokenA, TokenB)` | 생성자 의존성은 데코레이터 인자 순서대로 명시한다. |
| `class-validator` / 데코레이터 중심 DTO 검증 | Standard Schema를 지원하는 `@fluojs/validation` | 현재 검증 방향은 Zod, Valibot 등을 포함한 Standard Schema 기반이다. |
| `createApplicationContext()` 단독 부트스트랩 | `FluoFactory.createApplicationContext(AppModule)` | `@fluojs/runtime`에 standalone application context가 존재한다. |
| `Test.createTestingModule({ imports: [...] }).overrideModule(...)` | `@fluojs/testing`의 `createTestingModule({ rootModule }).overrideModule(...)` | fluo testing은 명시적 `rootModule`과 replacement compile seam을 사용하므로 전역 module metadata를 mutate하지 않고 authored module identity를 보존한다. |
| NestJS 요청 transaction interceptor | 영속성 패키지의 서비스 `@Transaction()` 또는 controller/request 경계의 명시적 `requestTransaction(...)` | fluo는 Drizzle 또는 Mongoose `*TransactionInterceptor` export를 제공하지 않는다. 비즈니스 transaction은 서비스에 두고, 전체 요청이 하나의 경계를 공유해야 할 때만 `DrizzleDatabase.requestTransaction(...)` 또는 `MongooseConnection.requestTransaction(...)`을 사용한다. |
| `HealthCheckService.check([...])`를 호출하는 `@HealthCheck()` 컨트롤러 메서드 | `@fluojs/terminus`의 `TerminusModule.forRoot({ indicators, indicatorProviders, readinessChecks })` | Module-level registration이 기본 API이므로 runtime `/health`와 `/ready` route가 indicator 및 platform diagnostics를 일관되게 포함한다. |
| NestJS Terminus memory/disk 또는 Redis check | `@fluojs/terminus/node`와 `@fluojs/terminus/redis` | Node.js memory/disk helper와 Redis helper는 전용 subpath에 있다. Root package는 Redis peer나 Node filesystem access를 기본 import 경계에 포함하지 않는다. |
| `@nestjs/throttler` 전역 throttler 설정 | `@fluojs/throttler` / `@fluojs/http`의 `ThrottlerModule.forRoot(...)`와 명시적 `@UseGuards(ThrottlerGuard)` | Module registration은 정책과 guard provider를 제공한다. Route enforcement는 guard를 붙인 위치에서만 시작된다. |
| `@WebSocketGateway()`와 `@SubscribeMessage()` 및 parameter decorator | `@fluojs/websockets`의 `@WebSocketGateway()`와 `@OnMessage(event?)`, positional handler argument, 선택적 `WebSocketRoomService` | fluo websocket handler는 `(payload, socket, request)`를 직접 받습니다. Nest-style `@MessageBody()`, `@ConnectedSocket()`, `@SubscribeMessage()` parameter/decorator rewrite는 없습니다. |
| `@nestjs/cache-manager` / `CacheModule.register(...)` | `@fluojs/cache-manager`의 `CacheModule.forRoot(...)`, `CacheService`, cache decorators | fluo cache registration은 동기 방식이다. Redis 또는 custom store는 module registration 전에 준비하고, manual cache operation에는 `CacheService`를 주입하며, request-aware response-cache key에는 `httpKeyStrategy` 또는 `@CacheKey(...)`를 사용한다. |

## Breaking Differences

- 데코레이터는 반드시 TC39 표준 모델을 따라야 한다. NestJS의 레거시 데코레이터 가정은 그대로 유지되지 않는다.
- 의존성 주입은 생성자 타입에서 절대 추론되지 않는다. fluo는 생성자 의존성에 대해 명시적 `@Inject(...)` 선언을 요구한다.
- 부트스트랩은 adapter-first 방식이다. `FluoFactory.create(...)`는 HTTP 플랫폼을 암묵적으로 고르는 대신 `adapter` 옵션을 반드시 받아야 한다.
- 검증은 `class-validator` 우선 계약을 유지하지 않고 Standard Schema 방향으로 반드시 옮겨야 한다.
- 컨트롤러 데코레이터는 반드시 `@fluojs/http`에서 가져오고, `@Module` 같은 구조 데코레이터는 `@fluojs/core`에서 가져온다.
- Observable을 반환하는 NestJS `@Sse()` 핸들러는 반드시 `SseResponse`를 만들고, `send(...)` 또는 `comment(...)`를 호출하며, request abort 또는 application cleanup 경로에서 stream을 닫도록 재작성해야 한다.
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
- NestJS Terminus의 controller-level `@HealthCheck()` handler는 `TerminusModule.forRoot(...)` 기반 indicator 및 readiness registration으로 옮기는 것이 좋다. 직접 `TerminusHealthService.check()` 호출은 test나 custom code에서 사용할 수 있지만, 기본 endpoint registration API는 아니다.
- `@fluojs/terminus`는 별도의 process-only liveness route를 기본으로 만들지 않는다. 기본 `GET /health` aggregated health route와 `GET /ready` readiness gate를 유지하고, 더 좁은 process probe가 필요하면 애플리케이션 또는 배포 계층에서 정의한다.
- Throttler migration은 global module을 global enforcement로 치환하는 방식이 아니다. `ThrottlerModule.forRoot(...)`는 default를 등록하고, `ThrottlerGuard`는 보호할 controller나 handler의 guard metadata로 활성화해야 한다.
- `@fluojs/throttler`는 하나의 module default와 class/method `@Throttle({ ttl, limit })` override를 제공한다. burst와 sustained limit 같은 multi-window 정책은 HTTP middleware, custom `ThrottlerStore`, 또는 애플리케이션이 소유한 guard wrapper로 명시적으로 구현해야 한다.
- Forwarded client IP header는 `Forwarded`, `X-Forwarded-For`, `X-Real-IP`를 신뢰 가능한 proxy가 덮어쓰는 배포에서 `trustProxyHeaders: true`를 설정한 경우에만 사용된다.
- Throttling된 응답에서 보장되는 metadata는 HTTP `429`와 `Retry-After`다. 추가 rate-limit header나 body shape는 애플리케이션 경계에서 더한다.
- WebSocket migration은 decorator-for-decorator 치환이 아닙니다. `@fluojs/websockets`의 `@OnMessage(event?)`를 사용하고, handler 입력은 `(payload, socket, request)` positional argument로 읽으며, room membership 또는 broadcast에는 NestJS gateway server injection이나 parameter decorator가 그대로 이어진다고 가정하지 말고 `WebSocketRoomService`를 사용합니다.
- Cache-manager migration은 async dynamic-module 치환이 아니다. `@fluojs/cache-manager`는 동기 `CacheModule.forRoot(...)`를 제공한다. 환경별 client는 먼저 application boundary에서 구성하고, `store`, `ttl`, `keyPrefix`, `redis.clientName`, `httpKeyStrategy` 같은 최종 cache option을 전달한다.
- NestJS-style cache-key customization은 interceptor subclassing 대신 fluo가 문서화한 key seam으로 옮겨야 한다. 애플리케이션 전역 request-aware 정책에는 function-valued `httpKeyStrategy`를 사용하고, handler-local 동작에는 literal key 또는 key factory를 받는 `@CacheKey(...)`를 사용한다.
- Custom cache tooling은 private metadata key를 다시 구현하지 말고 `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, `getCacheEvictMetadata(...)` 같은 exported cache metadata helper를 읽어야 한다.

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
