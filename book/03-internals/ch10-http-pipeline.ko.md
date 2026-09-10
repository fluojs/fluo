# HTTP 요청 파이프라인 해부하기

<!-- book:volume=03-internals;chapter=10 -->

[이전: 애플리케이션 시작과 실패 복구](./ch09-bootstrap-and-rollback.ko.md) · [3권 목차](./toc.ko.md) · [다음: DTO와 응답이 변환되는 과정](./ch11-dto-and-errors.ko.md)

## 주문 조회 한 건에 서로 다른 성공이 기록된 날

상점 고객이 주문 상세 화면을 열었다. 화면에는 정상 데이터가 표시되는데 서버의 요청 완료 기록에는 오류가 남았다. 컨트롤러가 성공했으므로 로깅 버그라고 단정할 수 있을까? application middleware가 `await next()` 뒤에서 실패했다면, 이미 작성한 응답과 전체 pipeline의 결과가 서로 다를 수 있다. HTTP의 성공은 handler의 반환, 응답 commit, middleware 종료, 관찰자 완료라는 여러 사건을 한 단어로 부르는 표현이다.

앞 장에서는 application이 요청을 받을 수 있는 상태까지 준비되는 과정을 보았다. 이제 같은 `fluo-blog` 안의 `AccountsModule`, `PostsModule`, `OrdersModule` 가운데 주문 조회 경로만 확대한다. 계정은 블로그에서 사용하던 계정 그대로이며, 주문의 `customerId`도 그 사용자 식별자를 참조한다. 내부 구조를 설명하기 위해 별도 사용자 시스템이나 마이크로서비스를 만들지 않는다.

이번 장의 질문은 “middleware 다음에 guard가 실행되는가”에서 끝나지 않는다. 그 전에 경로가 매칭되었는지, DTO는 언제 생성되는지, interceptor가 반환값을 바꾼 뒤 누가 응답을 쓰는지, 정리는 어디까지 기다리는지를 구분해야 한다. 이 구분이 있어야 느린 구간을 측정하고 실패한 요청에서 실행되지 않은 코드를 찾을 수 있다.

## 선언은 실행 계획이 되고, 요청 값은 나중에 들어온다

`@Controller('/orders')`와 `@Get('/:id')`는 서버에 즉시 route를 설치하는 명령이 아니다. 데코레이터가 기록한 메타데이터를 bootstrap이 수집하고, `createHandlerMapping()`이 유효 경로·method·controller token·handler 이름을 포함하는 descriptor로 만든다. `@Module({ controllers: [...] })` 등록이 빠지면 클래스에 데코레이터가 있다는 사실만으로 그 application의 경로가 되지 않는다.

`@Inject()`도 같은 선언과 실행의 구분을 따른다. `@Inject(OrdersReadModel)`은 생성자 의존성 토큰을 명시한다. 실제 인스턴스를 만드는 일은 container가 맡는다. interface만 적거나 이름이 같은 타입을 선언해도 런타임 토큰은 생기지 않는다. 다른 모듈의 provider를 사용하려면 그 모듈의 exports와 소비 모듈의 imports가 연결되어야 한다. HTTP 실행 계획은 이 DI 그래프 위에서 controller뿐 아니라 guard와 interceptor도 해석한다.

요청이 들어오면 어댑터는 native 요청을 `FrameworkRequest`로 정리한다. method, path, headers, query, cookies, params, body와 선택적인 abort surface가 공통 경계다. dispatcher는 요청별 params와 metadata를 분리하고 `RequestContext`를 만든다. native Fastify 요청 객체를 모든 서비스에 전달하는 대신 이 경계를 사용하는 이유는 타입 편의만이 아니다. 어댑터가 바뀌어도 요청 처리의 소유권과 취소 판단이 같은 표면을 통과하게 한다.

