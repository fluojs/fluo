<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 11. Request Pipeline Anatomy — HTTP 요청의 일생

## 이 챕터에서 배우는 것
- fluo HTTP 디스패처의 내부 구조와 핵심 생명주기
- 요청 수신부터 응답 반환까지의 10단계 파이프라인 흐름
- `RequestContext`를 통한 비동기 컨텍스트 격리 원리
- 옵저버(Observer) 패턴을 활용한 텔레메트리 및 로깅 통합
- 요청 중단(Aborted) 처리와 리소스 정리 메커니즘
- `DispatchPhaseContext`를 이용한 단계별 상태 공유 및 성능 최적화 기법

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

하나의 HTTP 요청이 들어오면 fluo는 다음과 같은 순서로 파이프라인을 가동합니다. 각 단계는 이전 단계의 결과에 의존하거나, 특정 조건(예: 인증 실패)에 따라 흐름을 중단할 수 있습니다.

1.  **Context Creation**: `RequestContext`를 생성하고 요청별 DI 스코프를 할당합니다. `dispatcher.ts:L93-L101`에서 `createDispatchContext`가 호출됩니다. 이때 생성된 컨테이너는 요청이 끝날 때까지 해당 요청에만 전속되는 인스턴스들을 관리합니다.
2.  **Notification (Start)**: 등록된 모든 옵저버에게 요청 시작을 알립니다. `dispatcher.ts:L211-L220`에서 `notifyRequestStart`가 수행됩니다. 로깅이나 메트릭 수집이 여기서 시작됩니다.
3.  **Global Middleware**: 애플리케이션 수준의 전역 미들웨어를 실행합니다. `dispatcher.ts:L267`에서 `runMiddlewareChain`이 시작됩니다. CORS나 보안 헤더 설정 등이 주로 여기서 처리됩니다.
4.  **Route Matching**: 요청 URL과 메서드를 기반으로 적절한 컨트롤러 핸들러를 찾습니다. `dispatcher.ts:L272`에서 `matchHandlerOrThrow`가 호출됩니다. 여기서 핸들러를 찾지 못하면 404 에러가 발생하며 파이프라인은 즉시 에러 처리 단계로 건너뜁니다.
5.  **Module Middleware**: 핸들러가 속한 모듈 수준의 미들웨어를 실행합니다. `dispatcher.ts:L283`에서 모듈별 체인이 가동됩니다. 특정 기능 도메인에만 적용되는 로직을 삽입하기에 적합합니다.
6.  **Guards**: 핸들러에 설정된 가드(Guard) 체인을 실행하여 권한을 검증합니다. `dispatcher.ts:L173`에서 `runGuardChain`이 권한을 체크합니다. `canActivate`가 `false`를 반환하면 403 Forbidden 에러와 함께 중단됩니다.
7.  **Interceptors (Before)**: 인터셉터 체인의 `intercept()` 메서드를 실행합니다. `dispatcher.ts:L181`에서 시작됩니다. 요청 데이터를 변환하거나 실행 시간을 측정하는 로직이 위치합니다.
8.  **Handler Execution**: DTO 바인딩 및 유효성 검사 후 실제 컨트롤러 메서드를 호출합니다. `invokeControllerHandler`가 이 역할을 수행하며, `packages/http/src/dispatch/dispatcher.test.ts:L541-L619`에서는 이 단계에서의 파라미터 매핑 성공 여부를 집중적으로 테스트합니다.
9.  **Interceptors (After)**: 핸들러가 반환한 결과(또는 에러)를 가공합니다. `interceptors.ts`의 역순 체인이 완성되며, 응답 객체를 최종적으로 정형화(normalization)합니다.
10. **Response Writing**: 최종 결과를 HTTP 응답으로 직렬화하여 클라이언트에 전송합니다. `dispatcher.ts:L188`에서 `writeSuccessResponse`가 호출됩니다. 이때 `Content-Type` 협상이 마무리됩니다.

## 11.3 RequestContext와 비동기 격리

fluo는 `AsyncLocalStorage`를 활용하여 요청의 전역 상태를 관리합니다. 이를 통해 서비스 레이어나 리포지토리 레이어와 같은 어떤 깊이의 함수에서도 인자로 `req` 객체를 일일이 넘기지 않고 현재 요청 정보(`requestId`, `user`, `traceId` 등)에 접근할 수 있습니다.

`packages/http/src/context/request-context.ts` 시스템은 디스패처가 `runWithRequestContext`를 호출하는 순간 활성화됩니다. `packages/http/src/context/request-context.test.ts:L50-L148`의 테스트 코드는 여러 요청이 동시에 병렬로 들어왔을 때 각자의 컨텍스트가 섞이지 않고 엄격히 격리되는지를 검증합니다.

```typescript
// packages/http/src/context/request-context.ts:L45-L60
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}
```

