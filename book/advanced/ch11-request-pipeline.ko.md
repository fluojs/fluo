<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 11. Request Pipeline Anatomy — HTTP 요청의 일생

이 장은 Fluo HTTP 디스패처가 요청을 받아 응답을 돌려주기까지 어떤 내부 단계를 거치는지 살펴봅니다. Chapter 10이 호스트 분기와 어댑터 seam을 다뤘다면, 이 장은 그 위에서 실제 요청 처리 파이프라인이 어떻게 작동하는지 집중해서 보여 줍니다.

## Learning Objectives
- Fluo HTTP 디스패처의 핵심 생명주기와 내부 책임 분리를 이해합니다.
- 요청 수신부터 응답 기록까지의 주요 파이프라인 단계를 설명합니다.
- `RequestContext`와 비동기 컨텍스트 격리가 요청 단위 DI 스코프를 어떻게 지키는지 분석합니다.
- 옵저버 패턴이 로깅, 텔레메트리, 오류 보고에 어떻게 연결되는지 살펴봅니다.
- 요청 중단과 리소스 정리 로직이 왜 파이프라인 안정성의 일부인지 정리합니다.
- `DispatchPhaseContext`가 단계별 상태 공유와 디스패처 최적화에 어떻게 쓰이는지 설명합니다.

## Prerequisites
- Chapter 10 완료.
- HTTP 컨트롤러, 라우팅, 미들웨어 기본 이해.
- `AsyncLocalStorage` 또는 비동기 컨텍스트 전파 개념에 대한 기초 지식.

## 11.1 디스패처(Dispatcher): 파이프라인의 사령탑

fluo의 모든 HTTP 요청은 `Dispatcher`를 통해 처리됩니다. 디스패처는 특정 HTTP 서버 프레임워크(Fastify, Express 등)에 종속되지 않는 범용 인터페이스를 제공하며, 프레임워크 메타데이터를 실제 실행 로직으로 전환합니다. 따라서 어댑터가 어떤 서버에서 요청을 받아오든, 이후의 라우팅과 파이프라인 실행은 같은 중심 흐름을 따를 수 있습니다.

`packages/http/src/dispatch/dispatcher.ts` (simplified)
```typescript
export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const dispatchScope = createRootDispatchScope(options.rootContainer);
      let phaseContext: DispatchPhaseContext;
      phaseContext = {
        contentNegotiation,
        dispatchScope,
        observers: options.observers ?? [],
        options,
        requestContext: createDispatchContext(request, response, dispatchScope.container, () => {
          ensureRequestScope(phaseContext);
          return phaseContext.dispatchScope.container;
        }),
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
            if (phaseContext.dispatchScope.requestScoped) {
              await phaseContext.dispatchScope.container.dispose();
            }
          } catch (error) {
            logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
          }
        }
      });
    },
  };
}
```

디스패처는 핸들러만 실행하지 않습니다. 전체 생명주기를 관리하고, 오류를 포착하며, request scope가 실제로 만들어진 경우 요청 단위 리소스를 안전하게 해제하는 조율 지점입니다.

## 11.2 요청 파이프라인의 10단계 흐름

하나의 HTTP 요청이 들어오면 fluo는 다음 순서로 파이프라인을 실행합니다. 각 단계는 이전 단계의 결과에 의존하거나, 특정 조건(예: 인증 실패)에 따라 흐름을 중단할 수 있습니다.

