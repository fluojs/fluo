# @konekti/http

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


라우트 메타데이터를 요청 처리 체인으로 변환하는 HTTP 실행 레이어입니다.

## 관련 문서

- `../../docs/concepts/http-runtime.ko.md`
- `../../docs/concepts/error-responses.ko.md`
- `../../docs/concepts/security-middleware.ko.md`

## 이 패키지가 하는 일

`@konekti/http`는 단순한 라우터가 아니라 전체 요청 실행 런타임입니다. 다음을 관리합니다.

- `FrameworkRequest` / `FrameworkResponse` / `RequestContext` — 어댑터, 미들웨어, 가드, 인터셉터, 컨트롤러 간의 공통 언어
- 라우트 및 DTO 데코레이터 (`@Controller`, `@Get`, `@Post`, `@Version`, `@FromBody`, `@FromPath` 등)
- `@konekti/validation` 패키지의 매핑된 DTO 헬퍼 (`PickType`, `OmitType`, `IntersectionType`, `PartialType`)
- 라우팅 테이블 구성 (`createHandlerMapping`)
- 요청 DTO 바인딩 및 검증
- 미들웨어 → 가드 → 인터셉터 → 바인드 → 검증 → 핸들러 호출을 순서대로 실행하는 디스패처
- HTTP 예외 클래스 및 표준 오류 엔벨로프(envelope)

## 설치

```bash
npm install @konekti/http
```

## 빠른 시작

### 컨트롤러 정의

```typescript
import { Controller, Get, Post, Version, FromBody, FromPath, RequestDto } from '@konekti/http';
import { IsString, MinLength } from '@konekti/validation';
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

### HTTP 예외 던지기

```typescript
import { NotFoundException, BadRequestException } from '@konekti/http';

throw new NotFoundException('User not found');
throw new BadRequestException('Invalid input', { field: 'email', message: 'must be valid' });
```

### 디스패처 생성 (부트스트랩 중 `@konekti/runtime`에 의해 수행됨)

```typescript
import { createHandlerMapping, createDispatcher } from '@konekti/http';