request container는 무조건 모든 요청에서 새로 만드는 것으로 일반화하면 안 된다. 현재 dispatcher는 root container로 시작하고, 활성 실행 경로가 request scope를 필요로 할 때 격리된 container로 승격할 수 있다. middleware, observer, converter, guard, interceptor, controller 의존성, 수동 container 해석이 모두 그 판단과 관련된다. 빠른 경로가 있다는 이유로 request provider를 singleton처럼 공유해서는 안 되고, 단순 경로에서도 언제나 request container가 할당된다고 성능 비용을 추정해서도 안 된다.

## 순서도를 함수 호출과 대응시키기

전체 경로의 application middleware는 handler matching보다 앞에 있다. 따라서 없는 URL을 기록하거나, 응답을 직접 끝내거나, 허용된 계약 안에서 routing 전 처리를 할 수 있다. 반면 module middleware는 매칭된 descriptor에 연결되어 있으므로 matching 뒤에 실행된다. 아직 모듈을 결정하지 못한 404를 특정 모듈 middleware가 반드시 관찰할 것이라고 기대하면 안 된다.

매칭되면 path params를 요청 컨텍스트에 반영하고 handler-matched observer를 알린다. 이어 module middleware, guard 순서로 진행한다. `runGuardChain()`은 선언 순서대로 guard를 해석하고 `canActivate()`를 기다린다. 반환값이 정확히 `false`이면 `ForbiddenException`으로 403이 된다. 미인증을 401로 구분하려면 guard가 `UnauthorizedException`을 명시적으로 던져야 한다. 모든 거부가 자동으로 로그인 필요라는 의미를 갖지는 않는다.

conditional request 설정이 있다면 guard 뒤, interceptor와 controller 앞에서 표현의 존재 여부와 validator를 평가한다. 캐시 재검증에서 304를 돌려준다는 이유로 인가를 생략하지 않는 위치다. 이 장의 실험은 조건부 요청과 content negotiation을 구성하지 않아 기본 요청 경로에 집중한다. 실제 코드에서 다른 branch가 보이면 틀린 순서도가 아니라 적용한 옵션에 따른 분기인지 먼저 살펴본다.

interceptor는 전역 목록 다음 route 목록을 안쪽으로 감싸도록 연결된다. `runInterceptorChain()`은 목록의 뒤에서부터 `CallHandler`를 만들고, 최종적으로 가장 바깥쪽 `handle()`을 호출한다. 선언 A, B의 진입은 A→B이고 복귀는 B→A다. 안쪽 반환값을 받아 변환하려면 반드시 `await next.handle()`의 결과를 사용해야 한다. 호출하지 않으면 handler까지 진행하지 않는 단락 경로가 되고, 두 번 호출하면 업무 코드도 두 번 실행될 수 있다.

chain의 terminal은 `invokeControllerHandler()`다. 여기서 controller를 해석하고, `@RequestDto()`가 있다면 binder로 입력을 만든 뒤 validation adapter로 검사하고, 마지막에 `method.call(controller, input, requestContext)`를 실행한다. DTO binding이 guard보다 앞이라고 가정해 guard에서 검증된 DTO를 꺼내려 하면 경계를 잘못 읽은 것이다. guard는 현재 request와 principal을 보고 판단하고, DTO 기반 업무 규칙은 이후 단계에서 처리한다.

handler와 interceptor chain이 끝나면 취소 상태를 다시 검사한다. 일반 반환값이고 응답이 아직 commit되지 않았다면 dispatcher의 response policy가 최종 값을 쓴다. 반환된 수동 SSE나 managed iterable에는 별도의 수명 처리가 있다. module·application middleware가 복귀한 뒤에야 request-success observer가 호출되고, finally에서 finish observer를 기다린 다음 만들어진 request scope를 dispose한다.

## 공유 로그 배열 대신 요청마다 실행 흔적 남기기

다음은 `src/orders/pipeline-lab.ts`에 둘 **완전한 실험용 모듈 파일**이다. 주문 저장소는 읽기 전용 메모리 fixture이며 운영 DB를 대체하지 않는다. 실험용 `OrdersModule`은 실제 모듈과 동시에 등록하지 않는다. 원래의 `AccountsModule` 인증 흐름은 본문 테스트의 명시적 principal fixture로 대체한다. 이 파일 자체에는 인증 정보를 신뢰하는 우회 경로가 없다.