1.  **Context Creation**: `RequestContext`를 생성하고 root DI container에서 시작합니다. `createDispatchContext`는 `RequestContext.container`를 감싸 수동 `resolve()`가 활성 dispatch 중에만 isolated request scope로 승격되게 할 수 있습니다. 또한 활성 middleware, observer, guard, interceptor, DTO conversion, custom binder, request-context handler parameter, request-scoped dependency를 가진 controller graph처럼 request scope가 필요할 수 있는 단계 전에 디스패처가 승격합니다.
2.  **Notification (Start)**: 등록된 모든 옵저버에게 요청 시작을 알립니다. `dispatcher.ts:L211-L220`에서 `notifyRequestStart`가 수행됩니다. 로깅이나 메트릭 수집이 여기서 시작됩니다.
3.  **Global Middleware**: 애플리케이션 수준의 전역 미들웨어를 실행합니다. `dispatcher.ts:L267`에서 `runMiddlewareChain`이 시작됩니다. CORS나 보안 헤더 설정 등이 주로 여기서 처리됩니다.
4.  **Route Matching**: 요청 URL과 메서드를 기반으로 적절한 컨트롤러 핸들러를 찾습니다. `dispatcher.ts:L272`에서 `matchHandlerOrThrow`가 호출됩니다. 여기서 핸들러를 찾지 못하면 404 에러가 발생하며 파이프라인은 즉시 에러 처리 단계로 건너뜁니다.
5.  **Module Middleware**: 핸들러가 속한 모듈 수준의 미들웨어를 실행합니다. `dispatcher.ts:L283`에서 모듈별 체인이 가동됩니다. 특정 기능 도메인에만 적용되는 로직을 삽입하기에 적합합니다.
6.  **Guards**: 핸들러에 설정된 가드(Guard) 체인을 실행하여 권한을 검증합니다. `dispatcher.ts:L173`에서 `runGuardChain`이 권한을 체크합니다. `canActivate`가 `false`를 반환하면 403 Forbidden 에러와 함께 중단됩니다.
7.  **Interceptors (Before)**: 인터셉터 체인의 `intercept()` 메서드를 실행합니다. `dispatcher.ts:L181`에서 시작됩니다. 요청 데이터를 변환하거나 실행 시간을 측정하는 로직이 위치합니다.
8.  **Handler Execution**: DTO 바인딩 및 유효성 검사 후 실제 컨트롤러 메서드를 호출합니다. `invokeControllerHandler`가 이 역할을 수행하며, `packages/http/src/dispatch/dispatcher.test.ts:L541-L619`에서는 이 단계의 파라미터 매핑을 집중적으로 테스트합니다.
9.  **Interceptors (After)**: 핸들러가 반환한 결과(또는 에러)를 가공합니다. `interceptors.ts`의 역순 체인이 완성되며, 응답 객체를 최종적으로 정형화(normalization)합니다.
10. **Response Writing**: 최종 결과를 HTTP 응답으로 직렬화하여 클라이언트에 전송합니다. `dispatcher.ts:L188`에서 `writeSuccessResponse`가 호출됩니다. 이때 `Content-Type` 협상이 마무리됩니다.

## 11.3 RequestContext와 런타임 의존 비동기 격리

fluo는 `runWithRequestContext(...)`와 `getCurrentRequestContext()`를 노출하므로 서비스나 리포지토리처럼 깊은 호출 지점에서도 요청 객체를 모든 함수 인자로 전달하지 않고 현재 요청을 읽을 수 있습니다. 다만 격리 보장은 호스트의 async-context 역량에 따라 달라지며, 모든 런타임에 `AsyncLocalStorage`가 있다는 보편적 약속은 아닙니다.

루트 `@fluojs/http` import는 Node async hooks를 즉시 로드하지 않습니다. Request-context helper는 처음 사용할 때 이미 존재하는 `globalThis.AsyncLocalStorage`를 우선 사용하고, 지원되는 Node.js 호스트에서는 `node:async_hooks`를 lazy하게 해석할 수 있습니다. 어느 storage를 사용하든 context는 awaited continuation을 따라가며 겹치는 요청을 격리합니다.

```typescript
runWithRequestContext(context, () => {
  const active = getCurrentRequestContext();
  // 이 callback 안에서는 active === context
});
```

호스트에 async-context primitive가 없으면 fluo는 동기 stack fallback을 사용합니다. Context는 callback의 동기 frame이 실행되는 동안에만 존재하고 awaited continuation이 재개되기 전에 제거됩니다. 이는 요청 간 context 누출을 피하기 위해 `await` 이후의 context 가용성을 의도적으로 포기하는 동작입니다. 이런 호스트까지 이식 가능한 코드가 필요하면 `RequestContext`를 명시적으로 전달하세요.

