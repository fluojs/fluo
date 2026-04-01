# @konekti/openapi

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based OpenAPI 3.1.0 document generation for konekti applications. Annotate controllers and handlers, then mount `OpenApiModule` to automatically serve a spec at `/openapi.json` and an optional Swagger UI at `/docs`.

## See also

- `../../docs/concepts/openapi.md`
- `../../docs/concepts/http-runtime.md`

## Installation

```bash
pnpm add @konekti/openapi
```

## Quick Start

```typescript
import { Controller, Get, Post, Version } from '@konekti/http';
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';
import {
  ApiTag,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  OpenApiModule,
} from '@konekti/openapi';

@Version('1')
@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse(200, { description: 'Array of users' })
  @Get('/')
  listUsers() {
    return [];
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a user' })
  @ApiResponse(201, { description: 'Created user' })
  @Post('/')
  createUser() {
    return {};
  }
}

@Module({
  controllers: [UsersController],
  imports: [
    OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'My API',
      version: '1.0.0',
      ui: true,               // enable Swagger UI at /docs
    }),
  ],
})
class AppModule {}

await bootstrapApplication({ rootModule: AppModule });
// GET /openapi.json  → OpenAPI 3.1.0 JSON document
// GET /docs          → Swagger UI
```

## Core API

### `OpenApiModule.forRoot(options)`

Registers two HTTP endpoints and returns a `ModuleType` to import into any module.

```typescript
interface OpenApiModuleOptions {
  title: string;
  version: string;
  defaultErrorResponsesPolicy?: 'inject' | 'omit'; // default: 'inject'
  descriptors?: readonly HandlerDescriptor[];  // handler descriptors from createHandlerMapping()
  sources?: readonly HandlerSource[];          // same handler-source model consumed by createHandlerMapping()
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  extraModels?: Constructor[];
  documentTransform?: (document: OpenApiDocument) => OpenApiDocument;
  ui?: boolean;                                 // serve Swagger UI at /docs (default: false)
}

class OpenApiModule {
  static forRoot(options: OpenApiModuleOptions): ModuleType;
}
```

**Endpoints:**

| Route | Description |
|-------|-------------|
| `GET /openapi.json` | Returns the generated OpenAPI 3.1.0 JSON. |
| `GET /docs` | Returns Swagger UI HTML (only when `ui: true`). |

---

## Decorators

### `@ApiTag(tag)`

Attaches an OpenAPI tag to all operations on a controller class.

```typescript
@ApiTag('Products')
@Controller('/products')
class ProductsController { ... }
```

### `@ApiOperation(options)`

Documents a handler's operation object.

```typescript
interface ApiOperationOptions {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

@ApiOperation({ summary: 'Get product by ID', description: 'Returns a single product.' })
@Get('/:id')
getProduct() { ... }
```

### `@ApiResponse(status, options)`

Documents a response for a handler.

```typescript
interface ApiResponseOptions {
  description?: string;
  schema?: Record<string, unknown>;
  type?: Constructor;
}

@ApiResponse(200, { description: 'The product', type: ProductDto })
@ApiResponse(404, { description: 'Not found' })
@Get('/:id')
getProduct() { ... }
```

Multiple `@ApiResponse` decorators can be stacked on the same handler.

### Mapped DTO helpers from the `@konekti/validation` package

OpenAPI generation preserves metadata from `PickType()`, `OmitType()`, `IntersectionType()`, and `PartialType()` request DTOs, so derived request bodies and parameter schemas continue to render from the resolved DTO class.

`PartialType()` also changes required semantics: request bodies and non-path parameters become optional in the generated OpenAPI document, while path parameters stay required because the OpenAPI spec requires that.

### `@Version(value)` from `@konekti/http`

When URI versioning is applied at the controller or handler level, OpenAPI paths reflect the resolved versioned route directly.

```typescript
@Version('1')
@Controller('/users')
class UsersController {
  @Get('/')
  listUsers() {}
}

// OpenAPI path: /v1/users
```

### `@ApiBearerAuth()`

