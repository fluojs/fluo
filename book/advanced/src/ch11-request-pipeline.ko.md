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

fluo의 모든 HTTP 요청은 `Dispatcher`를 통해 처리됩니다. 디스패처는 특정 HTTP 서버 프레임워크(Fastify, Express 등)에 종속되지 않는 범용적인 인터페이스를 제공하며, 프레임워크의 메타데이터를 실제 실행 가능한 로직으로 전환하는 역할을 합니다.

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

디스패처는 단순히 핸들러를 실행하는 것을 넘어, 전체 생명주기를 관리하고 오류를 포착하며 리소스를 안전하게 해제하는 "사령탑"입니다.

## 11.2 요청 파이프라인의 10단계 흐름

하나의 HTTP 요청이 들어오면 fluo는 다음과 같은 순서로 파이프라인을 가동합니다.

1.  **Context Creation**: `RequestContext`를 생성하고 요청별 DI 스코프를 할당합니다. `dispatcher.ts:L93-L101`에서 `createDispatchContext`가 호출됩니다.
2.  **Notification (Start)**: 등록된 모든 옵저버에게 요청 시작을 알립니다. `dispatcher.ts:L211-L220`에서 `notifyRequestStart`가 수행됩니다.
3.  **Global Middleware**: 애플리케이션 수준의 전역 미들웨어를 실행합니다. `dispatcher.ts:L267`에서 `runMiddlewareChain`이 시작됩니다.
4.  **Route Matching**: 요청 URL과 메서드를 기반으로 적절한 컨트롤러 핸들러를 찾습니다. `dispatcher.ts:L272`에서 `matchHandlerOrThrow`가 호출됩니다.
5.  **Module Middleware**: 핸들러가 속한 모듈 수준의 미들웨어를 실행합니다. `dispatcher.ts:L283`에서 모듈별 체인이 가동됩니다.
6.  **Guards**: 핸들러에 설정된 가드(Guard) 체인을 실행하여 권한을 검증합니다. `dispatcher.ts:L173`에서 `runGuardChain`이 권한을 체크합니다.
7.  **Interceptors (Before)**: 인터셉터 체인의 `intercept()` 메서드를 실행합니다. `dispatcher.ts:L181`에서 시작됩니다.
8.  **Handler Execution**: DTO 바인딩 및 유효성 검사 후 실제 컨트롤러 메서드를 호출합니다. `invokeControllerHandler`가 이 역할을 수행합니다.
9.  **Interceptors (After)**: 인터셉터에서 반환된 결과를 가공합니다. `interceptors.ts`의 역순 체인이 완성됩니다.
10. **Response Writing**: 최종 결과를 HTTP 응답으로 직렬화하여 클라이언트에 전송합니다. `dispatcher.ts:L188`에서 `writeSuccessResponse`가 호출됩니다.

## 11.3 RequestContext와 비동기 격리

fluo는 `AsyncLocalStorage`를 활용하여 요청의 전역 상태를 관리합니다. 이를 통해 어떤 깊이의 함수에서도 인자로 넘기지 않고 현재 요청 정보(`requestId`, `user` 등)에 접근할 수 있습니다.

`packages/http/src/context/request-context.ts` 시스템은 디스패처가 `runWithRequestContext`를 호출하는 순간 활성화됩니다. 이는 특히 로깅이나 트랜잭션 관리에서 강력한 위력을 발휘하며, `getCurrentRequestContext()`를 통해 전역적으로 접근 가능합니다.

## 11.4 옵저버(Observer) 패턴을 통한 모니터링

디스패처는 파이프라인 곳곳에 옵저버 훅을 심어두었습니다. `onRequestStart`, `onHandlerMatched`, `onRequestSuccess`, `onRequestError`, `onRequestFinish` 등이 그 예입니다.

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

이 구조 덕분에 비즈니스 로직을 건드리지 않고도 모든 요청의 성능 지표를 수집하거나 감사 로그(Audit Log)를 남길 수 있으며, `@RequestObserver()` 데코레이터로 간단히 옵저버를 정의할 수 있습니다.

## 11.5 요청 중단(Aborted) 처리의 정교함

클라이언트가 응답을 받기 전에 연결을 끊는 경우(예: 브라우저 새로고침), 서버 리소스를 낭비하지 않기 위해 즉시 작업을 중단해야 합니다. 디스패처는 `AbortSignal`을 감시하며 파이프라인 각 단계에서 이를 체크합니다.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L103-L107
function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}
```

미들웨어 실행 전, 가드 실행 후, 그리고 응답을 쓰기 직전에 `ensureRequestNotAborted`를 호출하여 불필요한 연산을 방지합니다. 이는 `Dispatcher`가 `signal` 객체를 `FrameworkRequest`로부터 올바르게 매핑받았을 때만 동작합니다.

## 11.6 파이프라인 시각화 다이어그램

전체적인 흐름을 다시 한번 시각적으로 정리해 봅시다.

```text
[Incoming Request]
       │
       ▼
