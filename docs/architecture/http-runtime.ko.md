# HTTP Runtime Contract

<p><a href="./http-runtime.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/http`가 구현하고 `@fluojs/runtime`이 조립하는 현재 요청 실행 계약을 정의한다.

## Request Lifecycle

1. 어댑터는 정규화된 `FrameworkRequest`와 `FrameworkResponse`를 `Dispatcher.dispatch(...)`에 전달하며, host가 요청 취소를 노출한다면 `signal` 또는 `isAborted()`를 포함한다.
2. dispatcher는 request params와 abort metadata를 복사하고 request metadata와 선택적 `x-request-id`를 포함하는 `RequestContext`를 생성한다. 시작 시에는 root container를 사용하고, 매칭된 graph, 활성 middleware, observer, DTO conversion, binder, guard, interceptor, controller dependency graph, 또는 수동 `RequestContext.container.resolve(...)` 접근이 request scope를 필요로 할 수 있을 때만 isolated request-scoped container로 승격한다.
3. 등록된 request observer는 route matching 전에 `onRequestStart`를 받는다.
4. 전역 application middleware가 `runMiddlewareChain(...)`을 통해 가장 먼저 실행된다.
5. `matchHandlerOrThrow(...)`는 `HandlerMapping`에서 하나의 handler를 해석하거나 `HandlerNotFoundError`를 던진다.
6. 매칭된 route params는 `requestContext.request.params`로 복사되고, 이어서 observer가 `onHandlerMatched`를 받을 수 있다.
7. 매칭된 handler에 연결된 module-level middleware는 global middleware 뒤, guard 실행 전에 실행된다.
8. `runGuardChain(...)`는 request container에서 guard를 해석하고, 어느 guard라도 `false`를 반환하면 `ForbiddenException`을 던진다.
9. 설정된 경우 `conditionalRequest.resolve(...)`는 application/module middleware와 guard 뒤, interceptor와 controller 호출 전에 실행된다. 따라서 `304` 또는 `412`는 authorization이나 middleware가 소유한 audit 작업을 우회하지 않는다.
10. interceptor chain은 global interceptor 다음 route interceptor 순서로 구성된다.
11. `invokeControllerHandler(...)`는 request container에서 controller를 해석하고, binder로 선언된 DTO를 바인딩하며, route가 `request` metadata를 선언한 경우 `HttpDtoValidationAdapter`로 DTO 입력을 검증한다.
12. controller method는 `(input, requestContext)`를 받고 handler 결과를 반환한다.
13. 성공한 non-SSE 결과는 `writeSuccessResponse(...)`를 통해 기록되며, 여기서 redirect metadata, route header, formatter 선택, validator, 기본 성공 status 규칙이 적용된다. Dispatcher는 handler 실행 전후에 `signal`과 `isAborted()`를 검사하고 어느 cancellation surface든 authoritative하게 처리하므로 `false` probe가 aborted signal을 가리지 않으며 abort된 요청은 뒤늦게 성공 응답을 commit하지 않는다.
14. Handler가 수동 `SseResponse`를 반환하면 명시적 close, request abort 또는 raw stream close까지 dispatch를 유지한다. 그 completion 뒤에만 middleware가 settle하고 request observer가 success와 finish를 받으며 request-scoped resource가 dispose된다.
15. Module-level 및 application-level middleware가 `await next()` 이후의 작업까지 모두 settle하면 dispatcher는 handler 결과와 함께 `onRequestSuccess`를 호출한다.
16. `next()` 반환 이후의 middleware 작업을 포함해 어느 단계에서든 예외가 발생하면 dispatcher는 앞선 success 알림 없이 `onRequestError`를 호출한 뒤, 설정된 경우 `onError`를 실행한다. 그렇지 않으면 `writeErrorResponse(...)`가 failure를 분류하고 canonical JSON을 기록하거나, eligible `HttpException` 및 route-miss outcome에 대해 configured HTTP-owned error representation negotiation을 수행한다.
17. dispatcher는 항상 `onRequestFinish`를 호출한다. request scope가 생성되었거나 lazy promotion 되었다면 요청이 끝나기 전에 해당 isolated request-scoped container를 dispose하며, graph가 request scope를 필요로 하지 않는 요청은 root container를 dispose하지 않는다. Fast path는 handler metadata만 cache하고 매 dispatch마다 active container를 통해 controller를 resolve하므로, container가 소유하는 singleton 공유와 transient의 resolution별 새 identity가 모두 유지된다.

## Error Representation Boundary

