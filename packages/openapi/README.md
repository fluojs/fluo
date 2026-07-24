# @fluojs/openapi

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Descriptor-driven OpenAPI 3.1.0 document generation for fluo, with standard decorators for explicit documentation metadata and optional Swagger UI support.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Capabilities](#core-capabilities)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/openapi
```

## When to Use

- When you want to provide interactive documentation for your REST API using **Swagger UI**.
- When you need a machine-readable **OpenAPI 3.1.0** specification for client generation or testing.
- When you want to keep your API documentation in sync with your code using standard decorators.
- When you need to derive request models from DTO binding/validation metadata and declare response models explicitly.
- When one application needs separate JSON and UI routes for multiple API versions or audiences.

## Quick Start

Register the `OpenApiModule` and pass `sources`, prebuilt `descriptors`, or both so the document builder knows which HTTP handlers to include. When both inputs are provided, they are merged.

```typescript
import { Controller, Get } from '@fluojs/http';
import { Module } from '@fluojs/core';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { OpenApiModule, ApiOperation, ApiResponse, ApiTag } from '@fluojs/openapi';

@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse(200, { description: 'Success' })
  @Get('/')
  list() {
    return [];
  }
}

@Module({
  imports: [
    OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'My API',
      version: '1.0.0',
      ui: true, // Enable Swagger UI at /docs
    })
  ],
  controllers: [UsersController]
})
class AppModule {}