## 11.4 옵저버(Observer) 패턴을 통한 모니터링

디스패처는 파이프라인 곳곳에 옵저버 훅을 둡니다. `onRequestStart`, `onHandlerMatched`, `onRequestSuccess`, `onRequestError`, `onRequestFinish` 등이 그 예입니다. 옵저버는 컨트롤러나 미들웨어와 달리 요청 흐름을 직접 변경하지 않으면서 시스템 상태를 관찰하는 "부수 효과(Side Effect) 전용" 레이어입니다.

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

이 구조 덕분에 비즈니스 로직을 수정하지 않고도 전역 성능 지표나 감사 로그(Audit Log)를 남길 수 있습니다. `packages/http/src/dispatch/dispatcher.test.ts:L898-L997`은 옵저버가 특정 단계에서 예외를 던지더라도 전체 파이프라인 실행은 방해받지 않고 완료되는 "Fault-tolerant" 특성을 입증합니다.

## 11.5 요청 중단(Aborted) 처리의 정교함

클라이언트가 응답을 받기 전에 연결을 끊는 경우(예: 브라우저 새로고침, 모바일 네트워크 단절), 어댑터는 그 상태를 `FrameworkRequest.signal`로 노출해야 합니다. Signal 할당이 실용적이지 않다면 `FrameworkRequest.isAborted()`를 제공할 수 있습니다.

```typescript
// packages/http/src/dispatch/dispatcher.ts (simplified)
function isRequestAborted(request: FrameworkRequest): boolean {
  return request.isAborted?.() ?? request.signal?.aborted === true;
}
```

일반 dispatch pipeline은 진입 시 이 상태를 확인하고, handler가 general path로 실행되면 handler/interceptor 작업 뒤 response를 쓰기 전에 다시 확인합니다. Native fast-path dispatch는 진입 시 확인합니다. 이것은 모든 middleware, database query, 임의의 business operation을 자동으로 취소하는 기능이 아니라 경계 검사입니다. 오래 실행되는 application code는 `RequestContext.request.signal`을 받아 cancellation을 지원하는 API로 직접 전파해야 합니다. Managed SSE는 request signal과 response-stream close notification에도 반응합니다.

## 11.6 파이프라인 시각화 다이어그램

전체 흐름을 시각적으로 정리하면 다음과 같습니다. 각 단계 사이의 화살표는 명시적인 상태 전이를 의미하며, 어느 단계에서든 발생한 예외는 즉시 [Error Handling] 레이어로 전파됩니다.

```text
[Incoming Request]
       │
       ▼
[Create RequestContext] ────────────── (Failure) ──┐
       │                                           │
       ▼                                           │
[Notify: onRequestStart] ───────────── (Failure) ──┤
       │                                           │
       ▼                                           │
[Global Middleware Chain] ─── (Next) ───▶ [Route Matching] ── (Fail) ──▶ [404 Error]
                                             │                          │
                                             ▼                          │
                                   [Module Middleware Chain] ───────────┤
                                             │                          │
                                             ▼                          │
                                      [Guard Chain] ───────── (Fail) ──▶ [403 Error]
                                             │                          │
                                             ▼                          │
                                   [Interceptor Chain (Before)] ────────┤
                                             │                          │
                                             ▼                          │
                                    [DTO Binding & Validation] ─────────┤
                                             │                          │
                                             ▼                          │
                                    [Controller Handler] ───────────────┤
                                             │                          │
                                             ▼                          │
                                   [Interceptor Chain (After)] ─────────┤
                                             │                          │
                                             ▼                          │
                                    [Response Writing] ─────────────────┤
                                             │                          │
                                             ▼                          │
[Notify: onRequestFinish] ◀─────────────────────────────────────────────┘
       │
       ▼
[Dispose request scope if promoted]
       │
       ▼
[End of Request]
```

