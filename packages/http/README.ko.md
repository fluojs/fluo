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

`runWithRequestContext(...)`는 호스트가 `globalThis.AsyncLocalStorage` 또는 Node 내장 `node:async_hooks` 모듈로 `AsyncLocalStorage`를 제공할 때 활성 컨텍스트를 `await` 이후까지 보존합니다. 선언된 `>=20.0.0` 지원 범위의 Node 런타임은 `process.getBuiltinModule(...)`이 없어도 `node:async_hooks`를 동적으로 해석해 ALS 의미론을 유지합니다. 비동기 컨텍스트 primitive가 없는 비 Node 호스트에서는 동기 stack fallback을 사용하며, 겹치는 비동기 요청이 서로의 컨텍스트를 관찰하지 않도록 awaited continuation이 재개되기 전에 컨텍스트를 비웁니다.

### 프록시 뒤의 속도 제한

`createRateLimitMiddleware(...)`는 기본적으로 raw socket `remoteAddress`만으로 클라이언트 식별자를 해석합니다. `Forwarded`, `X-Forwarded-For`, `X-Real-IP`를 신뢰하려면 해당 헤더를 신뢰 가능한 프록시가 덮어쓰는 환경에서만 `trustProxyHeaders: true`를 명시적으로 켜세요. 어댑터가 신뢰 가능한 프록시 체인도 raw socket 식별자도 제공하지 않는다면 공유 fallback 버킷에 의존하지 말고 명시적인 `keyResolver`를 설정하세요.

### 서버 전송 이벤트

```ts
import { Controller, Sse, type SseMessage } from '@fluojs/http';

@Controller('/orders')
export class OrdersEventsController {
  @Sse('/events')
  async *stream(): AsyncIterable<SseMessage<{ status: string }> | { heartbeat: true }> {
    yield { data: { status: 'connected' }, event: 'ready', id: 'orders-ready' };

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      yield { heartbeat: true };
    }
  }
}
```

`@Sse(path)`는 `GET` 라우트를 등록하고 `text/event-stream` produced media type metadata를 선언합니다. Handler는 수동 stream 제어가 필요하면 `SseResponse`를 반환할 수 있고, managed streaming이 필요하면 `AsyncIterable<SseMessage<T> | T>`를 반환할 수 있습니다. Managed async iterable은 `SseResponse`와 같은 `encodeSseMessage(...)` 동작으로 변환됩니다. 일반 yield 값은 `data:` frame이 되고, `data` 필드가 있는 객체는 `event`, `id`, `retry`도 함께 제공할 수 있습니다. Dispatcher는 `RequestContext.request.signal`이 abort되거나 response stream이 닫히면 source 소비를 중단하고, write가 backpressure를 보고하면 `FrameworkResponseStream.waitForDrain()`을 기다리며, 완료 또는 source error 시 stream을 닫고, source에서 던진 오류는 이미 commit된 SSE response를 닫은 뒤 일반 dispatcher error/observer seam으로 전달합니다. Observable 값은 계속 범위 밖이며 RxJS dependency는 필요하지 않습니다.

브라우저 쪽에서는 해당 연결을 소유하는 React effect 안에서 `EventSource`를 만들고 cleanup 함수에서 항상 닫아야 합니다. 그래야 route 변경, Strict Mode remount, component unmount가 중복 stream을 남기지 않습니다.

```tsx
import { useEffect, useState } from 'react';

export function OrderEvents({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    const source = new EventSource(`/orders/events?orderId=${encodeURIComponent(orderId)}`, {
      withCredentials: true,
    });

    source.addEventListener('ready', (event) => {
      setEvents((current) => [...current, event.data]);
    });

    source.onerror = () => {
      // 서버가 terminal status로 닫지 않는 한 브라우저가 자동으로 재연결합니다.
      console.warn('Order event stream disconnected; waiting for browser retry.');
    };

    return () => {
      source.close();
    };
  }, [orderId]);

  return <output>{events.join('\n')}</output>;
}
```

브라우저 `EventSource`는 호출자가 임의의 `Authorization` 헤더를 붙일 수 없습니다. SSE 엔드포인트는 same-origin cookie, `withCredentials`와 명시적인 CORS credentials 정책, 또는 guard가 검증하는 짧은 수명의 signed URL/query token으로 인증하세요. 내장 `EventSource` API가 아니라 fetch 기반 custom SSE client를 쓰는 경우가 아니라면 bearer header 브라우저 예제를 문서화하지 마세요.

