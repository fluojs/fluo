# NestJS에서 Konekti로 마이그레이션

<p><a href="./migrate-from-nestjs.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 이미 NestJS 서비스를 운영 중인 팀이 Konekti로 옮길 때, 개념 차이와 실제 변경 지점을 빠르게 파악하도록 돕기 위한 실전 문서입니다.

codemod 이후 Konekti 테스트 작성 레시피는 `../operations/testing-guide.ko.md`와 `../../packages/testing/README.ko.md`를 함께 참고하세요.

## codemod 빠른 시작 (`konekti migrate`)

먼저 CLI codemod를 실행하고, warning에 나온 수동 후속 작업을 이어서 처리하세요.

```bash
# 기본 동작: dry-run
konekti migrate ./src

# 변경 사항 실제 반영
konekti migrate ./src --apply

# transform 선택/제외
konekti migrate ./src --only imports,injectable,scope,bootstrap,testing,tsconfig
konekti migrate ./src --skip testing
```

현재 1차 자동 변환 범위:

1. import rewriting
2. `@Injectable()` 제거
3. scope enum 매핑
4. 안전한 기본 startup 형태에서 `KonektiFactory.create(...)` + `await app.listen()` 기준 bootstrap rewrite
5. 안전한 metadata/chain에 한한 testing rewrite (`Test.createTestingModule` → `createTestingModule`)
6. `tsconfig.json` rewrite (`experimentalDecorators`, `emitDecoratorMetadata` 제거)

또한 명령 출력에는 수동 마이그레이션 대상(`@Inject(TOKEN)` 파라미터 데코레이터, handler 파라미터의 Request DTO 전환, pipe/converter 전환 지점, 지원하지 않는 Nest bootstrap 변형, 지원하지 않는 Nest testing metadata/chain) 경고가 포함됩니다.

## 빠른 매핑 테이블

| NestJS 패턴 | Konekti 패턴 | 설명 |
|---|---|---|
| `@Module({ imports, providers, controllers, exports })` | `@konekti/core`의 `@Module({ imports, providers, controllers, exports })` | 형태는 유사하지만, Konekti는 부트스트랩 시 import/export 가시성을 fail-fast로 검증합니다. |
| `@Injectable()` | `providers` 등록 + 필요 시 `@Inject([...])` | Konekti에는 `@Injectable()`이 필수가 아닙니다. |
| `@Controller()`, `@Get()`, `@Post()` | `@konekti/http`의 동일 데코레이터 | 라우트 데코레이터 사용감은 거의 동일합니다. |
| `@Inject(TOKEN)` | `@konekti/core`의 `@Inject([TOKEN])` | 생성자 의존성 토큰 목록을 명시적으로 선언합니다. |
| `Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT` | `@Scope('singleton' \| 'request' \| 'transient')` | 기본값은 singleton입니다. |
| `NestFactory.create(AppModule)` | `KonektiFactory.create(AppModule, { adapter: createFastifyAdapter({ port: 3000 }) })` | Node.js 기준 스타터와 정렬된 권장 HTTP 시작 경로입니다. 런타임 facade를 유지하면서 명시적인 트랜스포트 어댑터를 선택합니다. |
| `NestFactory.create<NestExpressApplication>(AppModule)` | `KonektiFactory.create(AppModule, { adapter: createExpressAdapter(...) })` | 런타임 facade 기반 시작 경로를 유지하면서 Express 트랜스포트 어댑터를 명시적으로 선택합니다. |
| `app.listen(3000)` | `await app.listen()` | 애플리케이션 생성 이후 실행은 명시적으로 유지됩니다. |
| `HttpException`, `NotFoundException`, `BadRequestException` | `@konekti/http`의 예외 클래스들 | 핸들러/가드에서 typed HTTP 예외를 던지는 모델은 동일합니다. |
| `@UseGuards()`, `@UseInterceptors()`, validation pipes | `@UseGuards()`, `@UseInterceptors()`, `@RequestDto(...)`, `@Convert(...)`, global `converters` 런타임 옵션 | Konekti는 별도의 `@UsePipes()` 데코레이터 대신 HTTP 바인딩 계층에서 요청 변환을 처리합니다. |
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

Konekti는 `@Inject([TOKEN_A, TOKEN_B])` 형태로 생성자 의존성 토큰 목록을 명시합니다. 구체 클래스가 있는 의존성은 클래스를 토큰으로 우선 사용하고, 인터페이스 전용 계약이나 runtime handle에는 symbol을 유지합니다.

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

