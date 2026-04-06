# migrate from nestjs

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>


This guide is for teams that already ship NestJS services and want a practical migration path to Konekti.

For concrete Konekti-side testing recipes after codemod migration, see `../operations/testing-guide.md` and `../../packages/testing/README.md`.

## codemod quick start (`konekti migrate`)

Use the CLI codemod first, then finish manual follow-ups reported by warnings.

```bash
# dry-run (default)
konekti migrate ./src

# apply changes
konekti migrate ./src --apply

# focus or exclude transforms
konekti migrate ./src --only imports,injectable,scope,bootstrap,testing,tsconfig
konekti migrate ./src --skip testing
```

Current first-phase automated transforms:

1. import rewriting
2. `@Injectable()` removal
3. scope enum mapping
4. bootstrap rewrite to `KonektiFactory.create(...)` + `await app.listen()` for safe default startup forms
5. testing rewrite (`Test.createTestingModule` → `createTestingModule`) for safe metadata/chains only
6. `tsconfig.json` rewrite (`experimentalDecorators`, `emitDecoratorMetadata` removal)

The command also emits warning/report items for manual migration areas (`@Inject(TOKEN)` parameter decorators, Request DTO migration for handler parameters, pipe/converter hotspots, unsupported Nest bootstrap variants, and unsupported Nest testing metadata/chains).

## quick mapping table

| NestJS pattern | Konekti pattern | Notes |
|---|---|---|
| `@Module({ imports, providers, controllers, exports })` | `@Module({ imports, providers, controllers, exports })` from `@konekti/core` | Same shape, but Konekti enforces import/export visibility at bootstrap with fail-fast graph validation. |
| `@Injectable()` | Register class in `providers`, optional `@Inject([...])` for explicit tokens | No `@Injectable()` requirement in Konekti. |
| `@Controller()`, `@Get()`, `@Post()` | `@Controller()`, `@Get()`, `@Post()` from `@konekti/http` | Route decorator shape is intentionally familiar. |
| `@Inject(TOKEN)` | `@Inject([TOKEN])` from `@konekti/core` | Konekti takes an explicit token list for constructor dependencies. |
| `Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT` | `@Scope('singleton' \| 'request' \| 'transient')` | Default remains singleton. |
| `NestFactory.create(AppModule)` | `KonektiFactory.create(AppModule, { adapter: createFastifyAdapter({ port: 3000 }) })` | Preferred starter-aligned HTTP startup on Node.js: keep the runtime facade and select an explicit transport adapter. |
| `NestFactory.create<NestExpressApplication>(AppModule)` | `KonektiFactory.create(AppModule, { adapter: createExpressAdapter(...) })` | Keep startup on the runtime facade while selecting an Express transport adapter explicitly. |
| `app.listen(3000)` | `await app.listen()` | Startup remains explicit after application creation. |
| `HttpException`, `NotFoundException`, `BadRequestException` | `NotFoundException`, `BadRequestException`, and peers from `@konekti/http` | Same mental model: throw typed HTTP exceptions in handlers/guards. |
| `@UseGuards()`, `@UseInterceptors()`, validation pipes | `@UseGuards()`, `@UseInterceptors()`, `@RequestDto(...)`, `@Convert(...)`, and global `converters` runtime options | Konekti keeps request conversion in the HTTP binding layer instead of a separate `@UsePipes()` decorator. |
| `@nestjs/testing` (`Test.createTestingModule`) | `createTestingModule({ rootModule })` from `@konekti/testing` | Override providers, compile graph, resolve tokens. |

## 1) module mapping

At a high level, module metadata is structurally the same. The migration work is mostly about DI and runtime conventions, not rewriting module shape.

The important difference is visibility enforcement. Konekti validates module graph rules at bootstrap, including token accessibility across `imports` and `exports`.

### NestJS

```typescript
import { Module } from '@nestjs/common';

@Module({
  imports: [UsersModule],
  providers: [AppService],
  controllers: [AppController],
  exports: [AppService],
})
export class AppModule {}
```

### Konekti

```typescript
import { Module } from '@konekti/core';

@Module({
  imports: [UsersModule],
  providers: [AppService],
  controllers: [AppController],
  exports: [AppService],
})
export class AppModule {}
```

## 2) decorator mapping

### `@Injectable()` -> provider registration

In NestJS, `@Injectable()` marks a class as DI-constructable.

