# Public Decorator Defaults

<p><a href="./decorator-defaults.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 [#3701](https://github.com/fluojs/fluo/issues/3701)의 조사표를 최종 구현과 대조한 결과입니다.
조사 기준은 `4a0fd3c37b5b220c3bc38519b8e231bb9e442d37`의 공개 `@fluojs/*` 42개 패키지입니다.
19개 패키지가 소유한 공개 decorator factory는 165개이며, 정확히 15개에 기본값을 추가하고
나머지 150개의 인수 계약은 유지합니다. 같은 소유 API의 subpath 재수출, overload, alias는
중복 집계하지 않습니다. Metadata reader/writer, DI token wrapper, mapped DTO constructor,
compiler plugin은 decorator가 아닙니다.

## Fifteen Added Defaults

| 패키지 | API | 개수 | 최종 계약 |
| --- | --- | --- | --- |
| http | `Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`, `Head`, `All`, `Sse` | 9 | 공통 route factory의 `(path = '')` |
| http | `Query`, `Route` | 2 | `Query(path = '')`; `Route(method: string, path = '')`의 method는 필수 |
| openapi | `ApiOperation`, `ApiBody` | 2 | `(options = {})`; 기존 빈 객체 metadata 의미를 사용 |
| core | `Module` | 1 | `(definition = {})`; 빈 module metadata 등록 |
| react | `Path` | 1 | `(path = '', options?)`; options는 undefined 유지 |

생략과 명시적 `undefined`에만 기본값을 적용합니다. `null`, 다른 타입의 인수, 잘못된 path
grammar나 method token을 유효한 입력으로 바꾸지 않습니다. 모두 **factory 호출**
(`@Get()`, `@Module()`)이며 새 bare decorator overload가 아닙니다.
기존 HTTP legacy transform invocation fallback은 보존할 뿐 확장하지 않습니다.

`@Controller('cats')`의 `@Get()`은 `@Get('')`와 정확히 같은 `GET /cats`입니다.
`@Get('/')`는 유효 route가 같지만 raw path 문자열은 다릅니다. Slash는 controller prefix를
무시하지 않습니다. `@Router()` 및 prefix가 있는 router의 `@Path()`도 같은 규칙을 사용하며
정규화된 중복 route는 계속 실패합니다. `Sse()`는 GET + `text/event-stream`과 기존 stream
lifecycle을 유지합니다. `All()`은 wildcard sentinel이며 HTTP `Query()`는 RFC QUERY입니다.
Adapter의 custom-method 제한과 OpenAPI의 표준 Path Item method 집합은 바뀌지 않습니다.

`ApiOperation()`은 summary, description, deprecated 값을 임의로 만들지 않습니다.
`ApiBody()`도 required나 schema를 만들지 않습니다. DTO에서 추론한 body는 유지하고,
body가 없는 route에는 `requestBody`를 추가하지 않습니다. 빈 OpenAPI decorator도 metadata를
기록하므로 stacking에서 이전 값을 덮어쓸 수 있습니다. Decorator 자체 생략과 항상 같지는
않습니다. 기존 `null` 실패는 factory 호출이 아니라 decorator 적용 시 발생할 수 있습니다.

`Module()`은 decorator가 없는 클래스와 다릅니다. Metadata를 등록하며 앞서 기록된 부분 필드와
어느 순서의 `Global()`도 보존하고, 클래스별 record를 격리하며 module metadata version을
증가시킵니다. `Path()`는 HTTP, React, route-inspection metadata를 기록하면서 React
metadata의 `options` 속성은 만들지 않습니다.

## Remaining 150 APIs

아래 모든 이름은 issue 이전의 인수 계약과 구현을 유지합니다. `?`는 이미 optional인 인수,
`...`는 기존 variadic 입력입니다. 표에서 괄호를 생략한 이름도 모두 factory입니다.

