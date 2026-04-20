<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 11. Request Pipeline Anatomy — HTTP 요청의 일생

## 이 챕터에서 배우는 것
- fluo HTTP 디스패처의 내부 구조와 핵심 생명주기
- 요청 수신부터 응답 반환까지의 10단계 파이프라인 흐름
- `RequestContext`를 통한 비동기 컨텍스트 격리 원리
- 옵저버(Observer) 패턴을 활용한 텔레메트리 및 로깅 통합
- 요청 중단(Aborted) 처리와 리소스 정리 메커니즘

## 사전 요구사항
- 1권에서 다룬 기초적인 HTTP 컨트롤러 및 라우팅 지식
- `AsyncLocalStorage` 또는 비동기 컨텍스트 전파 개념에 대한 기본 이해

## 11.1 디스패처(Dispatcher): 파이프라인의 사령탑

fluo의 모든 HTTP 요청은 `Dispatcher`를 통해 처리됩니다. 디스패처는 특정 HTTP 서버 프레임워크(Fastify, Express, Bun, Cloudflare Workers 등)에 종속되지 않는 범용적인 인터페이스를 제공하며, 프레임워크의 네이티브 요청/응답 객체를 fluo의 표준화된 메타데이터와 결합하여 실제 실행 가능한 로직으로 전환하는 중추적인 역할을 합니다.

`packages/http/src/dispatch/dispatcher.ts`의 `createDispatcher` 함수는 전체 파이프라인의 입구입니다.

`packages/http/src/dispatch/dispatcher.ts:L324-L354`
```typescript
export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const phaseContext: DispatchPhaseContext = {
        contentNegotiation,
        observers: options.observers ?? [],
        options,
        requestContext: createDispatchContext(createDispatchRequest(request), response, options.rootContainer),
        response,
      };

      await runWithRequestContext(phaseContext.requestContext, async () => {
        try {
          await notifyRequestStart(phaseContext);
          await runDispatchPipeline(phaseContext);
        } catch (error: unknown) {
          await handleDispatchError(phaseContext, error);
        } finally {
          await notifyRequestFinish(phaseContext);
          try {
            await phaseContext.requestContext.container.dispose();
          } catch (error) {
            logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
          }
        }
      });
    },
  };
}
```

디스패처는 단순히 핸들러를 실행하는 것을 넘어, `runWithRequestContext`를 통해 비동기 실행 흐름을 요청 단위로 캡슐화하고, 요청이 끝나는 시점에 `container.dispose()`를 호출하여 리소스 누수를 원천 차단하는 등 전체 생명주기를 엄격하게 관리하는 "사령탑"입니다.

## 11.2 요청 파이프라인의 10단계 흐름

하나의 HTTP 요청이 수신되면 fluo 디스패처는 `runDispatchPipeline` 내부에서 다음과 같은 순서로 파이프라인을 가동합니다. 이 과정은 `dispatcher.ts`와 각 정책 파일들에 정의된 행동 계약에 따라 수행됩니다.

1.  **Context Creation**: 수신된 프레임워크 객체로부터 `RequestContext`를 생성합니다. 이때 `rootContainer.createRequestScope()`를 통해 해당 요청만을 위한 독립된 DI 컨테이너가 생성되어 격리된 상태(Isolate)를 보장합니다.
2.  **Notification (Start)**: 등록된 모든 옵저버에게 요청 시작을 알립니다. `notifyRequestStart`는 비즈니스 로직 시작 전 텔레메트리 스팬(Span)을 생성하기에 최적의 위치입니다.
3.  **Global Middleware**: 애플리케이션 수준의 전역 미들웨어를 실행합니다. `runMiddlewareChain`은 `next()`를 호출하지 않으면 다음 단계로 넘어가지 않는 제어권을 가집니다.
4.  **Route Matching**: 요청 URL과 메서드를 기반으로 `HandlerMapping`에서 최적의 컨트롤러 핸들러를 찾습니다. `matchHandlerOrThrow`는 매칭 실패 시 즉시 `NotFoundException`을 유발합니다.
5.  **Module Middleware**: 핸들러가 속한 모듈 수준의 미들웨어를 실행합니다. 특정 도메인(예: `/admin`)에만 적용되어야 하는 공통 로직이 여기서 가동됩니다.
6.  **Guards**: 핸들러에 설정된 가드(Guard) 체인을 실행하여 권한을 검증합니다. `runGuardChain`에서 하나라도 `false`를 반환하거나 오류를 던지면 파이프라인은 즉시 중단됩니다.
7.  **Interceptors (Before)**: 인터셉터 체인의 `intercept()` 메서드를 실행합니다. 이는 핸들러 실행 전후의 요청/응답 스트림을 가로챌 수 있는 지점입니다.
8.  **Handler Execution**: DTO 바인딩 및 유효성 검사(`binder` 호출) 후 실제 컨트롤러 메서드를 호출합니다. `invokeControllerHandler`가 타겟 인스턴스의 메서드를 실행합니다.
9.  **Interceptors (After)**: 핸들러에서 반환된 결과를 인터셉터의 역순 체인이 가공합니다. 데이터 변환(Transform)이나 응답 봉투(Envelope) 래핑이 주로 여기서 일어납니다.
10. **Response Writing**: 최종 결과와 `contentNegotiation` 설정을 바탕으로 결과를 HTTP 응답으로 직렬화하여 클라이언트에 전송합니다. `writeSuccessResponse`가 이 역할을 수행합니다.

