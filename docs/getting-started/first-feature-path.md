# Feature Creation Reference

<p><strong><kbd>English</kbd></strong> <a href="./first-feature-path.ko.md"><kbd>한국어</kbd></a></p>

This document defines the minimal feature-slice structure used in fluo applications. The canonical examples in this repository are `examples/minimal/src/hello.*` and `examples/realworld-api/src/users/*`.

For step-by-step instructions, use the [FluoBlog tutorial](../../apps/docs/content/docs/tutorial/index.mdx). This page remains the structural reference for an existing application.

The snippets below show feature wiring, not a replacement starter or a complete second application. In a CLI-generated app, retain the existing config, greeting, and health registrations and tests, and keep its `runFastifyApplication` entrypoint. The isolated `AppModule` fragment illustrates adding `UsersModule` to those existing imports. `examples/minimal` instead demonstrates explicit low-level composition; see [bootstrap paths](./bootstrap-paths.md) for that distinction and metadata-before-decorated-evaluation prerequisites.

## Required Files

The smallest HTTP feature slice usually contains these files under a dedicated directory such as `src/users/` or `src/catalog/`.

| File | Role | Required | Notes |
| --- | --- | --- | --- |
| `*.module.ts` | Module boundary for the slice | Yes | Declares `controllers`, `providers`, `imports`, and `exports` metadata with `@Module(...)`. |
| `*.service.ts` | Business logic provider | Yes | Registered in the module `providers` list. Add `@Inject(...)` when the constructor depends on other tokens or classes. |
| `*.controller.ts` | HTTP route surface | Yes for HTTP features | Uses `@Controller(...)` and route decorators from `@fluojs/http`. |
| `*.repo.ts` or equivalent | Persistence or data-access provider | No | Common once the service stops being self-contained. `examples/realworld-api/src/users/users.repo.ts` is the current repo pattern. |
| `*.dto.ts` | Request validation boundary | No | Add when request payload validation or coercion is required, for example `create-user.dto.ts`. |
| `*.response.dto.ts` or equivalent | Response contract type | No | Used when the feature publishes a stable response shape. |

`examples/minimal/src/hello.service.ts` shows the smallest service file, while `examples/realworld-api/src/users/` shows the expanded slice with repository and DTO support.

## Module Registration

Feature modules are declared with `@Module(...)` from `@fluojs/core`. The current repository pattern is a class with explicit metadata arrays.

```ts
import { Module } from '@fluojs/core';

import { UsersController } from './users.controller';
import { UsersRepo } from './users.repo';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersRepo, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Module registration facts used by the runtime:

- `controllers` exposes route handlers for the feature.
- `providers` registers classes or provider definitions in the slice container.
- `exports` is required when another imported module needs access to a provider from this slice.
- `imports` is required when the slice consumes providers exported by another module.

Root activation happens by importing the feature module into the application module.

```ts
import { Module } from '@fluojs/core';

import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule],
})
export class AppModule {}
```

The runtime compiles this metadata into the module graph. Invalid visibility or missing export relationships surface as runtime errors such as `ModuleVisibilityError` and `ModuleInjectionMetadataError`.

## DI Wiring

fluo uses explicit constructor token metadata through `@Inject(...)`. `packages/core/src/decorators.ts` defines variadic `@Inject(A, B)` as the canonical API.

```ts
import { Inject } from '@fluojs/core';

import { UsersRepo } from './users.repo';

@Inject(UsersRepo)
export class UsersService {
  constructor(private readonly repo: UsersRepo) {}
}
```

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, Post, RequestDto } from '@fluojs/http';

import { CreateUserDto } from './create-user.dto';
import { UsersService } from './users.service';

@Inject(UsersService)
@Controller('/users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('/')
  list() {
    return this.service.listUsers();
  }

  @Post('/')
  @RequestDto(CreateUserDto)
  create(dto: CreateUserDto) {
    return this.service.createUser(dto.name, dto.email);
  }
}
```

DI wiring rules for feature slices:

- The token order in `@Inject(...)` maps to constructor parameter order.
- Concrete class tokens are common for feature-local providers such as repositories and services.
- Abstract tokens or symbols still require explicit `@Inject(TOKEN)` because fluo does not depend on `emitDecoratorMetadata`.
- A provider must be registered in the current module or exported from an imported module before it can be injected.

## Checklist

- Create a dedicated feature directory, for example `src/users/`.
- Add a `*.module.ts` file with `@Module(...)` metadata.
- Register every controller in `controllers`.
- Register every service, repository, or provider in `providers`.
- Export only the providers that other modules must consume.
- Import the feature module into the root application module, or into another parent module that composes it.
- Add `@Inject(...)` to classes with constructor dependencies.
- Add DTO or response-contract files only when the feature boundary requires them.