이 다이어그램은 fluo 아키텍처의 핵심인 "보증된 정리(Guaranteed Cleanup)" 원칙을 보여 줍니다. 각 레이어는 독립적이지만, 디스패처는 이를 하나의 흐름으로 묶습니다. 성공, 예상된 에러, 예기치 못한 패닉 중 어떤 경로를 지나도 request-scoped container가 생성된 경우 리소스 해제 단계가 실행되도록 설계되어 있습니다. 끝까지 승격되지 않은 singleton-only fast-path 요청은 root container를 계속 사용하며 이를 dispose하지 않습니다.

## 11.7 DispatchPhaseContext: 단계별 상태 공유

디스패처는 내부에서 요청 상태를 추적하기 위해 `DispatchPhaseContext` 인터페이스를 사용합니다. 여기에는 요청 컨텍스트뿐 아니라 매칭된 핸들러 정보, 옵저버 목록 등이 담기며 파이프라인 전반에 걸쳐 공유됩니다.

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

이 컨텍스트는 파이프라인을 지나며 `matchedHandler`와 같은 필드가 채워지고, 최종적으로 `onRequestFinish` 옵저버에게 전달되어 전체 실행 이력을 보고할 수 있게 합니다. `packages/http/src/dispatch/dispatcher.ts:L258-L351`의 핵심 파이프라인 실행 로직은 이 컨텍스트를 상태 저장소(State Store)로 사용하여 각 단계가 독립적으로 동작하면서도 필요한 정보를 공유하도록 설계되었습니다.

## 11.8 오류 처리 정책 (Error Policy)

파이프라인 어디에서든 오류가 발생하면 `handleDispatchError`가 호출되어 중앙에서 관리됩니다. 이 중앙화된 정책 덕분에 각 단계는 자신이 맡은 일에 집중하고, 오류 응답 형식과 관찰성 훅은 한 흐름에서 일관되게 처리됩니다.

1. `RequestAbortedError`는 조용히 무시합니다. 이는 클라이언트가 연결을 끊은 것이므로 서버 로그를 불필요하게 오염시키지 않기 위함입니다.
2. `onRequestError` 옵저버에게 알립니다. `dispatcher.ts:L302`에서 수행되며, 외부 모니터링 시스템(Sentry 등)에 에러를 보고하기에 적합한 시점입니다.
3. 전역 `onError` 훅이 있다면 실행합니다. `dispatcher.ts:L304`에서 비동기로 호출되며 애플리케이션 수준의 커스텀 에러 로깅을 수행할 수 있습니다.
4. 아무도 처리하지 않았다면 `writeErrorResponse`를 통해 표준 HTTP 오류 봉투(Envelope)를 클라이언트에 전송합니다. `packages/http/src/dispatch/dispatcher.test.ts:L541-L619`에서는 다양한 비즈니스 에러가 올바른 HTTP 상태 코드로 변환되는지 테스트합니다.

## 11.9 성능 최적화: 디스패처 계획과 바인딩 캐시

디스패처는 라우트 매칭 시 매번 복잡한 연산을 반복하지 않습니다. 다만 현재 캐시는 `packages/http/src/dispatch/dispatch-routing-policy.ts` 안에 저장된 controller metadata가 아닙니다. 이 policy 파일은 현재 요청에 맞는 handler를 `HandlerMapping`에 질의하고, 해석된 route params를 dispatch request에 다시 기록하는 역할만 합니다.

