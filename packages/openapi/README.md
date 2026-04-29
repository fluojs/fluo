# @fluojs/openapi

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based OpenAPI 3.1.0 document generation for fluo. Automatically generate and serve your API documentation with zero manual synchronization and optional Swagger UI support.

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
- When you need to document complex request/response models using DTOs and validation metadata.

## Quick Start

Register the `OpenApiModule` and pass `sources` (or prebuilt `descriptors`) so the document builder knows which HTTP handlers to include.

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

If you need to bypass controller discovery, pass `descriptors: createHandlerMapping([...]).descriptors` instead. `OpenApiModule` does not infer handlers from `@Module({ controllers: [...] })` on its own.

## Core Capabilities

### Automated Specification Generation
fluo inspects your controllers and methods to build a complete OpenAPI 3.1.0 document. This includes paths, methods, parameters, and request bodies.

### Response Media Types
When an HTTP handler declares `@Produces(...)` from `@fluojs/http`, generated OpenAPI responses use those media types as the response `content` keys. For example, `@Produces('application/json', 'application/problem+json')` on a handler with an `@ApiResponse(...)` schema emits both media types with the same response schema instead of silently falling back to only `application/json`.

### Integrated DTO Schemas
Works seamlessly with `@fluojs/validation`. Your DTO classes are automatically converted to OpenAPI components and referenced in the appropriate operations.

### Versioning Support
Handles URI-based versioning from `@fluojs/http` automatically. Your OpenAPI paths will correctly reflect the resolved versioned routes.

### Security Documentation
Easily document authentication requirements like Bearer tokens or API keys using `@ApiBearerAuth()` and `@ApiSecurity()`.

Stacking multiple `@ApiSecurity()` decorators for the same scheme merges scopes into one cumulative OpenAPI security requirement for that scheme. This keeps OAuth-style requirements deterministic when a route declares overlapping scopes such as `['reports:read']` and `['reports:write', 'reports:read']`, while different schemes remain separate requirements.

### Deterministic Swagger UI Assets
When `ui: true` is enabled, the generated `/docs` page references an exact `swagger-ui-dist` asset version so release behavior stays deterministic across package updates.

## Public API

- `OpenApiModule`: Main entry point for OpenAPI integration.
- `ApiTag`, `ApiOperation`, `ApiResponse`: Documentation decorators.
- `ApiBody`, `ApiParam`, `ApiQuery`, `ApiHeader`, `ApiCookie`: Explicit request-body and parameter documentation decorators that override inferred request documentation when names overlap.
- `ApiBearerAuth`, `ApiSecurity`: Security requirement decorators.
- `ApiExcludeEndpoint`: Omit specific handlers from documentation.
- `buildOpenApiDocument`: Programmatic document builder (low-level).
- `OpenApiSchemaObject`: Typed schema surface for explicit `@ApiBody(...)` and `@ApiResponse(...)` schemas, including OpenAPI 3.1 composition (`allOf`, `oneOf`, `anyOf`), object/array constraints, examples/defaults, and read/write/deprecated annotations.

## Related Packages

- `@fluojs/core`: Shared metadata utilities.
- `@fluojs/http`: Controller and routing integration.
- `@fluojs/validation`: Schema and model generation from DTOs.

## Example Sources

- `packages/openapi/src/openapi-module.test.ts`: Integration tests and usage examples.
- `examples/openapi-swagger`: Complete OpenAPI application example.
