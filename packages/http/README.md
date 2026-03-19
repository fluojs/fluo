# @konekti/http

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The HTTP execution layer that turns route metadata into a request processing chain.

## See also

- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/error-responses.md`
- `../../docs/concepts/security-middleware.md`

## What this package does

`@konekti/http` is not a router — it is the full request execution runtime. It owns:

- `FrameworkRequest` / `FrameworkResponse` / `RequestContext` — the common language between adapters, middleware, guards, interceptors, and controllers
- Route and DTO decorators (`@Controller`, `@Get`, `@Post`, `@Version`, `@FromBody`, `@FromPath`, etc.)
- Mapped DTO helpers (`PickType`, `OmitType`, `IntersectionType`, `PartialType`)
- Routing table construction (`createHandlerMapping`)
- Request DTO binding and validation
- The dispatcher that sequences middleware → guards → interceptors → bind → validate → handler invocation
- HTTP exception classes and the canonical error envelope

## Installation

```bash
npm install @konekti/http
```

## Quick Start

### Define a controller

```typescript
import { Controller, Get, Post, Version, FromBody, FromPath, RequestDto } from '@konekti/http';
import { IsString, MinLength } from '@konekti/dto-validator';
import type { RequestContext } from '@konekti/http';

class CreateUserDto {
  @FromBody()
  @IsString()
  @MinLength(2)
  name!: string;
}

class GetUserParams {
  @FromPath()
  @IsString()
  id!: string;
}

@Version('1')
@Controller('/users')
export class UserController {
  @Post('/')
  @RequestDto(CreateUserDto)
  async create(input: CreateUserDto, ctx: RequestContext) {
    return { created: input.name };
  }

  @Get('/:id')
  @RequestDto(GetUserParams)
  async getById(input: GetUserParams, ctx: RequestContext) {
    return { id: input.id };
  }
}
```

### Throw HTTP exceptions

```typescript
import { NotFoundException, BadRequestException } from '@konekti/http';

throw new NotFoundException('User not found');
throw new BadRequestException('Invalid input', { field: 'email', message: 'must be valid' });
```

### Create a dispatcher (done by `@konekti/runtime` during bootstrap)

```typescript
import { createHandlerMapping, createDispatcher } from '@konekti/http';

const handlerMapping = createHandlerMapping([{ controllerToken: UserController }]);
const dispatcher = createDispatcher({ handlerMapping, rootContainer: container, appMiddleware: middleware });
```

## Key API

### Types

| Export | Location | Description |
|---|---|---|
| `FrameworkRequest` | `src/types.ts` | Adapter-agnostic request shape |
| `FrameworkResponse` | `src/types.ts` | Adapter-agnostic response shape |
| `RequestContext` | `src/request-context.ts` | Runtime context: request, response, principal, requestId, container |

### Route decorators

| Decorator | Description |
|---|---|
| `@Controller(path)` | Marks a class as a controller with a base path |
| `@Get(path)` / `@Post(path)` / `@Put(path)` / `@Patch(path)` / `@Delete(path)` | HTTP method route |
| `@Version(value)` | Applies URI versioning such as `/v1/...`; handler-level version overrides controller-level version |

### URI versioning

Konekti currently supports URI versioning only.

```typescript
@Version('1')
@Controller('/users')
class UsersV1Controller {
  @Get('/')
  listUsers() {
    return [];
  }

  @Version('2')
  @Post('/')
  createUser() {
    return {};
  }
}
```

- controller-level `@Version('1')` produces routes such as `/v1/users`
- handler-level `@Version('2')` overrides the controller version for that specific route
- unversioned controllers keep their normal paths

### Mapped DTO helpers

Konekti supports metadata-preserving mapped DTO helpers for common request-shape derivation.

```typescript
import { IntersectionType, OmitType, PartialType, PickType } from '@konekti/http';

class CreateUserRequest {
  @FromBody('name')
  name = '';

  @FromBody('email')
  email = '';
}

class AddressRequest {
  @FromBody('city')
  city = '';
}

const UserNameOnlyRequest = PickType(CreateUserRequest, ['name']);
const UserWithoutEmailRequest = OmitType(CreateUserRequest, ['email']);
const CreateUserWithAddressRequest = IntersectionType(CreateUserRequest, AddressRequest);
const UpdateUserRequest = PartialType(CreateUserRequest);
```

- `PickType()` keeps only the selected DTO fields and their metadata
- `OmitType()` removes selected DTO fields while preserving the rest of the metadata
- `IntersectionType()` composes metadata from multiple DTO bases into one derived DTO
- `PartialType()` preserves the DTO shape while making inherited fields optional for request binding, validation, and non-path OpenAPI required semantics
- derived DTOs continue to work with `RequestDto(...)`, runtime binding, validation, and OpenAPI generation

`PartialType()` is intentionally separate from the other mapped helpers because it changes field optionality semantics instead of only composing metadata. Path parameters remain required in generated OpenAPI parameters because the spec requires path params to be required.

### DTO binding decorators

| Decorator | Description |
|---|---|
| `@FromBody()` | Bind field from request body (strict allowlist, blocks unknown fields) |
| `@FromPath()` | Bind field from URL path parameter |
| `@FromQuery()` | Bind field from query string |
| `@FromHeader()` | Bind field from request header |
| `@FromCookie()` | Bind field from cookie |
| `@Optional()` | Mark binding as optional (binder-level) |

> Validation decorators (`@IsString`, `@IsEmail`, etc.) come from `@konekti/dto-validator`, not this package.

### Runtime helpers

| Export | Location | Description |
|---|---|---|
| `createHandlerMapping(sources)` | `src/mapping.ts` | Builds the normalized routing table from handler sources such as `{ controllerToken }` |
| `createDispatcher(options)` | `src/dispatcher.ts` | Creates the request dispatch function |
| `SseResponse` | `src/sse.ts` | Helper for streaming Server-Sent Events from a `RequestContext` |
| `createCorsMiddleware(options)` | `src/cors.ts` | Returns a CORS middleware function |
| `createRequestContext()` | `src/request-context.ts` | ALS-backed context factory |

Additional public exports include `Options`, `Head`, `IntersectionType`, `OmitType`, `PartialType`, `PickType`, `RequestDto`, `SuccessStatus`, `UseGuard`, `UseInterceptor`, `Version`, `createCorrelationMiddleware`, `createRateLimitMiddleware`, `createSecurityHeadersMiddleware`, `encodeSseComment`, `encodeSseMessage`, `forRoutes`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `HttpApplicationAdapter`, `createNoopHttpApplicationAdapter`, and `PayloadTooLargeException`.

### Server-Sent Events (SSE)

Use `SseResponse` when a handler needs to keep the HTTP connection open and stream frames over time.

```typescript
import { Controller, Get, SseResponse, type RequestContext } from '@konekti/http';

