# http runtime

<p><strong><kbd>English</kbd></strong> <a href="./http-runtime.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current HTTP execution model across `@konekti/http`, `@konekti/runtime`, auth packages, and the generated starter app.

See also:

- `./architecture-overview.md`
- `./auth-and-jwt.md`
- `../../packages/http/README.md`

## request lifecycle

```text
HTTP adapter
-> RequestContext creation
-> app middleware
-> route match
-> module middleware
-> guard chain
-> interceptor chain
-> request DTO binding
-> DTO validation
-> controller invocation
-> success status resolution
-> response write
-> exception mapping when needed
```

## success status defaults

Without an explicit override, the dispatcher uses method-based success defaults:

- `GET`, `PUT`, `PATCH`, `HEAD` -> `200`
- `POST` -> `201`
- `DELETE`, `OPTIONS` -> `204` when the final resolved value is `undefined`, otherwise `200`

`@SuccessStatus(code)` always overrides those defaults.

The decision happens after the interceptor chain resolves, so interceptor result shaping still affects the final default status.

## DTO boundary

- request DTO binding belongs to `@konekti/http`
- field source decorators such as `@FromBody()` and `@FromPath()` also belong to `@konekti/http`
- validation decorators such as `@IsString()` and `@MinLength()` belong to `@konekti/dto-validator`

The runtime treats request DTOs as an explicit boundary, not a convenience copy step.

## starter-app HTTP policies

The generated starter keeps a few HTTP defaults consistent:

- runtime-owned `/health` and `/ready`
- starter-owned `/health-info/` through the generated `health/` module
- default CORS policy driven by runtime bootstrap config

These defaults live above any single package README because they describe how packages are composed in the starter app.

## current public boundary

The shipped HTTP/runtime contract stays intentionally narrow for now.

Current public direction:

- keep the handler shape as `handler(input, ctx)`
- keep plain return values plus `@SuccessStatus(...)` as the main success-response model
- keep middleware exposure at the app and module levels only
- keep the current guard allow/deny model without adding a richer general HTTP deny-result contract

Explicitly deferred for a future track:

- a new top-level transport-neutral `handler(requestObject)` public API
- first-class response wrapper objects as the main success path
- route-level middleware as a public contract
- broader custom guard result shapes beyond the current allow/deny model

These items are deferred to protect dispatcher clarity and keep transport expansion sequenced after the current HTTP-first model.

## where to look next

- package API details -> `../../packages/http/README.md`
- runtime bootstrap -> `../../packages/runtime/README.md`
- auth strategy flow -> `./auth-and-jwt.md`
- starter HTTP defaults -> `../getting-started/quick-start.md`