```ts
import { Inject, Module, Scope } from '@fluojs/core';
import {
  Controller, ForbiddenException, Get, NotFoundException,
  UnauthorizedException, UseGuards, UseInterceptors,
  type CallHandler, type Guard, type GuardContext,
  type Interceptor, type InterceptorContext,
  type Middleware, type MiddlewareContext, type Next,
  type RequestContext,
} from '@fluojs/http';

@Scope('request')
export class RequestTrail {
  readonly events: string[] = [];
}

@Scope('request')
@Inject(RequestTrail)
class OrdersMiddleware implements Middleware {
  constructor(private readonly trail: RequestTrail) {}

  async handle(_context: MiddlewareContext, next: Next): Promise<void> {
    this.trail.events.push('module:before');
    try {
      await next();
    } finally {
      this.trail.events.push('module:finally');
    }
  }
}

@Scope('request')
@Inject(RequestTrail)
class OrdersGuard implements Guard {
  constructor(private readonly trail: RequestTrail) {}

  canActivate({ requestContext }: GuardContext): boolean {
    this.trail.events.push('guard');
    if (!requestContext.principal) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Scope('request')
@Inject(RequestTrail)
class OrderTraceInterceptor implements Interceptor {
  constructor(private readonly trail: RequestTrail) {}

  async intercept(
    _context: InterceptorContext,
    next: CallHandler,
  ): Promise<unknown> {
    this.trail.events.push('interceptor:before');
    try {
      const value = await next.handle();
      this.trail.events.push('interceptor:after');
      return value;
    } finally {
      this.trail.events.push('interceptor:finally');
    }
  }
}

class OrdersReadModel {
  find(id: string) {
    if (id !== 'order-1') {
      throw new NotFoundException('Order not found.');
    }
    return {
      id, customerId: 'account-1', status: 'paid' as const,
      currency: 'KRW' as const, totalMinor: 25_000, version: 2,
    };
  }
}

@Scope('request')
@Inject(OrdersReadModel, RequestTrail)
@Controller('/orders')
@UseGuards(OrdersGuard)
@UseInterceptors(OrderTraceInterceptor)
class OrdersController {
  constructor(
    private readonly orders: OrdersReadModel,
    private readonly trail: RequestTrail,
  ) {}

  @Get('/:id')
  get(_input: undefined, context: RequestContext) {
    this.trail.events.push('handler');
    const order = this.orders.find(context.request.params.id);
    if (order.customerId !== context.principal?.subject) {
      throw new ForbiddenException('Order access denied.');
    }
    return order;
  }
}

@Module({
  controllers: [OrdersController],
  middleware: [OrdersMiddleware],
  providers: [
    RequestTrail, OrdersMiddleware, OrdersGuard,
    OrderTraceInterceptor, OrdersReadModel,
  ],
  exports: [RequestTrail],
})
export class OrdersModule {}
```

기록을 request provider로 만든 것은 두 고객이 동시에 조회해도 순서를 섞지 않기 위해서다. 이를 생성자에 보관하는 middleware·guard·interceptor·controller에도 request scope를 명시했다. 요청별 의존성을 시작 시점의 singleton에 붙잡아 두지 않기 위해서다. `RequestTrail`을 singleton 배열로 바꾸면 순차 실험에서는 그럴듯한 결과가 나오지만 병렬 요청에서는 의미가 사라진다. 이 실험에서 여러 단계가 같은 trail을 받는다는 사실 자체가 request scope와 DI 해석 경로를 함께 확인한다.

컨트롤러에 소유자 검사도 남아 있다. guard는 미인증 요청을 먼저 거절하지만, 어떤 주문이 어떤 고객의 것인지는 읽어 온 주문으로 확인한다. URL의 id와 클라이언트가 보낸 customerId를 조합해 권한을 판정하지 않는다. 실제 제품에서 접근 거부와 리소스 부재의 정보 공개 정책은 별도로 정하되, 여기서는 공통 계약대로 없음은 404, 소유권 불일치는 403으로 나눈다.