이 메커니즘은 특히 대규모 분산 시스템에서의 분산 트레이싱(Distributed Tracing) 구현을 매우 단순하게 만들어 줍니다. 로그 출력 시 수동으로 컨텍스트를 주입할 필요 없이, 로거가 내부적으로 `getCurrentRequestContext()`를 호출하여 현재 로그가 어떤 요청에 속하는지 자동으로 표시할 수 있기 때문입니다.

## 11.4 옵저버(Observer) 패턴을 통한 모니터링

디스패처는 파이프라인 곳곳에 옵저버 훅을 심어두었습니다. `onRequestStart`, `onHandlerMatched`, `onRequestSuccess`, `onRequestError`, `onRequestFinish` 등이 그 예입니다. 옵저버는 컨트롤러나 미들웨어와 달리 요청의 흐름을 직접 변경하지 않으면서도 시스템의 상태를 관찰할 수 있는 "부수 효과(Side Effect) 전용" 레이어입니다.

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

이 구조 덕분에 비즈니스 로직을 전혀 수정하지 않고도 전역적인 성능 지표 수집이나 감사 로그(Audit Log)를 남길 수 있습니다. `packages/http/src/dispatch/dispatcher.test.ts:L898-L997`은 옵저버가 특정 단계에서 예외를 던지더라도 전체 파이프라인의 실행은 방해받지 않고 안전하게 완료되는 "Fault-tolerant" 특성을 입증합니다.

## 11.5 요청 중단(Aborted) 처리의 정교함

클라이언트가 응답을 받기 전에 연결을 끊는 경우(예: 브라우저 새로고침, 모바일 네트워크 단절), 서버 리소스를 낭비하지 않기 위해 현재 진행 중인 데이터베이스 쿼리나 비즈니스 로직을 즉시 중단해야 합니다. 디스패처는 표준 `AbortSignal`을 감시하며 파이프라인 각 단계에서 이를 정교하게 체크합니다.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L103-L107
function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}
```

디스패처는 미들웨어 실행 전, 가드 실행 후, 그리고 응답을 쓰기 직전에 `ensureRequestNotAborted`를 호출하여 불필요한 연산을 방지합니다. `packages/http/src/dispatch/dispatcher.test.ts:L622-L735`에서는 요청이 도중에 중단되었을 때 `finally` 블록의 리소스 정리 로직이 누락 없이 실행되는지를 엄격하게 테스트합니다. 이는 특히 파일 업로드나 대용량 데이터 처리와 같이 리소스 집약적인 요청에서 서버의 가용성을 유지하는 데 필수적인 기능입니다.

## 11.6 파이프라인 시각화 다이어그램

전체적인 흐름을 다시 한번 시각적으로 정리해 봅시다. 각 단계 사이의 화살표는 명시적인 상태 전이를 의미하며, 어느 단계에서든 발생한 예외는 즉시 [Error Handling] 레이어로 전파됩니다.

```text
[Incoming Request]
       │
       ▼
[Create RequestContext & DI Scope] ─── (Failure) ──┐
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
[Dispose DI Scope]
       │
       ▼
