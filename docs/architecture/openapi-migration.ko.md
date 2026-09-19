# OpenAPI 3 마이그레이션 가이드

<p><strong><kbd>한국어</kbd></strong> <a href="./openapi-migration.md"><kbd>English</kbd></a></p>

애플리케이션 등록은 `OpenApiModule.forRoot(...)` 또는 `OpenApiModule.forRootAsync(...)`만 사용하세요. Offline 문서에는 `OpenApiDocumentBuilder.build({ title, version, sources?, descriptors?, operationPathPrefix? })`를 사용합니다. `buildOpenApiDocument`, `BuildOpenApiDocumentOptions`, `OpenApiHandlerRegistry`는 사용하지 마세요.

`@ApiResponse({ status, ... })`를 사용하고 명시적 body schema는 `@ApiBody({ content: { 'application/json': { schema } } })`에 넣으세요. OpenAPI 3.1은 numeric exclusive bound와 null union/`anyOf`를 허용하며 legacy `nullable`과 boolean exclusive 형식은 실패합니다.

`operationPathPrefix`는 operation path만 바꾸며 descriptor deduplication과 transform 전에 적용됩니다. URI versioning과 결합하면(`/api/v2`) module document/UI route, `info.version`, host global prefix는 바꾸지 않습니다.