In Konekti, classes are DI-constructable when they are registered in `providers`; `@Injectable()` is not required.

### NestJS

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {
  findAll() {
    return [];
  }
}
```

### Konekti

```typescript
export class UserService {
  findAll() {
    return [];
  }
}

// registered in module metadata
// @Module({ providers: [UserService] })
```

### route decorators (`@Controller`, `@Get`, `@Post`)

Route decorators map directly to `@konekti/http`.

### NestJS

```typescript
import { Controller, Get, Post } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  list() {
    return [];
  }

  @Post()
  create() {
    return { ok: true };
  }
}
```

### Konekti

```typescript
import { Controller, Get, Post } from '@konekti/http';

@Controller('/users')
export class UsersController {
  @Get('/')
  list() {
    return [];
  }

  @Post('/')
  create() {
    return { ok: true };
  }
}
```

### `@Inject(TOKEN)` -> explicit token list

Konekti uses an explicit token list (`@Inject([TOKEN_A, TOKEN_B])`) for constructor dependency metadata.

### NestJS

```typescript
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class BillingService {
  constructor(@Inject('PAYMENT_CLIENT') private readonly client: PaymentClient) {}
}
```

### Konekti

```typescript
import { Inject } from '@konekti/core';

const PAYMENT_CLIENT = Symbol('PAYMENT_CLIENT');

@Inject([PAYMENT_CLIENT])
export class BillingService {
  constructor(private readonly client: PaymentClient) {}
}
```

## 3) provider scopes

Scope mapping is straightforward:

- Nest `DEFAULT` -> Konekti `'singleton'`
- Nest `REQUEST` -> Konekti `'request'`
- Nest `TRANSIENT` -> Konekti `'transient'`

### NestJS

```typescript
import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class RequestAuditService {}
```

### Konekti

```typescript
import { Scope } from '@konekti/core';

@Scope('request')
export class RequestAuditService {}
```

## 4) bootstrap path

Use `KonektiFactory.create()` with an explicit adapter as the canonical HTTP startup path for new apps.

The starter keeps Fastify on Node.js as the default generated example, but the official runtime matrix also includes Bun, Deno, and Cloudflare Workers through their dedicated adapter packages.

Use `bootstrapApplication()` only when you explicitly want the lower-level bootstrap primitive.

### NestJS

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

void bootstrap();
```

### Konekti (`KonektiFactory.create` + starter-aligned Fastify adapter)

```typescript
import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});

await app.listen();
```

### Konekti (`KonektiFactory.create` + Express adapter)

```typescript
import { createExpressAdapter } from '@konekti/platform-express';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

### Konekti (`bootstrapApplication` + manual listen)

```typescript
import { bootstrapApplication } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await bootstrapApplication({
  rootModule: AppModule,
});

await app.listen();
```

### Konekti (`runNodeApplication` compatibility helper)

```typescript
import { runNodeApplication } from '@konekti/runtime/node';
import { AppModule } from './app.module';

await runNodeApplication(AppModule, {
  port: 3000,
});
```

Use `@konekti/runtime/node` when you intentionally want the Node compatibility wrapper (startup logging, signal wiring, and Node-default adapter behavior) rather than the starter-aligned adapter-first transport surface.

## 5) HTTP exceptions

## 4.5) request conversion instead of pipes

NestJS commonly uses pipes such as `ParseIntPipe` or `ValidationPipe({ transform: true })` to normalize request values before validation.

Konekti keeps that responsibility in the HTTP binding layer:

- **global conversion** via `KonektiFactory.create(..., { converters })` or `@konekti/runtime/node`'s `runNodeApplication(..., { converters })`
- **field conversion** via `@Convert(...)` on a DTO field
- **validation** still runs afterward through `@konekti/validation`

This means validators always see the **post-convert value**, not the raw transport value.

### Konekti

```typescript
class ParseIntConverter {
  convert(value: unknown) {
    return typeof value === 'string' ? Number(value) : value;
  }
}

class SearchRequest {
  @FromQuery('id')
  @Convert(ParseIntConverter)
  @IsNumber()
  id = 0;
}

await runNodeApplication(AppModule, {
  converters: [ParseIntConverter],
  port: 3000,
});
```

Import `runNodeApplication()` from `@konekti/runtime/node` when you need the Node compatibility helper.

## 5) HTTP exceptions

Konekti keeps familiar typed HTTP exceptions in `@konekti/http`.

### NestJS

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';

if (!user) {
  throw new NotFoundException('User not found');
}

if (!input.email) {
  throw new BadRequestException('Email is required');
}
```

