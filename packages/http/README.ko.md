# @konekti/http

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


route metadata를 request 처리 체인으로 바꾸는 HTTP 실행 레이어.

## 관련 문서

- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/error-responses.md`
- `../../docs/concepts/security-middleware.md`

## 이 패키지가 하는 일

`@konekti/http`는 단순 라우터가 아니라 전체 request 실행 런타임이다. 다음을 소유한다:

- `FrameworkRequest` / `FrameworkResponse` / `RequestContext` — adapter, middleware, guard, interceptor, controller 사이의 공통 언어
- Route와 DTO 데코레이터 (`@Controller`, `@Get`, `@Post`, `@Version`, `@FromBody`, `@FromPath` 등)
- Mapped DTO helper (`PickType`, `OmitType`, `IntersectionType`)
- Routing table 구성 (`createHandlerMapping`)
- Request DTO binding과 validation
- middleware → guard → interceptor → bind → validate → handler 호출을 순서대로 실행하는 dispatcher
- HTTP exception 클래스와 canonical error envelope

## 설치

```bash
npm install @konekti/http
```

## 빠른 시작

### Controller 정의

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

### HTTP exception 던지기

```typescript
import { NotFoundException, BadRequestException } from '@konekti/http';

throw new NotFoundException('User not found');
throw new BadRequestException('Invalid input', { field: 'email', message: 'must be valid' });
```

### Dispatcher 생성 (`@konekti/runtime`이 bootstrap 시 처리)

```typescript
import { createHandlerMapping, createDispatcher } from '@konekti/http';

const handlerMapping = createHandlerMapping([{ controllerToken: UserController }]);
const dispatcher = createDispatcher({ handlerMapping, rootContainer: container, appMiddleware: middleware });
```

## 핵심 API

### 타입

| Export | 위치 | 설명 |
|---|---|---|
| `FrameworkRequest` | `src/types.ts` | Adapter에 독립적인 request shape |
| `FrameworkResponse` | `src/types.ts` | Adapter에 독립적인 response shape |
| `RequestContext` | `src/request-context.ts` | 런타임 context: request, response, principal, requestId, container |

### Route 데코레이터

| 데코레이터 | 설명 |
|---|---|
| `@Controller(path)` | 클래스를 base path를 가진 controller로 지정 |
| `@Get(path)` / `@Post(path)` / `@Put(path)` / `@Patch(path)` / `@Delete(path)` | HTTP method route |
| `@Version(value)` | `/v1/...` 같은 URI 버저닝을 적용; handler 레벨 버전이 controller 레벨 버전을 override |

### URI 버저닝

현재 Konekti는 URI 버저닝만 지원합니다.

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

- controller 레벨 `@Version('1')`은 `/v1/users` 같은 경로를 만듭니다
- handler 레벨 `@Version('2')`는 해당 route에 한해 controller 버전을 override합니다
- 버전을 지정하지 않은 controller는 기존 경로를 그대로 유지합니다

### Mapped DTO helper

Konekti는 일반적인 request shape 파생을 위해 metadata-preserving mapped DTO helper를 지원합니다.

```typescript
import { IntersectionType, OmitType, PickType } from '@konekti/http';

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
```

- `PickType()`은 선택한 DTO field와 해당 metadata만 유지합니다
- `OmitType()`은 선택한 DTO field를 제거하고 나머지 metadata를 유지합니다
- `IntersectionType()`은 여러 DTO base의 metadata를 하나의 파생 DTO로 합성합니다
- 파생 DTO는 `RequestDto(...)`, runtime binding, validation, OpenAPI generation과 계속 함께 동작합니다

### DTO binding 데코레이터

| 데코레이터 | 설명 |
|---|---|
| `@FromBody()` | request body에서 필드 바인딩 (strict allowlist, 알 수 없는 필드 차단) |
| `@FromPath()` | URL path parameter에서 필드 바인딩 |
| `@FromQuery()` | query string에서 필드 바인딩 |
| `@FromHeader()` | request header에서 필드 바인딩 |
| `@FromCookie()` | cookie에서 필드 바인딩 |
| `@Optional()` | binding을 optional로 표시 (binder 레벨) |

> Validation 데코레이터 (`@IsString`, `@IsEmail` 등)는 이 패키지가 아니라 `@konekti/dto-validator`에서 가져온다.

### 런타임 helper

| Export | 위치 | 설명 |
|---|---|---|
| `createHandlerMapping(sources)` | `src/mapping.ts` | `{ controllerToken }` 같은 handler source에서 normalized routing table 생성 |
| `createDispatcher(options)` | `src/dispatcher.ts` | request dispatch 함수 생성 |
| `createCorsMiddleware(options)` | `src/cors.ts` | CORS middleware 함수 반환 |
| `createRequestContext()` | `src/request-context.ts` | ALS 기반 context factory |

추가 public export로는 `Options`, `Head`, `IntersectionType`, `OmitType`, `PickType`, `RequestDto`, `SuccessStatus`, `UseGuard`, `UseInterceptor`, `Version`, `createCorrelationMiddleware`, `createRateLimitMiddleware`, `createSecurityHeadersMiddleware`, `forRoutes`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `HttpApplicationAdapter`, `createNoopHttpApplicationAdapter`, `PayloadTooLargeException` 등이 있습니다.

### 성공 상태 코드 기본값

- `GET`, `PUT`, `PATCH`, `HEAD`는 기본적으로 `200`
- `POST`는 기본적으로 `201`
- `DELETE`, `OPTIONS`는 핸들러가 `undefined`를 반환하면 `204`, 아니면 `200`
- `@SuccessStatus(code)`는 항상 메서드 기본값보다 우선합니다
- dispatcher는 interceptor 체인이 끝난 뒤 최종 성공 코드를 결정하므로, interceptor가 결과를 바꾸면 기본 상태 코드 결정에도 반영됩니다

### Exception

| Export | 상태 코드 |
|---|---|
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `InternalServerException` | 500 |

## 구조

### Dispatcher 실행 순서

```text
들어오는 요청
  → RequestContext 생성
  → app middleware
  → route match
  → module middleware
  → guard chain  (허용 / 거부)
  → interceptor chain  (전후 wrapper)
  → request DTO binding  (fromBody / fromPath / fromQuery / ...)
  → DTO validation  (@konekti/dto-validator 사용)
  → controller method(input, ctx)
  → 성공 상태 코드 결정 (`@SuccessStatus` override 또는 메서드 기본값)
  → 성공 response 작성
  → catch → canonical error response 작성
