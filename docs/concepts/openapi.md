# openapi

<p><strong><kbd>English</kbd></strong> <a href="./openapi.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current OpenAPI generation model across `@konekti/openapi`, `@konekti/http`, and request DTO metadata.

See also:

- `./http-runtime.md`
- `../../packages/openapi/README.md`
- `../../packages/http/README.md`

## module registration

`OpenApiModule.forRoot(...)` serves:

- `GET /openapi.json`
- optional Swagger UI at `/docs`

The document is built from handler descriptors gathered at application startup.
`OpenApiModule.forRoot(...)` can receive either prebuilt descriptors or the same `HandlerSource[]` model that `createHandlerMapping()` consumes.

## operation-level decorators

Konekti currently supports:

- `@ApiTag(tag)`
- `@ApiOperation({ summary, description })`
- `@ApiResponse(status, { description, schema, type })`
- `@ApiBearerAuth()`

These decorators are metadata-only. They do not affect runtime request handling.

## DTO schema extraction

- request DTO metadata is read through normalized helpers
- validator metadata drives `components.schemas`
- request DTOs are linked through `requestBody`
- cookie-bound DTO fields are emitted as cookie parameters
- response DTOs can be referenced through `@ApiResponse(..., { type: ... })`
- nested DTOs and arrays are expressed as component schema references where possible

## generation model

- route metadata is read from handler descriptors
- URI versioning written by `@Version(...)` is reflected directly in the resolved OpenAPI paths (for example `/v1/users`)
- those descriptors can be derived from the same handler sources the runtime uses
- tags, operation metadata, response metadata, and request DTO schema are assembled into one OpenAPI 3.1 document
- the generated document is built at startup and served statically

## ownership boundaries

- `@konekti/openapi` owns schema generation and serving logic
- `@konekti/http` owns route and request metadata writing
- `@konekti/openapi` reads normalized metadata; it should not reach into package-private storage details
- auth scheme declaration remains app-driven through OpenAPI decorators

## practical mental model

```text
@konekti/http writes runtime metadata
@konekti/dto-validator writes validation metadata
@konekti/openapi reads both to generate the document
```