| 소유 패키지 | API | 개수 | 보존 계약 |
| --- | --- | --- | --- |
| http | `Controller` | 1 | `basePath = ''` |
| http | `FromPath`, `FromQuery`, `FromHeader`, `FromCookie`, `FromBody`, `FromFiles` | 6 | `key?`; 생략 시 DTO field 이름이며 body 전체나 모든 파일이 아님 |
| http | `Optional`, `Produces`, `UseGuards`, `UseInterceptors` | 4 | 무인수 field 또는 variadic factory; 빈 `Produces()`는 `[]`; 빈 guard/interceptor 호출은 상속 metadata를 지우지 않음 |
| http | `Convert`, `RequestDto`, `HttpCode`, `Version`, `Header`, `Redirect` | 6 | Converter, DTO, status, version, header name/value, redirect URL은 필수; redirect status는 dispatcher 기본 302 유지 |
| openapi | `ApiTag`, `ApiResponse` | 2 | Tag 또는 response status/options 필수; response overload는 한 API |
| openapi | `ApiParam`, `ApiQuery`, `ApiHeader`, `ApiCookie`, `ApiSecurity` | 5 | Name 필수; parameter options는 `{}`, security scopes는 `[]` 유지 |
| openapi | `ApiBearerAuth`, `ApiExcludeEndpoint` | 2 | 기존 무인수 factory; bearer metadata는 authentication guard를 설치하지 않음 |
| graphql | `Resolver`, `Query`, `Mutation`, `Subscription`, `FieldResolver`, `Arg` | 6 | 기존 optional name/options와 class/method/DTO-field 이름 fallback |
| graphql | `Parent`, `Context`, `Args` | 3 | TC39 method factory; index는 0, 1, 0과 중복 index 검증 유지 |
| serialization | `Expose`, `Exclude`, `Transform` | 3 | `Expose(options?)`는 상속 class policy 보존; `Exclude()`는 무인수; 동기 transform 함수 필수 |
| throttler | `Throttle`, `SkipThrottle` | 2 | `Throttle(options)`의 양의 유한 정수 limit/ttl 필수; skip은 무인수 |
| cache-manager | `CacheKey`, `CacheTTL`, `CacheEvict` | 3 | Key/resolver, 초 단위 TTL, eviction target 필수; 명시적 `CacheTTL(0)`은 무만료 |
| passport | `UseAuth`, `UseOptionalAuth`, `RequireScopes` | 3 | `UseAuth(strategyName)`, `UseOptionalAuth(strategyName)`은 전략 필수; scopes는 variadic 합성 유지 |
| core | `Global`, `Inject`, `Scope` | 3 | `Global()`; 명시적 variadic/legacy-array injection token과 `Inject()`의 상속 token 지우기; scope 필수 |
| queue | `QueueWorker` | 1 | Job constructor 필수; options는 `{}` 유지 |
| cron | `Cron`, `Interval`, `Timeout` | 3 | Expression/milliseconds 필수; options는 `{}` 유지 |
| cqrs | `CommandHandler`, `QueryHandler`, `EventHandler`, `Saga` | 4 | Message/event constructor 필수; Saga는 비어 있지 않은 constructor 배열도 받는 class factory |
| event-bus | `OnEvent` | 1 | Event constructor 필수; 이름 문자열이나 catch-all 추론 없음 |
| microservices | `MessagePattern`, `EventPattern`, `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern` | 5 | String/RegExp pattern 필수 |
| websockets | `WebSocketGateway`, `OnMessage`, `OnConnect`, `OnDisconnect` | 4 | Gateway options는 `{}`; event 생략은 일반 메시지; connect/disconnect는 무인수 |
| prisma | `Transaction` | 1 | 기존 optional accessor/options 및 service 탐색; options는 `undefined` |
| drizzle | `Transaction` | 1 | 기존 optional accessor/options 및 database 탐색; options는 `undefined` |
| mongoose | `Transaction` | 1 | Optional accessor와 connection 탐색; 새로운 options-object API 없음 |
| react | `Router`, `PageLayout`, `SuspenseFallback`, `PageMetadata` | 4 | Router base path는 `''`; component 참조와 metadata factory는 필수 |

### Validation: 76 Unchanged Factories

Const alias와 반환 helper function을 포함해 모두 `@fluojs/validation` 소유입니다.
구현은 `packages/validation/src/decorators.ts` 및
`src/internal/decorator-factories.ts`입니다.