[Create RequestContext & DI Scope]
       │
       ▼
[Notify: onRequestStart]
       │
       ▼
[Global Middleware Chain] ─── (Next) ───▶ [Route Matching]
                                            │
                                            ▼
                                  [Module Middleware Chain]
                                            │
                                            ▼
                                     [Guard Chain]
                                            │
                                            ▼
                                  [Interceptor Chain (Before)]
                                            │
                                            ▼
                                   [DTO Binding & Validation]
                                            │
                                            ▼
                                   [Controller Handler]
                                            │
                                            ▼
                                  [Interceptor Chain (After)]
                                            │
                                            ▼
                                   [Response Writing]
                                            │
                                            ▼
[Notify: onRequestFinish]
       │
       ▼
[Dispose DI Scope]
       │
       ▼
[End of Request]
```

이 다이어그램은 fluo 아키텍처의 핵심을 보여줍니다. 모든 레이어는 독립적이며, 디스패처가 이를 하나의 조화로운 흐름으로 엮어냅니다.

## 11.7 DispatchPhaseContext: 단계별 상태 공유

디스패처 내부에서 요청의 상태를 추적하기 위해 `DispatchPhaseContext` 인터페이스를 사용합니다. 여기에는 요청 컨텍스트뿐만 아니라 매칭된 핸들러 정보, 옵저버 목록 등이 담깁니다.

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

이 컨텍스트는 파이프라인을 흐르며 `matchedHandler`와 같은 필드가 채워지게 되고, 최종적으로 `onRequestFinish` 옵저버에게 전달되어 전체 실행 이력을 보고할 수 있게 합니다.

## 11.8 오류 처리 정책 (Error Policy)

파이프라인 어디에서든 오류가 발생하면 `handleDispatchError`가 호출됩니다.

1. `RequestAbortedError`는 조용히 무시합니다. (클라이언트 중단이므로 서버 로그를 오염시키지 않습니다.)
2. `onRequestError` 옵저버에게 알립니다. `dispatcher.ts:L302`에서 수행됩니다.
3. 전역 `onError` 훅이 있다면 실행합니다. `dispatcher.ts:L304`에서 비동기로 호출됩니다.
4. 아무도 처리하지 않았다면 `writeErrorResponse`를 통해 표준 HTTP 오류 봉투(Envelope)를 클라이언트에 전송합니다.

## 11.9 성능 최적화: WeakMap을 활용한 메타데이터 캐싱

디스패처는 라우트 매칭 시 매번 복잡한 연산을 수행하지 않습니다. `packages/http/src/dispatch/dispatch-routing-policy.ts` 내부에서는 `WeakMap`을 사용하여 컨트롤러와 라우트 메타데이터를 캐싱하며, 이는 대규모 애플리케이션에서도 일관된 라우팅 성능을 보장하는 비결입니다.

또한 디스패처 생성 시점에 `resolveContentNegotiation`을 통해 설정을 미리 계산해 둠으로써 요청당 오버헤드를 최소화합니다.

## 11.10 리소스 정리: DI 스코프 소멸

요청 처리가 끝나면 반드시 `requestContext.container.dispose()`를 호출합니다. 이는 해당 요청 기간 동안 생성된 싱글톤이 아닌 객체들(Request-scoped providers)의 `onDispose` 훅을 실행하고 메모리를 해제하여 누수를 방지합니다.

이 과정은 `finally` 블록 내에서 수행되어 요청의 성공/실패 여부와 관계없이 항상 실행되도록 보장됩니다.

## 요약
- fluo 디스패처는 런타임과 독립적인 HTTP 실행 엔진입니다.
- 요청 생명주기는 옵저버 패턴과 체인 기반의 미들웨어/인터셉터로 구성됩니다.
- `RequestContext`와 `AbortSignal`은 현대적인 백엔드 안정성의 핵심입니다.
- 모든 리소스는 요청 종료 시점에 안전하게 해제됩니다.

## 다음 챕터 예고
다음 챕터에서는 가드, 인터셉터, 미들웨어가 구체적으로 어떻게 "체인"을 형성하고 서로의 실행을 제어하는지 깊이 있게 파헤칩니다. `reduceRight`를 활용한 체인 구성의 묘미를 만나보세요.

