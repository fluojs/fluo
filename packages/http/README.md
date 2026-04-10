# @fluojs/http

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The HTTP execution layer that turns route metadata into a request pipeline with binding, validation, guards, interceptors, and response writing.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/http
```

## When to Use

Use this package when you need to:

- define REST-style controllers with decorators such as `@Controller`, `@Get`, and `@Post`
- bind request data into DTOs with `@FromBody`, `@FromPath`, `@FromQuery`, and related decorators
- run guards, interceptors, and middleware in a predictable request lifecycle
- access the active request through `RequestContext` without passing it through every function

## Quick Start

```ts
import { Controller, FromBody, FromPath, Get, Post, RequestDto } from '@fluojs/http';
import { IsString, MinLength } from '@fluojs/validation';

class CreateUserDto {
  @FromBody()
  @IsString()
  @MinLength(3)
  name!: string;
}

@Controller('/users')
export class UserController {
  @Post('/')
  @RequestDto(CreateUserDto)
  create(input: CreateUserDto) {
    return { id: '1', name: input.name };
  }

  @Get('/:id')
  getById(@FromPath('id') id: string) {
    return { id, name: 'John Doe' };
  }
}
```

## Common Patterns

### Guards and interceptors

```ts
import { Controller, Get, UseGuards, UseInterceptors } from '@fluojs/http';

@Controller('/admin')
@UseGuards(AdminGuard)
@UseInterceptors(LoggingInterceptor)
class AdminController {
  @Get('/')
  dashboard() {
    return { data: 'secret' };
  }
}
```

### Async request context

```ts
import { getCurrentRequestContext } from '@fluojs/http';

function someDeepHelper() {
  const ctx = getCurrentRequestContext();
  console.log(ctx?.requestId);
}
```

### Server-sent events

```ts
import { Get, SseResponse, type RequestContext } from '@fluojs/http';

@Get('/events')
stream(_input: undefined, ctx: RequestContext) {
  const sse = new SseResponse(ctx);
  sse.send({ message: 'hello' });
  return sse;
}
```

## Public API Overview

- **Routing decorators**: `Controller`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `All`
- **Binding decorators**: `FromBody`, `FromQuery`, `FromPath`, `FromHeader`, `FromCookie`, `RequestDto`
- **Execution decorators**: `UseGuards`, `UseInterceptors`, `HttpCode`, `Version`, `Header`, `Redirect`
- **Core runtime types**: `RequestContext`, `FrameworkRequest`, `FrameworkResponse`, `SseResponse`
- **Exceptions**: `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `InternalServerErrorException`, `PayloadTooLargeException`
- **Helpers**: `createHandlerMapping`, `createDispatcher`, `createCorsMiddleware`, `getCurrentRequestContext`

## Internal Subpath (`@fluojs/http/internal`)

The `./internal` subpath exports low-level utilities used by platform adapters and the core runtime. These are subject to change and should not be used in typical application code.

- `createErrorResponse(error, requestId)`: Standardized JSON error response factory.
- `HttpException`: Base class for all framework-level HTTP errors.
- `PLATFORM_SHELL`: DI token for the active platform adapter.

## Related Packages

- `@fluojs/core`: stores controller, route, and DTO metadata
- `@fluojs/validation`: validates DTOs after HTTP binding
- `@fluojs/runtime`: assembles the dispatcher during application bootstrap
- `@fluojs/passport`: plugs auth guards into the same HTTP guard chain

## Example Sources

- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/auth.controller.ts`
- `packages/http/src/dispatch/dispatcher.test.ts`