- Canonical JSON은 default error response이며 HTML provider가 등록되지 않으면 유일한 representation이다.
- Application은 `createDispatcher(...)` 또는 runtime bootstrap의 `errorRepresentation.html`로 optional HTML을 등록한다. Provider는 classified exception, canonical JSON, request, optional matched handler, request id, active request-scope container를 받지만 response mutation authority는 받지 않는다.
- `HandlerNotFoundError`는 `Accept` negotiation 전에 기존 HTTP 404 outcome으로 변환된다. Middleware, DTO binding/validation, guard, interceptor, handler의 uncommitted `HttpException` failure는 diagnostic phase를 합치지 않고 같은 selection을 사용한다.
- Unknown failure, React shell failure, post-shell recoverable error, request abort, browser error는 별도 owner를 유지하며 HTML provider path에 들어가지 않는다.
- HTTP가 deterministic JSON/HTML quality 및 specificity selection, JSON tie-break, JSON 406 response, `Vary: Accept`, status/content type, `HEAD` body suppression, abort check, already-committed response 보호를 소유한다.
- Provider failure는 negotiation에 다시 진입하지 않고 원래 canonical JSON outcome으로 한 번만 fallback한다.

전체 ownership, negotiation, React adapter, fallback 계약은
[HTTP error representation decision](./http-error-representations.ko.md)에 기록되어 있다.

## Request Context Isolation

- Runtime-specific root entry는 `runWithRequestContext(...)`를 노출하기 전에 host async-context storage를 사용할 수 있게 한다. Node와 Bun은 `node:async_hooks` constructor를 등록하고 portable entry는 Node built-in import 없이 유지된다.
- Request-local store는 첫 helper 사용 시점에 lazy하게 instantiate되며, host가 async-context primitive를 제공하면 callback은 해당 store 안에서 실행된다.
- Non-async callback은 즉시 실행되므로 반환과 throw 동작이 동기로 유지된다. Promise를 반환하면 callback이 만든 continuation은 요청이 겹치는 동안에도 해당 promise가 settle될 때까지 request context를 보존한다.
- Request-context helper는 `Promise.prototype`을 patch하지 않으며 한 요청의 context를 관련 없는 promise continuation에 노출하지 않는다.
- 비동기 컨텍스트 primitive가 없는 host는 awaited work가 재개되기 전에 context를 지우는 synchronous stack fallback을 사용한다.

## Managed SSE Backpressure Cancellation

- Managed SSE는 request abort와 response-stream close notification을 iterator read뿐 아니라 adapter의 `waitForDrain()` backpressure wait에도 적용한다.
- Drain promise가 settle되지 않은 동안 cancellation이 먼저 완료되면 dispatcher는 해당 promise를 더 기다리지 않고 response stream을 닫으며, source iterator의 `return()`을 정확히 한 번 호출하고 그 cleanup을 기다린 뒤 request-scope disposal을 수행한다.
- Stream write가 throw하거나 drain promise가 reject하는 경우 cancellation으로 다시 분류하지 않는다. 원래 error가 committed-response observer 및 dispatcher logging boundary를 통해 그대로 전달된다.

## Routing Rules