const app = await bootstrapNodeApplication(AppModule);
await app.listen(3000);
// OpenAPI JSON: http://localhost:3000/openapi.json
// Swagger UI: http://localhost:3000/docs
```

If you need to bypass controller discovery, create handler descriptors with `createHandlerMapping(...)` from `@fluojs/http` and pass them through `descriptors`. `OpenApiModule` does not infer handlers from `@Module({ controllers: [...] })` on its own.

When a prebuilt descriptor and a discovered source resolve to the same OpenAPI path and HTTP method, the later descriptor wins. Because `OpenApiModule` composes discovered `sources` first and explicit `descriptors` second, explicit descriptors take precedence without emitting duplicate operations or silently leaving stale source metadata in the generated document.

## Core Capabilities

### Automated Specification Generation
fluo inspects only the controllers and handler descriptors supplied through `sources` and `descriptors` to build an OpenAPI 3.1.0 document. This includes paths, methods, parameters, and request bodies for that explicit input set; importing a controller into an application module does not add it automatically.

### Response Media Types
When an HTTP handler declares `@Produces(...)` from `@fluojs/http`, generated OpenAPI responses use those media types as the response `content` keys. For example, `@Produces('application/json', 'application/problem+json')` on a handler with an `@ApiResponse(...)` schema emits both media types with the same response schema instead of silently falling back to only `application/json`.

### Default Success Responses
When a handler does not declare `@ApiResponse(...)` or `@HttpCode(...)`, the OpenAPI builder applies method-only implicit defaults: `POST` handlers default to `201`, and other methods default to `200`. Bodyless or runtime-dependent cases such as `DELETE` and `OPTIONS` should declare the intended success status explicitly with `@HttpCode(...)` or `@ApiResponse(...)`.

### Response Documentation Boundary
The builder does not inspect handler return values or TypeScript return types to infer response content. A default success response contains only its status and the description `OK`. Add `@ApiResponse(...)` with `schema` or `type` when the OpenAPI document must describe a response body; without either field, an explicit response still contains status and description only.

### Integrated DTO Schemas
Works with `@fluojs/validation` to derive request schemas from DTO binding and validation metadata. Response DTOs become OpenAPI components only when they are referenced explicitly, such as with `@ApiResponse(..., { type: ResponseDto })` or `extraModels`.

### Versioning Support
Handles URI-based versioning from `@fluojs/http` automatically. Your OpenAPI paths will correctly reflect the resolved versioned routes.

### Security Documentation
Easily document authentication requirements like Bearer tokens or API keys using `@ApiBearerAuth()` and `@ApiSecurity()`.

Stacking multiple `@ApiSecurity()` decorators for the same scheme merges scopes into one cumulative OpenAPI security requirement for that scheme. This keeps OAuth-style requirements deterministic when a route declares overlapping scopes such as `['reports:read']` and `['reports:write', 'reports:read']`, while different schemes remain separate requirements.

### Deterministic Swagger UI Assets
When `ui: true` is enabled, the generated `/docs` page references an exact `swagger-ui-dist` asset version so release behavior stays deterministic across package updates. If your deployment requires self-hosted assets for offline or CSP-controlled environments, set `swaggerUiAssets.cssUrl` and `swaggerUiAssets.jsBundleUrl`; the generated HTML escapes those URLs and does not expose the Swagger UI instance on `window.ui`.

### Configurable Document Routes
Each `OpenApiModule` registration serves JSON at `documentPath` and reserves its Swagger UI route at `uiPath`. The defaults remain `/openapi.json` and `/docs`, so existing applications do not need configuration changes. Set both paths when one application imports multiple OpenAPI modules:

```typescript
@Module({
  imports: [
    OpenApiModule.forRoot({
      documentPath: '/openapi/public.json',
      sources: [{ controllerToken: PublicController }],
      title: 'Public API',
      ui: true,
      uiPath: '/docs/public',
      version: '1.0.0',
    }),
    OpenApiModule.forRoot({
      documentPath: '/openapi/admin.json',
      sources: [{ controllerToken: AdminController }],
      title: 'Admin API',
      ui: true,
      uiPath: '/docs/admin',
      version: '1.0.0',
    }),
  ],
})
class AppModule {}
```

Paths follow the `@fluojs/http` route grammar and normalize duplicate or trailing slashes. Route collisions do not use document-descriptor precedence: if two normalized `GET` routes collide—between JSON and UI paths, separate OpenAPI modules, or another application controller—application bootstrap fails with `RouteConflictError`. The UI route remains reserved when `ui` is false so the configured endpoint can return the documented `Swagger UI is disabled.` not-found response.

### Module Option Determinism
`OpenApiModule.forRoot(...)` snapshots and freezes its options at registration time. Mutating the original options object, `documentPath`, `uiPath`, `sources`, `descriptors`, `securitySchemes`, `extraModels`, or `swaggerUiAssets` after registration does not alter the served OpenAPI document or UI HTML. The generated singleton document is also served through defensive copies, so downstream response serialization or tests cannot mutate the stored document for later requests. `OpenApiModule.forRootAsync(...)` fixes `documentPath` and `uiPath` from the outer registration before module compilation, applies the same snapshot once the async document-options factory resolves, and propagates factory failures during bootstrap.

### Async Registration and Options
Use `OpenApiModule.forRootAsync(...)` when title/version/source configuration comes from DI or async setup. Put registration-time `documentPath` and `uiPath` beside `inject` and `useFactory`; return `sources`, `descriptors`, `securitySchemes`, `extraModels`, `defaultErrorResponsesPolicy`, `documentTransform`, `ui`, and `swaggerUiAssets` from the factory. `defaultErrorResponsesPolicy` defaults to injecting standard error responses and an `ErrorResponse` schema, while `documentTransform` runs after document generation and before serving.

## Public API

- `OpenApiModule`: Main entry point for OpenAPI integration.
- `ApiTag`, `ApiOperation`, `ApiResponse`: Documentation decorators.
- `ApiBody`, `ApiParam`, `ApiQuery`, `ApiHeader`, `ApiCookie`: Explicit request-body and parameter documentation decorators that override inferred request documentation when names overlap.
- `ApiBearerAuth`, `ApiSecurity`: Security requirement decorators.
- `ApiExcludeEndpoint`: Omit specific handlers from documentation.
- `ApiOperationOptions`, `ApiResponseOptions`, `ApiParameterOptions`, `ApiBodyOptions`: Decorator option types accepted by `@ApiOperation(...)`, `@ApiResponse(...)`, `@ApiParam(...)`, `@ApiQuery(...)`, `@ApiHeader(...)`, `@ApiCookie(...)`, and `@ApiBody(...)`.
- `buildOpenApiDocument`: Programmatic document builder (low-level).
- `OpenApiHandlerRegistry`: Mutable descriptor registry used by advanced integrations to snapshot handler descriptors before document generation.
- `getControllerTags`, `getMethodApiMetadata`: Metadata readers for advanced tests and integration tooling.
- `OpenApiModuleOptions`, `OpenApiAsyncModuleOptions`, `OpenApiRouteOptions`, `OpenApiSwaggerUiAssetsOptions`, `BuildOpenApiDocumentOptions`, `DefaultErrorResponsesPolicy`: Option types for module and builder integrations.
- `OpenApiDocument`, `OpenApiSecuritySchemeObject`, and related OpenAPI shape types: Typed document surface for tests, tooling, and integrations.
- `OpenApiSchemaObject`: Typed schema surface for explicit `@ApiBody(...)` and `@ApiResponse(...)` schemas, including OpenAPI 3.1 composition (`allOf`, `oneOf`, `anyOf`), object/array constraints, examples/defaults, and read/write/deprecated annotations.

## Related Packages

- `@fluojs/core`: Shared metadata utilities.
- `@fluojs/http`: Controller and routing integration.
- `@fluojs/validation`: Schema and model generation from DTOs.

## Example Sources

- `packages/openapi/src/openapi-module.test.ts`: Integration tests and usage examples.
- `packages/openapi/src/openapi-module-routes.test.ts`: Default, custom, multi-document, and route-collision examples.
- `packages/openapi/src/schema-builder.test.ts`: Document builder and schema generation examples.