@Inject([PaymentClient])
export class BillingService {
  constructor(private readonly client: PaymentClient) {}
}
```

의존성이 인터페이스나 런타임별 토큰 뒤에 추상화되어 있다면 symbol도 계속 유효합니다:

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

새 앱에서 canonical HTTP startup path는 명시적 어댑터를 넘기는 `KonektiFactory.create()`입니다.

스타터는 생성 예제로 Fastify + Node.js 경로를 유지하지만, 공식 런타임 매트릭스는 전용 어댑터 패키지를 통해 Bun, Deno, Cloudflare Workers까지 포함합니다.

`bootstrapApplication()`은 low-level bootstrap primitive를 직접 써야 할 때만 사용하세요.

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

### Konekti (`KonektiFactory.create` + 스타터 정렬 Fastify 어댑터)

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

### Konekti (`runNodeApplication` 호환 헬퍼)

```typescript
import { runNodeApplication } from '@konekti/runtime/node';
import { AppModule } from './app.module';

await runNodeApplication(AppModule, {
  port: 3000,
});
```

스타터와 정렬된 adapter-first 트랜스포트 surface 대신 Node 호환 wrapper(시작 로그, 시그널 wiring, Node 기본 어댑터 동작)가 의도적으로 필요할 때만 `@konekti/runtime/node`를 사용하세요.

## 4.5) pipes 대신 요청 변환

NestJS에서는 `ParseIntPipe`나 `ValidationPipe({ transform: true })`처럼 요청 값을 validation 전에 정규화하는 패턴이 흔합니다.

Konekti는 이 책임을 HTTP 바인딩 계층에 둡니다.

- **global conversion**: `KonektiFactory.create(..., { converters })` 또는 `@konekti/runtime/node`의 `runNodeApplication(..., { converters })`
- **field conversion**: DTO 필드의 `@Convert(...)`
- **validation**: 그 이후 `@konekti/validation`이 실행

즉 validator는 raw transport value가 아니라 **변환이 끝난 값**을 기준으로 동작합니다.

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

const app = await KonektiFactory.create(AppModule, {
  converters: [ParseIntConverter],
  port: 3000,
});

await app.listen();
```

Node 호환 헬퍼가 필요하면 `runNodeApplication()`은 `@konekti/runtime/node`에서 import 하세요.

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

Konekti는 `@RequestDto(...)`와 `@konekti/validation` 패키지 데코레이터를 결합해 DTO 바인딩/검증을 수행합니다. 현재 공개 API에는 별도 `@UsePipes()` 데코레이터가 없습니다.

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

`ConfigModule.forRoot()`는 env 파일을 로드하고 기본적으로 `ConfigService`를 글로벌 provider로 등록합니다(`isGlobal: true`). 모듈 스코프로 제한하려면 `isGlobal: false`를 사용하고, 특정 env 파일은 `envFile` 또는 `envFilePath`로 지정할 수 있습니다.

### 마이그레이션 시 런타임 모듈 네이밍 규칙

애플리케이션 모듈 import에 참여하는 런타임 모듈은 Nest 스타일 canonical 엔트리포인트(`SomeModule.forRoot(...)`)를 사용하세요.

런타임 모듈 엔트리포인트가 아닌 helper/builder는 `create*` 네이밍을 유지하세요(예: `createTestingModule(...)`, `createHealthModule()`).

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

## 포스트 코드모드 체크리스트

`konekti migrate` 실행 후 CLI 출력은 경고를 카테고리별로 그룹화합니다. 이 체크리스트를 사용하여 각 항목을 처리하세요. ✅ 표시된 항목은 코드모드가 자동으로 처리하며, 나머지는 수동 후속 작업이 필요합니다.

### 코드모드가 자동 처리 (별도 작업 불필요)

- ✅ import 재작성 (`@nestjs/common` → `@konekti/core` / `@konekti/http`)
- ✅ `@Injectable()` 제거
- ✅ scope enum 매핑 (`Scope.REQUEST` → `@Scope('request')`)
- ✅ 안전한 기본 형태의 bootstrap 재작성 (`NestFactory.create` → `KonektiFactory.create`)
- ✅ 안전한 metadata의 testing 재작성 (`Test.createTestingModule` → `createTestingModule`)
- ✅ `tsconfig.json` 레거시 플래그 제거 (`experimentalDecorators`, `emitDecoratorMetadata`)