| Rule | Current behavior |
| --- | --- |
| Path normalization | `normalizeRoutePath(...)`는 중복 슬래시와 trailing slash를 제거하므로, 동등한 경로 형식은 하나의 canonical path로 정규화된다. |
| Supported segments | `parseRoutePath(...)`는 literal segment와 전체 segment를 차지하는 `:param` placeholder만 허용한다. |
| Unsupported syntax | wildcard, regex-like token, inline modifier, `user-:id` 또는 `:id.json` 같은 mixed segment는 route validation에서 거부된다. |
| Catch-all decision | Catch-all grammar 도입은 유예되어 있다. [HTTP catch-all route grammar 결정](./http-catch-all-route-grammar.ko.md)을 참고한다. Candidate syntax는 현재 활성화되지 않는다. |
| Param naming | Route param 이름은 `/[a-zA-Z_][a-zA-Z0-9_]*/`를 만족해야 한다. |
| Method authoring | `@Query(path)`는 `QUERY`를 등록한다. `@Route(method, path)`는 비어 있지 않은 HTTP token을 받고 uppercase로 canonicalize하며 invalid token과 reserved `ALL` sentinel을 거부한다. `@All(path)`은 유일한 wildcard authoring API로 유지된다. |
| Method precedence | 같은 normalized path에서는 exact method route가 `ALL` route보다 먼저 선택된다. Custom method도 built-in method와 같은 duplicate detection 및 version-selection rule을 사용한다. |
| Adapter boundary | 지원되는 listener와 fetch dispatch는 `QUERY`와 extension method를 보존한다. Custom method는 native fluo route handoff가 아니라 adapter fallback dispatch에 남고, `CONNECT`는 일반 routing conformance 범위 밖에 유지된다. |
| OpenAPI boundary | Custom runtime method가 OpenAPI Path Item operation으로 자동 변환되지는 않는다. `@fluojs/openapi`는 문서화된 standard-operation allowlist를 유지한다. |
| Match shape | `matchRoutePath(...)`는 등록된 경로와 incoming 경로의 segment 개수가 같을 때만 매칭한다. |
| Handler lookup | `HandlerMapping.match(request)`는 descriptor와 추출된 params를 담은 하나의 `HandlerMatch`를 반환하거나, 매칭이 없으면 `undefined`를 반환한다. |
| Missing route behavior | `matchHandlerOrThrow(...)`는 매칭되지 않은 method 와 path 조합에 대해 `HandlerNotFoundError`를 던진다. |
| Response defaults | `writeSuccessResponse(...)`는 route metadata가 status를 덮어쓰지 않는 한, `POST`는 `201`, payload가 `undefined`인 `DELETE` 와 `OPTIONS`는 `204`, 그 외 성공 route는 `200`을 기본값으로 사용한다. |

## Conditional Requests

`BootstrapApplicationOptions.conditionalRequest`는 선택된 representation을 해석하는 resolver를 dispatcher에 제공합니다. Representation이 없으면 `{ exists: false }`를, 존재하면 optional `ETag` 및 `Last-Modified` validator와 함께 `{ exists: true, validators? }`를 반환합니다. Dispatcher는 route selection, application/module middleware, guard 뒤와 interceptor 또는 controller handler 전 사이에 resolver를 평가하므로 conditional outcome이 authorization이나 middleware-owned audit 작업을 우회하지 않습니다.

정책은 RFC validator precedence를 따릅니다. `If-Match`는 `If-Unmodified-Since`보다 우선하고, `If-None-Match`는 `If-Modified-Since`보다 우선합니다. `If-Match`는 strong comparison을 사용하며 `If-None-Match`는 weak comparison을 사용합니다. unsafe precondition 실패는 body 없는 `412`를 만들고, fresh safe representation은 body 없는 `304`를 만듭니다. 두 응답 모두 해석된 validator를 유지합니다. `HEAD`는 `GET`과 같은 validator 및 status를 받으며 framework-managed response writing이 body를 suppress합니다. 명시적 `@Head` handler는 독립 route로 유지되고 custom response writer는 body emission을 소유하므로 body 없는 `HEAD` 계약도 직접 보존해야 합니다.

Dispatcher는 portable `FrameworkResponse` facade를 통해 validator를 적용합니다. 따라서 Node.js, Express, Fastify, Bun, Deno, Cloudflare Workers는 동일한 conditional-response header와 body suppression을 제공합니다.

## Middleware Constraints

- Middleware는 `handle(context, next)`를 구현해야 하며 `runMiddlewareChain(...)`을 통해 실행된다.
- Middleware 정의는 object instance, DI token, 또는 특정 정규화 route pattern을 대상으로 하는 `forRoutes(...)` 선언일 수 있다.
- Route-targeted middleware는 정확히 일치하는 정규화 path 또는 `/*`로 끝나는 prefix pattern에만 매칭된다.
- 전역 application middleware는 handler matching 전에 실행된다. 매칭된 handler의 module middleware는 handler matching 뒤, guard 전에 실행된다.
- Middleware 해석은 request-scoped container를 사용하므로, request scope 의존성은 middleware 실행 중에도 사용할 수 있다.
- Middleware는 응답을 조기에 commit할 수 있다. `response.committed`가 이미 `true`이면 이후 routing 과 handler 단계는 계속 진행되지 않는다.
- 처리된 요청은 module 및 application middleware chain이 모두 반환한 뒤에만 success로 관찰된다. `next()` 이후의 middleware failure는 request error observer path를 따른다.
- Guard와 interceptor는 middleware가 아니다. Guard는 `canActivate(...)`로 선행 조건을 강제하고, interceptor는 `intercept(...)`로 handler 실행을 감싼다.
- Middleware는 dispatcher policy가 소유한 route matching, DTO validation, controller invocation, response serialization 규칙을 다시 정의하면 안 된다.