### Konekti

```typescript
import { BadRequestException, NotFoundException } from '@konekti/http';

if (!user) {
  throw new NotFoundException('User not found');
}

if (!input.email) {
  throw new BadRequestException('Email is required', {
    field: 'email',
    message: 'must be provided',
  });
}
```

## 6) interceptors, guards, and pipes

### guards

Nest `@UseGuards(...)` maps to Konekti `@UseGuards(...)`.

### NestJS

```typescript
import { CanActivate, ExecutionContext, Injectable, UseGuards } from '@nestjs/common';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext) {
    return true;
  }
}

@UseGuards(AdminGuard)
@Controller('admin')
class AdminController {}
```

### Konekti

```typescript
import { Controller, Get, UseGuards, type Guard } from '@konekti/http';

class AdminGuard implements Guard {
  canActivate({ requestContext }) {
    const roles = requestContext.principal?.roles ?? [];
    return roles.includes('admin');
  }
}

@Controller('/admin')
@UseGuards(AdminGuard)
class AdminController {
  @Get('/')
  list() {
    return { ok: true };
  }
}
```

### interceptors

Nest `@UseInterceptors(...)` maps to Konekti `@UseInterceptors(...)`.

### NestJS

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { map } from 'rxjs/operators';

@Injectable()
class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((data) => ({ data })));
  }
}

@UseInterceptors(EnvelopeInterceptor)
@Controller('users')
class UsersController {}
```

### Konekti

```typescript
import { Controller, Get, UseInterceptors, type Interceptor } from '@konekti/http';

class EnvelopeInterceptor implements Interceptor {
  async intercept(_ctx, next) {
    const data = await next.handle();
    return { data };
  }
}

@Controller('/users')
@UseInterceptors(EnvelopeInterceptor)
class UsersController {
  @Get('/')
  list() {
    return [{ id: 'u1' }];
  }
}
```

### pipes and validation

Nest usually applies validation through `ValidationPipe` (global or route-level).

Konekti uses DTO request binding + validation decorators via `@RequestDto(...)` and the `@konekti/validation` package. There is no separate `@UsePipes()` decorator in the current public API.

### NestJS

```typescript
import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsEmail } from 'class-validator';

class CreateUserDto {
  @IsEmail()
  email!: string;
}

@Controller('users')
class UsersController {
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() dto: CreateUserDto) {
    return dto;
  }
}
```

### Konekti

```typescript
import { Controller, FromBody, Post, RequestDto } from '@konekti/http';
import { IsEmail } from '@konekti/validation';

class CreateUserDto {
  @FromBody()
  @IsEmail()
  email!: string;
}

@Controller('/users')
class UsersController {
  @Post('/')
  @RequestDto(CreateUserDto)
  create(dto: CreateUserDto) {
    return dto;
  }
}
```

## 7) configuration

Nest commonly uses `ConfigModule.forRoot()` and `ConfigService` from `@nestjs/config`.

Konekti configuration lives in `@konekti/config` and is loaded through the runtime bootstrap path.

### NestJS

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.dev',
    }),
  ],
})
export class AppModule {}
```

### Konekti

```typescript
import { Module } from '@konekti/core';
import { ConfigModule } from '@konekti/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
      validate: (raw) => {
        if (!raw.DATABASE_URL) {
          throw new Error('DATABASE_URL is required');
        }

        return raw as { DATABASE_URL: string; PORT: string };
      },
    }),
  ],
})
export class AppModule {}
```

`ConfigModule.forRoot()` loads the env file and registers `ConfigService` as a global provider by default (`isGlobal: true`). Pass `isGlobal: false` for module-only scope, and use either `envFile` or `envFilePath` to set a specific env file.

### runtime module naming rule during migration

Use Nest-style canonical entrypoints (`SomeModule.forRoot(...)`) for runtime modules that participate in application module imports.

Keep `create*` names for helpers/builders that are not runtime module entrypoints (for example `createTestingModule(...)`, `createHealthModule()`).

## 8) testing

Nest uses `@nestjs/testing` and a `TestingModule` builder.

Konekti uses `createTestingModule({ rootModule })` in `@konekti/testing` with familiar override-and-compile semantics.

