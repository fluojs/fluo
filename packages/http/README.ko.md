# @fluojs/http

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

라우트 메타데이터를 DTO 바인딩, 검증, 가드, 인터셉터, 응답 작성으로 이어지는 요청 파이프라인으로 바꾸는 HTTP 실행 레이어입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [요청 정리와 런타임 이식성](#요청-정리와-런타임-이식성)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/http
```

## 사용 시점

- `@Controller`, `@Get`, `@Post` 같은 데코레이터로 REST 스타일 엔드포인트를 선언할 때
- `@FromBody`, `@FromPath`, `@FromQuery`로 요청 데이터를 DTO에 바인딩할 때
- 가드, 인터셉터, 미들웨어를 예측 가능한 요청 라이프사이클에 얹고 싶을 때
- 현재 요청을 `RequestContext`로 깊은 호출 스택에서 접근하고 싶을 때

## 빠른 시작

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

### 라우트 경로 계약

`@Controller()`, `@Get()`, `@Post()` 같은 HTTP 라우트 데코레이터는 다음만 허용합니다.

- `/users`, `/healthz` 같은 literal 세그먼트
- `/:id`, `/users/:userId/posts/:postId` 같은 full-segment path param

트레일링 슬래시와 중복 슬래시는 라우트 매핑 단계에서 정규화되므로 `//users///:id/`는 `/users/:id`로 해석됩니다.

라우트 데코레이터는 `*`, `?`, `/(.*)`, `user-:id`, `:id.json` 같은 wildcard, regex 유사 문법, mixed segment를 지원하지 않습니다. 와일드카드 매칭은 계속 `forRoutes('/users/*')` 같은 미들웨어 설정에서만 지원됩니다.

## 주요 패턴

### 가드와 인터셉터

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

### 비동기 요청 컨텍스트

```ts
import { getCurrentRequestContext } from '@fluojs/http';

function someDeepHelper() {
  const ctx = getCurrentRequestContext();
  console.log(ctx?.requestId);
}
```

### 프록시 뒤의 속도 제한

`createRateLimitMiddleware(...)`는 기본적으로 raw socket `remoteAddress`만으로 클라이언트 식별자를 해석합니다. `Forwarded`, `X-Forwarded-For`, `X-Real-IP`를 신뢰하려면 해당 헤더를 신뢰 가능한 프록시가 덮어쓰는 환경에서만 `trustProxyHeaders: true`를 명시적으로 켜세요. 어댑터가 신뢰 가능한 프록시 체인도 raw socket 식별자도 제공하지 않는다면 공유 fallback 버킷에 의존하지 말고 명시적인 `keyResolver`를 설정하세요.

### 서버 전송 이벤트

```ts
import { Get, SseResponse, type RequestContext } from '@fluojs/http';

@Get('/events')
stream(_input: undefined, ctx: RequestContext) {
  const sse = new SseResponse(ctx);
  sse.send({ message: 'hello' });
  return sse;
}
```

### Versioning

`createHandlerMapping(...)`은 `VersioningType`과 `versioning` option을 통해 URI, header, media-type, custom versioning strategy를 지원합니다. Route registration은 exact/static match를 fallback보다 앞에 두고, 동등하게 정규화된 route는 registration order를 보존합니다.

### Request context helper

Framework integration이 명시적인 request context boundary나 typed per-request storage가 필요할 때 `runWithRequestContext(...)`, `assertRequestContext()`, `createRequestContext(...)`, `createContextKey(...)`, `getContextValue(...)`, `setContextValue(...)`를 사용합니다.

### Fast-path observability

Dispatcher는 adapter와 diagnostics를 위해 `FAST_PATH_ELIGIBILITY_SYMBOL`, `FAST_PATH_STATS_SYMBOL`, `formatFastPathStats(...)`, `getDispatcherFastPathStats(...)`로 fast-path observability를 노출합니다.

### Bun decorator bundling compatibility

Fluo의 HTTP 데코레이터는 TC39 표준 데코레이터이며, runtime 또는 compiler가 표준 decorator context를 제공하면 계속 `context.metadata`를 통해 metadata를 기록합니다. Bun이 legacy TypeScript decorator transform으로 애플리케이션을 번들링하는 경우에도 controller, route, DTO binding, guard/interceptor, header, redirect, versioning, status, request DTO, `@Produces(...)` metadata를 Fluo 내부 metadata store에 기록하여 생성된 Bun bundle의 route mapping 동작을 보존합니다.

이 호환 경로는 Bun bundle output을 위한 실행 fallback입니다. 애플리케이션 소스는 계속 Fluo 표준 데코레이터를 사용해야 하며, `emitDecoratorMetadata`를 켜거나 `reflect-metadata`에 의존해서는 안 됩니다.

## 요청 정리와 런타임 이식성

디스패처는 활성 dispatch 동안에만 `AsyncLocalStorage`로 `RequestContext`를 바인딩합니다. 요청이 controller graph, middleware, guard, interceptor, observer, DTO converter, custom binder 또는 수동 `getCurrentRequestContext()` / `assertRequestContext()` container 접근을 통해 request-scoped DI를 사용할 수 있으면, 디스패처는 요청 observer가 끝난 뒤 `finally` 경로에서 isolated request-scoped DI 컨테이너를 생성하고 dispose합니다. Singleton-only route는 `RequestContext.container`가 접근되기 전까지 이 컨테이너 lifecycle을 건너뛰어 baseline 경로의 불필요한 per-request allocation을 피하면서도, graph가 모호하거나 request-scoped이면 request-scoped provider isolation을 유지합니다. 따라서 공개 `RequestContext.container` 읽기는 request-scoped provider resolve에 항상 안전합니다. singleton-only fast path는 내부 dispatcher 최적화일 뿐, 공개 context가 root container를 노출한다는 약속이 아닙니다.

어댑터는 플랫폼이 제공한다면 `FrameworkRequest.signal`에 `AbortSignal`을 전달해야 합니다. SSE에서는 가능하면 `FrameworkResponse.stream.onClose(...)`도 노출해야 합니다. `SseResponse`는 request abort와 raw stream close를 모두 구독하고, 멱등하게 닫히며, 어느 쪽이 먼저 종료되더라도 등록한 listener를 제거합니다.

## 공개 API

- **라우팅 데코레이터**: `Controller`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `All`, `Options`, `Head`
- **바인딩 데코레이터**: `FromBody`, `FromQuery`, `FromPath`, `FromHeader`, `FromCookie`, `RequestDto`, `Optional`, `Convert`
- **실행 데코레이터**: `UseGuards`, `UseInterceptors`, `HttpCode`, `Version`, `Header`, `Redirect`, `Produces`
- **핵심 런타임 타입**: `RequestContext`, `FrameworkRequest`, `FrameworkResponse`, `SseResponse`
- **Adapter API**: `HttpApplicationAdapter`, `createNoopHttpApplicationAdapter`, `createServerBackedHttpAdapterRealtimeCapability`, `createUnsupportedHttpAdapterRealtimeCapability`, `createFetchStyleHttpAdapterRealtimeCapability`
- **예외와 오류**: `HttpException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `NotAcceptableException`, `TooManyRequestsException`, `InternalServerErrorException`, `PayloadTooLargeException`, `createErrorResponse`, `RouteConflictError`, `InvalidRoutePathError`, `HandlerNotFoundError`, `RequestAbortedError`
- **헬퍼**: `createHandlerMapping`, `createDispatcher`, `forRoutes`, `normalizeRoutePattern`, `matchRoutePattern`, `isMiddlewareRouteConfig`, `createCorrelationMiddleware`, `createCorsMiddleware`, `createRateLimitMiddleware`, `createSecurityHeadersMiddleware`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `createRequestContext`, `createContextKey`, `getContextValue`, `setContextValue`, `encodeSseComment`, `encodeSseMessage`
- **Option type**: `CorsOptions`, `RateLimitOptions`, `RateLimitStore`, `SecurityHeadersOptions`, `SseSendOptions`

## 내부 서브경로 (`@fluojs/http/internal`)

`./internal` 서브경로는 플랫폼 어댑터와 핵심 런타임에서 사용하는 저수준 유틸리티만 내보냅니다. 이들은 변경될 수 있으며 일반적인 애플리케이션 코드에서 사용해서는 안 됩니다.

- `DefaultBinder`: 런타임 부트스트랩 경로에서 사용하는 기본 DTO/요청 바인더.
- `bindRawRequestNativeRouteHandoff(...)` / `attachFrameworkRequestNativeRouteHandoff(...)`: public dispatcher API를 넓히지 않고 의미 보존이 가능한 native route match를 재사용하기 위한 내부 adapter/runtime 헬퍼.
- `consumeRawRequestNativeRouteHandoff(...)` / `readFrameworkRequestNativeRouteHandoff(...)`: native route handoff를 읽거나 소비하기 위한 내부 helper.
- Native route handoff는 framework request에 붙는 시점의 method와 path를 함께 스냅샷합니다. app middleware가 handler matching 전에 둘 중 하나를 rewrite하면 dispatcher는 stale handoff를 무시하고 일반 route matching으로 fallback합니다.
- `isRoutePathNormalizationSensitive(path)`: duplicate slash와 trailing slash 요청을 generic dispatcher 경로에 남기기 위한 내부 guard.
- `resolveClientIdentity(request)`: 속도 제한과 런타임 통합에서 사용하는 보수적 클라이언트 식별 해석기.
- `createFetchStyleHttpAdapterRealtimeCapability(...)`, `Dispatcher`, `HttpApplicationAdapter`: 전체 HTTP root barrel을 instantiate하면 안 되는 edge/fetch-style platform package를 위한 내부 adapter seam.

## 관련 패키지

- `@fluojs/core`: 컨트롤러, 라우트, DTO 메타데이터를 저장합니다.
- `@fluojs/validation`: HTTP 바인딩 이후 DTO를 검증합니다.
- `@fluojs/runtime`: 부트스트랩 중 디스패처를 조립합니다.
- `@fluojs/passport`: 같은 가드 체인 안에서 인증을 연결합니다.

## 예제 소스

- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/auth.controller.ts`
- `packages/http/src/dispatch/dispatcher.test.ts`