[End of Request]
```

이 다이어그램은 fluo 아키텍처의 핵심인 "보증된 정리(Guaranteed Cleanup)" 원칙을 보여줍니다. 모든 레이어는 독립적이며, 디스패처가 이를 하나의 조화로운 흐름으로 엮어내되 어떠한 경로(성공, 예상된 에러, 예기치 못한 패닉)를 통하더라도 리소스 해제 단계는 반드시 거치게 설계되어 있습니다.

## 11.7 DispatchPhaseContext: 단계별 상태 공유

디스패처 내부에서 요청의 상태를 추적하기 위해 `DispatchPhaseContext` 인터페이스를 사용합니다. 여기에는 요청 컨텍스트뿐만 아니라 매칭된 핸들러 정보, 옵저버 목록 등이 담기며 파이프라인 전반에 걸쳐 공유됩니다.

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

이 컨텍스트는 파이프라인을 흐르며 `matchedHandler`와 같은 필드가 채워지게 되고, 최종적으로 `onRequestFinish` 옵저버에게 전달되어 전체 실행 이력을 보고할 수 있게 합니다. `packages/http/src/dispatch/dispatcher.ts:L258-L351`의 핵심 파이프라인 실행 로직은 이 컨텍스트를 상태 저장소(State Store)로 활용하여 각 단계가 독립적이면서도 필요한 정보를 유기적으로 공유하도록 설계되었습니다.

## 11.8 오류 처리 정책 (Error Policy)

파이프라인 어디에서든 오류가 발생하면 `handleDispatchError`가 호출되어 중앙 집중식으로 관리됩니다.

1. `RequestAbortedError`는 조용히 무시합니다. 이는 클라이언트가 연결을 끊은 것이므로 서버 로그를 불필요하게 오염시키지 않기 위함입니다.
2. `onRequestError` 옵저버에게 알립니다. `dispatcher.ts:L302`에서 수행되며, 외부 모니터링 시스템(Sentry 등)에 에러를 보고하기에 적합한 시점입니다.
3. 전역 `onError` 훅이 있다면 실행합니다. `dispatcher.ts:L304`에서 비동기로 호출되며 애플리케이션 수준의 커스텀 에러 로깅을 수행할 수 있습니다.
4. 아무도 처리하지 않았다면 `writeErrorResponse`를 통해 표준 HTTP 오류 봉투(Envelope)를 클라이언트에 전송합니다. `packages/http/src/dispatch/dispatcher.test.ts:L541-L619`에서는 다양한 비즈니스 에러가 올바른 HTTP 상태 코드로 변환되는지 테스트합니다.

## 11.9 성능 최적화: WeakMap을 활용한 메타데이터 캐싱

디스패처는 라우트 매칭 시 매번 복잡한 연산을 수행하지 않습니다. `packages/http/src/dispatch/dispatch-routing-policy.ts` 내부에서는 `WeakMap`을 사용하여 컨트롤러 클래스와 해당 클래스의 라우트 메타데이터를 캐싱합니다. `WeakMap`을 사용함으로써 컨트롤러 클래스가 가비지 컬렉션의 대상이 되었을 때 캐시 데이터도 자동으로 함께 제거되도록 설계되었습니다.

또한 디스패처 생성 시점에 `resolveContentNegotiation`을 통해 설정을 미리 계산해 둠으로써 요청당 오버헤드를 최소화합니다. `packages/http/src/public-api.test.ts:L39-L52` 수준의 통합 테스트를 통해 대규모 애플리케이션에서도 일관된 라우팅 지연 시간(Latency)을 보장함을 입증하고 있습니다. 이러한 최적화 덕분에 Fluo는 매 요청마다 컨테이너를 생성하고 해제하는 오버헤드에도 불구하고 매우 높은 처리량(Throughput)을 유지할 수 있습니다.

## 11.10 리소스 정리: DI 스코프 소멸

요청 처리가 끝나면 반드시 `requestContext.container.dispose()`를 호출합니다. 이는 해당 요청 기간 동안 생성된 싱글톤이 아닌 객체들(Request-scoped providers)의 `onDispose` 훅을 실행하고 메모리를 해제하여 누수를 방지합니다.

`packages/http/src/dispatch/dispatcher.ts:L240-L255`
```typescript
async function finalizeRequest(phaseContext: DispatchPhaseContext): Promise<void> {
  try {
    await notifyObservers(phaseContext.observers, phaseContext.requestContext, (o, ctx) => o.onRequestFinish?.(ctx));
  } catch (error) {
    phaseContext.options.logger?.error('Observer onRequestFinish threw an error', error);
  } finally {
    try {
      await phaseContext.requestContext.container.dispose();
    } catch (error) {
      phaseContext.options.logger?.error('Request-scoped container dispose threw an error', error);
    }
  }
}
```

이 과정은 `finally` 블록 내에서 수행되어 요청의 성공/실패 여부와 관계없이 항상 실행되도록 보장됩니다. `packages/http/src/public-api.test.ts:L39-L52`에서는 요청 컨테이너가 해제된 후에는 해당 컨테이너에 속했던 프로바이더들에 더 이상 접근할 수 없음을 확인하여 격리 및 해제 정책이 엄격히 준수되고 있음을 증명합니다.

또한, `RequestContext` 내부에 저장된 임시 파일 참조나 열려 있는 스트림도 이 단계에서 안전하게 닫힙니다. Fluo의 HTTP 디스패처는 "Zero-leak" 지향 설계를 통해 수백만 건의 요청이 흐르는 프로덕션 환경에서도 메모리 점유율을 일정하게 유지할 수 있도록 돕습니다.

## 요약
- **범용 디스패처**: 특정 프레임워크에 얽매이지 않고 표준화된 요청 처리 파이프라인을 제공합니다.
- **10단계 파이프라인**: 전역 미들웨어부터 응답 쓰기까지 명확히 정의된 단계별 실행을 보장합니다.
- **비동기 격리**: `AsyncLocalStorage` 기반의 `RequestContext`로 요청간 데이터를 완벽히 격리합니다.
- **강력한 관찰성**: 옵저버 패턴을 통해 비즈니스 로직 수정 없이 전 구간 모니터링이 가능합니다.
- **신뢰할 수 있는 정리**: `AbortSignal` 감시와 강제 `dispose()` 호출로 리소스 낭비를 원천 차단합니다.

## 다음 챕터 예고
다음 챕터에서는 가드, 인터셉터, 미들웨어가 구체적으로 어떻게 "체인"을 형성하고 서로의 실행을 제어하는지 깊이 있게 파헤칩니다. `reduceRight`를 활용한 체인 구성의 묘미를 만나보세요.