middleware와 interceptor가 모두 `finally`에 기록하는 이유는 실패해도 복귀 경로를 관찰하기 위해서다. 반대로 `interceptor:after`는 `next.handle()`이 정상 반환한 경우에만 기록한다. 이 두 지점을 합쳐 버리면 “종료되었다”와 “성공했다”를 구별할 수 없다. 이 원칙은 주문을 변경하는 감사 기록에도 적용된다. 실행을 시도했다는 기록과 DB commit이 확인되었다는 기록은 같은 사건이 아니다.

## 실제 dispatcher를 통과시키는 실험

다음 `src/orders/pipeline-lab.test.ts`는 **완전한 테스트 파일**이다. listener 없이 `Application.dispatch()`를 호출하므로 소켓 전송이나 JSON 인코딩을 검증하지는 않지만, 실제 runtime이 모듈을 컴파일하고 실제 HTTP dispatcher가 middleware부터 finish까지 실행한다. response fixture는 commit 상태와 body를 보존하여 이 장에서 확인하려는 순서를 가리지 않는다.

```ts
import { expect, it } from 'vitest';
import { Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { OrdersModule, RequestTrail } from './pipeline-lab.js';

async function execute(authenticated: boolean) {
  const observed: string[][] = [];
  @Module({ imports: [OrdersModule] })
  class AppModule { }

  const app = await FluoFactory.create(AppModule, {
    middleware: [{
      async handle({ requestContext }, next) {
        if (authenticated) {
          requestContext.principal = { subject: 'account-1', claims: {} };
        }
        const trail = await requestContext.container.resolve(RequestTrail);
        trail.events.push('app:before');
        try {
          await next();
        } finally {
          trail.events.push('app:finally');
        }
      },
    }],
    observers: [{
      async onRequestFinish({ requestContext }) {
        const trail = await requestContext.container.resolve(RequestTrail);
        trail.events.push('finish');
        observed.push([...trail.events]);
      },
    }],
  });

  const request: FrameworkRequest = {
    method: 'GET', path: '/orders/order-1', url: '/orders/order-1',
    headers: {}, query: {}, cookies: {}, params: {}, raw: {},
  };
  const response: FrameworkResponse & { body?: unknown } = {
    committed: false,
    headers: {},
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; this.committed = true; },
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
  };
  try {
    await app.dispatch(request, response);
    return { response, observed };
  } finally {
    await app.close('lab-complete');
  }
}

it('shares a request trail across the complete pipeline', async () => {
  const { response, observed } = await execute(true);
  expect(response.statusCode).toBe(200);
  expect(response.body).toMatchObject({ id: 'order-1', totalMinor: 25_000 });
  expect(observed).toEqual([[
    'app:before', 'module:before', 'guard',
    'interceptor:before', 'handler', 'interceptor:after',
    'interceptor:finally', 'module:finally', 'app:finally', 'finish',
  ]]);
});

it('rejects before interceptors but still finishes the request', async () => {
  const { response, observed } = await execute(false);
  expect(response.statusCode).toBe(401);
  expect(observed).toEqual([[
    'app:before', 'module:before', 'guard',
    'module:finally', 'app:finally', 'finish',
  ]]);
});
```

```bash
pnpm exec vitest run src/orders/pipeline-lab.test.ts
```

principal을 주입하는 부분은 테스트 fixture에만 있다. 운영에서는 기존 인증 계층이 검증한 JWT subject나 세션 계정으로 같은 `RequestContext.principal`을 설정해야 한다. 요청 헤더의 임의 문자열을 그대로 subject로 복사하는 코드를 이 fixture 대신 배포하면 파이프라인 테스트는 통과해도 인증은 성립하지 않는다.

