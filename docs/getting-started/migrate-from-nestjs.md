# migrate from nestjs

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>


This guide is for teams that already ship NestJS services and want a practical migration path to Konekti.

## quick mapping table

| NestJS pattern | Konekti pattern | Notes |
|---|---|---|
| `@Module({ imports, providers, controllers, exports })` | `@Module({ imports, providers, controllers, exports })` from `@konekti/core` | Same shape, but Konekti enforces import/export visibility at bootstrap with fail-fast graph validation. |
| `@Injectable()` | Register class in `providers`, optional `@Inject([...])` for explicit tokens | No `@Injectable()` requirement in Konekti. |
| `@Controller()`, `@Get()`, `@Post()` | `@Controller()`, `@Get()`, `@Post()` from `@konekti/http` | Route decorator shape is intentionally familiar. |
| `@Inject(TOKEN)` | `@Inject([TOKEN])` from `@konekti/core` | Konekti takes an explicit token list for constructor dependencies. |
| `Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT` | `@Scope('singleton' \| 'request' \| 'transient')` | Default remains singleton. |
| `NestFactory.create(AppModule)` | `runNodeApplication(AppModule, options)` or `bootstrapApplication({ rootModule: AppModule, ... })` | Runtime owns adapter wiring and startup flow. |
| `app.listen(3000)` | `runNodeApplication(...)` (built-in listen) or `await app.listen()` after `bootstrapApplication(...)` | Both are supported depending on how much control you need. |
| `HttpException`, `NotFoundException`, `BadRequestException` | `NotFoundException`, `BadRequestException`, and peers from `@konekti/http` | Same mental model: throw typed HTTP exceptions in handlers/guards. |
| `@UseGuards()`, `@UseInterceptors()`, validation pipes | `@UseGuards()`, `@UseInterceptors()`, and `@RequestDto(...)` + `@konekti/dto-validator` decorators | Konekti does not use a separate `@UsePipes()` decorator. |
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

Use `runNodeApplication()` as the canonical Node startup path when you want runtime-managed adapter setup, startup logging, and graceful shutdown wiring.

Use `bootstrapApplication()` when you want to control `listen()` yourself.

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

### Konekti (`runNodeApplication`)

```typescript
import { runNodeApplication } from '@konekti/runtime';
import { AppModule } from './app.module';

await runNodeApplication(AppModule, {
  port: 3000,
});
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

Konekti uses DTO request binding + validation decorators via `@RequestDto(...)` and `@konekti/dto-validator`. There is no separate `@UsePipes()` decorator in the current public API.

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
import { IsEmail } from '@konekti/dto-validator';

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

## migration checklist

- move module declarations first (`@Module`) and keep boundaries explicit
- replace `@Injectable()` usage with provider registration in module metadata
- convert DI metadata to explicit `@Inject([...])` token lists where needed
- migrate guards/interceptors with `@UseGuards` and `@UseInterceptors`
- move validation from Nest pipes to `@RequestDto` + `@konekti/dto-validator`
- switch bootstrap to `runNodeApplication(...)` or `bootstrapApplication(...)`
- migrate tests to `createTestingModule(...)` and provider overrides

## related docs

- `./quick-start.md`
- `./bootstrap-paths.md`
- `../concepts/di-and-modules.md`
- `../concepts/http-runtime.md`
- `../operations/testing-guide.md`
