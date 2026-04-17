# decorators and metadata

<p><strong><kbd>English</kbd></strong> <a href="./decorators-and-metadata.ko.md"><kbd>한국어</kbd></a></p>

fluo is built from the ground up on **TC39 Standard Decorators**. We have completely abandoned the legacy `experimentalDecorators` and `emitDecoratorMetadata` model in favor of a clean, performant, and standard-aligned metadata system.

## why this matters

For years, the TypeScript ecosystem relied on a "proposal" version of decorators that never became standard. This legacy system required the compiler to "guess" types and emit them as hidden metadata (`reflect-metadata`), leading to:
- **Hidden performance costs**: Large amounts of metadata emitted for every class, even if unused.
- **Fragile type-guessing**: Circular dependencies often broke the "metadata emit," leading to runtime `undefined` errors.
- **Lock-in**: Your code became dependent on specific TypeScript compiler flags, making it harder to run on tools like `esbuild`, `swc`, or native engines without complex plugins.

fluo's move to **Standard Decorators** ensures your backend is portable, explicit, and ready for the future of JavaScript.

## core ideas

### standard decorators (TC39)
Every decorator in fluo—`@Module`, `@Controller`, `@Inject`—is a standard JavaScript decorator. They are functions that receive a well-defined context and return a modified version of the element they decorate.
- **No Reflect Metadata**: We do not use `reflect-metadata`. Metadata is stored in a structured, framework-owned registry.
- **Native Speed**: Because we don't rely on heavy reflection libraries, application startup and dependency resolution are significantly faster.

### explicit over implicit
Legacy frameworks often "guessed" your dependencies by looking at constructor types. In fluo, we value **explicitness**.
- You use `@Inject(UsersService)` to clearly state your dependencies.
- This makes your code searchable, auditable, and eliminates the "magic" that leads to difficult-to-debug DI issues.

### framework-owned registry
Decorators in fluo serve as "declarations" that populate a central **Framework Registry**. This registry acts as the source of truth for:
1. **The Dependency Graph**: Which classes depend on which tokens.
2. **Routing Tables**: Which methods handle which HTTP paths.
3. **Validation Schemas**: How incoming JSON should be parsed and checked.

For HTTP routing, that registry uses a deliberately small path contract: each route segment is either a literal string or a full-segment `:param` placeholder. Wildcards, regex-like syntax, and mixed segments such as `user-:id` are intentionally excluded from route decorators so the same handler mapping works consistently across runtimes. Middleware route filters keep their own `forRoutes('/prefix/*')` wildcard support and should not be confused with controller route syntax.

## decorator families

- **Structural (`@Module`)**: Defines the boundaries of a feature and its exported providers.
- **Component (`@Controller`)**: Marks a class as a participant in the framework's lifecycle.
- **Dependency (`@Inject`, `@Scope`, `@Global`)**: Explicitly declares the contract between a class and its dependencies.
- **Behavioral (`@Get`, `@Post`, `@UseGuards`, `@RequestDto`)**: Attaches runtime logic to specific methods or classes.

### structural decorators

The `@Module()` decorator is the fundamental unit of organization in fluo. It defines the module's boundary and its relationship with other modules.

```ts
import { Module } from '@fluojs/core';
import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

@Module({
  imports: [],
  controllers: [HelloController],
  providers: [HelloService],
  exports: [HelloService],
})
export class HelloModule {}
```

- **imports**: List of modules that export the providers required by this module.
- **controllers**: Controllers defined in this module which have to be instantiated.
- **providers**: Providers that will be instantiated by the fluo injector and that may be shared at least across this module.
- **exports**: The subset of providers that are provided by this module and should be available in other modules which import this module.

You can also create **Dynamic Modules** using the `forRoot` or `forRootAsync` patterns to allow consumers to configure the module at registration time.

### component decorators

Component decorators mark a class as a specific type of participant in the application.

```ts
import { Controller, Get, Post } from '@fluojs/http';

@Controller('/users')
export class UsersController {
  @Get('/')
  findAll() {
    return [];
  }

  @Post('/')
  create() {
    return { id: '1' };
  }
}
```

- **@Controller**: Marks a class as an HTTP controller. Note that `@Controller` is imported from `@fluojs/http`, not `@fluojs/core`, as it is specific to the HTTP runtime.
- **basePath**: The parameter passed to `@Controller('/users')` acts as a prefix for all routes defined within the class.

### dependency decorators

These decorators provide explicit instructions to the DI container on how to wire and manage instances.

```ts
import { Inject, Scope, Global } from '@fluojs/core';

@Global()
@Inject(UsersRepository, ConfigService)
@Scope('request')
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly config: ConfigService,
  ) {}
}
```

- **@Inject**: Because fluo does not use `reflect-metadata`, you must explicitly declare constructor dependencies. `@Inject` takes tokens in the same order as your constructor parameters.
- **@Scope**: Defines the lifecycle of a provider. Supported values are `'singleton'` (default), `'request'` (per-request instance), and `'transient'` (new instance per resolution).
- **@Global**: When applied to a module, it makes its exported providers available throughout the entire application without needing to import the module in every feature module.

### behavioral decorators

Behavioral decorators attach runtime logic—such as routing, validation, and security—to specific class methods.

```ts
import { Controller, Get, Post, RequestDto, UseGuards } from '@fluojs/http';
import { UseAuth, RequireScopes } from '@fluojs/passport';

@Controller('/auth')
export class AuthController {
  @Post('/token')
  @RequestDto(LoginDto)
  issueToken(dto: LoginDto) {
    return { token: '...' };
  }

  @Get('/profile')
  @UseAuth('jwt')
  @RequireScopes('profile:read')
  getProfile(_input: undefined, ctx: RequestContext) {
    return ctx.principal;
  }
}
```

- **Route Decorators**: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, and `@All` define HTTP endpoints.
- **@RequestDto**: Associates a DTO (Data Transfer Object) class with the route for automatic binding and validation.
- **Guards**: `@UseGuards` (from `@fluojs/http`) and domain-specific decorators like `@UseAuth` and `@RequireScopes` (from `@fluojs/passport`) manage authorization and security.

## comparison with legacy decorators

| Aspect | Legacy (experimentalDecorators) | fluo (TC39 Standard) |
| :--- | :--- | :--- |
| **DI wiring** | Implicit via `reflect-metadata` | Explicit via `@Inject()` |
| **Compiler flags** | `experimentalDecorators` + `emitDecoratorMetadata` | None required |
| **Bundler compat** | Needs complex plugins | Native support |

## boundaries

- **No Magic Discovery**: fluo does not "scan" your filesystem. Metadata is registered only when a class is imported and its decorators are executed.
- **Immutable at Runtime**: Once the application is bootstrapped, the framework registry is typically locked. You cannot dynamically add decorators to a running class.
- **Type Safety First**: While decorators add metadata, they do not change the type signature of your classes. Your IDE and compiler still see the original, clean TypeScript class.

## related docs

- [Architecture Overview](./architecture-overview.md)
- [DI and Modules](./di-and-modules.md)
- [HTTP Runtime](./http-runtime.md)
- [Core README](../../packages/core/README.md)
