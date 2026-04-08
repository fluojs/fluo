# @konekti/openapi

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based OpenAPI 3.1.0 document generation for Konekti. Automatically generate and serve your API documentation with zero manual synchronization and optional Swagger UI support.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Capabilities](#core-capabilities)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @konekti/openapi
```

## When to Use

- When you want to provide interactive documentation for your REST API using **Swagger UI**.
- When you need a machine-readable **OpenAPI 3.1.0** specification for client generation or testing.
- When you want to keep your API documentation in sync with your code using standard decorators.
- When you need to document complex request/response models using DTOs and validation metadata.

## Quick Start

Register the `OpenApiModule` and annotate your controllers to generate the documentation.

```typescript
import { Controller, Get } from '@konekti/http';
import { Module } from '@konekti/core';
import { bootstrapNodeApplication } from '@konekti/runtime/node';
import { OpenApiModule, ApiOperation, ApiResponse, ApiTag } from '@konekti/openapi';

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

## Core Capabilities

### Automated Specification Generation
Konekti inspects your controllers and methods to build a complete OpenAPI 3.1.0 document. This includes paths, methods, parameters, and request bodies.

### Integrated DTO Schemas
Works seamlessly with `@konekti/validation`. Your DTO classes are automatically converted to OpenAPI components and referenced in the appropriate operations.

### Versioning Support
Handles URI-based versioning from `@konekti/http` automatically. Your OpenAPI paths will correctly reflect the resolved versioned routes.

### Security Documentation
Easily document authentication requirements like Bearer tokens or API keys using `@ApiBearerAuth()` and `@ApiSecurity()`.

## Public API Overview

- `OpenApiModule`: Main entry point for OpenAPI integration.
- `ApiTag`, `ApiOperation`, `ApiResponse`: Documentation decorators.
- `ApiBearerAuth`, `ApiSecurity`: Security requirement decorators.
- `ApiExcludeEndpoint`: Omit specific handlers from documentation.
- `buildOpenApiDocument`: Programmatic document builder (low-level).

## Related Packages

- `@konekti/core`: Shared metadata utilities.
- `@konekti/http`: Controller and routing integration.
- `@konekti/validation`: Schema and model generation from DTOs.

## Example Sources

- `packages/openapi/src/module.test.ts`: Integration tests and usage examples.
- `examples/openapi-swagger`: Complete OpenAPI application example.
