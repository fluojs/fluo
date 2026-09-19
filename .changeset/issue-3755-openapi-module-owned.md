---
"@fluojs/openapi": major
---

OpenAPI is now module-owned: register live JSON, Swagger UI, routes, and status with `OpenApiModule.forRoot(...)` or `OpenApiModule.forRootAsync(...)`. Replace `buildOpenApiDocument(options)` with `OpenApiDocumentBuilder.build(options)`, pass `sources` and/or `descriptors` directly, and remove `OpenApiHandlerRegistry` and `BuildOpenApiDocumentOptions`.

Replace `@ApiResponse(200, options)` with `@ApiResponse({ status: 200, ...options })`. `ApiBody` now uses explicit media `content` schemas. Use OpenAPI 3.1 null unions or `anyOf` and finite numeric exclusive bounds; legacy `nullable` and boolean exclusive bounds are rejected. `operationPathPrefix` affects only normalized operation paths, never `documentPath`, `uiPath`, `info.version`, or the application global prefix.
