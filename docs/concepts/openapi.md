# openapi

<p><strong><kbd>English</kbd></strong> <a href="./openapi.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the OpenAPI generation model used in `@konekti/openapi`, `@konekti/http`, and the request DTO metadata system.

### related documentation

- `./http-runtime.md`
- `../../packages/openapi/README.md`
- `../../packages/http/README.md`

## registration and serving

Use `OpenApiModule.forRoot(...)` to enable OpenAPI support. By default, it provides:

- **JSON Document**: `GET /openapi.json`
- **Swagger UI** (optional): `GET /docs`

The OpenAPI document is constructed during application startup from handler descriptors. `OpenApiModule.forRoot(...)` accepts either prebuilt descriptors or the `HandlerSource[]` model used by `createHandlerMapping()`.

## documentation decorators

Konekti provides several decorators specifically for OpenAPI metadata:

- `@ApiTag(tag)`: Groups operations.
- `@ApiOperation({ summary, description })`: Describes an endpoint's purpose.
- `@ApiResponse(status, { description, schema, type })`: Documents possible response codes and structures.
- `@ApiBearerAuth()`: Declares Bearer authentication for an operation.

These decorators only affect documentation and do not change runtime behavior.

## dto schema extraction

The OpenAPI generator extracts schema information from DTOs:

- **Metadata Reading**: Request DTO metadata is accessed via normalized helper APIs.
- **Component Schemas**: Validator metadata (e.g., `@IsString()`) is used to populate `components.schemas`.
- **Request Bodies**: Linked via `requestBody`.
- **Parameters**: Cookie-bound DTO fields are mapped to cookie parameters.
- **Responses**: Response DTOs can be specified using `@ApiResponse(..., { type: ... })`.
- **Nesting**: Nested DTOs and arrays are represented as schema references.

## generation process

- **Route Metadata**: Extracted from handler descriptors.
- **Versioning**: Versioning defined via `@Version(...)` is reflected in URI paths (e.g., `/v1/users`).
- **Composition**: Tags, operations, responses, and DTO schemas are combined into a single OpenAPI 3.1 document.
- **Lifecycle**: The document is generated once at startup and served statically.

## architectural boundaries

- **`@konekti/openapi`**: Handles schema generation and the serving layer.
- **`@konekti/http`**: Manages the writing of route and request metadata.
- **Decoupling**: `@konekti/openapi` interacts only with normalized metadata and does not access internal package storage.
- **Auth Schemes**: Authentication schemes are declared at the application level using OpenAPI decorators.

## conceptual flow

```text
@konekti/http writes route metadata
The `@konekti/validation` package writes validation metadata
@konekti/openapi reads both to assemble the documentation
```
