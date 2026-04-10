# OpenAPI Documentation

<p><strong><kbd>English</kbd></strong> <a href="./openapi.ko.md"><kbd>한국어</kbd></a></p>

Documentation should never be an afterthought. fluo provides automated **OpenAPI 3.1.0** document generation by aggregating metadata from your HTTP routes, validation rules, and security configurations—keeping your API spec and implementation in perfect sync.

## Why OpenAPI in fluo?

- **Zero-Manual Sync**: Your code *is* the documentation. Changes to routes or DTOs are automatically reflected in the generated specification.
- **Interactive UI**: Built-in support for **Swagger UI** allows developers to test endpoints directly from the browser.
- **Machine Readable**: Generate client libraries, run contract tests, or integrate with API gateways using the standard `openapi.json` output.
- **DTO Integration**: Automatically translates `@fluojs/validation` decorators into rich JSON Schema components.

## Responsibility Split

- **`@fluojs/openapi` (The Generator)**: The core engine that orchestrates metadata collection and produces the final specification. It also provides the optional Swagger UI middleware.
- **`@fluojs/http` (The Source)**: Supplies route-level metadata such as paths, methods, HTTP status codes, and URI versioning info.
- **`@fluojs/validation` (The Schema)**: Translates class-based DTOs and validation rules (e.g., `@IsEmail()`, `@Min(1)`) into OpenAPI schema components.

## Typical Workflow

### 1. Zero-Config Discovery
By simply importing `OpenApiModule.forRoot()`, fluo begins scanning your controllers. Most basic information (paths, methods) is captured automatically.

### 2. Enhancing with Decorators
Use dedicated documentation decorators to add human-readable context without polluting your business logic.

```typescript
@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: 'Create a new user profile' })
  @ApiResponse(201, { description: 'User successfully created' })
  @Post('/')
  create(@FromBody() dto: CreateUserDto) {
    // ...
  }
}
```

### 3. Automatic Schema Generation
Your DTOs become OpenAPI "Components" automatically.

```typescript
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  name: string;
}
```

### 4. Serving the Documentation
The generated document is exposed at runtime:
- **JSON Spec**: `GET /openapi.json`
- **Swagger UI**: `GET /docs` (optional)

## Core Boundaries

- **Startup-Only Overhead**: Document generation happens once during the application bootstrap. It has zero impact on request-time performance.
- **Standard Decorators**: Like the rest of fluo, the OpenAPI system uses TC39 standard decorators, avoiding legacy compiler flags.
- **Security-First**: Documenting auth requirements (JWT, API Keys) is handled via explicit `@ApiBearerAuth()` decorators to ensure your security posture is clearly communicated.

## Next Steps

- **Configuration**: See all available options in the [OpenAPI Package README](../../packages/openapi/README.md).
- **Validation**: Learn how DTOs work in the [Validation Package](../../packages/validation/README.md).
- **Live Example**: Check out the [Examples Directory](../../examples/README.md).