const handlerMapping = createHandlerMapping([{ controllerToken: UserController }]);
const dispatcher = createDispatcher({ handlerMapping, rootContainer: container, appMiddleware: middleware });
```

## 주요 API

### 타입

| 익스포트(Export) | 위치 | 설명 |
|---|---|---|
| `FrameworkRequest` | `src/types.ts` | 어댑터에 독립적인 요청 형태 |
| `FrameworkResponse` | `src/types.ts` | 어댑터에 독립적인 응답 형태 |
| `RequestContext` | `src/request-context.ts` | 런타임 컨텍스트: 요청, 응답, 주체(principal), requestId, 컨테이너 |

### 라우트 데코레이터

| 데코레이터 | 설명 |
|---|---|
| `@Controller(path)` | 클래스를 기본 경로를 가진 컨트롤러로 표시 |
| `@Get(path)` / `@Post(path)` / `@Put(path)` / `@Patch(path)` / `@Delete(path)` | HTTP 메서드 라우트 |
| `@All(path)` | 모든 HTTP 메서드에 매칭되는 라우트 |
| `@Header(name, value)` | 라우트에 응답 헤더를 설정 |
| `@Redirect(url, statusCode?)` | 응답을 지정된 URL로 리다이렉트 |
| `@Version(value)` | `/v1/...`과 같은 URI 버전 관리를 적용; 핸들러 레벨 버전은 컨트롤러 레벨 버전을 오버라이드함 |

### 버전 관리 전략

컨트롤러와 핸들러에서의 `@Version()` 사용법은 동일합니다. 활성 전략은 `@konekti/runtime` 부트스트랩 옵션에 의해 선택됩니다.

```typescript
@Version('1')
@Controller('/users')
class UsersController {
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

- `VersioningType.URI` (기본값): `/v1/users`
- `VersioningType.HEADER`: `X-API-Version: 1`과 같이 구성된 요청 헤더에서 버전을 읽음
- `VersioningType.MEDIA_TYPE`: `Accept: application/json;v=1`과 같이 `v=`와 같은 키를 사용하여 `Accept`에서 버전을 추출함
- `VersioningType.CUSTOM`: 사용자 정의 추출 함수 사용

런타임 `versioning` 옵션이 제공되지 않으면 URI 방식이 기본값으로 유지됩니다.

### 매핑된 DTO 헬퍼

Konekti는 일반적인 요청 형태 파생을 위해 메타데이터를 보존하는 매핑된 DTO 헬퍼를 지원합니다.

```typescript
import { IntersectionType, OmitType, PartialType, PickType } from '@konekti/validation';

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

- `PickType()`은 선택된 DTO 필드와 그 메타데이터만 유지합니다.
- `OmitType()`은 선택된 DTO 필드를 제거하고 나머지 메타데이터를 유지합니다.
- `IntersectionType()`은 여러 DTO 베이스의 메타데이터를 하나의 파생 DTO로 합성합니다.
- `PartialType()`은 DTO 형태를 유지하면서 상속된 필드들을 요청 바인딩, 검증 및 경로가 아닌 OpenAPI 필수 시맨틱 기준으로 선택 사항(optional)으로 만듭니다.
- 파생된 DTO는 `RequestDto(...)`, 런타임 바인딩, 검증 및 OpenAPI 생성과 계속 호환됩니다.

`PartialType()`은 단순히 메타데이터를 합성하는 것이 아니라 필드의 선택 가능성 시맨틱을 변경하기 때문에 다른 매핑 헬퍼와는 의도적으로 분리되어 있습니다. 경로 파라미터는 스펙상 필수여야 하므로 생성된 OpenAPI 파라미터에서는 필수 상태로 남습니다.

### DTO 바인딩 데코레이터

| 데코레이터 | 설명 |
|---|---|
| `@FromBody()` | 요청 바디에서 필드 바인딩 (엄격한 허용 목록 적용, 알 수 없는 필드 차단) |
| `@FromPath()` | URL 경로 파라미터에서 필드 바인딩 |
| `@FromQuery()` | 쿼리 스트링에서 필드 바인딩 |
| `@FromHeader()` | 요청 헤더에서 필드 바인딩 |
| `@FromCookie()` | 쿠키에서 필드 바인딩 |
| `@Optional()` | 바인딩을 선택 사항으로 표시 (바인더 레벨) |
| `@Convert()` | global converter 이후, validation 이전에 필드 전용 변환 적용 |

> 검증 데코레이터 (`@IsString`, `@IsEmail` 등)는 이 패키지가 아닌 `@konekti/validation` 패키지에서 제공됩니다.

바인딩은 소스 값의 형태를 명시적으로 유지합니다. 예를 들어, 반복되는 쿼리/헤더 값은 이를 정규화하는 명시적인 변환기를 제공하지 않는 한 배열(단일 요소 배열 포함)로 유지됩니다.

### 요청 변환기 (Request converters)

`@konekti/http`는 이제 요청 시점 변환을 위한 두 가지 seam을 제공합니다.

1. **global converters** — 앱 부트스트랩 시 등록
2. **field-level converters** — `@Convert(...)`로 선언

field-level converter는 항상 **global converter 이후**, 그리고 `@konekti/validation` 검증 **이전**에 실행됩니다.

```typescript
import { Controller, Convert, FromQuery, Get, RequestDto } from '@konekti/http';
import { IsNumber } from '@konekti/validation';

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

@Controller('/search')
class SearchController {
  @Get('/')
  @RequestDto(SearchRequest)
  list(input: SearchRequest) {
    return input;
  }
}
```

global converter는 문자열 trim, query primitive coercion 같은 transport-wide 정규화에 사용하고, `@Convert(...)`는 특정 DTO 필드에만 필요한 변환 규칙에 사용하세요.

### 런타임 헬퍼

| 익스포트(Export) | 위치 | 설명 |
|---|---|---|
| `createHandlerMapping(sources)` | `src/mapping.ts` | `{ controllerToken }`과 같은 핸들러 소스로부터 정규화된 라우팅 테이블 빌드 |
| `createDispatcher(options)` | `src/dispatcher.ts` | 요청 디스패치 함수 생성 |
| `SseResponse` | `src/sse.ts` | `RequestContext`에서 서버 전송 이벤트(SSE) 스트리밍을 위한 헬퍼 |
| `createCorsMiddleware(options)` | `src/cors.ts` | CORS 미들웨어 함수 반환 |
| `createRequestContext()` | `src/request-context.ts` | ALS 기반 컨텍스트 팩토리 |

추가적인 공개 익스포트에는 `All`, `Options`, `Head`, `RequestDto`, `HttpCode`, `UseGuards`, `UseInterceptors`, `Header`, `Redirect`, `Version`, `createCorrelationMiddleware`, `createRateLimitMiddleware`, `createSecurityHeadersMiddleware`, `encodeSseComment`, `encodeSseMessage`, `forRoutes`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `HttpApplicationAdapter`, `createNoopHttpApplicationAdapter`, `PayloadTooLargeException` 등이 포함됩니다.

### 서버 전송 이벤트 (SSE)

핸들러가 HTTP 연결을 열어두고 시간이 지남에 따라 프레임을 스트리밍해야 할 때 `SseResponse`를 사용합니다.

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

- `new SseResponse(ctx)`는 SSE 헤더를 즉시 커밋합니다.
- `send(data, { event, id, retry })`는 표준 SSE 메시지 프레임을 작성합니다.
- `comment(text)`는 주석 프레임을 작성합니다.
- `close()`는 멱등(idempotent)하며 `ctx.request.signal`이 중단될 때도 실행됩니다.
- `encodeSseMessage()`와 `encodeSseComment()`는 테스트 및 커스텀 프레이밍 요구사항을 위해 익스포트됩니다.
- 현재 SSE는 Node 어댑터 또는 `write()`, `end()`, `writableEnded` 및 선택적으로 `flushHeaders()`를 노출하는 커스텀 `FrameworkResponse.raw` 객체가 필요합니다.
- 요청 옵저버는 핸들러가 반환될 때 완료됩니다. SSE 소켓의 전체 수명 동안 열려 있지 않습니다.

### 속도 제한(Rate limiting) 주의사항

`createRateLimitMiddleware()`는 인프로세스 메모리 저장소를 사용합니다. 이는 로컬 개발, 테스트 및 단일 프로세스 배포에는 적합하지만, 클러스터링된 Node 워커나 여러 앱 인스턴스 간에 공유되는 글로벌 제한기는 아닙니다. 인스턴스 간 정책 강제가 필요한 경우 게이트웨이/프록시 레이어에서 제한을 두거나 Konekti 앞에 애플리케이션 레벨의 공유 저장소를 추가하세요.

### 성공 상태 기본값

- `GET`, `PUT`, `PATCH`, `HEAD`의 기본값은 `200`입니다.
- `POST`의 기본값은 `201`입니다.
- `DELETE`와 `OPTIONS`는 핸들러가 `undefined`를 반환하면 `204`, 그렇지 않으면 `200`이 기본값입니다.
- `@HttpCode(code)`는 항상 메서드 기본값보다 우선합니다.
- 디스패처는 인터셉터 체인이 해결된 후 최종 성공 코드를 결정하므로, 인터셉터의 결과 형태 변경은 여전히 기본 상태 결정에 영향을 미칩니다.

### 예외(Exceptions)

| 익스포트(Export) | 상태 코드 |
|---|---|
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `PayloadTooLargeException` | 413 |
| `InternalServerErrorException` | 500 |

## 아키텍처

### 디스패처 실행 순서

```text
들어오는 요청
  → RequestContext 생성
  → 앱 미들웨어
  → 라우트 매칭
  → 모듈 미들웨어
  → 가드 체인 (허용 / 거부)
  → 인터셉터 체인 (전/후 래퍼)
  → 요청 DTO 바인딩 + 변환 (FromBody / FromPath / FromQuery / ...)
→ DTO 검증 (`@konekti/validation` 패키지 경유, 변환 이후)
  → 컨트롤러 메서드 호출(input, ctx)
  → 성공 상태 해결 (@HttpCode 오버라이드 또는 메서드 기본값)
  → 성공 응답 작성
  → catch → 표준 오류 응답 작성
```

### 가드 계약

가드는 의도적으로 작은 계약을 가집니다.

- 요청을 거부하고 기본 `ForbiddenException` / 403 경로를 사용하려면 `false`를 반환합니다.
- 요청 파이프라인을 계속 진행하려면 `true` 또는 `undefined`를 반환합니다.
- 거부 시 더 구체적인 상태나 메시지를 사용해야 하는 경우 HTTP 예외를 던집니다.
- 가드가 직접 결과를 완전히 처리하는 경우(예: 리다이렉트 흐름) 응답을 직접 커밋합니다.

### DTO 바인딩 보안

바인더는 단순한 필드 복사가 아닙니다. 두 가지 정책이 강제됩니다.

1. **`@FromBody`의 엄격한 허용 목록** — DTO에 선언되지 않은 요청 바디의 필드는 `BadRequestException`으로 거부되어 대량 할당(mass-assignment) 공격을 방지합니다.
2. **위험한 키 차단** — `__proto__`, `constructor`, `prototype`과 같은 키는 무조건 거부됩니다.

### 라우팅 테이블 구성

`createHandlerMapping()`은 요청 전에 실행되며 다음과 같은 작업을 수행합니다.
- 컨트롤러 기본 경로와 각 라우트 경로를 결합합니다.
- 중복된 슬래시를 정규화합니다.
- 명명된 경로 파라미터(`:id` → 파라미터 이름)를 추출합니다.
- 중복된 라우트 충돌 시 즉시 실패 처리합니다.

### 요청 컨텍스트 및 ALS

`RequestContext`는 `AsyncLocalStorage`에 저장됩니다. 요청, 응답, `requestId`, (인증 가드에 의해 설정된) 인증된 주체(`principal`), 그리고 요청 스코프의 DI 컨테이너를 포함합니다. 요청 내에서 실행되는 모든 코드는 프롭 드릴링(prop drilling) 없이 컨텍스트에 접근할 수 있습니다.

## 기여자를 위한 파일 읽기 순서

1. `src/types.ts` — `FrameworkRequest`, `FrameworkResponse`, `RequestContext`
2. `src/decorators.ts` — 라우트 및 DTO 바인딩 메타데이터 작성자
3. `src/mapping.ts` — 라우팅 테이블 구축 + 충돌 감지
4. `src/binding.ts` — 요청 부분으로부터 DTO 인스턴스화
5. `src/dto-validation-adapter.ts` — DTO 검증 어댑터
6. `src/request-context.ts` — ALS 기반 컨텍스트
7. `src/dispatcher.ts` — 실행 체인 시퀀싱
8. `src/exceptions.ts` — HTTP 예외 패밀리 + 오류 엔벨로프
9. `src/binding.test.ts` — 바인딩 정책 (허용 목록, 위험한 키, 400 상세 형태)
10. `src/dispatcher.test.ts` — 미들웨어/가드/인터셉터 순서, 표준 오류 코드

## 관련 패키지

- `@konekti/core` — 라우트 및 DTO 메타데이터가 저장되는 곳
- `@konekti/validation` 패키지 — DTO 검증 단계에서 사용되는 검증 엔진
- `@konekti/runtime` — 부트스트랩 중 라우팅 테이블과 디스패처를 조립함
- `@konekti/passport` — 가드 체인에 연결되는 인증 가드

## 한 줄 멘탈 모델

```text
@konekti/http = 라우트 메타데이터 → DTO 바인딩 → 미들웨어/가드/인터셉터 체인 → 핸들러 호출
```