운영 환경에서는 SSE 연결을 buffering 없이 오래 유지해야 합니다. 신뢰한 origin에 대해서만 CORS credentials를 허용하고, proxy buffering과 response transform을 비활성화하며(`SseResponse`는 `Cache-Control: no-cache, no-transform` 및 `X-Accel-Buffering: no`를 설정합니다), `text/event-stream`을 buffering하는 compression middleware를 피하고, load balancer 또는 platform idle timeout을 heartbeat interval보다 길게 두고, `sse.comment('heartbeat')` 같은 comment heartbeat를 보내며, 클라이언트가 재연결 후 replay가 필요할 때 `Last-Event-ID`를 처리할 수 있도록 충분한 event history를 보존하세요.

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

디스패처는 활성 dispatch 동안에만 호스트 비동기 컨텍스트 저장소로 `RequestContext`를 바인딩합니다. 지원되는 Node 20+ 런타임을 포함해 `AsyncLocalStorage`가 있는 호스트에서는 컨텍스트가 awaited work 이후까지 유지됩니다. 비동기 컨텍스트 primitive가 없는 비 Node 호스트에서는 fallback 컨텍스트가 동기 프레임에만 유효하고, 겹치는 요청이 서로의 컨텍스트를 관찰하지 않도록 `await` 이후에는 의도적으로 사용할 수 없습니다. 요청이 controller graph, middleware, guard, interceptor, observer, DTO converter, custom binder 또는 수동 `getCurrentRequestContext()` / `assertRequestContext()` container 접근을 통해 request-scoped DI를 사용할 수 있으면, 디스패처는 요청 observer가 끝난 뒤 `finally` 경로에서 isolated request-scoped DI 컨테이너를 생성하고 dispose합니다. Singleton-only route는 `RequestContext.container`가 접근되기 전까지 이 컨테이너 lifecycle을 건너뛰어 baseline 경로의 불필요한 per-request allocation을 피하면서도, graph가 모호하거나 request-scoped이면 request-scoped provider isolation을 유지합니다. 따라서 공개 `RequestContext.container` 읽기는 request-scoped provider resolve에 항상 안전합니다. singleton-only fast path는 내부 dispatcher 최적화일 뿐, 공개 context가 root container를 노출한다는 약속이 아닙니다.

어댑터는 플랫폼이 제공한다면 `FrameworkRequest.signal`에 `AbortSignal`을 전달해야 합니다. SSE에서는 가능하면 `FrameworkResponse.stream.onClose(...)`도 노출해야 합니다. `SseResponse`는 request abort와 raw stream close를 모두 구독하고, 멱등하게 닫히며, 어느 쪽이 먼저 종료되더라도 등록한 listener를 제거합니다.

## 공개 API

- **라우팅 데코레이터**: `Controller`, `Get`, `Sse`, `Post`, `Put`, `Patch`, `Delete`, `All`, `Options`, `Head`
- **바인딩 데코레이터**: `FromBody`, `FromQuery`, `FromPath`, `FromHeader`, `FromCookie`, `RequestDto`, `Optional`, `Convert`
- **실행 데코레이터**: `UseGuards`, `UseInterceptors`, `HttpCode`, `Version`, `Header`, `Redirect`, `Produces`
- **핵심 런타임 타입**: `RequestContext`, `FrameworkRequest`, `FrameworkResponse`, `SseResponse`, `SseMessage`, `Middleware`, `MiddlewareContext`, `MiddlewareRouteConfig`, `Next`, `Guard`, `GuardContext`, `Interceptor`, `InterceptorContext`, `CallHandler`, `RequestObserver`, `DispatcherLogger`
- **Adapter API**: `HttpApplicationAdapter`, `createNoopHttpApplicationAdapter`, `createServerBackedHttpAdapterRealtimeCapability`, `createUnsupportedHttpAdapterRealtimeCapability`, `createFetchStyleHttpAdapterRealtimeCapability`
- **예외와 오류**: `HttpException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `NotAcceptableException`, `TooManyRequestsException`, `InternalServerErrorException`, `PayloadTooLargeException`, `createErrorResponse`, `RouteConflictError`, `InvalidRoutePathError`, `HandlerNotFoundError`, `RequestAbortedError`
- **헬퍼**: `createHandlerMapping`, `createDispatcher`, `forRoutes`, `normalizeRoutePattern`, `matchRoutePattern`, `isMiddlewareRouteConfig`, `createCorrelationMiddleware`, `createCorsMiddleware`, `createRateLimitMiddleware`, `createMemoryRateLimitStore`, `createSecurityHeadersMiddleware`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `createRequestContext`, `createContextKey`, `getContextValue`, `setContextValue`, `encodeSseComment`, `encodeSseMessage`, `isSseMessage`
- **Option 및 store type**: `CorsOptions`, `RateLimitOptions`, `RateLimitStore`, `RateLimitStoreEntry`, `SecurityHeadersOptions`, `SseSendOptions`

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