Marks a handler as requiring Bearer token authentication. Adds `bearerAuth` to the operation's `security` requirements and registers the `bearerAuth` security scheme in the generated document.

```typescript
@ApiBearerAuth()
@Post('/')
createProduct() { ... }
```

### `@ApiSecurity(name, scopes?)`

Declares generic OpenAPI security requirements without affecting runtime authentication behavior.

```typescript
@ApiSecurity('apiKeyAuth')
@ApiSecurity('oauth2Auth', ['users:read'])
@Get('/')
listProducts() { ... }
```

### `@ApiExcludeEndpoint()`

Excludes a handler from generated OpenAPI `paths`.

```typescript
@ApiExcludeEndpoint()
@Get('/internal')
getInternalHealth() { ... }
```

---

## Document Structure

The generated document follows OpenAPI 3.1.0:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "My API",
    "version": "1.0.0"
  },
  "paths": {
    "/users": {
      "get": {
        "operationId": "<auto-generated>",
        "tags": ["Users"],
        "summary": "List all users",
        "responses": {
          "200": { "description": "Array of users" }
        }
      }
    }
  }
}
```

- **`operationId`** is auto-generated from the primary tag, handler name, HTTP method, and normalized route path (for example: `Users_listUsers_get_v1_users`).
- **`tags`** default to the controller class name when `@ApiTag` is not used.
- **`security`** requirements can be declared with `@ApiBearerAuth()` and/or `@ApiSecurity(...)`.
- **`securitySchemes`** can be registered via module/document options (API key, HTTP, OAuth2, OpenID Connect). `bearerAuth` is still auto-added when needed by `@ApiBearerAuth()`.
- Request DTOs decorated with the `@konekti/validation` package are emitted as `components.schemas` entries and linked through `requestBody`.
- `extraModels` can register additional schema components even when they are not referenced by request/response DTO discovery.
- Cookie-bound DTO fields are emitted as `in: cookie` parameters.
- Request bodies are only marked `required: true` when at least one body-bound DTO field is required.
- Default error responses (`400`, `401`, `403`, `404`, `500`) are injected by default and can be disabled with `defaultErrorResponsesPolicy: 'omit'`.
- Non-body parameter fields are emitted as runtime-compatible scalar/array shapes; nested object refs are not emitted for query/header/cookie/path params.
- `@ApiOperation({ deprecated: true })` emits OpenAPI operation deprecation metadata.
- `@ApiExcludeEndpoint()` omits a handler from generated operations.

---

## Low-Level API

These are exported for advanced use cases (e.g. custom document generation pipelines).

Additional public exports also include `OpenApiHandlerRegistry`, `OpenApiModuleOptions`, and the schema/type interfaces re-exported from `src/index.ts`.

### `buildOpenApiDocument(options)`

Builds the OpenAPI document directly from handler descriptors without mounting a server.

```typescript
interface BuildOpenApiDocumentOptions {
  defaultErrorResponsesPolicy?: 'inject' | 'omit'; // default: 'inject'
  descriptors: readonly HandlerDescriptor[];
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  extraModels?: Constructor[];
  documentTransform?: (document: OpenApiDocument) => OpenApiDocument;
  title: string;
  version: string;
}

function buildOpenApiDocument(options: BuildOpenApiDocumentOptions): OpenApiDocument;
```

### Metadata readers

Read decorator metadata programmatically:

```typescript
function getControllerTags(target: Function): string[] | undefined;
function getMethodApiMetadata(target: Function, propertyKey: MetadataPropertyKey): MethodApiMetadata | undefined;
```

Both getters return defensive copies to prevent accidental external mutation of internal decorator metadata.

```typescript
interface MethodApiMetadata {
  operation?: ApiOperationOptions;
  responses: ApiResponseMetadata[];
  security?: string[];
  securityRequirements?: Record<string, string[]>[];
  excludeEndpoint?: boolean;
}
```

## Dependencies

| Package | Role |
|---------|------|
| `@konekti/core` | Shared metadata utilities |
| `@konekti/http` | Controller/routing decorators, `HandlerDescriptor` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