@Controller('/events')
class EventsController {
  @Get('/')
  stream(_input: undefined, ctx: RequestContext) {
    const stream = new SseResponse(ctx);

    stream.comment('connected');
    stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });

    return stream;
  }
}
```

- `new SseResponse(ctx)` commits SSE headers immediately
- `send(data, { event, id, retry })` writes a canonical SSE message frame
- `comment(text)` writes a comment frame
- `close()` is idempotent and also runs when `ctx.request.signal` aborts
- `encodeSseMessage()` and `encodeSseComment()` are exported for tests and custom framing needs
- SSE currently requires the Node adapter or a custom `FrameworkResponse.raw` object exposing `write()`, `end()`, `writableEnded`, and optional `flushHeaders()`
- request observers still complete when the handler returns; they do not stay open for the full lifetime of the SSE socket

### Rate limiting caveat

`createRateLimitMiddleware()` uses an in-process memory store. That makes it suitable for local development, tests, and single-process deployments, but it is not a shared/global limiter across clustered Node workers or multiple app instances. If you need cross-instance enforcement today, place the shared limit at a gateway/proxy layer or add an application-level shared store in front of Konekti.

### Success status defaults

- `GET`, `PUT`, `PATCH`, `HEAD` default to `200`
- `POST` defaults to `201`
- `DELETE` and `OPTIONS` default to `204` when the handler returns `undefined`, otherwise `200`
- `@SuccessStatus(code)` always overrides the method default
- the dispatcher decides the final success code after the interceptor chain resolves, so interceptor result shaping still affects the default-status decision

### Exceptions

| Export | Status Code |
|---|---|
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `PayloadTooLargeException` | 413 |
| `InternalServerException` | 500 |

## Architecture

### Dispatcher execution order

```text
incoming request
  → RequestContext creation
  → app middleware
  → route match
  → module middleware
  → guard chain  (allow / deny)
  → interceptor chain  (before/after wrapper)
  → request DTO binding  (fromBody / fromPath / fromQuery / ...)
  → DTO validation  (via @konekti/dto-validator)
  → controller method(input, ctx)
  → success status resolution (`@SuccessStatus` override or method default)
  → success response write
  → catch → canonical error response write
```

### Guard contract

Guards have a deliberately small contract:

- return `false` to deny the request with the default `ForbiddenException` / 403 path
- return `true` or `undefined` to continue the request pipeline
- throw an HTTP exception when the denial should use a more specific status or message
- commit the response directly (for example redirect flows) when the guard fully handles the outcome itself

### DTO binding security

The binder is not a simple field copy. Two policies are enforced:

1. **Strict allowlist on `@FromBody`** — any field in the request body that is not declared in the DTO is rejected with `BadRequestException`, preventing mass-assignment attacks.
2. **Dangerous key blocking** — keys like `__proto__`, `constructor`, and `prototype` are rejected unconditionally.

### Routing table construction

`createHandlerMapping()` runs before any request. It:
- Combines the controller base path with each route path
- Normalises duplicate slashes
- Extracts named path params (`:id` → param name)
- Fails fast on duplicate route conflicts

### Request context and ALS

`RequestContext` is stored in `AsyncLocalStorage`. It carries the request, response, `requestId`, the authenticated `principal` (set by auth guards), and the request-scoped DI `container`. Any code that runs within a request can access the context without prop drilling.

## File reading order for contributors

1. `src/types.ts` — `FrameworkRequest`, `FrameworkResponse`, `RequestContext`
2. `src/decorators.ts` — route and DTO binding metadata writers
3. `src/mapping.ts` — routing table build + conflict detection
4. `src/binding.ts` — DTO instantiation from request parts
5. `src/dto-validation-adapter.ts` — DTO validation adapter
6. `src/request-context.ts` — ALS-backed context
7. `src/dispatcher.ts` — execution chain sequencing
8. `src/exceptions.ts` — HTTP exception family + error envelope
9. `src/binding.test.ts` — binding policies (allowlist, dangerous keys, 400 detail shape)
10. `src/dispatcher.test.ts` — middleware/guard/interceptor ordering, canonical error codes

## Related packages

- `@konekti/core` — where route and DTO metadata is stored
- `@konekti/dto-validator` — validation engine used by the DTO validation step
- `@konekti/runtime` — assembles the routing table and dispatcher during bootstrap
- `@konekti/passport` — auth guard that plugs into the guard chain

## One-liner mental model

```text
@konekti/http = route metadata → DTO binding → middleware/guard/interceptor chain → handler invocation
```