```

### DTO binding 보안

binder는 단순 필드 복사가 아니다. 두 가지 정책이 적용된다:

1. **`@FromBody`의 strict allowlist** — DTO에 선언되지 않은 request body 필드는 `BadRequestException`으로 거부되어 mass-assignment 공격을 방지한다.
2. **위험한 key 차단** — `__proto__`, `constructor`, `prototype` 같은 key는 무조건 거부된다.

### Routing table 구성

`createHandlerMapping()`은 요청이 들어오기 전에 실행된다:
- controller base path와 각 route path를 결합
- 중복 슬래시 정규화
- named path param 추출 (`:id` → param 이름)
- 중복 route 충돌 시 빠른 실패

### Request context와 ALS

`RequestContext`는 `AsyncLocalStorage`에 저장된다. request, response, `requestId`, 인증된 `principal` (auth guard가 설정), request-scoped DI `container`를 담는다. request 안에서 실행되는 모든 코드는 prop drilling 없이 context에 접근할 수 있다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — `FrameworkRequest`, `FrameworkResponse`, `RequestContext`
2. `src/decorators.ts` — route와 DTO binding 메타데이터 writer
3. `src/mapping.ts` — routing table 구성 + 충돌 감지
4. `src/binding.ts` — request 각 부분에서 DTO 인스턴스화
5. `src/dto-validation-adapter.ts` — DTO validation adapter
6. `src/request-context.ts` — ALS 기반 context
7. `src/dispatcher.ts` — 실행 체인 순서 결정
8. `src/exceptions.ts` — HTTP exception family + error envelope
9. `src/binding.test.ts` — binding 정책 (allowlist, 위험한 key, 400 detail shape)
10. `src/dispatcher.test.ts` — middleware/guard/interceptor 순서, canonical error 코드

## 관련 패키지

- `@konekti/core` — route와 DTO 메타데이터가 저장되는 곳
- `@konekti/dto-validator` — DTO validation 단계에서 사용하는 validation 엔진
- `@konekti/runtime` — bootstrap 시 routing table과 dispatcher 조립
- `@konekti/passport` — guard chain에 연결되는 auth guard

## 한 줄 mental model

```text
@konekti/http = route metadata → DTO binding → middleware/guard/interceptor 체인 → handler 호출
```
