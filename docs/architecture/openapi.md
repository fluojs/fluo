# OpenAPI Generation Contract

<p><strong><kbd>English</kbd></strong> <a href="./openapi.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current OpenAPI document-generation contract implemented by `@fluojs/openapi`.

## Module Registration Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Module entrypoints | Applications register OpenAPI through `OpenApiModule.forRoot(options)` or `OpenApiModule.forRootAsync(options)`. | `packages/openapi/src/openapi-module.ts` |
| Required options | The options provider MUST resolve `title` and `version`. Missing either value fails module setup. `sources` and `descriptors` are optional as values, but omitting both produces no documented operations because the module does not scan the application graph. | `packages/openapi/src/openapi-module.ts` |
| Handler inclusion | The module includes HTTP handlers only from `sources` and `descriptors`. It does not infer handlers from `@Module({ controllers: [...] })` by itself. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/README.md` |
| Source composition and collisions | When both inputs are provided, descriptors discovered from `sources` are composed first and explicit `descriptors` second. For duplicate OpenAPI path/method operations, the later descriptor wins, so an explicit descriptor overrides a discovered source operation. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts`, `packages/openapi/src/openapi-module.test.ts` |
| Exposed routes | Each runtime module serves JSON at `documentPath` (default `/openapi.json`) and reserves `uiPath` (default `/docs`). Swagger UI is opt-in: the UI route serves the page only when `ui: true`; otherwise it throws `NotFoundException`. | `packages/openapi/src/openapi-module.ts` |
| Async route options | `forRootAsync(...)` receives `documentPath` and `uiPath` on the outer registration because routes are compiled before its injected document-options factory resolves. | `packages/openapi/src/openapi-module.ts` |
| Runtime route collisions | Document and UI paths use normal HTTP path normalization. Any duplicate normalized `GET` route within one registration, across multiple OpenAPI registrations, or against another application controller fails bootstrap with `RouteConflictError`; runtime routes never use OpenAPI descriptor later-wins precedence. | `packages/openapi/src/openapi-module.ts`, `packages/http/src/mapping.ts`, `packages/openapi/src/openapi-module-routes.test.ts` |

## Metadata Sources

| Source | Current contract | Source anchor |
| --- | --- | --- |
| Base document version | `buildOpenApiDocument(...)` always emits `openapi: '3.1.0'`. | `packages/openapi/src/schema-builder.ts` |
| HTTP route metadata | Paths, HTTP methods, handler names, and resolved URI-versioned routes come from fluo HTTP handler descriptors. Express-style `:id` path segments are converted to `{id}` in the final document. | `packages/openapi/src/schema-builder.ts` |
| Controller tags | `@ApiTag(...)` defines controller tags. If absent, the controller class name becomes the default tag. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| Operation metadata | `@ApiOperation(...)` stores `summary`, `description`, and `deprecated` flags per handler. | `packages/openapi/src/decorators.ts` |
| Response metadata | `@ApiResponse(...)` stores explicit status/description/schema/type metadata. DTO `type` values become component schema references. Handler return values and TypeScript return types are not inspected. Without `@ApiResponse(...)`, the builder emits only a method-derived or `@HttpCode(...)` success status with description `OK`, not an inferred response schema. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| Parameter and body metadata | `@ApiParam(...)`, `@ApiQuery(...)`, `@ApiHeader(...)`, `@ApiCookie(...)`, and `@ApiBody(...)` supply explicit parameter and request-body metadata. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| DTO schema generation | DTO schemas are derived from binding and validation metadata through `getDtoBindingSchema(...)` and `getDtoValidationSchema(...)`, then emitted into `components.schemas`. | `packages/openapi/src/schema-builder.ts` |
| Security metadata | `@ApiBearerAuth()` and `@ApiSecurity()` contribute operation-level security requirements. `securitySchemes` options populate `components.securitySchemes`. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts` |

## Output Surface

| Surface | Current contract | Source anchor |
| --- | --- | --- |
| JSON document | `GET documentPath` returns the generated `OpenApiDocument`; `documentPath` defaults to `/openapi.json`. | `packages/openapi/src/openapi-module.ts` |
| Swagger UI | With `ui: true`, `GET uiPath` renders HTML that points to that module instance's `documentPath`, including under a runtime global prefix. `uiPath` defaults to `/docs`. The default assets use the pinned `swagger-ui-dist` version `5.32.2`; `swaggerUiAssets.cssUrl` and `swaggerUiAssets.jsBundleUrl` can replace those URLs for self-hosted or CSP-controlled deployments. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/swagger-ui.ts` |
| Default error responses | `defaultErrorResponsesPolicy` defaults to `'inject'`. The builder can also omit framework-added defaults when set to `'omit'`. | `packages/openapi/src/schema-builder.ts`, `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/openapi-module.test.ts` |
| Extra models | `extraModels` lets the module include DTO constructors that are not otherwise discovered from handlers. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts` |
| Final transform | `documentTransform(document)` can rewrite the generated document before it is exposed. | `packages/openapi/src/openapi-module.ts` |

## Generation Boundaries

- `@ApiExcludeEndpoint()` removes one handler from generated `paths`, but it does not change the runtime route itself.
- OpenAPI generation is descriptor-driven. Controllers or handlers not represented in `sources` or `descriptors` are outside the generated document boundary.
- Response generation is metadata-driven rather than return-value-driven. Use `@ApiResponse(...)` with `schema` or `type` when clients need response content in the document.
- The package documents the HTTP surface only. It does not generate contracts for non-HTTP transports.
- Swagger UI is optional and runtime-served; the OpenAPI JSON document remains available even when UI support is disabled.
- Disabling Swagger UI does not unregister `uiPath`; that route remains reserved and returns the explicit disabled-UI not-found response.
- The package uses explicit metadata and DTO schema readers from fluo packages.