| 분류 | API | 개수 | 보존 계약 |
| --- | --- | --- | --- |
| 기본 optional options | `IsString`, `IsNumber`, `IsBoolean`, `IsDefined`, `IsOptional`, `IsEmpty`, `IsNotEmpty`, `IsDate`, `IsArray`, `IsObject`, `IsInt`, `IsPositive`, `IsNegative` | 13 | 기존 optional Fluo validation options |
| String/network/geo optional options | `IsAlpha`, `IsAlphanumeric`, `IsAscii`, `IsBase64`, `IsBooleanString`, `IsDataURI`, `IsDateString`, `IsDecimal`, `IsEmail`, `IsFQDN`, `IsHexColor`, `IsHexadecimal`, `IsJSON`, `IsJWT`, `IsLocale`, `IsLowercase`, `IsMagnetURI`, `IsMimeType`, `IsMongoId`, `IsNumberString`, `IsPort`, `IsRFC3339`, `IsSemVer`, `IsUppercase`, `IsISO8601`, `IsLatitude`, `IsLongitude`, `IsLatLong`, `IsISSN`, `IsUrl`, `IsCurrency` | 31 | 기존 optional Fluo validation options |
| 이미 optional인 인수 | `IsIP`, `IsISBN`, `IsMobilePhone`, `IsPostalCode`, `IsRgbColor`, `IsUUID`, `ArrayNotEmpty`, `ArrayUnique` | 8 | 기존 version/locale/options/selector 동작 |
| 필수 의미 인수 | `ValidateIf`, `Equals`, `NotEquals`, `IsIn`, `IsNotIn`, `IsEnum`, `IsDivisibleBy`, `Min`, `Max`, `MinDate`, `MaxDate`, `Contains`, `NotContains`, `Length`, `ValidateNested`, `MinLength`, `MaxLength`, `Matches`, `ArrayContains`, `ArrayNotContains`, `ArrayMinSize`, `ArrayMaxSize`, `Validate`, `ValidateClass` | 24 | 조건, 비교값, list/enum, bound, DTO constructor, pattern, custom validator 필수 |

`Length`의 min과 `Matches`의 pattern은 계속 필수입니다. `ValidateClass`는 class factory이며
나머지는 field factory입니다. Fluo의 `message`, `code`, `each`, `IsNumber`/`allowNaN`,
optional version/locale, null/undefined 입력 동작은 유지합니다. Validator.js의 모든 option을
노출하는 변경이 아닙니다. `IsJWT`는 서명이 아니라 문자열 형식을 검사합니다.

## Boundaries and Audit Evidence

Prisma와 Drizzle의 생략된 transaction options를 `{}`로 바꾸면 안 됩니다. 중첩 transaction에서
options 제공 여부는 관찰 가능한 차이입니다. HTTP Query는 GraphQL Query나 query-string
parameter decorator가 아닙니다. `di.Scope`는 namespace이며 decorator가 아닙니다.
`forwardRef`, `optional`, `defineModule`, mapped-type helper는 집계 밖입니다.
WebSocket host subpath 재수출은 API 16개를 추가하지 않습니다. 모든 기존 decorator가 타입 밖
`null`을 일관되게 거부한다고 주장하지 않으며, 이번 변경은 전체 factory hardening이 아닙니다.

소유한 공개 decorator가 없는 23개 패키지는 `config`, `di`, `i18n`, `runtime`,
`platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`,
`platform-cloudflare-workers`, `redis`, `notifications`, `email`, `slack`, `discord`,
`socket.io`, `metrics`, `terminus`, `cli`, `studio`, `testing`, `vite`, `jwt`입니다.

Production 수정은 `packages/{http,openapi,core,react}/src/decorators.ts`의 기본값을 받는
시그니처 일곱 곳과 TSDoc뿐입니다. 공통 HTTP factory가 API 아홉 개를 담당합니다.
Metadata writer, dispatcher, lifecycle 구현, export, 다른 패키지의 decorator는 변경하지 않습니다.

실행 가능한 증거는 다음 파일에 있습니다.

- `tooling/governance/decorator-defaults-public-types.test.ts`: 공개 declaration/import, 필수 인수 및 bare 형태 거부.
- `packages/http/src/decorator-defaults.test.ts`, `src/dispatch/default-route-paths.test.ts`: root/portable TC39와 기존 legacy metadata, dispatch, grammar, 충돌, method, managed SSE.
- `packages/http/src/dispatch/dispatcher-manual-sse-lifecycle.test.ts`: 기본 경로 manual stream의 close/abort/resource settlement.
- `packages/openapi/src/decorator-defaults.test.ts`: 빈 options, stacking, snapshot, 적용 시 null 실패, 실제 문서.
- `packages/core/src/module-defaults.test.ts`, `packages/runtime/src/empty-module-default.test.ts`: metadata 등록, 부분 병합/version, 격리, bootstrap/close.
- `packages/react/src/path-defaults.test.ts`: metadata, 렌더링된 GET 응답, bootstrap-resolved catalog.

릴리스 의도는 `@fluojs/http`, `@fluojs/openapi`, `@fluojs/core`, 현재 `0.x`인
`@fluojs/react` 모두 minor입니다. Changesets가 대기 중인 metadata와 합산하여 실제 버전을
계산하며, 이 문서에서 릴리스 버전을 지정하지 않습니다.
