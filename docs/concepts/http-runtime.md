# http runtime

<p><strong><kbd>English</kbd></strong> <a href="./http-runtime.ko.md"><kbd>한국어</kbd></a></p>

This guide explains the HTTP execution model used in `@konekti/http`, `@konekti/runtime`, authentication packages, and the generated starter application.

### related documentation

- `./architecture-overview.md`
- `./auth-and-jwt.md`
- `../../packages/http/README.md`

## request lifecycle

The request execution path follows this sequence:

1.  **HTTP adapter** receives the request.
2.  **RequestContext** creation.
3.  **Application middleware** execution.
4.  **Route matching**.
5.  **Module middleware** execution.
6.  **Guard chain** validation.
7.  **Interceptor chain** execution.
8.  **Request DTO binding**.
9.  **DTO validation**.
10. **Controller invocation**.
11. **Success status resolution**.
12. **Response write**.
13. **Exception mapping** (if an error occurs).

## success status defaults

Unless overridden, the dispatcher uses method-based defaults:

- `GET`, `PUT`, `PATCH`, `HEAD`: `200`
- `POST`: `201`
- `DELETE`, `OPTIONS`: `204` if the result is `undefined`, otherwise `200`.

Use `@HttpCode(code)` to override these defaults. Note that status resolution happens after the interceptor chain, so interceptors can still influence the final status code.

## dto boundaries

- **Binding**: `@konekti/http` handles request DTO binding.
- **Source Decorators**: `@FromBody()` and `@FromPath()` are provided by `@konekti/http`.
- **Validation**: `@IsString()` and `@MinLength()` are provided by `@konekti/dto-validator`.

Konekti treats request DTOs as an explicit boundary between the transport layer and application logic.

## starter app policies

The generated starter application maintains several HTTP defaults:

- Built-in `/health` and `/ready` endpoints.
- Sample `/health-info/` endpoint via the `health/` module.
- Default CORS policies managed by the runtime bootstrap configuration.

## development boundaries

The HTTP and runtime contracts are intentionally kept narrow to ensure stability and clarity.

### current priorities

- Keep the handler signature as `handler(input, ctx)`.
- Use plain return values and `@HttpCode(...)` as the primary response model.
- Restrict middleware to the application and module levels.
- Maintain the current boolean (allow/deny) guard model.

### deferred features

The following items are deferred to future updates to maintain architectural clarity:

- A transport-neutral `handler(requestObject)` API.
- First-class response wrapper objects for success paths.
- Route-level middleware support.
- Complex guard results beyond boolean allow/deny.

## further reading

- **HTTP API details**: `../../packages/http/README.md`
- **Runtime bootstrap**: `../../packages/runtime/README.md`
- **Authentication flow**: `./auth-and-jwt.md`
- **Starter defaults**: `../getting-started/quick-start.md`
