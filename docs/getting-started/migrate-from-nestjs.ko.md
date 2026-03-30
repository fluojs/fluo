# NestJS에서 Konekti로 마이그레이션

<p><a href="./migrate-from-nestjs.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 이미 NestJS 서비스를 운영 중인 팀이 Konekti로 옮길 때, 개념 차이와 실제 변경 지점을 빠르게 파악하도록 돕기 위한 실전 문서입니다.

## 빠른 매핑 테이블

| NestJS 패턴 | Konekti 패턴 | 설명 |
|---|---|---|
| `@Module({ imports, providers, controllers, exports })` | `@konekti/core`의 `@Module({ imports, providers, controllers, exports })` | 형태는 유사하지만, Konekti는 부트스트랩 시 import/export 가시성을 fail-fast로 검증합니다. |
| `@Injectable()` | `providers` 등록 + 필요 시 `@Inject([...])` | Konekti에는 `@Injectable()`이 필수가 아닙니다. |
| `@Controller()`, `@Get()`, `@Post()` | `@konekti/http`의 동일 데코레이터 | 라우트 데코레이터 사용감은 거의 동일합니다. |
| `@Inject(TOKEN)` | `@konekti/core`의 `@Inject([TOKEN])` | 생성자 의존성 토큰 목록을 명시적으로 선언합니다. |
| `Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT` | `@Scope('singleton' \| 'request' \| 'transient')` | 기본값은 singleton입니다. |
| `NestFactory.create(AppModule)` | `runNodeApplication(AppModule, options)` 또는 `bootstrapApplication({ rootModule: AppModule, ... })` | 런타임이 어댑터 wiring과 시작 흐름을 소유합니다. |
| `app.listen(3000)` | `runNodeApplication(...)` (내장 listen) 또는 `bootstrapApplication(...)` 후 `await app.listen()` | 제어 수준에 따라 선택할 수 있습니다. |
| `HttpException`, `NotFoundException`, `BadRequestException` | `@konekti/http`의 예외 클래스들 | 핸들러/가드에서 typed HTTP 예외를 던지는 모델은 동일합니다. |
| `@UseGuards()`, `@UseInterceptors()`, validation pipes | `@UseGuards()`, `@UseInterceptors()`, `@RequestDto(...)` + `@konekti/dto` 패키지 | 현재 공개 API에는 별도의 `@UsePipes()` 데코레이터가 없습니다. |
| `@nestjs/testing` (`Test.createTestingModule`) | `@konekti/testing`의 `createTestingModule({ rootModule })` | provider override, compile, token resolve 흐름이 유사합니다. |

## 1) 모듈 매핑

큰 틀에서 모듈 메타데이터 구조는 거의 같습니다. 실제 마이그레이션 비용은 모듈 형태 변경보다 DI/런타임 관례 변경에서 발생합니다.

핵심 차이는 가시성 검증입니다. Konekti는 부트스트랩 시점에 `imports`/`exports` 경계와 토큰 접근성을 모듈 그래프 수준에서 검증합니다.

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

## 2) 데코레이터 매핑

### `@Injectable()` -> provider 등록

NestJS에서는 `@Injectable()`이 DI 가능한 클래스를 선언하는 신호입니다.

Konekti에서는 클래스가 `providers`에 등록되면 DI 대상으로 취급되며, `@Injectable()`은 필요하지 않습니다.

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

// 모듈 메타데이터에서 등록
// @Module({ providers: [UserService] })
```

### 라우트 데코레이터 (`@Controller`, `@Get`, `@Post`)

라우트 데코레이터는 `@konekti/http`로 거의 1:1 대응됩니다.

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

### `@Inject(TOKEN)` -> 명시적 토큰 목록

Konekti는 `@Inject([TOKEN_A, TOKEN_B])` 형태로 생성자 의존성 토큰 목록을 명시합니다.

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

## 3) provider scope

스코프 매핑은 단순합니다:

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

## 4) 부트스트랩 경로

Node 앱에서는 `runNodeApplication()`이 canonical startup 경로입니다. HTTP 어댑터, startup 로그, graceful shutdown wiring을 런타임이 소유합니다.

`listen()` 제어를 직접 하려면 `bootstrapApplication()`을 사용하세요.

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

## 5) HTTP 예외

Konekti도 `@konekti/http`에서 typed HTTP 예외를 제공합니다.

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

## 6) 인터셉터, 가드, 파이프

### 가드

Nest `@UseGuards(...)`는 Konekti `@UseGuards(...)`로 매핑됩니다.

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

### 인터셉터

Nest `@UseInterceptors(...)`는 Konekti `@UseInterceptors(...)`로 매핑됩니다.

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

### 파이프와 검증

Nest는 보통 `ValidationPipe`(전역 또는 라우트 단위)로 검증을 적용합니다.

Konekti는 `@RequestDto(...)`와 `@konekti/dto` 패키지 데코레이터를 결합해 DTO 바인딩/검증을 수행합니다. 현재 공개 API에는 별도 `@UsePipes()` 데코레이터가 없습니다.

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
import { IsEmail } from '@konekti/dto';

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

## 7) 설정(config)

Nest는 일반적으로 `@nestjs/config`의 `ConfigModule.forRoot()`를 사용합니다.

Konekti는 `@konekti/config`를 런타임 부트스트랩 경로와 함께 사용합니다.

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

`ConfigModule.forRoot()`는 env 파일을 로드하고 기본적으로 `ConfigService`를 글로벌 provider로 등록합니다(`isGlobal: true`). 모듈 스코프로 제한하려면 `isGlobal: false`를 사용하고, 특정 env 파일은 `envFile` 또는 `envFilePath`로 지정할 수 있습니다.

## 8) 테스트

Nest는 `@nestjs/testing`의 `Test.createTestingModule`을 사용합니다.

Konekti는 `@konekti/testing`의 `createTestingModule({ rootModule })`를 사용하며, override + compile 흐름이 유사합니다.

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

## 마이그레이션 체크리스트

- 모듈 선언(`@Module`)을 먼저 옮기고 경계를 명시적으로 유지
- `@Injectable()` 의존을 줄이고 provider 등록 중심으로 정리
- 필요한 클래스에 `@Inject([...])` 토큰 목록 명시
- 가드/인터셉터를 `@UseGuards`/`@UseInterceptors`로 이전
- Nest pipe 기반 검증을 `@RequestDto` + `@konekti/dto` 패키지로 이전
- 부트스트랩을 `runNodeApplication(...)` 또는 `bootstrapApplication(...)`로 전환
- 테스트를 `createTestingModule(...)` + provider override 패턴으로 전환

## 관련 문서

- `./quick-start.ko.md`
- `./bootstrap-paths.ko.md`
- `../concepts/di-and-modules.ko.md`
- `../concepts/http-runtime.ko.md`
- `../operations/testing-guide.ko.md`
