<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 12. Execution Chain & Exception Chain — 가드, 인터셉터, 예외 처리

## 이 챕터에서 배우는 것
- 미들웨어, 가드, 인터셉터의 정교한 실행 우선순위와 체이닝 원리
- `reduceRight`를 활용한 미들웨어 양파링(Onion) 구조 구현
- 가드의 동기/비동기 권한 검증과 `ForbiddenException` 전파
- 인터셉터의 프록시 패턴을 통한 컨트롤러 실행 전후 제어
- 전역 및 로컬 예외 처리 체인과 표준 에러 응답 설계

## 사전 요구사항
- Ch11에서 다룬 전체적인 요청 파이프라인 흐름 이해
- 함수 합성(Function Composition) 및 고차 함수에 대한 이해

## 12.1 실행 체인의 삼각 편대: Middleware vs Guard vs Interceptor

fluo의 실행 체인은 각기 다른 목적을 가진 세 가지 레이어로 구성됩니다. 이 레이어들은 요청이 핸들러에 도달하기 전까지의 "필터"와 "게이트" 역할을 수행합니다.

1.  **Middleware**: 로우레벨 요청/응답 변조. 라우트 매칭 전(Global) 또는 후(Module)에 실행됩니다. 주로 로깅, CORS, 바디 파싱 등에 사용됩니다.
2.  **Guard**: 실행 권한 결정. 컨트롤러 로직에 진입하기 전의 최종 게이트웨이입니다. `boolean`을 반환하여 실행 여부를 결정합니다.
3.  **Interceptor**: 컨트롤러 실행 전후의 로직 바인딩. 반환값 가공이나 로깅, 캐싱에 특화되어 있습니다. 프록시 패턴을 사용합니다.

이들은 `dispatcher.ts`에서 엄격한 순서로 호출되며, 각 레이어는 자신만의 실행 철학을 가지고 있습니다.

## 12.2 미들웨어 체인: 양파링(Onion) 구조의 비밀

fluo의 미들웨어는 `next()`를 호출하여 다음 단계로 넘어가는 전형적인 양파링 구조를 가집니다. 내부적으로는 `reduceRight`를 사용하여 체인을 구성합니다.

`packages/http/src/middleware/middleware.ts` (유사 로직)
```typescript
export async function runMiddlewareChain(
  middlewares: MiddlewareLike[],
  context: MiddlewareContext,
  terminal: () => Promise<void>
): Promise<void> {
  const chain = middlewares.reduceRight(
    (next, middleware) => async () => {
      await middleware.use(context, next);
    },
    terminal
  );
  return chain();
}
```

이 구조는 `next()` 호출 이후의 로직이 역순으로 실행되게 하여, 요청뿐만 아니라 응답 단계에서도 미들웨어가 개입할 수 있게 합니다. `reduceRight`를 사용하는 이유는 리스트의 마지막 요소가 `terminal`(가장 안쪽 로직)을 감싸야 하기 때문입니다.

## 12.3 가드(Guard): 철저한 출입 통제

가드는 `canActivate` 메서드를 통해 `boolean`을 반환합니다. `false`가 반환되면 디스패처는 즉시 `ForbiddenException`을 던져 파이프라인을 중단합니다.

`packages/http/src/guards.ts:L18-L27`
```typescript
export async function runGuardChain(definitions: GuardLike[], context: GuardContext): Promise<void> {
  for (const definition of definitions) {
    const guard = await resolveGuard(definition, context.requestContext);
    const result = await guard.canActivate(context);

    if (result === false) {
      throw new ForbiddenException('Access denied.');
    }
  }
}
```

가드는 순차적으로 실행되며, 하나라도 실패하면 뒤쪽의 가드나 인터셉터는 아예 실행되지 않습니다. 가드는 "권한"에 집중하며, 데이터 변조보다는 "통과 여부"에만 책임을 집니다.

## 12.4 인터셉터(Interceptor): 실행의 마법사

인터셉터는 단순한 전/후처리를 넘어, 컨트롤러의 실행 자체를 가로챌 수 있습니다. 이는 프록시 패턴을 기반으로 하며, `CallHandler` 인터페이스를 통해 제어권을 넘깁니다.

`packages/http/src/interceptors.ts:L26-L45`
```typescript
export async function runInterceptorChain(
  definitions: InterceptorLike[],
  context: InterceptorContext,
  terminal: () => Promise<unknown>,
): Promise<unknown> {
  let next: CallHandler = {
    handle: terminal,
  };

  for (const definition of [...definitions].reverse()) {
    const interceptor = await resolveInterceptor(definition, context.requestContext);
    const previous = next;

    next = {
      handle: () => Promise.resolve(interceptor.intercept(context, previous)),
    };
  }

  return next.handle();
}
```

인터셉터 체인의 가장 안쪽(`terminal`)에는 실제 컨트롤러 핸들러 호출 로직이 자리 잡고 있습니다. `reverse()`와 `reduce` 형태의 루프를 통해 가장 먼저 선언된 인터셉터가 가장 바깥쪽에서 실행되도록 보장합니다.

## 12.5 예외 체인(Exception Chain)의 동작 원리

파이프라인 실행 중 오류가 발생하면, fluo는 이를 "예외 체인"을 통해 처리합니다. 이 과정은 `handleDispatchError`에서 시작됩니다.