### NestJS

```typescript
import { Test } from '@nestjs/testing';

const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(USER_REPOSITORY)
  .useValue(fakeUserRepo)
  .compile();

const service = moduleRef.get(UserService);
```

### Konekti

```typescript
import { createTestingModule } from '@konekti/testing';

const moduleRef = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, fakeUserRepo)
  .compile();

const service = await moduleRef.resolve(UserService);
```

## post-codemod checklist

After running `konekti migrate`, the CLI output groups warnings by category. Use this checklist to address each one. Items marked with ✅ are handled automatically by the codemod; the rest require manual follow-up.

### automated by codemod (no action needed)

- ✅ Import rewriting (`@nestjs/common` → `@konekti/core` / `@konekti/http`)
- ✅ `@Injectable()` removal
- ✅ Scope enum mapping (`Scope.REQUEST` → `@Scope('request')`)
- ✅ Bootstrap rewrite for safe default forms (`NestFactory.create` → `KonektiFactory.create`)
- ✅ Testing rewrite for safe metadata (`Test.createTestingModule` → `createTestingModule`)
- ✅ `tsconfig.json` legacy flag removal (`experimentalDecorators`, `emitDecoratorMetadata`)

### manual follow-up by warning category

Each category below maps to a warning group in the `konekti migrate` output. Address them in order after the codemod completes.

#### DI token migration (`@Inject`)

- CLI warning category: **DI token migration (@Inject)**
- Constructor `@Inject(TOKEN)` parameter decorators must be migrated to class-level `@Inject([TOKEN])`.
- See [section 2: `@Inject(TOKEN)` → explicit token list](#injecttoken---explicit-token-list) for the before/after pattern.

#### Request DTO migration (handler parameter decorators)

- CLI warning category: **Request DTO migration (handler parameter decorators)**
- Handler parameter decorators (`@Body()`, `@Param()`, `@Query()`) should be reviewed for `@RequestDto` + DTO field decorator migration.
- See [section 4.5: request conversion instead of pipes](#45-request-conversion-instead-of-pipes) for the Konekti DTO binding pattern.

#### Pipe/converter migration

- CLI warning category: **Pipe/converter migration**
- `@UsePipes()`, `ValidationPipe`, and `Parse*Pipe` usages need manual conversion to Konekti converters + `@RequestDto` validation.
- Konekti keeps request conversion in the HTTP binding layer (`@Convert(...)`, global `converters` option) instead of a separate `@UsePipes()` decorator.

#### Unsupported bootstrap variant

- CLI warning category: **Unsupported bootstrap variant**
- Bootstrap forms using type arguments (`NestFactory.create<NestExpressApplication>(...)`) or adapter-specific constructors are not auto-rewritten.
- Use `KonektiFactory.create(AppModule, { adapter: createExpressAdapter(...) })` as the explicit adapter path.
- See [section 4: bootstrap path](#4-bootstrap-path) for all supported Konekti bootstrap forms.

#### Unsupported testing pattern

- CLI warning category: **Unsupported testing pattern**
- Testing builder chains with methods beyond the supported set (e.g., `.useMocker()`) or non-standard metadata shapes are not auto-rewritten.
- Rewrite these tests manually using `createTestingModule({ rootModule })` from `@konekti/testing`.
- See [section 8: testing](#8-testing) for the Konekti testing pattern.

#### Bootstrap port folding issue

- CLI warning category: **Bootstrap port folding issue**
- The codemod could not move the `listen(port)` argument into `KonektiFactory.create` options (e.g., because the options object already has a `port` property).
- Review the bootstrap file manually and ensure the final startup path matches the portability guidance: explicit adapter-first startup for new HTTP apps, or `@konekti/runtime/node` when you intentionally keep the Node compatibility helper.

#### Other warnings

- **Unsupported import form**: a non-named `@nestjs/common` import that the codemod cannot rewrite. Rewrite it manually.
- **@Injectable options removed**: `@Injectable()` options other than `scope` were dropped. Verify behavior manually.
- **tsconfig parse failure**: the codemod could not parse `tsconfig.json`. Rewrite legacy flags manually.

## related docs

- `./quick-start.md`
- `./bootstrap-paths.md`
- `../concepts/di-and-modules.md`
- `../concepts/http-runtime.md`
- `../operations/testing-guide.md`