## 11.3 RequestContext와 비동기 격리

fluo는 Node.js의 `AsyncLocalStorage`를 활용하여 요청의 전역 상태를 관리합니다. 이는 현대적인 백엔드 아키텍처에서 "Context"를 다루는 가장 효율적인 방법입니다.

`packages/http/src/context/request-context.ts` 시스템은 디스패처가 `runWithRequestContext`를 호출하는 순간 활성화됩니다.

`packages/http/src/context/request-context.ts:L7-L18`
```typescript
const requestContextStore = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStore.run(context, callback);
}
```

이 구조 덕분에 개발자는 어떤 깊이의 함수에서도 인자로 `request`나 `user` 정보를 넘기지 않고 `getCurrentRequestContext()`를 통해 현재 요청 정보에 안전하게 접근할 수 있습니다. 이는 특히 로깅 라이브러리에서 `requestId`를 자동으로 삽입하거나, 데이터베이스 계층에서 현재 사용자의 테넌트 ID(Tenant ID)를 식별할 때 강력한 위력을 발휘합니다.

## 11.4 옵저버(Observer) 패턴을 통한 모니터링

디스패처는 파이프라인 곳곳에 옵저버 훅을 심어두어 실행 과정을 투명하게 공개합니다. `notifyObservers`는 등록된 옵저버들을 순회하며 각 단계의 이벤트를 발행합니다.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L124-L139
async function notifyObservers(
  observers: RequestObserverLike[],
  requestContext: RequestContext,
  callback: (observer: RequestObserver, context: RequestObservationContext) => Promise<void> | void,
  handler?: HandlerDescriptor,
): Promise<void> {
  const context: RequestObservationContext = {
    handler,
    requestContext,
  };

  for (const definition of observers) {
    const observer = await resolveRequestObserver(definition, requestContext);
    await callback(observer, context);
  }
}
```

이 구조의 핵심은 **비침습성(Non-invasive)**입니다. 비즈니스 로직(컨트롤러)을 전혀 수정하지 않고도 모든 요청의 실행 시간, 에러율, 매칭된 라우트 통계 등을 수집할 수 있습니다. `@RequestObserver()` 데코레이터로 정의된 클래스는 `requestContext.container`를 통해 인스턴스화되므로, 옵저버 내부에서도 DI를 활용해 메트릭 서비스를 주입받을 수 있습니다.

## 11.5 요청 중단(Aborted) 처리의 정교함

클라이언트가 응답을 받기 전에 연결을 끊는 경우(예: 브라우저 새로고침, 네트워크 단절), 서버 리소스를 낭비하지 않기 위해 진행 중인 작업을 즉시 중단해야 합니다. 디스패처는 `FrameworkRequest`가 제공하는 `AbortSignal`을 감시하며 파이프라인 각 단계에서 이를 체크합니다.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L103-L107
function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}
```

디스패처는 미들웨어 실행 직전(`dispatcher.ts:L259`), 핸들러 실행 직후(`dispatcher.ts:L185`), 그리고 응답을 쓰기 직전에 `ensureRequestNotAborted`를 호출합니다. 특히 대규모 데이터베이스 쿼리나 외부 API 호출이 포함된 파이프라인에서, 이미 끊어진 연결을 위해 연산을 계속하는 불필요한 비용을 획기적으로 줄여줍니다.

## 11.6 파이프라인 시각화 다이어그램

HTTP 요청이 fluo 시스템을 통과하며 겪는 "일생"을 시각적으로 정리해 봅시다.

```text
[Incoming Request]
       │
       ▼
[Create RequestContext & DI Scope] ─── (AsyncLocalStorage Bound)
       │
       ▼
[Notify: onRequestStart] ──────────── (Telemetry Start)
       │
       ▼
[Global Middleware Chain] ─── (Next) ───▶ [Route Matching]
                                             │
                                             ▼
                                  [Module Middleware Chain]
                                             │
                                             ▼
                                      [Guard Chain] ──── (Authorization Check)
                                             │
                                             ▼
                                  [Interceptor Chain (Before)]
                                             │
                                             ▼
                                   [DTO Binding & Validation]
                                             │
                                             ▼
                                   [Controller Handler] ── (Business Logic)
                                             │
                                             ▼
                                  [Interceptor Chain (After)]
                                             │
                                             ▼
                                   [Response Writing] ─── (Serialization)
                                             │
                                             ▼
[Notify: onRequestFinish] ─────────── (Telemetry End)
       │
       ▼
[Dispose DI Scope] ────────────────── (Resource Cleanup)
       │
       ▼
[End of Request]
```