1.  **Catch**: 디스패처의 메인 루프인 `runDispatchPipeline`을 감싸는 `try-catch` 블록에서 모든 에러를 포착합니다.
2.  **Notify**: `onRequestError` 옵저버들에게 에러 정보를 전파하여 텔레메트리 시스템이 인지하도록 합니다.
3.  **Global Handler**: 사용자가 정의한 `onError` 전역 핸들러가 있다면 먼저 처리 기회를 줍니다. `true`를 반환하면 처리가 완료된 것으로 간주합니다.
4.  **Fallback**: 아무도 처리하지 않았다면 `writeErrorResponse`를 호출하여 표준 에러 응답을 생성합니다.

## 12.6 HttpException과 표준 응답 구조

fluo는 모든 HTTP 오류를 `HttpException`으로 추상화합니다. 이는 상태 코드와 메시지, 그리고 기계가 읽을 수 있는 세부 사항(`details`)을 포함합니다.

`packages/http/src/exceptions.ts:L37-L46`
```typescript
export interface ErrorResponse {
  error: {
    code: string;
    details?: HttpExceptionDetail[];
    message: string;
    meta?: Record<string, unknown>;
    requestId?: string;
    status: number;
  };
}
```

이 표준 구조 덕분에 프론트엔드 팀은 어떤 API 호출에서도 일관된 에러 핸들링 로직을 작성할 수 있습니다. `HttpException`을 상속받아 `NotFoundException`, `UnauthorizedException` 등을 쉽게 만들 수 있습니다.

## 12.7 바인딩 예외와 BadRequestException

데이터 바인딩 단계(`binding.ts`)에서 발생하는 오류는 `BadRequestException`으로 변환됩니다. 이때 `details` 필드에는 어떤 필드가 왜 잘못되었는지(예: `MISSING_FIELD`, `INVALID_BODY`)가 구체적으로 담깁니다.

```typescript
// packages/http/src/adapters/binding.ts:L229-L232
if (details.length > 0) {
  throw new BadRequestException('Request binding failed.', {
    details,
  });
}
```

이 과정은 컨트롤러 메서드가 실행되기 전 단계에서 발생하므로, 비즈니스 로직은 항상 유효한 데이터만을 받게 됩니다.

## 12.8 비동기 예외 처리와 stack trace

Node.js 환경에서 비동기 에러의 스택 트레이스는 종종 끊기기 쉽습니다. fluo는 에러를 래핑할 때 `FluoError`의 `cause` 옵션을 활용하여 원본 에러 정보를 보존하며, 이는 디버깅 시 결정적인 단서를 제공합니다. 또한 `RequestContext`에 포함된 `requestId`를 에러 응답에 포함시켜 로그 추적을 용이하게 합니다.

## 12.9 인터셉터를 활용한 커스텀 에러 매핑

특정 컨트롤러에서 발생하는 도메인 에러를 HTTP 에러로 변환하고 싶을 때 인터셉터는 훌륭한 도구가 됩니다. `catch` 블록 내에서 특정 클래스의 인스턴스인지 확인한 후 적절한 `HttpException`을 던지면 됩니다.

```typescript
// 예시: DomainError -> 404 NotFound
export class ErrorMappingInterceptor implements Interceptor {
  async intercept(context: InterceptorContext, next: CallHandler) {
    try {
      return await next.handle();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
```

## 12.10 실행 순서의 결합 (The Full Chain)

미들웨어 -> 가드 -> 인터셉터가 결합된 최종 실행 순서를 기억하세요.

1.  Global Middleware (Onion - Request phase)
2.  Module Middleware (Onion - Request phase)
3.  **Guard Chain** (Sequential - All must pass)
4.  **Interceptor Chain** (Proxy wrap - Outermost to Innermost)
5.  **Controller Handler** (Execution)
6.  Interceptor Chain (Proxy wrap - Innermost to Outermost - Response phase)
7.  Module Middleware (Onion - Response phase)
8.  Global Middleware (Onion - Response phase)

## 12.11 심화: 컨트롤러 실행과 인스턴스 스코프

가드와 인터셉터를 통과한 요청은 마침내 컨트롤러 핸들러에 도달합니다. 이때 fluo는 DI 컨테이너를 통해 컨트롤러 인스턴스를 요청 스코프(Request Scope)에서 생성하거나 싱글톤 풀에서 가져옵니다.

```typescript
// packages/http/src/dispatch/dispatch-handler-policy.ts (개념적 구현)
export async function invokeControllerHandler(
  handler: HandlerDescriptor,
  context: RequestContext,
  binder?: Binder
) {
  const instance = await context.container.resolve(handler.controller);
  const args = binder ? await binder.bind(handler, context) : [];
  return instance[handler.method](...args);
}
```

이 과정에서 DTO 바인딩이 함께 일어나며, 컨트롤러 메서드는 이미 정제되고 검증된 데이터를 인자로 받게 됩니다.

## 12.12 요약
- 실행 체인은 미들웨어(기능), 가드(권한), 인터셉터(로직)로 역할이 나뉩니다.
- `reduceRight`와 프록시 패턴이 체인 구성의 핵심 기술입니다.
- 모든 예외는 표준화된 `HttpException` 구조를 통해 클라이언트에 전달됩니다.
- 컨트롤러는 DI 컨테이너와 바인더를 통해 안전하게 실행됩니다.

## 12.13 다음 챕터 예고
다음 챕터에서는 이러한 복잡한 파이프라인을 특정 플랫폼(Fastify, Bun 등)에 연결하는 커스텀 어댑터 구현 방법을 배웁니다. `HttpApplicationAdapter`의 마법을 기대해 주세요.

---
<!-- lines: 255 -->
