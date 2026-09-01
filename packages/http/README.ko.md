# @fluojs/http

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

라우트 메타데이터를 DTO 바인딩, 검증, 가드, 인터셉터, 응답 작성으로 이어지는 요청 파이프라인으로 바꾸는 HTTP 실행 레이어입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [응답 쿠키](#응답-쿠키)
- [Early Hints](#early-hints)
- [Realtime Adapter Capabilities](#realtime-adapter-capabilities)
- [HTTP Error Representations](#http-error-representations)
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

class FindUserParamsDto {
  @FromPath('id')
  id!: string;
}

@Controller('/users')
export class UserController {
  @Post('/')
  @RequestDto(CreateUserDto)
  create(input: CreateUserDto) {
    return { id: '1', name: input.name };
  }

  @Get('/:id')
  @RequestDto(FindUserParamsDto)
  getById(input: FindUserParamsDto) {
    return { id: input.id, name: 'John Doe' };
  }
}
```

### 라우트 경로 계약

`@Controller()`, `@Get()`, `@Post()` 같은 HTTP 라우트 데코레이터는 다음만 허용합니다.

- `/users`, `/healthz` 같은 literal 세그먼트
- `/:id`, `/users/:userId/posts/:postId` 같은 full-segment path param

트레일링 슬래시와 중복 슬래시는 라우트 매핑 단계에서 정규화되므로 `//users///:id/`는 `/users/:id`로 해석됩니다.

라우트 데코레이터는 `*`, `?`, `/(.*)`, `user-:id`, `:id.json` 같은 wildcard, regex 유사 문법, mixed segment를 지원하지 않습니다. 와일드카드 매칭은 계속 `forRoutes('/users/*')` 같은 미들웨어 설정에서만 지원됩니다.

Catch-all route grammar는 의도적으로 도입이 유예된 상태입니다.
[HTTP catch-all route grammar 결정](../../docs/architecture/http-catch-all-route-grammar.ko.md)은 검토한
syntax, provisional precedence 및 params shape, OpenAPI 제한, adapter native fast-path 제약, 이 HTTP
contract를 재검토하기 전에 필요한 evidence를 기록합니다. 해당 문서의 syntax는 현재 활성 route behavior가
아닙니다.

### Custom HTTP method 계약

RFC `QUERY`에는 `@Query(path)`를 사용하고, `PURGE` 또는 WebDAV `PROPFIND` 같은 다른 HTTP extension method에는 `@Route(method, path)`를 사용합니다.

```ts
import { Controller, Query, Route } from '@fluojs/http';

@Controller('/operations')
export class OperationsController {
  @Query('/search')
  search() {
    return { method: 'QUERY' };
  }

  @Route('purge', '/cache')
  purgeCache() {
    return { method: 'PURGE' };
  }
}
```

`@Route(...)`는 비어 있지 않은 HTTP token을 받고 metadata 등록 전에 uppercase로 canonicalize하며, whitespace, separator, control character, non-ASCII token character가 들어오면 `InvalidHttpMethodError`로 거부합니다. `ALL`은 framework-owned `@All(...)` wildcard 전용이므로 `@Route(...)`에서 거부됩니다. Custom method를 포함한 method-specific route는 `@All(...)`보다 먼저 매칭되고 duplicate detection과 route versioning에 참여하며, 일반 DTO binding, validation, guard, interceptor, response pipeline을 그대로 사용합니다. Status metadata가 별도로 지정되지 않으면 성공한 `QUERY` 및 extension-method handler는 `200`을 기본값으로 사용합니다.

Adapter wire support는 명시적인 portability contract입니다. 지원되는 Node listener, Fastify와 Express wildcard fallback, Bun, Deno, Cloudflare Workers fetch dispatch는 `QUERY`와 대표 extension method를 일반 method로 바꾸지 않고 실행합니다. Custom method는 Bun native `routes` 가속 대상에서 제외되며, Fastify는 wildcard fallback이 해당 요청을 받을 수 있도록 method 이름만 등록합니다. 두 경로 모두 native fluo route handoff를 만들지 않습니다. `CONNECT`는 일반 controller-route conformance 범위 밖에 남습니다.

Custom runtime method가 자동으로 OpenAPI Path Item operation이 되는 것은 아닙니다. `@fluojs/openapi`는 계속 문서화된 standard operation method만 받으므로 custom-method descriptor를 OpenAPI input에서 제외하거나 application-owned extension으로 해당 endpoint를 문서화해야 합니다.

### 이식 가능한 헤더 helper

미들웨어, versioning, DTO binding, controller 코드가 adapter가 넘긴 `string | string[] | undefined`
header 값을 납작하게 만들지 않으면서 case-insensitive lookup을 해야 하면
`getRequestHeader(request, name)`를 사용하세요.

응답 negotiation이나 cache 로직이 case variant를 중복하지 않고 `Vary` 필드를 추가해야 하거나,
comma list를 매번 수동으로 파싱하고 싶지 않거나, 기존 `Vary: *` contract를 실수로 확장하면 안
될 때는 `appendVaryHeader(response, ...fields)`를 사용하세요.

Adapter가 제공한 응답 header를 같은 방식으로 case-insensitive lookup하려면
`getResponseHeader(response, name)`와 `hasResponseHeader(response, name)`를 사용하세요. 두 helper는
원래의 `string | string[]` shape을 보존하고 header, body, status, commit state를 쓰지 않습니다.

`attachment` 또는 `inline` Content-Disposition field value는
`buildContentDisposition(disposition, filename)`으로 만드세요. 이 helper는 escape한 printable-ASCII
`filename` fallback과 deterministic RFC 8187 UTF-8 `filename*` 값을 함께 만들고, carriage return 또는
line feed가 있는 filename은 header value를 반환하기 전에 reject합니다.

```ts
import {
  appendVaryHeader,
  buildContentDisposition,
  getRequestHeader,
  getResponseHeader,
  hasResponseHeader,
  type RequestContext,
} from '@fluojs/http';

export function readLanguage(context: RequestContext): string | undefined {
  const acceptLanguage = getRequestHeader(context.request, 'accept-language');
  return Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
}

export function markLanguageVariance(context: RequestContext): void {
  appendVaryHeader(context.response, 'Accept-Language', 'Origin');
  context.response.setHeader(
    'Content-Disposition',
    buildContentDisposition('attachment', 'résumé.pdf'),
  );
}

export function readResponseEtag(
  context: RequestContext,
): string | string[] | undefined {
  return getResponseHeader(context.response, 'etag');
}

export function shouldSetResponseEtag(context: RequestContext): boolean {
  return !hasResponseHeader(context.response, 'etag');
}
```

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

### Request observer

`onRequestSuccess`는 매칭된 handler와 모든 module-level 및 application-level middleware가 완전히 settle된 뒤에만 호출되며, 여기에는 `await next()` 이후의 작업도 포함됩니다. Middleware가 `next()` 반환 뒤 예외를 던지면 observer는 앞선 success 알림 없이 `onRequestError`를 받습니다. `onRequestFinish`는 어느 outcome에서든 그 뒤에 호출됩니다.

### 비동기 요청 컨텍스트

```ts
import { getCurrentRequestContext } from '@fluojs/http';

function someDeepHelper() {
  const ctx = getCurrentRequestContext();
  console.log(ctx?.requestId);
}
```

`runWithRequestContext(...)`는 호스트가 `globalThis.AsyncLocalStorage` 또는 `node:async_hooks` 모듈로 `AsyncLocalStorage`를 제공할 때 활성 컨텍스트를 `await` 이후까지 보존합니다. 루트 `@fluojs/http` export는 async-context storage를 probe하거나 instantiate하지 않고 runtime-specific entrypoint를 선택합니다. Node와 Bun은 module initialization 중 host constructor를 등록하고, Deno, worker, browser, default entry는 Node built-in import 없이 유지됩니다. Request-local store 자체는 첫 사용 시점에 계속 lazy하게 생성됩니다. Promise를 반환하는 non-async callback은 동기 호출, 반환, throw 동작을 유지하고, 반환한 promise가 settle될 때까지 continuation에서 바인딩된 context를 보존합니다. Helper는 `Promise.prototype.then`을 교체하지 않으므로 관련 없는 promise continuation이 request를 capture하지 않습니다. 비동기 컨텍스트 primitive가 없는 호스트는 awaited work가 재개되기 전에 context를 지우는 synchronous-only fallback을 사용합니다.

## 응답 쿠키

adapter 고유 응답 API 대신 이식 가능한 `setCookie()`와 `clearCookie()` helper를 사용하세요. 각 호출은 독립적인 `Set-Cookie` field 하나를 작성하므로, 반복 호출은 순서를 보존하며 comma-folding되지 않습니다.

```ts
import { clearCookie, setCookie } from '@fluojs/http';

setCookie(context.response, 'session', sessionToken, {
  httpOnly: true,
  maxAgeSeconds: 60 * 60,
  path: '/',
  sameSite: 'lax',
  secure: true,
});

clearCookie(context.response, 'session', {
  path: '/',
});
```

`maxAgeSeconds`는 모든 adapter에서 음수가 아닌 정수 초 단위 lifetime입니다. 값은 percent-encoding되고, 이름과 attribute는 응답이 변경되기 전에 검증되며, `sameSite: 'none'`에는 `secure: true`가 필요합니다. 같은 browser cookie를 삭제하려면 기존 `path`와 `domain`을 반복해야 합니다. `httpOnly`, `secure`, `sameSite`는 browser matching key가 아니라 policy attribute입니다.

## Early Hints

`FrameworkResponse.earlyHints`는 HTTP `103` informational response를 위한 optional request-scoped capability입니다. 사용 전에 property 존재 여부를 확인하세요. Property가 없으면 active adapter가 Early Hints를 emit할 수 없다는 뜻입니다. 필수 `FrameworkResponse.writeEarlyHints()` method는 없으며 unsupported adapter가 write를 조용히 무시하지도 않습니다.

```ts
import type { RequestContext } from '@fluojs/http';

async function render(_input: undefined, context: RequestContext) {
  const earlyHints = context.response.earlyHints;

  if (earlyHints) {
    await earlyHints.write({
      link: [
        '</styles.css>; rel=preload; as=style',
        '</app.js>; rel=modulepreload',
      ],
      'x-trace-id': 'render-1',
    });
  }

  context.response.setHeader('link', '</final.css>; rel=stylesheet');
  return { ok: true };
}
```

각 `write(...)`는 하나의 `103`을 emit하므로 final response 전에 여러 write를 순서대로 await할 수 있습니다. 모든 write에는 비어 있지 않은 `link` value가 하나 이상 필요하며 유효한 HTTP name과 value를 사용하는 추가 informational field를 포함할 수 있습니다. Header name은 대소문자를 구분하지 않으며 casing만 다른 이름을 중복해서 사용할 수 없습니다. Status상 금지된 framing field(`content-length`, `transfer-encoding`)는 native write 전에 reject됩니다. Early field는 `response.headers`를 채우거나 status를 바꾸거나 `committed`를 설정하지 않으며 final-response header로 복사되지도 않습니다.

Node.js, Express, Fastify는 이 capability를 노출합니다. Fetch-style Web, Bun, Deno, Cloudflare Workers response는 해당 `Response` API로 final response 이전 informational response를 표현할 수 없으므로 capability를 생략합니다. Final commit 이후 write 또는 native validation/write 실패는 `EarlyHintsWriteError`(`EARLY_HINTS_WRITE_FAILED`)로 reject되고, settlement 전에 연결이 끊기면 `RequestAbortedError`(`REQUEST_ABORTED`)로 reject됩니다.

## Realtime Adapter Capabilities

`HttpApplicationAdapter.getRealtimeCapability()`는 platform이 realtime protocol integration에서 server-backed, fetch-style, unsupported 중 무엇인지 보고합니다. Fetch-style capability는 version 1을 유지합니다. Host는 stable capability discriminator를 바꾸지 않으면서 first-party realtime package가 adapter `listen()` 전에 binding을 설치할 수 있도록 별도로 versioned된 optional `bindingInstallation` extension을 노출할 수 있습니다.

`createFetchStyleHttpAdapterRealtimeCapability(reason, options)`는 항상 source-compatible version 1 capability를 반환합니다. Installer를 제공하면 반환값에 `bindingInstallation`도 포함됩니다. Installer는 protocol-owned binding 또는 pre-listen cleanup을 위한 `undefined`를 받으며 platform adapter는 이 boundary를 host-specific binding type으로 parse할 책임이 있습니다. Managed adapter가 live 상태가 된 뒤에는 최종 binding cleanup을 adapter `close()` boundary가 소유합니다. Application code는 일반적으로 이 low-level adapter capability를 직접 호출하지 말고 `@fluojs/websockets` 또는 `@fluojs/socket.io` module을 등록해야 합니다.

## HTTP Error Representations

Canonical JSON이 default error response로 유지된다. Browser request에 API client 동작을 바꾸지 않고 complete
error/not-found document를 제공하려면 runtime bootstrap에 optional application-owned HTML provider를 등록한다.

```ts
import type { HttpErrorRepresentationOptions } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const errorRepresentation = {
  html: {
    canRender({ request }) {
      return request.method === 'GET' || request.method === 'HEAD';
    },
    render({ json }) {
      return `<!doctype html><main>${json.error.status}: ${escapeHtml(json.error.message)}</main>`;
    },
  },
} satisfies HttpErrorRepresentationOptions;

const app = await bootstrapApplication({
  errorRepresentation,
  rootModule: AppModule,
});
```

HTTP가 representation selection 전에 outcome을 분류한다. Route miss는 기존 404 outcome이 되고 middleware,
DTO binding/validation, guard, interceptor, handler의 uncommitted `HttpException`은 같은 seam을 사용한다.
Provider는 classified exception, canonical `ErrorResponse`, request, optional matched handler, request id, active
request-scope container를 받는다. `FrameworkResponse`는 받지 않으므로 status, header, `HEAD`, abort, commit
ownership은 dispatcher에 남는다.

Provider return value는 application이 책임지는 trusted HTML이다. fluo는 이를 escape하거나 sanitize하지 않는다.
예제의 `json.error.message`처럼 request-derived 또는 error-derived value를 interpolation 전에 모두 HTML escape하거나,
text-node contract가 해당 escape를 수행하는 rendering framework를 사용해야 한다.

`Accept` negotiation은 deterministic하다. `Accept`가 없거나 wildcard/tie이면 JSON을 선택하고 quality와
specificity가 `application/json`과 available `text/html` 사이를 선택하며 unsupported range는 canonical JSON
406을 만든다. `canRender(...)`로 application 또는 matched handler별 HTML availability를 제한할 수 있다.
Provider failure는 원래 canonical JSON outcome으로 한 번만 fallback하며 committed 또는 aborted request는
다시 쓰지 않는다. Response writer `send(...)` 또는 stream/write failure는 그대로 propagate하며 두 번째 canonical
JSON write를 시작하지 않는다. HTTP가 `Accept`를 추가할 때 기존 native `Vary` 값도 보존한다. Successful-route
`@Produces(...)` metadata는 error representation을 제어하지 않는다. 전체 phase/fallback 계약은
[HTTP error representation decision](../../docs/architecture/http-error-representations.ko.md)을 참고한다.

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

`@Sse(path)`는 `GET` 라우트를 등록하고 `text/event-stream` produced media type metadata를 선언합니다. Handler는 수동 stream 제어가 필요하면 `SseResponse`를 반환할 수 있고, managed streaming이 필요하면 `AsyncIterable<SseMessage<T> | T>`를 반환할 수 있습니다. Managed async iterable은 `SseResponse`와 같은 `encodeSseMessage(...)` 동작으로 변환됩니다. 일반 yield 값은 `data:` frame이 되고, `data` 필드가 있는 객체는 `event`, `id`, `retry`도 함께 제공할 수 있습니다. Dispatcher는 `RequestContext.request.signal`이 abort되거나 response stream이 닫히면 source 소비를 중단하고, write가 backpressure를 보고하면 `FrameworkResponseStream.waitForDrain()`을 기다리며, 완료 또는 source error 시 stream을 닫습니다. 같은 cancellation boundary가 진행 중인 `waitForDrain()`도 제한합니다. Request abort 또는 stream close는 settle되지 않은 drain promise보다 먼저 완료되고, 이후 dispatcher는 source iterator를 정확히 한 번 닫은 다음 request-scope disposal을 계속합니다. Stream write failure와 reject된 drain promise는 원래 error를 그대로 전파합니다. 취소 시에는 response stream을 즉시 닫고 request-scoped resource를 dispose하기 전에 source iterator의 `return()` cleanup을 기다립니다. Cleanup 실패는 이미 commit된 SSE response를 대체하지 않고 request observer와 dispatcher logger seam으로 보고됩니다. Source에서 던진 오류도 같은 committed-response error/observer 경계를 따릅니다. Observable 값은 계속 범위 밖이며 RxJS dependency는 필요하지 않습니다.

Managed SSE는 `FrameworkResponse.stream`을 노출하는 adapter가 필요합니다. 활성 adapter가 response stream을 제공하지 않으면 dispatcher는 response를 처리된 것으로 표시하기 전에 managed async iterable을 거부하고, stream이 처리된 것으로 조용히 보고하는 대신 표준 dispatch error 경로(request error observer와 구성된 error response writer)를 통해 실패를 전달합니다.

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

Dispatcher는 adapter와 diagnostics를 위해 `FAST_PATH_ELIGIBILITY_SYMBOL`, `FAST_PATH_STATS_SYMBOL`, `formatFastPathStats(...)`, `getDispatcherFastPathStats(...)`로 fast-path observability를 노출합니다. Eligibility 결정은 shared `HandlerMapping`이 아니라 dispatcher instance에 속합니다. 따라서 여러 dispatcher가 서로 다른 middleware, observer, interceptor, binder, adapter option으로 하나의 mapping을 재사용해도 서로의 결정을 덮어쓰지 않습니다. `describeRoutes()`는 cloned descriptor에 frozen eligibility snapshot을 노출하며 dispatcher statistics와 그 route entry도 frozen observability value입니다.

### Bun decorator bundling compatibility

Fluo의 HTTP 데코레이터는 TC39 표준 데코레이터이며, runtime 또는 compiler가 표준 decorator context를 제공하면 계속 `context.metadata`를 통해 metadata를 기록합니다. Bun이 legacy TypeScript decorator transform으로 애플리케이션을 번들링하는 경우에도 controller, route, DTO binding, guard/interceptor, header, redirect, versioning, status, request DTO, `@Produces(...)` metadata를 Fluo 내부 metadata store에 기록하여 생성된 Bun bundle의 route mapping 동작을 보존합니다.

이 호환 경로는 Bun bundle output을 위한 실행 fallback입니다. 애플리케이션 소스는 계속 Fluo 표준 데코레이터를 사용해야 하며, `emitDecoratorMetadata`를 켜거나 `reflect-metadata`에 의존해서는 안 됩니다.

## 요청 정리와 런타임 이식성

디스패처는 활성 dispatch 동안에만 호스트 비동기 컨텍스트 저장소로 `RequestContext`를 바인딩합니다. 지원되는 Node 20+ 런타임을 포함해 `AsyncLocalStorage`가 있는 호스트에서는 컨텍스트가 awaited work 이후까지 유지됩니다. 비동기 컨텍스트 primitive가 없는 비 Node 호스트에서는 fallback 컨텍스트가 동기 프레임에만 유효하고, 겹치는 요청이 서로의 컨텍스트를 관찰하지 않도록 `await` 이후에는 의도적으로 사용할 수 없습니다. 요청이 controller graph, middleware, guard, interceptor, observer, DTO converter, custom binder 또는 수동 `getCurrentRequestContext()` / `assertRequestContext()` container 접근을 통해 request-scoped DI를 사용할 수 있으면, 디스패처는 요청 observer가 끝난 뒤 `finally` 경로에서 isolated request-scoped DI 컨테이너를 생성하고 dispose합니다. Graph가 request scope를 필요로 하지 않는 route는 `RequestContext.container`가 접근되기 전까지 이 컨테이너 lifecycle을 건너뛰어 baseline 경로의 불필요한 per-request allocation을 피하면서도, graph가 모호하거나 request-scoped이면 request-scoped provider isolation을 유지합니다. Fast path는 handler metadata만 cache하고 매 dispatch마다 active container를 통해 controller를 resolve합니다. 따라서 singleton provider는 container에 의해 공유되고 transient controller와 dependency는 resolution마다 새로운 identity를 유지합니다. 그러므로 공개 `RequestContext.container` 읽기는 request-scoped provider resolve에 항상 안전합니다. Request-scope-free fast path는 내부 dispatcher 최적화일 뿐, 공개 context가 root container를 노출한다는 약속이 아닙니다.

어댑터는 플랫폼이 제공한다면 `FrameworkRequest.signal`에 `AbortSignal`을 전달하고, signal allocation이 실용적이지 않다면 `isAborted()` probe를 제공해야 합니다. Dispatcher는 per-dispatch request clone에 두 abort surface를 모두 보존하고 어느 한쪽이라도 cancellation을 보고하면 request를 aborted로 처리하므로 `false` probe가 aborted signal을 가리지 않습니다. Handler 작업 전후에 두 surface를 검사하므로 `AbortSignal`이 없는 어댑터도 abandon된 요청을 중단할 수 있습니다. SSE에서는 가능하면 `FrameworkResponse.stream.onClose(...)`도 노출해야 합니다. `SseResponse`는 request abort와 raw stream close를 모두 구독하고, 멱등하게 닫히며, 어느 쪽이 먼저 종료되더라도 등록한 listener를 제거합니다.

Multipart upload를 parse하는 어댑터는 shared HTTP contract를 adapter-specific file type으로 augment하지 말고 runtime-neutral `FrameworkRequestFile` 값을 `FrameworkRequest.files`에 붙여야 합니다. 이 seam은 모든 HTTP adapter가 제공할 수 있는 portable field(`fieldname`, `originalname`, `mimetype`, `buffer`, `size`)만 의도적으로 모델링합니다. Platform package는 더 풍부한 native file object를 raw request surface에 유지할 수 있지만, guard, binder, middleware, interceptor, controller가 cross-runtime 동작을 필요로 하면 `RequestContext.request.files`를 통해 파일을 읽어야 합니다.

### Multipart DTO 필드

Multipart 파일이 handler 입력 계약에 포함되면 `@RequestDto(...)`와 함께 `@FromFiles(fieldname?)`를 사용하세요.

```ts
import {
  Controller,
  FromFiles,
  Optional,
  Post,
  RequestDto,
  type FrameworkRequestFile,
} from '@fluojs/http';

class UploadAssetsDto {
  @FromFiles('attachments')
  attachments: readonly FrameworkRequestFile[] = [];

  @FromFiles('cover')
  @Optional()
  cover?: readonly FrameworkRequestFile[];
}

@Controller('/uploads')
export class UploadController {
  @Post('/')
  @RequestDto(UploadAssetsDto)
  upload(input: UploadAssetsDto) {
    return input.attachments.map((file) => file.originalname);
  }
}
```

`@FromFiles(...)`는 array-only입니다. `FrameworkRequest.files`가 있으면 `fieldname`으로 필터링된 readonly 배열을 어댑터 도착 순서대로 반환하며, collection이 있지만 일치 항목이 없으면 `[]`가 됩니다. Collection이 없으면 필수 필드는 표준 missing-field 오류를 내고 `@Optional()` 필드는 `undefined`로 남습니다. Converter와 validation은 같은 portable 배열을 받습니다. DTO binder는 다섯 `FrameworkRequestFile` 필드만 projection하므로 adapter-native file property가 DTO 경계를 넘어오지 않습니다. 전체 요청 collection이 필요한 controller와 pipeline stage에서는 기존처럼 `RequestContext.request.files`에 직접 접근할 수 있습니다.

응답 content negotiation formatter는 `ResponseFormatter.format(...)`에서 `string` 또는 `Uint8Array`를 반환해야 합니다. Node.js `Buffer` 값은 `Buffer`가 `Uint8Array`를 구현하므로 계속 할당 가능하지만, formatter contract는 runtime-neutral byte 동작에만 의존해야 합니다.

## 공개 API

- **라우팅 데코레이터**: `Controller`, `Get`, `Sse`, `Query`, `Route`, `Post`, `Put`, `Patch`, `Delete`, `All`, `Options`, `Head`
- **바인딩 데코레이터**: `FromBody`, `FromQuery`, `FromPath`, `FromHeader`, `FromCookie`, `FromFiles`, `RequestDto`, `Optional`, `Convert`
- **실행 데코레이터**: `UseGuards`, `UseInterceptors`, `HttpCode`, `Version`, `Header`, `Redirect`, `Produces`
- **응답 쿠키 helper**: `setCookie`, `clearCookie`, `CookieOptions`, `ClearCookieOptions`, `CookieSameSite`
- **Conditional request 타입**: `EntityTagStrength`, `EntityTag`, `ResponseValidators`, `ConditionalRequestContext`, `ConditionalRequestResolution`, `ConditionalRequestResolver`, `ConditionalRequestOptions`
- **요청/응답 및 컨텍스트 타입**: `RequestContext`, `Principal`, `ContextKey`, `ControllerHandler`, `FrameworkRequest`, `FrameworkRequestFile`, `FrameworkResponse`, `EarlyHintsHeaders`, `FrameworkResponseEarlyHints`, `FrameworkResponseStream`, `FrameworkResponseCompression`, `FrameworkResponseCompressionWriteOptions`, `SseResponse`, `SseMessage`
- **디스패처, 라우팅, 협상 타입**: `Dispatcher`, `CreateDispatcherOptions`, `ErrorHandler`, `DispatcherLogger`, `HandlerMapping`, `HandlerMetadata`, `HandlerDescriptor`, `HandlerMatch`, `HandlerSource`, `RouteDefinition`, `HttpMethod`, `VersioningType`, `VersioningOptions`, `VersioningExtractor`, `VersioningExtractorResult`, `ContentNegotiationOptions`, `ResponseFormatter`, `HttpErrorRepresentationContext`, `HtmlErrorRepresentationProvider`, `HttpErrorRepresentationOptions`, `FastPathEligibility`, `FastPathStats`
- **파이프라인 계약 타입**: `Middleware`, `MiddlewareLike`, `MiddlewareContext`, `MiddlewareRouteConfig`, `Next`, `Guard`, `GuardLike`, `GuardContext`, `Interceptor`, `InterceptorLike`, `InterceptorContext`, `CallHandler`, `RequestObserver`, `RequestObserverLike`, `RequestObservationContext`, `ArgumentResolverContext`, `Binder`, `Converter`, `ConverterLike`, `ConverterTarget`, `ValidationIssue`, `Validator`
- **Adapter API**: `HttpApplicationAdapter`, `HttpAdapterRealtimeCapability`, `ServerBackedHttpAdapterRealtimeCapability`, `FetchStyleHttpAdapterRealtimeCapability`, `HttpAdapterRealtimeBindingInstallation`, `UnsupportedHttpAdapterRealtimeCapability`, `createNoopHttpApplicationAdapter`, `createServerBackedHttpAdapterRealtimeCapability`, `createUnsupportedHttpAdapterRealtimeCapability`, `createFetchStyleHttpAdapterRealtimeCapability`
- **예외와 오류**: `HttpExceptionDetail`, `HttpExceptionOptions`, `ErrorResponse`, `HttpException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `NotAcceptableException`, `TooManyRequestsException`, `InternalServerErrorException`, `PayloadTooLargeException`, `createErrorResponse`, `RouteConflictError`, `InvalidRoutePathError`, `InvalidHttpMethodError`, `HandlerNotFoundError`, `RequestAbortedError`, `EarlyHintsWriteError`
- **헬퍼**: `createHandlerMapping`, `createDispatcher`, `forRoutes`, `normalizeRoutePattern`, `matchRoutePattern`, `isMiddlewareRouteConfig`, `createCorrelationMiddleware`, `createCorsMiddleware`, `createRateLimitMiddleware`, `createMemoryRateLimitStore`, `createSecurityHeadersMiddleware`, `getRequestHeader`, `getResponseHeader`, `hasResponseHeader`, `appendVaryHeader`, `buildContentDisposition`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `createRequestContext`, `createContextKey`, `getContextValue`, `setContextValue`, `encodeSseComment`, `encodeSseMessage`, `isSseMessage`, `formatFastPathStats`, `getDispatcherFastPathStats`, `FAST_PATH_ELIGIBILITY_SYMBOL`, `FAST_PATH_STATS_SYMBOL`
- **Option 및 store type**: `CorsOptions`, `RateLimitOptions`, `RateLimitStore`, `RateLimitStoreEntry`, `SecurityHeadersOptions`, `SseSendOptions`

## Portable 서브경로 (`@fluojs/http/portable`)

Node `AsyncLocalStorage` bootstrap을 eager 초기화하지 않고 HTTP authoring contract가 필요한 runtime-neutral integration에서는 `@fluojs/http/portable`을 사용하세요. 이 경로는 지원되는 HTTP decorator, exception, request/response contract, authoring helper를 내보냅니다. Node request-context 동작이 필요한 Node 애플리케이션은 계속 root package를 import해야 합니다.

## 내부 서브경로 (`@fluojs/http/internal`)

`./internal` 서브경로는 플랫폼 어댑터, 핵심 런타임, first-party response integration에서 사용하는 저수준 유틸리티만 내보냅니다. 이들은 변경될 수 있으며 일반적인 애플리케이션 코드에서 사용해서는 안 됩니다.

- `DefaultBinder`: 런타임 부트스트랩 경로에서 사용하는 기본 DTO/요청 바인더.
- `bindRawRequestNativeRouteHandoff(...)` / `attachFrameworkRequestNativeRouteHandoff(...)`: public dispatcher API를 넓히지 않고 의미 보존이 가능한 native route match를 재사용하기 위한 내부 adapter/runtime 헬퍼.
- `consumeRawRequestNativeRouteHandoff(...)` / `readFrameworkRequestNativeRouteHandoff(...)`: native route handoff를 읽거나 소비하기 위한 내부 helper.
- Native route handoff는 framework request에 붙는 시점의 method와 path를 함께 스냅샷합니다. app middleware가 handler matching 전에 둘 중 하나를 rewrite하면 dispatcher는 stale handoff를 무시하고 일반 route matching으로 fallback합니다.
- `isRoutePathNormalizationSensitive(path)`: duplicate slash와 trailing slash 요청을 generic dispatcher 경로에 남기기 위한 내부 guard.
- `getCompiledRouteIdentity(descriptor)`: first-party package integration을 위해 `createHandlerMapping(...)`이 할당한 deterministic source/method position을 읽습니다. 수동으로 작성한 descriptor에는 `undefined`를 반환합니다.
- `resolveClientIdentity(request)`: 속도 제한과 런타임 통합에서 사용하는 보수적 클라이언트 식별 해석기.
- `createFetchStyleHttpAdapterRealtimeCapability(...)`, `Dispatcher`, `HttpApplicationAdapter`: 전체 HTTP root barrel을 instantiate하면 안 되는 edge/fetch-style platform package를 위한 내부 adapter seam.
- `FRAMEWORK_RESPONSE_WRITER` / `registerFrameworkResponseWriter(...)`: first-party response integration을 위한 typed response-entry branding seam.
- `FRAMEWORK_RESPONSE_VALUE_FINALIZER` / `registerFrameworkResponseValueFinalizer(...)`: typed request-local response finalization seam. Finalizer는 registration 순서대로 compose되고 각각 이전에 resolve된 값을 받으며, dispatcher가 await하므로 throw와 rejection은 기존 error policy를 따릅니다.

## Conditional Requests

runtime bootstrap에서 `conditionalRequest`를 구성해 representation 존재 여부와 optional validator를 분리하여 해석합니다.

```ts
const app = await bootstrapNodeApplication(AppModule, {
  conditionalRequest: {
    resolve({ handler, request }) {
      return {
        exists: true,
        validators: {
          etag: { opaqueValue: `${handler.route.method}:${request.path}:v1`, strength: 'strong' },
          lastModified: new Date('2026-01-01T00:00:00Z'),
        },
      };
    },
  },
});
```

representation이 없으면 `{ exists: false }`를, 존재하지만 validator가 의도적으로 없으면 `{ exists: true }`를 반환합니다. Dispatcher는 application/module middleware와 guard 뒤에 이 resolver를 평가하므로 conditional `304`와 `412`가 authorization 또는 audit logic을 우회하지 않습니다. 유효한 entity-tag list와 HTTP-date form만 받아들이며 malformed conditional field는 무시합니다.

dispatcher는 RFC 9110 precedence와 comparison을 소유합니다. 성공한 `If-Match`는 `If-Unmodified-Since`만 건너뛰고, 이후에도 `If-None-Match`가 `If-Modified-Since`보다 우선합니다. `If-Match`는 strong comparison, `If-None-Match`는 weak comparison을 사용합니다. `304`와 `412`는 body 없이 `ETag`/`Last-Modified`를 유지하며 redirect와 지원되는 custom response-writer 경로에도 적용됩니다. 같은 selected representation에서는 `HEAD`와 `GET`이 같은 conditional 결과를 사용하고 framework-generated `HEAD` body는 억제됩니다. 명시적인 `@Head` route는 독립 route이며 custom response writer는 body emission을 소유하므로 직접 bodyless `HEAD` contract를 지켜야 합니다. 전체 실행 계약은 [HTTP Runtime Contract](../../docs/architecture/http-runtime.ko.md)를 참고하세요.

## 관련 패키지

- `@fluojs/core`: 컨트롤러, 라우트, DTO 메타데이터를 저장합니다.
- `@fluojs/validation`: HTTP 바인딩 이후 DTO를 검증합니다.
- `@fluojs/runtime`: 부트스트랩 중 디스패처를 조립합니다.
- `@fluojs/passport`: 같은 가드 체인 안에서 인증을 연결합니다.

## 예제 소스

- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/auth.controller.ts`
- `packages/http/src/dispatch/dispatcher.test.ts`
