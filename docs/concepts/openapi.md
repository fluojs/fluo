# openapi

<p><strong><kbd>English</kbd></strong> <a href="./openapi.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the OpenAPI generation model used in `@konekti/openapi`, `@konekti/http`, and the input validation metadata system.

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
- `@ApiOperation({ summary, description, deprecated })`: Describes an endpoint's purpose and deprecation state.
- `@ApiResponse(status, { description, schema, type })`: Documents possible response codes and structures.
- `@ApiBearerAuth()`: Declares Bearer authentication for an operation.
- `@ApiSecurity(name, scopes?)`: Declares generic OpenAPI security requirements (for example API key/OAuth2/OpenID Connect scheme names).
- `@ApiExcludeEndpoint()`: Omits a handler from the generated `paths` map.

These decorators only affect documentation and do not change runtime behavior.

## schema extraction from route and validation metadata

The OpenAPI generator extracts schema information from route metadata and input validation metadata:

- **Metadata Reading**: Request binding and input validation metadata are accessed via normalized helper APIs.
- **Component Schemas**: Validator metadata (e.g., `@IsString()`) is used to populate `components.schemas`.
- **Request Bodies**: Linked via `requestBody`.
- **Parameters**: Bound input fields are mapped into parameter definitions.
- **Responses**: Response models can be documented using `@ApiResponse(..., { type: ... })`.
- **Nesting**: Nested models and arrays are represented as schema references.
- **Extra models**: `extraModels` option can register schema components that are not discovered from request/response metadata.

## generation process

- **Route Metadata**: Extracted from handler descriptors.
- **Versioning**: Versioning defined via `@Version(...)` is reflected in URI paths (e.g., `/v1/users`).
- **Composition**: Tags, operations, responses, and schema metadata are combined into a single OpenAPI 3.1 document.
- **Lifecycle**: The document is generated once at startup and served statically.

## architectural boundaries

- **`@konekti/openapi`**: Handles schema generation and the serving layer.
- **`@konekti/http`**: Manages the writing of route and request metadata.
- **`@konekti/validation`**: Supplies input validation metadata that OpenAPI can read as schema hints.
- **Output shaping**: Runtime response serialization is separate from documentation generation.
- **Decoupling**: `@konekti/openapi` interacts only with normalized metadata and does not access internal package storage.
- **Auth Schemes**: Authentication schemes are declared at the application level using OpenAPI decorators.
- **Security scheme breadth**: OpenAPI security schemes can be registered in module/document options (`securitySchemes`) for API key, HTTP, OAuth2, and OpenID Connect.
- **Document post-processing**: `documentTransform` can post-process the generated document once at build time after document generation; when absent, it is a no-op.

## conceptual flow

```text
@konekti/http writes route and binding metadata
@konekti/validation writes input validation metadata
@konekti/openapi reads both plus explicit response schema declarations to assemble the documentation
```
