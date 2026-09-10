# Public Decorator Defaults

<p><strong><kbd>English</kbd></strong> <a href="./decorator-defaults.ko.md"><kbd>한국어</kbd></a></p>

This is the final implementation reconciliation of [#3701](https://github.com/fluojs/fluo/issues/3701),
whose audit covered all 42 public `@fluojs/*` packages at
`4a0fd3c37b5b220c3bc38519b8e231bb9e442d37`. That audit counted 165 owned public decorator
factories in 19 packages: 15 gained defaults and 150 retained their argument
contracts. #3738 subsequently removes `Global` (164 factories remain) and the legacy
Inject array overload. See the [declaration migration](../getting-started/migrate-core-di-declarations.md).
Re-exported subpaths, overloads, and aliases of the same owned API are not
counted twice. Metadata readers/writers, DI token wrappers, mapped DTO constructors,
and compiler plugins are not decorators.

## Fifteen Added Defaults

| Package | APIs | Count | Final contract |
| --- | --- | --- | --- |
| http | `Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`, `Head`, `All`, `Sse` | 9 | `(path = '')` through the shared route factory |
| http | `Query`, `Route` | 2 | `Query(path = '')`; `Route(method: string, path = '')` keeps method required |
| openapi | `ApiOperation`, `ApiBody` | 2 | `(options = {})`, using the existing empty-object metadata behavior |
| core | `Module` | 1 | `(definition = {})`, registering empty module metadata |
| react | `Path` | 1 | `(path = '', options?)`, leaving options undefined |

Omission and explicit `undefined` select these defaults. They do not replace `null`,
wrong argument types, invalid path grammar, or invalid method tokens with valid input.
These remain **factory calls** (`@Get()`, `@Module()`), not new bare decorator overloads.
The existing HTTP legacy-transform invocation fallback is preserved, not expanded.

`@Controller('cats')` plus `@Get()` means `GET /cats`, exactly as `@Get('')`.
`@Get('/')` has the same effective route but retains a different raw path string;
the slash never escapes the controller prefix. The same rules hold for `@Router()`
and prefixed routers with `@Path()`. Duplicate normalized routes still fail.
`Sse()` remains GET plus `text/event-stream` with the same stream lifecycle;
`All()` remains the wildcard sentinel, and HTTP `Query()` remains RFC QUERY.
Adapter custom-method limitations and OpenAPI's standard Path Item method set do
not change.

`ApiOperation()` invents no summary, description, or deprecation flag.
`ApiBody()` invents no required flag or schema: a DTO-inferred body remains, and a
route without a body gains no `requestBody`. Empty OpenAPI decorators still write
metadata, so stacking can overwrite a previous value. They are not always equivalent
to omitting the decorator. Their existing `null` failures occur on decorator
application, not necessarily on factory invocation.

`Module()` is not an undecorated class. It registers metadata, preserves earlier
partial fields and `Module({ global: true })` in either order, isolates class records, and increments
the module metadata version. `Path()` writes HTTP, React, and route-inspection
metadata while keeping the React metadata's `options` property absent.

## Remaining 150 APIs

This stable section records the original 150-API group; 149 remain after #3738.
The Core row reflects that later consolidation. Other rows retain their argument contracts.
`?` denotes an already optional argument; `...` denotes existing variadic input.
Names in this table are factories even when the table omits call parentheses.

| Owner | APIs | Count | Preserved contract |
| --- | --- | --- | --- |
| http | `Controller` | 1 | `basePath = ''` |
| http | `FromPath`, `FromQuery`, `FromHeader`, `FromCookie`, `FromBody`, `FromFiles` | 6 | `key?`; omission uses the DTO field name, not the entire body or all files |
| http | `Optional`, `Produces`, `UseGuards`, `UseInterceptors` | 4 | No-arg field factory or variadic factories; empty `Produces()` stores `[]`; empty guards/interceptors do not clear inherited metadata |
| http | `Convert`, `RequestDto`, `HttpCode`, `Version`, `Header`, `Redirect` | 6 | Converter, DTO, status, version, header name/value, and redirect URL remain required; redirect status keeps dispatcher default 302 |
| openapi | `ApiTag`, `ApiResponse` | 2 | Tag or response status/options remains required; response overloads count once |
| openapi | `ApiParam`, `ApiQuery`, `ApiHeader`, `ApiCookie`, `ApiSecurity` | 5 | Name required; parameter options remain `{}`, security scopes remain `[]` |
| openapi | `ApiBearerAuth`, `ApiExcludeEndpoint` | 2 | Existing no-arg factories; bearer metadata does not install an authentication guard |
| graphql | `Resolver`, `Query`, `Mutation`, `Subscription`, `FieldResolver`, `Arg` | 6 | Existing optional names/options, class/method/DTO-field name fallback |
| graphql | `Parent`, `Context`, `Args` | 3 | TC39 method factories; indexes remain 0, 1, 0; duplicate index validation remains |
| serialization | `Expose`, `Exclude`, `Transform` | 3 | `Expose(options?)` preserves inherited class policy; `Exclude()` remains no-arg; synchronous transform function required |
| throttler | `Throttle`, `SkipThrottle` | 2 | `Throttle(options)` requires positive finite integer limit/ttl; skip remains no-arg |
| cache-manager | `CacheKey`, `CacheTTL`, `CacheEvict` | 3 | Key/resolver, TTL in seconds, and eviction target required; explicit `CacheTTL(0)` means no expiry |
| passport | `UseAuth`, `UseOptionalAuth`, `RequireScopes` | 3 | `UseAuth(strategyName)` and `UseOptionalAuth(strategyName)` require a strategy; scopes remain variadic and compositional |
| core | `Inject`, `Scope` | 2 | Explicit variadic injection tokens or spread lists; `Inject()` clears inherited tokens; scope literal required |
| queue | `QueueWorker` | 1 | Job constructor required; options remain `{}` |
| cron | `Cron`, `Interval`, `Timeout` | 3 | Expression/milliseconds required; options remain `{}` |
| cqrs | `CommandHandler`, `QueryHandler`, `EventHandler`, `Saga` | 4 | Message/event constructor required; Saga also accepts a nonempty constructor array and is a class factory |
| event-bus | `OnEvent` | 1 | Event constructor required; no name-string or catch-all inference |
| microservices | `MessagePattern`, `EventPattern`, `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern` | 5 | String/RegExp pattern required |
| websockets | `WebSocketGateway`, `OnMessage`, `OnConnect`, `OnDisconnect` | 4 | Gateway options remain `{}`; event omission means general messages; connect/disconnect remain no-arg |
| prisma | `Transaction` | 1 | Existing optional accessor/options and service lookup; options remain `undefined` |
| drizzle | `Transaction` | 1 | Existing optional accessor/options and database lookup; options remain `undefined` |
| mongoose | `Transaction` | 1 | Optional accessor and connection lookup; no new options-object API |
| react | `Router`, `PageLayout`, `SuspenseFallback`, `PageMetadata` | 4 | Router base path remains `''`; component references and metadata factory remain required |

### Validation: 76 Unchanged Factories

All are owned by `@fluojs/validation`, including const aliases and returned helper
functions. Their implementation is `packages/validation/src/decorators.ts` and
`src/internal/decorator-factories.ts`.

| Group | APIs | Count | Preserved contract |
| --- | --- | --- | --- |
| Basic optional options | `IsString`, `IsNumber`, `IsBoolean`, `IsDefined`, `IsOptional`, `IsEmpty`, `IsNotEmpty`, `IsDate`, `IsArray`, `IsObject`, `IsInt`, `IsPositive`, `IsNegative` | 13 | Existing optional Fluo validation options |
| String/network/geo optional options | `IsAlpha`, `IsAlphanumeric`, `IsAscii`, `IsBase64`, `IsBooleanString`, `IsDataURI`, `IsDateString`, `IsDecimal`, `IsEmail`, `IsFQDN`, `IsHexColor`, `IsHexadecimal`, `IsJSON`, `IsJWT`, `IsLocale`, `IsLowercase`, `IsMagnetURI`, `IsMimeType`, `IsMongoId`, `IsNumberString`, `IsPort`, `IsRFC3339`, `IsSemVer`, `IsUppercase`, `IsISO8601`, `IsLatitude`, `IsLongitude`, `IsLatLong`, `IsISSN`, `IsUrl`, `IsCurrency` | 31 | Existing optional Fluo validation options |
| Already optional arguments | `IsIP`, `IsISBN`, `IsMobilePhone`, `IsPostalCode`, `IsRgbColor`, `IsUUID`, `ArrayNotEmpty`, `ArrayUnique` | 8 | Existing version/locale/options/selector behavior |
| Required semantic arguments | `ValidateIf`, `Equals`, `NotEquals`, `IsIn`, `IsNotIn`, `IsEnum`, `IsDivisibleBy`, `Min`, `Max`, `MinDate`, `MaxDate`, `Contains`, `NotContains`, `Length`, `ValidateNested`, `MinLength`, `MaxLength`, `Matches`, `ArrayContains`, `ArrayNotContains`, `ArrayMinSize`, `ArrayMaxSize`, `Validate`, `ValidateClass` | 24 | Condition, comparison value, list/enum, bound, DTO constructor, pattern, or custom validator required |

`Length` still requires min; `Matches` still requires pattern. `ValidateClass` is
a class factory; the others are field factories. Fluo's `message`, `code`, `each`,
`IsNumber`/`allowNaN`, optional versions/locales, and null/undefined input behavior
are unchanged. This is not exposure of every validator.js option. `IsJWT` checks
string format, not signatures.

## Boundaries and Audit Evidence

Prisma and Drizzle must not turn omitted transaction options into `{}`: supplying
options is observably different for nested transactions. HTTP Query is not GraphQL
Query or a query-string parameter decorator. `di.Scope` is a namespace, not a
decorator. `forwardRef`, `optional`, `defineModule`, and mapped-type helpers are
outside the count. WebSocket host-subpath re-exports do not add 16 more APIs.
No claim is made that every existing decorator consistently rejects out-of-type
`null`; this change does not harden all factories.

The 23 packages without owned public decorators are `config`, `di`, `i18n`,
`runtime`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`,
`platform-deno`, `platform-cloudflare-workers`, `redis`, `notifications`, `email`,
`slack`, `discord`, `socket.io`, `metrics`, `terminus`, `cli`, `studio`, `testing`,
`vite`, and `jwt`.

The only production edits are the seven default-bearing signatures in
`packages/{http,openapi,core,react}/src/decorators.ts` and their TSDoc. The shared
HTTP factory accounts for nine APIs. Metadata writers, dispatchers, lifecycle
implementations, exports, and the other packages' decorators are unchanged.

Executable evidence lives at:

- `tooling/governance/decorator-defaults-public-types.test.ts`: published declarations, public imports, rejected required arguments and bare forms.
- `packages/http/src/decorator-defaults.test.ts` and `src/dispatch/default-route-paths.test.ts`: root/portable TC39 and existing legacy metadata, dispatch, grammar, conflicts, methods, and managed SSE.
- `packages/http/src/dispatch/dispatcher-manual-sse-lifecycle.test.ts`: default-path manual stream close/abort/resource settlement.
- `packages/openapi/src/decorator-defaults.test.ts`: empty options, stacking, snapshots, application-time null failure, and actual documents.
- `packages/core/src/module-defaults.test.ts` and `packages/runtime/src/empty-module-default.test.ts`: metadata registration, partial merge/version, isolation, and bootstrap/close.
- `packages/react/src/path-defaults.test.ts`: metadata, rendered GET responses, and bootstrap-resolved catalogs.

The release intent is minor for `@fluojs/http`, `@fluojs/openapi`, `@fluojs/core`,
and the current `0.x` `@fluojs/react`. Changesets computes versions together with
pending release metadata; this document does not assign release versions.
