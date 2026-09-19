# OpenAPI 3 Migration Guide

<p><strong><kbd>English</kbd></strong> <a href="./openapi-migration.ko.md"><kbd>한국어</kbd></a></p>

Migrate application registration only through `OpenApiModule.forRoot(...)` or `OpenApiModule.forRootAsync(...)`. Use `OpenApiDocumentBuilder.build({ title, version, sources?, descriptors?, operationPathPrefix? })` for offline documents. Do not use `buildOpenApiDocument`, `BuildOpenApiDocumentOptions`, or `OpenApiHandlerRegistry`.

Use `@ApiResponse({ status, ... })`, and put explicit body schemas under `@ApiBody({ content: { 'application/json': { schema } } })`. OpenAPI 3.1 accepts numeric exclusive bounds and null unions/`anyOf`; legacy `nullable` and boolean exclusive forms fail.

`operationPathPrefix` changes operation paths only and is applied before descriptor deduplication and transforms. It combines with URI versioning (`/api/v2`) but never changes module document/UI routes, `info.version`, or host global prefixes.