위 실험의 예상 결과는 첫 테스트의 사건 배열과 두 번째 테스트에서 사라지는 interceptor·handler 기록이다. 본문 예제를 이 집필 작업에서 실행했다고 주장하지 않는다. 이미 저장소에 있는 `dispatcher-lifecycle-ordering.test.ts`는 middleware 복귀 뒤 success가 발생하고 finish 완료 뒤 disposal이 실행되는 별도 근거다. 그 테스트를 읽은 사실과 새 테스트를 자신의 앱에서 통과시킨 사실은 구분해 기록한다.

## 반환값 하나와 응답 작성자 하나

초기의 주문 컨트롤러는 객체를 반환했다. 이 경우 interceptor는 그 객체를 감싸거나 변환하고 dispatcher가 결과를 commit한다. 이후 다운로드 기능을 추가하며 `context.response.send()`로 직접 응답을 쓰면 작성자가 바뀐다. 직접 작성한 뒤 또 다른 값을 반환해도 dispatcher는 두 번째 성공 응답을 쓰지 않는다. 그러나 interceptor의 JavaScript 실행까지 중단되는 것은 아니다.

여기서 흔한 오류는 “어차피 serializer interceptor가 있으므로 먼저 원본 객체를 send해도 나중에 비밀 필드가 빠지겠지”라는 생각이다. commit된 payload는 이미 다른 소유권 아래 있다. serializer는 그 경우 serialization을 우회하고, dispatcher도 최종 chain 값을 다시 쓰지 않는다. 직접 응답을 쓰는 handler는 commit 전에 공개 필드와 인코딩을 완성해야 한다. 자세한 DTO 경계는 다음 장에서 다룬다.

또 다른 오류는 middleware의 `await next()` 이후를 response commit 이전이라고 가정하는 것이다. 일반 전체 경로에서는 안쪽 handler 처리 중 성공 응답 작성이 이미 끝날 수 있다. 후행 middleware가 throw하면 error observer는 전체 pipeline의 실패를 관찰하지만, error writer는 이미 commit된 응답을 500으로 교체할 수 없다. 처음의 “고객은 200을 받았지만 요청 로그는 오류”라는 사고는 이 경계에서 설명된다.

그래서 응답 헤더를 반드시 포함해야 하는 정책은 `next()` 전에 적용하거나, 해당 목적의 문서화된 response policy를 사용한다. 후행 작업에는 측정 종료나 로컬 정리처럼 응답을 다시 쓸 필요가 없는 일을 둔다. 실패할 수 있는 필수 결제 기록을 응답 뒤에 실행하는 구조는 더더욱 적절하지 않다. 그런 업무는 주문 트랜잭션과 outbox 등 애플리케이션이 소유한 완료 조건 안으로 옮겨야 한다.

## 빠른 경로를 이해하되 구현을 계약으로 오해하지 않기

소스에서 `tryFastPathExecution()`이나 native route handoff를 만나면 앞의 설명이 모든 요청의 정확한 함수 호출 목록은 아니라는 사실이 드러난다. 단순한 handler에서는 일반 경로의 일부 준비를 피할 수 있다. observers나 conditional request 같은 설정은 더 완전한 lifecycle 경로를 선택하게 한다. 따라서 관찰자를 추가한 벤치마크와 없는 벤치마크를 같은 실행 비용으로 비교하면 안 된다.

최적화의 목적은 관찰 가능한 계약을 버리는 것이 아니다. 취소된 signal을 보존하고, 필요한 request scope를 격리하며, handler가 직접 commit한 응답을 다시 쓰지 않는 성질은 유지되어야 한다. 새로운 guard를 넣었더니 속도가 달라졌다면 먼저 해당 route의 실행 경로와 DI graph가 달라졌는지 확인한다. 특정 내부 helper가 호출되었다는 assertion보다 필요한 guard가 실제로 실행되었는지 확인하는 테스트가 오래간다.