현재 hot path 작업은 dispatcher와 binding-plan 경로에서 준비됩니다. `createDispatcher(...)`는 모든 `HandlerDescriptor`에 대한 handler execution plan을 컴파일해 dispatcher-local `handlerExecutionPlans` `WeakMap`에 저장하고, 각 handler에 fast-path eligibility를 기록하며, native fast route에서 사용하는 controller/method handle을 위해 dispatcher-local `fastPathRuntimeCache`를 유지합니다. DTO binding은 `packages/http/src/adapters/dto-binding-plan.ts`에 별도 plan cache를 두고, `getCompiledDtoBindingPlan(...)`이 field reader, bound property key, converter 존재 여부, validation filtering을 DTO constructor를 key로 하는 `WeakMap`에 저장합니다. Content negotiation도 dispatcher 생성 시 `resolveContentNegotiation(...)`으로 한 번 미리 계산되어 formatter를 중복 제거하고 default formatter를 선택하며, request-time `Accept` matching에 사용할 normalized media type을 보관합니다. 이런 최적화 덕분에 Fluo는 singleton-only route를 root-container fast path에 유지하면서도, 파이프라인이 request-scoped provider를 필요로 할 때는 isolated request scope로 승격해 높은 처리량(Throughput)을 유지할 수 있습니다.

## 11.10 리소스 정리: DI 스코프 소멸

요청 처리가 끝나면 승격된 request-scoped container를 반드시 dispose해야 합니다. 이는 해당 요청 기간 동안 생성된 싱글톤이 아닌 객체(Request-scoped providers)의 `onDispose` 훅을 실행하고 메모리를 해제하여 누수를 막습니다. 요청이 singleton-only로 유지되어 승격이 일어나지 않았다면 cleanup 경로는 root container를 그대로 둡니다.

`packages/http/src/dispatch/dispatcher.ts` (simplified)
```typescript
try {
  await runDispatchPipeline(phaseContext);
} finally {
  await notifyRequestFinish(phaseContext);

  if (phaseContext.dispatchScope.requestScoped) {
    try {
      await phaseContext.dispatchScope.container.dispose();
    } catch (error) {
      logger?.error('Request-scoped container dispose threw an error.', error);
    }
  }
}
```

이 과정은 `finally` 블록 안에서 수행되어 요청의 성공/실패 여부와 관계없이 항상 cleanup 여부를 확인합니다. `packages/http/src/dispatch/dispatcher.test.ts`는 singleton-only route가 request-scope 생성을 건너뛰는 경우와, request-scoped controller, 활성 middleware, observer, custom binder, DTO converter, 수동 container resolution이 isolated scope를 사용한 뒤 dispatch 후 dispose되는 경우를 모두 검증합니다.

디스패처는 `RequestContext`를 검사해 임의의 임시 파일, database handle, application-owned stream을 자동으로 닫지 않습니다. 이런 resource는 `onDispose`가 있는 request-scoped provider 뒤에 두거나 application `finally` 블록에서 해제하거나 request abort signal에 cleanup을 연결해야 합니다. Managed `SseResponse`/`AsyncIterable` 처리는 문서화된 response-stream lifecycle만 소유하며, 그 밖의 native resource는 adapter와 application code가 계속 소유합니다.

## 요약
- **범용 디스패처**: 특정 프레임워크에 묶이지 않고 표준화된 요청 처리 파이프라인을 제공합니다.
- **10단계 파이프라인**: 전역 미들웨어부터 응답 쓰기까지 명확히 정의된 단계별 실행을 보장합니다.
- **런타임 의존 비동기 격리**: 호스트가 async-context storage를 제공하면 awaited work까지 context를 보존하고, 그렇지 않으면 synchronous-only fallback을 사용합니다.
- **관찰성 계층**: 옵저버 패턴을 통해 비즈니스 로직 수정 없이 전 구간 모니터링이 가능합니다.
- **명시적 정리**: 문서화된 경계에서 adapter-provided abort state를 확인하고 디스패처가 만든 request scope를 dispose합니다. Application-owned resource에는 여전히 명시적인 owner가 필요합니다.

## 다음 챕터 예고
다음 챕터에서는 가드, 인터셉터, 미들웨어가 어떻게 "체인"을 형성하고 서로의 실행을 제어하는지 더 깊게 살펴봅니다. `reduceRight`를 활용한 체인 구성이 어떤 실행 순서를 만드는지도 함께 다룹니다.