이 다이어그램은 모든 레이어가 독립적이고 교체 가능하면서도, 디스패처라는 사령탑에 의해 하나의 조화로운 실행 흐름(Unified Flow)으로 엮여 있음을 보여줍니다.

## 11.7 DispatchPhaseContext: 단계별 상태 공유

디스패처 내부에서 요청의 상태를 일관되게 추적하기 위해 `DispatchPhaseContext` 인터페이스를 사용합니다.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L202-L209
interface DispatchPhaseContext {
  contentNegotiation: ResolvedContentNegotiation | undefined;
  matchedHandler?: HandlerDescriptor;
  observers: RequestObserverLike[];
  options: CreateDispatcherOptions;
  requestContext: RequestContext;
  response: FrameworkResponse;
}
```

이 컨텍스트는 파이프라인을 흐르며 `matchedHandler`와 같은 필드가 동적으로 채워집니다. 예를 들어, `Route Matching` 단계에서 채워진 핸들러 정보는 이후 `Interceptor`나 `Observer`에게 전달되어 "현재 어떤 엔드포인트가 실행 중인지"에 대한 명확한 맥락을 제공합니다.

## 11.8 오류 처리 정책 (Error Policy)

파이프라인 어디에서든 오류가 발생하면 `handleDispatchError`가 호출되어 시스템을 안정적인 상태로 복구합니다.

1.  **Aborted Check**: `RequestAbortedError`나 실제 신호 중단은 조용히 무시합니다. 이는 클라이언트의 변심으로 인한 정상적인 중단이므로 서버 로그를 불필요한 "Error"로 오염시키지 않기 위함입니다.
2.  **Observer Notification**: `onRequestError` 옵저버에게 알립니다. 이를 통해 Sentry나 CloudWatch 같은 외부 시스템에 예외 상황을 즉시 보고할 수 있습니다.
3.  **Custom Error Handler**: 사용자 정의 `onError` 훅이 있다면 실행합니다. 만약 이 훅이 `true`를 반환하면 에러가 처리된 것으로 간주하고 추가 응답을 보내지 않습니다.
4.  **Final Response**: 아무도 처리하지 않은 경우 `writeErrorResponse`가 호출되어 표준 HTTP 오류 봉투(Envelope)와 상태 코드를 클라이언트에 전송합니다.

## 11.9 성능 최적화: 메타데이터 캐싱

디스패처는 라우트 매칭 시 매번 클래스 메타데이터를 리플렉션으로 읽는 복잡한 연산을 수행하지 않습니다.

`packages/http/src/dispatch/dispatch-routing-policy.ts` 내부에서는 `WeakMap`을 사용하여 컨트롤러와 라우트 메타데이터를 메모리에 캐싱합니다. 또한 디스패처가 **생성되는 시점**(부트스트랩 타임)에 `resolveContentNegotiation`을 통해 복잡한 컨텐츠 협상 설정을 미리 계산해 둡니다. 이러한 "Pre-compilation" 전략은 요청당 오버헤드를 마이크로초(µs) 단위로 압축하여 대규모 트래픽에서도 일관된 성능을 유지하게 합니다.

## 11.10 리소스 정리: DI 스코프 소멸과 Disposal

요청 처리가 끝나면(성공이든 실패든 상관없이) 디스패처의 `finally` 블록에서 `requestContext.container.dispose()`가 호출됩니다.

`packages/http/src/dispatch/dispatcher.ts:L344-L349`
```typescript
} finally {
  await notifyRequestFinish(phaseContext);
  try {
    await phaseContext.requestContext.container.dispose();
  } catch (error) {
    logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
  }
}
```

이 과정은 해당 요청을 위해 생성된 모든 'Request-scoped' 프로바이더들을 메모리에서 해제합니다. 만약 프로바이더가 `onDispose` 메서드를 가지고 있다면 이 시점에 호출되어, 열려 있는 데이터베이스 커넥션을 반환하거나 파일 핸들을 닫는 등의 필수적인 정리가 안전하게 수행됩니다.

## 요약
- **Dispatcher**는 특정 프레임워크에 얽매이지 않는 fluo의 표준 HTTP 엔진입니다.
- 요청의 생명주기는 **10단계의 명확한 파이프라인**을 통해 엄격하게 통제됩니다.
- **RequestContext**와 **AsyncLocalStorage**는 비동기 환경에서 데이터의 무결성을 보장합니다.
- **AbortSignal** 연동은 서버의 불필요한 자원 낭비를 방지하는 필수 장치입니다.
- **finally** 블록을 통한 리소스 정리는 고가용성 서버의 기초가 됩니다.

## 다음 챕터 예고
다음 챕터에서는 가드, 인터셉터, 미들웨어가 구체적으로 어떻게 "체인"을 형성하고 서로의 실행을 제어하는지 깊이 있게 파헤칩니다. `reduceRight`를 활용한 함수형 체인 구성의 묘미를 만나보세요.