실험에 observer를 넣은 것은 finish를 관찰하기 위한 의도적 선택이다. 이 테스트로 최저 지연 시간을 주장할 수는 없다. 또한 request finish는 response stream과 handler 생명주기가 끝나는 dispatcher 사건이지 고객이 화면을 실제로 읽었다는 확인이 아니다. 네트워크 전송 완료나 브라우저 수신 확인까지 필요한 기능이라면 호스트와 클라이언트의 별도 관찰이 필요하다.

## 어디에서 실패했는지 검증하기

요청 경로가 없는 실험에서는 application middleware는 실행되어도 Orders module middleware와 guard는 실행되지 않아야 한다. 주문 자체가 없는 실험은 route가 존재하므로 middleware·guard·interceptor가 실행되고 handler의 저장소 조회에서 404가 발생한다. 두 실패를 같은 404 숫자로만 검사하면 routing 문제와 데이터 문제를 구별하지 못한다.

잘못된 DTO 실험에서는 guard와 interceptor 진입까지 기록되고 실제 handler 본문은 실행되지 않는지 확인한다. interceptor가 `finally`에서 기록하는 사건은 남아야 한다. 다른 고객의 주문을 읽는 실험에서는 handler의 소유권 확인이 403을 만들고, 응답 객체에 주문의 금액이나 내부 데이터가 섞이지 않아야 한다. 이후 성공 조회가 정상 동작하는지도 확인하면 request metadata가 다음 요청으로 새지 않는지 볼 수 있다.

동시성 검증은 두 request trail을 서로 다른 requestId로 수집한다. 둘 다 handler 진입을 알리는 promise를 먼저 준비하고, 두 진입을 확인한 뒤 해제하는 방식이면 두 요청이 실제로 겹친다. 하나의 전역 배열에서 우연히 순서가 맞기를 기다리지 않는다. 각 요청의 배열이 자기 사건만 가지는 것이 기대 결과다. 요청이 끝난 뒤 호출하는 비동기 작업이 `getCurrentRequestContext()`를 당연히 사용할 수 있다고도 가정하지 않는다.

finish observer가 실패하는 경우에도 뒤의 정리가 중단되지 않는지 소스와 테스트로 확인한다. 운영 관찰 코드는 요청을 다시 실행하거나 응답을 수정하는 수단이 아니다. 요청 body, 인증 토큰, 쿠키 전체를 사건 배열에 넣지 말고 requestId, route 식별자, 단계, 결과처럼 필요한 정보만 남긴다. 무엇이 실행되지 않았는지 설명할 수 있을 정도면 충분하다.

이제 `/orders/:id`는 하나의 데코레이터 함수가 아니라 metadata, mapping, request context, DI, middleware, guard, binding, interceptor, response policy가 함께 만든 경로로 보인다. 다음 장에서는 그 가운데 입력이 DTO가 되고 출력이 공개 JSON이 되는 두 변환을 분리한다. 같은 “객체 변환”처럼 보여도 잘못된 입력을 거부하는 규칙과 내부 필드를 숨기는 규칙은 서로 대신할 수 없다.

## 소스와 확인 근거

- [HTTP README](../../packages/http/README.ko.md), [HTTP 공개 export](../../packages/http/src/index.portable.ts)
- [core README의 DI·scope·module 계약](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts)
- [handler mapping](../../packages/http/src/mapping.ts), [dispatcher](../../packages/http/src/dispatch/dispatcher.ts)
- [guard 실행](../../packages/http/src/guards.ts), [interceptor chain](../../packages/http/src/interceptors.ts), [controller 호출과 DTO 경계](../../packages/http/src/dispatch/dispatch-handler-policy.ts)
- [lifecycle 순서 테스트](../../packages/http/src/dispatch/dispatcher-lifecycle-ordering.test.ts), [취소 경로 테스트](../../packages/http/src/dispatch/dispatcher-cancellation.test.ts)
- [HTTP runtime 계약](../../docs/architecture/http-runtime.ko.md)

이 장의 실험은 dispatcher 내부 표면을 대상으로 설계했다. 실제 Fastify listener, 프록시, TLS 연결에서의 전송 결과나 지연 시간은 이 실험만으로 검증되지 않는다.
