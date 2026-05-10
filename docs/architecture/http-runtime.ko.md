# HTTP Runtime Contract

<p><a href="./http-runtime.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/http`가 구현하고 `@fluojs/runtime`이 조립하는 현재 요청 실행 계약을 정의한다.

## Request Lifecycle

1. 어댑터는 정규화된 `FrameworkRequest`와 `FrameworkResponse`를 `Dispatcher.dispatch(...)`에 전달한다.
2. dispatcher는 request params를 복사하고 request metadata와 선택적 `x-request-id`를 포함하는 `RequestContext`를 생성한다. 시작 시에는 root container를 사용하고, 매칭된 graph, 활성 middleware, observer, DTO conversion, binder, guard, interceptor, controller dependency graph, 또는 수동 `RequestContext.container.resolve(...)` 접근이 request scope를 필요로 할 수 있을 때만 isolated request-scoped container로 승격한다.
3. 등록된 request observer는 route matching 전에 `onRequestStart`를 받는다.
4. 전역 application middleware가 `runMiddlewareChain(...)`을 통해 가장 먼저 실행된다.
5. `matchHandlerOrThrow(...)`는 `HandlerMapping`에서 하나의 handler를 해석하거나 `HandlerNotFoundError`를 던진다.
6. 매칭된 route params는 `requestContext.request.params`로 복사되고, 이어서 observer가 `onHandlerMatched`를 받을 수 있다.
7. 매칭된 handler에 연결된 module-level middleware는 global middleware 뒤, guard 실행 전에 실행된다.
8. `runGuardChain(...)`는 request container에서 guard를 해석하고, 어느 guard라도 `false`를 반환하면 `ForbiddenException`을 던진다.
9. interceptor chain은 global interceptor 다음 route interceptor 순서로 구성된다.
10. `invokeControllerHandler(...)`는 request container에서 controller를 해석하고, binder로 선언된 DTO를 바인딩하며, route가 `request` metadata를 선언한 경우 `HttpDtoValidationAdapter`로 DTO 입력을 검증한다.
11. controller method는 `(input, requestContext)`를 받고 handler 결과를 반환한다.
12. 성공한 non-SSE 결과는 `writeSuccessResponse(...)`를 통해 기록되며, 여기서 redirect metadata, route header, formatter 선택, 기본 성공 status 규칙이 적용된다.
13. 어느 단계에서든 예외가 발생하면 dispatcher는 설정된 경우 `onError`를 실행하고, 그렇지 않으면 `writeErrorResponse(...)`가 기본 에러 응답을 기록한다.
14. dispatcher는 항상 `onRequestFinish`를 호출한다. request scope가 생성되었거나 lazy promotion 되었다면 요청이 끝나기 전에 해당 isolated request-scoped container를 dispose하며, 끝까지 승격되지 않은 singleton-only fast-path 요청은 root container를 dispose하지 않는다.

## Routing Rules

| Rule | Current behavior |
| --- | --- |
| Path normalization | `normalizeRoutePath(...)`는 중복 슬래시와 trailing slash를 제거하므로, 동등한 경로 형식은 하나의 canonical path로 정규화된다. |
| Supported segments | `parseRoutePath(...)`는 literal segment와 전체 segment를 차지하는 `:param` placeholder만 허용한다. |
| Unsupported syntax | wildcard, regex-like token, inline modifier, `user-:id` 또는 `:id.json` 같은 mixed segment는 route validation에서 거부된다. |
| Param naming | Route param 이름은 `/[a-zA-Z_][a-zA-Z0-9_]*/`를 만족해야 한다. |
| Match shape | `matchRoutePath(...)`는 등록된 경로와 incoming 경로의 segment 개수가 같을 때만 매칭한다. |
| Handler lookup | `HandlerMapping.match(request)`는 descriptor와 추출된 params를 담은 하나의 `HandlerMatch`를 반환하거나, 매칭이 없으면 `undefined`를 반환한다. |
| Missing route behavior | `matchHandlerOrThrow(...)`는 매칭되지 않은 method 와 path 조합에 대해 `HandlerNotFoundError`를 던진다. |
| Response defaults | `writeSuccessResponse(...)`는 route metadata가 status를 덮어쓰지 않는 한, `POST`는 `201`, payload가 `undefined`인 `DELETE` 와 `OPTIONS`는 `204`, 그 외 성공 route는 `200`을 기본값으로 사용한다. |

## Middleware Constraints

- Middleware는 `handle(context, next)`를 구현해야 하며 `runMiddlewareChain(...)`을 통해 실행된다.
- Middleware 정의는 object instance, DI token, 또는 특정 정규화 route pattern을 대상으로 하는 `forRoutes(...)` 선언일 수 있다.
- Route-targeted middleware는 정확히 일치하는 정규화 path 또는 `/*`로 끝나는 prefix pattern에만 매칭된다.
- 전역 application middleware는 handler matching 전에 실행된다. 매칭된 handler의 module middleware는 handler matching 뒤, guard 전에 실행된다.
- Middleware 해석은 request-scoped container를 사용하므로, request scope 의존성은 middleware 실행 중에도 사용할 수 있다.
- Middleware는 응답을 조기에 commit할 수 있다. `response.committed`가 이미 `true`이면 이후 routing 과 handler 단계는 계속 진행되지 않는다.
- Guard와 interceptor는 middleware가 아니다. Guard는 `canActivate(...)`로 선행 조건을 강제하고, interceptor는 `intercept(...)`로 handler 실행을 감싼다.
- Middleware는 dispatcher policy가 소유한 route matching, DTO validation, controller invocation, response serialization 규칙을 다시 정의하면 안 된다.