### 경고 카테고리별 수동 후속 작업

아래 각 카테고리는 `konekti migrate` 출력의 경고 그룹에 대응합니다. 코드모드 완료 후 순서대로 처리하세요.

#### DI 토큰 마이그레이션 (`@Inject`)

- CLI 경고 카테고리: **DI token migration (@Inject)**
- 생성자 `@Inject(TOKEN)` 파라미터 데코레이터를 클래스 수준 `@Inject([TOKEN])`으로 전환해야 합니다.
- [섹션 2: `@Inject(TOKEN)` → 명시적 토큰 목록](#injecttoken---명시적-토큰-목록)의 before/after 패턴을 참고하세요.

#### Request DTO 마이그레이션 (핸들러 파라미터 데코레이터)

- CLI 경고 카테고리: **Request DTO migration (handler parameter decorators)**
- 핸들러 파라미터 데코레이터(`@Body()`, `@Param()`, `@Query()`)를 `@RequestDto` + DTO 필드 데코레이터 전환 관점에서 검토해야 합니다.
- [섹션 4.5: pipes 대신 요청 변환](#45-pipes-대신-요청-변환)의 Konekti DTO 바인딩 패턴을 참고하세요.

#### Pipe/converter 마이그레이션

- CLI 경고 카테고리: **Pipe/converter migration**
- `@UsePipes()`, `ValidationPipe`, `Parse*Pipe` 사용을 Konekti converter + `@RequestDto` 검증으로 수동 전환해야 합니다.
- Konekti는 별도의 `@UsePipes()` 데코레이터 대신 HTTP 바인딩 계층(`@Convert(...)`, global `converters` 옵션)에서 요청 변환을 처리합니다.

#### 지원하지 않는 bootstrap 변형

- CLI 경고 카테고리: **Unsupported bootstrap variant**
- 타입 인자(`NestFactory.create<NestExpressApplication>(...)`)나 어댑터 전용 생성자를 사용하는 bootstrap 형태는 자동 재작성되지 않습니다.
- `KonektiFactory.create(AppModule, { adapter: createExpressAdapter(...) })`를 명시적 어댑터 경로로 사용하세요.
- [섹션 4: 부트스트랩 경로](#4-부트스트랩-경로)에서 지원하는 모든 Konekti bootstrap 형태를 확인하세요.

#### 지원하지 않는 testing 패턴

- CLI 경고 카테고리: **Unsupported testing pattern**
- 지원 범위를 벗어나는 메서드(예: `.useMocker()`)나 비표준 metadata 형태를 사용하는 testing builder chain은 자동 재작성되지 않습니다.
- `@konekti/testing`의 `createTestingModule({ rootModule })`를 사용하여 수동으로 재작성하세요.
- [섹션 8: 테스트](#8-테스트)의 Konekti 테스팅 패턴을 참고하세요.

#### Bootstrap 포트 접기 문제

- CLI 경고 카테고리: **Bootstrap port folding issue**
- 코드모드가 `listen(port)` 인자를 `KonektiFactory.create` 옵션으로 옮기지 못했습니다(예: 옵션 객체에 이미 `port` 속성이 있는 경우).
- bootstrap 파일을 수동으로 검토하고, 최종 startup path가 portability 가이드와 맞는지 확인하세요. 새 HTTP 앱은 explicit adapter-first startup을, Node 호환 헬퍼를 유지하려는 경우에는 `@konekti/runtime/node`를 사용해야 합니다.

#### 기타 경고

- **Unsupported import form**: 코드모드가 재작성할 수 없는 비명명 `@nestjs/common` import입니다. 수동으로 재작성하세요.
- **@Injectable options removed**: `scope` 이외의 `@Injectable()` 옵션이 제거되었습니다. 동작을 수동으로 확인하세요.
- **tsconfig parse failure**: 코드모드가 `tsconfig.json`을 파싱하지 못했습니다. 레거시 플래그를 수동으로 제거하세요.

## 관련 문서

- `./quick-start.ko.md`
- `./bootstrap-paths.ko.md`
- `../concepts/di-and-modules.ko.md`
- `../concepts/http-runtime.ko.md`
- `../operations/testing-guide.ko.md`
