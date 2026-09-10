# 주문 요청 하나를 소스 끝까지 따라가기

<!-- book:volume=03-internals;chapter=01 -->

[이전: 2권 마지막 장 — 장애 훈련으로 FluoShop 완성하기](../02-fluoshop/ch28-failure-drills.ko.md) · [3권 목차](./toc.ko.md) · [다음: 표준 데코레이터와 빌드 도구의 역할](./ch02-standard-decorators.ko.md)

## 고객이 받은 404에서 출발하기

FluoBlog의 독자가 로고 티셔츠를 주문했다. 블로그에서 쓰던 계정으로 로그인했고, 주문 생성 응답에서 `order-1001`을 받았다. 그런데 주문 내역 화면을 새로 고침하자 404가 나타난다. 운영자는 데이터베이스에서 주문을 찾았으므로 저장 실패는 아니라고 생각한다. 프런트엔드 개발자는 `/orders/order-1001`을 호출했다고 말한다. 이제 “라우트가 없다”와 “라우트는 실행됐지만 주문이 없다”를 구분해야 한다. 두 경우 모두 HTTP 상태는 404일 수 있지만, 조사할 소스와 고칠 경계는 완전히 다르다.

이 권의 대상은 새 상점이 아니다. 앞의 두 권에서 발전시킨 같은 `fluo-blog` 애플리케이션이다. 계정과 게시글은 남아 있고, 상품·재고·주문 모듈이 추가되었으며, 필요한 배송 처리만 별도 프로세스로 나갔다. 여기서는 그 제품의 주문 조회 하나를 작게 떼어 엔진을 살펴본다. 전체 상점을 메모리 저장소로 되돌리는 것이 아니다. 데이터베이스와 인증 서버에 연결하지 않는 진단 실험을 만들고, 어디까지 실제 프레임워크를 통과했는지 구분한다. 저장소에 모든 장의 누적 완성 앱이 이미 있다는 전제도 두지 않는다.

소스를 읽는 목적은 함수 이름을 외우는 데 있지 않다. 요청이 실패했을 때 다음 세 질문을 증거로 답할 수 있어야 한다. 선언한 컨트롤러가 부트스트랩에 들어갔는가? 요청 경로가 그 컨트롤러의 메서드에 매칭됐는가? 매칭된 뒤 서비스가 어떤 계정과 주문 ID로 호출됐는가? 이 질문은 각각 모듈 메타데이터, 컴파일된 라우트, 요청 실행에 대응한다. 같은 로그 메시지를 여러 층에 추가하기 전에, 각 층이 어떤 사실을 소유하는지 먼저 정하자.

## 관찰 가능한 최소 주문 경로

아래 `src/orders/trace-orders.ts`는 **독립된 진단 실험의 완전한 파일**이다. 운영용 `OrdersModule`과 동시에 등록하지 않는다. 조회 포트는 `OrderLookup` 인터페이스이고 실제 DI 토큰은 `ORDER_LOOKUP`이다. 주문 상태 타입은 공통 계약의 이름을 유지하며, 저장소 fixture에는 이미 결제가 끝난 주문 하나만 넣는다. `totalMinor`는 내부에서 `bigint`, HTTP에서는 십진 문자열이다. 결제나 재고 변경은 이 실험에 없다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  FromPath,
  Get,
  NotFoundException,
  RequestDto,
  UnauthorizedException,
  type RequestContext,
} from '@fluojs/http';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: bigint;
  version: number;
}

export interface OrderLookup {
  find(id: string): Promise<Order | undefined>;
}

export const ORDER_LOOKUP = Symbol('ORDER_LOOKUP');
export const lookupCalls: string[] = [];

const fixture: Readonly<Order> = Object.freeze({
  id: 'order-1001',
  customerId: 'account-7',
  status: 'paid',
  currency: 'KRW',
  totalMinor: 29000n,
  version: 2,
});

const lookup: OrderLookup = {
  async find(id) {
    lookupCalls.push(id);
    return id === fixture.id ? { ...fixture } : undefined;
  },
};

@Inject(ORDER_LOOKUP)
export class OrdersService {
  constructor(private readonly orders: OrderLookup) {}

  async findForCustomer(id: string, customerId: string) {
    if (!/^order-[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException('Invalid order id');
    }
    const order = await this.orders.find(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Order belongs to another account');
    }
    return {
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      currency: order.currency,
      totalMinor: order.totalMinor.toString(),
      version: order.version,
    };
  }
}

class FindOrderRequest {
  @FromPath('id')
  id = '';
}

@Controller('/orders')
@Inject(OrdersService)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('/:id')
  @RequestDto(FindOrderRequest)
  find(input: FindOrderRequest, context: RequestContext) {
    const subject = context.principal?.subject;
    if (!subject) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.orders.findForCustomer(input.id, subject);
  }
}

@Module({
  providers: [
    { provide: ORDER_LOOKUP, useValue: lookup },
    OrdersService,
  ],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
```

인터페이스와 토큰을 분리한 이유가 있다. TypeScript의 `OrderLookup`은 타입 검사 뒤 사라진다. 생성자에 그 타입을 적었다고 컨테이너가 `lookup` 객체를 찾을 수는 없다. 클래스 위의 `@Inject(ORDER_LOOKUP)`이 생성자 첫 인수의 런타임 의미를 기록하고, `providers`의 descriptor가 그 토큰에 실제 값을 연결한다. 컨트롤러 역시 `@Inject(OrdersService)`와 `controllers` 등록이 모두 필요하다. 소스 파일을 import하는 일, 클래스를 데코레이션하는 일, 애플리케이션 그래프에 등록하는 일은 서로 다른 작업이다.

조회용 fixture는 동결된 원본을 직접 반환하지 않고 얕은 복사본을 반환한다. 이 주문은 원시 값만 가진 평평한 객체이므로 충분하다. 중첩된 주문 항목 배열이 있었다면 복사 계약을 다시 정해야 한다. 여기서 복사는 테스트 호출끼리 값을 바꿔 읽는 일을 막는 것이며, DB 트랜잭션이나 동시 갱신 제어를 대신하지 않는다. `lookupCalls`도 실험의 관찰 장치일 뿐이다. 운영 서버의 singleton 배열에 요청 기록을 계속 쌓는 설계로 가져가면 안 된다.

권한 판단은 경로의 `customerId`가 아니라 기존 인증 결과의 `principal.subject`를 사용한다. 본문 실험은 인증 자체를 구현하지 않는다. 아래 실행 파일이 신뢰된 fixture principal을 주입한다. 운영에서는 1권의 인증 경계가 같은 자리를 채운다. 타인 소유 주문은 편집 계약에 따라 403으로 구분하지만, 리소스 존재를 숨겨야 하는 제품이라면 서비스의 응답 정책을 별도로 결정해야 한다. 프레임워크는 계정과 주문의 소유 관계를 추론하지 않는다.

## 서버 소켓 없이 실제 디스패처 통과시키기

`src/trace-app.ts`도 **완전한 실험 파일**이다. 실제 `src/app.ts`를 덮어쓰지 않는다. 기존 앱에서는 `AccountsModule`, `PostsModule` 등의 imports를 유지하며 주문 기능을 연결하지만, 이 실험에서는 문제의 경로만 등록한다.

```ts
import { Module } from '@fluojs/core';
import { OrdersModule } from './orders/trace-orders.js';

@Module({ imports: [OrdersModule] })
export class TraceAppModule {}
```

다음 `src/trace-main.ts`는 **완전한 실험 진입점**이다. 실행 기준은 Node24와 pnpm10이며, TypeScript를 직접 Node에 넘기지 않고 다음 장에서 설명할 표준 데코레이터 빌드 경계를 사용한다. `ensureMetadataSymbol()` 다음의 dynamic import는 의도적이다. HTTP의 표준 데코레이터가 평가되기 전에 메타데이터 심벌이 준비되어야 한다.

```ts
import assert from 'node:assert/strict';
import { ensureMetadataSymbol, getModuleMetadata } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';
import {
  createWebFrameworkRequest,
  createWebRequestResponseFactory,
} from '@fluojs/runtime/web';

ensureMetadataSymbol();
const { TraceAppModule } = await import('./trace-app.js');
const { OrdersModule, OrdersController, lookupCalls } =
  await import('./orders/trace-orders.js');

assert.ok(
  getModuleMetadata(OrdersModule)?.controllers?.includes(OrdersController),
);

const app = await FluoFactory.create(TraceAppModule, {
  middleware: [{
    handle(context, next) {
      context.requestContext.principal = {
        subject: 'account-7',
        claims: {},
      };
      return next();
    },
  }],
});
const responseFactory = createWebRequestResponseFactory();

async function request(path: string) {
  const incoming = new Request(`http://trace.local${path}`);
  const request = await createWebFrameworkRequest(incoming, incoming.signal);
  const response = responseFactory.createResponse(incoming.signal, incoming);
  await app.dispatch(request, response);
  return response.toResponse();
}

try {
  const found = await request('/orders/order-1001');
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), {
    id: 'order-1001',
    customerId: 'account-7',
    status: 'paid',
    currency: 'KRW',
    totalMinor: '29000',
    version: 2,
  });

  const missing = await request('/orders/order-9999');
  assert.equal(missing.status, 404);
  assert.deepEqual(lookupCalls, ['order-1001', 'order-9999']);

  const invalid = await request('/orders/not-an-order');
  assert.equal(invalid.status, 400);
  const wrongRoute = await request('/order/order-1001');
  assert.equal(wrongRoute.status, 404);
  assert.deepEqual(lookupCalls, ['order-1001', 'order-9999']);

  console.log('order trace assertions passed');
} finally {
  await app.close();
}
```

이 실행은 실제 모듈 컴파일, DI, HTTP 매핑, DTO 바인딩, 컨트롤러 호출, 예외 응답을 통과한다. 반면 TCP 수신, Fastify의 요청 변환, 프록시 경로 재작성은 통과하지 않는다. `http://trace.local`은 `Request` 값을 만드는 식별자이며 네트워크 접속 대상이 아니다. `createWebFrameworkRequest()`가 표준 Web 요청을 프레임워크 요청으로 바꾸고, Web 응답 factory가 만들어 준 응답에 `app.dispatch()`가 쓴다. 따라서 필드 몇 개만 흉내 낸 응답 mock보다 실제 응답 경계를 더 많이 검증하면서도 포트를 열지 않는다.

`FluoFactory.create()`에 어댑터를 생략하는 것은 이 실험의 의도다. 이 상태에서 `listen()`하면 서버가 생기는 것이 아니라 어댑터가 없다는 오류가 난다. DI만 시험하려면 `createApplicationContext()`가 더 적합하지만, 이번에는 HTTP 디스패처까지 필요하므로 애플리케이션 셸을 사용한다. `app.dispatch()`를 끝까지 await한 뒤 응답을 읽고 `finally`에서 닫아, 비동기 처리가 남은 상태에서 다음 실험으로 넘어가지 않도록 했다.

처음 두 요청은 저장소까지 도달한다. 잘못된 주문 ID는 서비스의 형식 검사에서 멈추고, 잘못된 단수형 경로는 라우트 매칭에서 멈춘다. 마지막 배열 단언은 이 차이를 관찰한다. 모든 오류를 “404가 나왔다”로만 검사하면 잘못된 라우트를 주문 부재로 착각할 수 있다. 상태 코드와 호출된 경계라는 두 증거를 함께 봐야 한다.

## 선언이 실행 계획이 되는 지점

`@fluojs/core`의 `src/decorators.ts`에서 `Module()`을 읽으면 반환한 클래스 데코레이터가 `defineModuleMetadata(target, definition)`을 호출하는 것을 볼 수 있다. 그때 OrdersService를 생성하지 않으며, HTTP 라우터에 경로를 등록하지도 않는다. `Inject()` 역시 주어진 토큰 목록을 복사하여 클래스 DI 메타데이터로 기록한다. 이 시점은 클래스 선언이 평가되는 시점이다. 주문 요청이 도착할 때마다 이 기록을 새로 만드는 것이 아니다.

`@fluojs/runtime`의 `src/bootstrap.ts`로 이동하면 `bootstrapModule()`이 `compileModuleGraph()`를 호출한다. 그래프 컴파일은 imports를 따라 모듈 정의를 읽고 provider 선언과 가시성을 검사한다. `OrdersService`가 `ORDER_LOOKUP`을 요구하는데 같은 모듈의 providers에 없고 imported module에서도 export되지 않았다면, 정상 요청 처리까지 기다리지 않고 구성 문제를 찾아야 한다. `exports`는 클래스의 TypeScript `export` 키워드와 다르다. 전자는 모듈 간 DI 가시성이고 후자는 ESM 파일 간 이름 가시성이다.

이 구분을 이용하면 404 조사에서 먼저 볼 곳이 정해진다. `OrdersModule` 자체를 루트 imports에서 빼면 클래스에 `@Controller`가 있어도 부트스트랩이 그 컨트롤러를 발견할 이유가 없다. 반대로 모듈이 들어왔지만 필요한 토큰이 빠지면 그래프 검증 오류가 관찰될 수 있다. 이 두 고장을 같은 “자동 탐색 실패”라고 부르면 해결책이 흐려진다. Fluo의 명시적 등록은 파일 시스템을 검색해 모든 클래스를 임의로 활성화하는 모델이 아니다.

그다음 runtime의 `createHandlerSources()`가 컴파일된 모듈에서 컨트롤러와 소유 모듈 정보를 꺼내고, HTTP의 `src/mapping.ts`에 있는 `createHandlerMapping()`으로 전달한다. `createHandlerDescriptors()`는 컨트롤러의 `/orders`와 메서드의 `/:id`를 결합하여 `/orders/:id`를 만든다. 요청 DTO, guards, interceptors, 모듈 미들웨어도 descriptor에 연결된다. 여기서 만들어진 정보가 요청마다 데코레이터 함수를 다시 부르는 대신 사용하는 실행 자료다.

중복 경로도 이 층에서 의미가 생긴다. 서로 다른 파일의 두 컨트롤러가 같은 method·path·version 조합을 만들면 “먼저 등록된 것이 이긴다”에 기대지 않고 `RouteConflictError`로 거부한다. 같은 fixture를 기존 운영 `OrdersModule`과 나란히 넣지 말라고 한 이유다. 진단 코드가 정상 경로를 가리거나 우연한 등록 순서로 결과가 바뀌면 관찰 자체가 오염된다. 또한 descriptor는 부트스트랩 시점의 스냅샷이다. 실행 중인 앱 옆에서 데코레이터 메타데이터만 고쳤다고 현재 라우터가 다시 컴파일되는 것으로 생각하면 안 된다.

## 요청 안에서 실제로 일어나는 순서

HTTP의 `src/dispatch/dispatcher.ts`에서 이번 실험의 일반 경로를 읽자. 애플리케이션 미들웨어가 요청을 감싼 뒤 매핑을 찾고, path params를 요청 컨텍스트에 넣는다. 매칭된 모듈의 미들웨어가 이어지고, `dispatchMatchedHandler()`가 guard chain을 실행한다. 필요한 요청 scope는 실행 계획에 따라 확보한다. 모든 요청마다 항상 새 컨테이너를 만든다는 식으로 최적화 경로까지 일반화할 필요는 없다.

특히 가드와 DTO의 순서를 주의해야 한다. 현재 구현에서 가드는 컨트롤러 호출 경계보다 먼저 실행된다. `src/dispatch/dispatch-handler-policy.ts`의 `invokeControllerHandler()` 안에서 컨트롤러를 resolve하고, `@RequestDto`가 있으면 binder로 입력을 만들며, 필요한 validation 계획이 있으면 검증한 뒤 `method.call(controller, input, requestContext)`를 호출한다. 인터셉터는 이 호출을 감쌀 수 있다. “DTO 검증 뒤 가드가 실행된다”는 기억을 다른 프레임워크에서 가져오면 인증 가드가 아직 만들어지지 않은 입력 객체에 의존하는 오류를 낳는다.

실험에서는 검증 패키지 데코레이터를 추가하지 않았다. `@FromPath('id')`는 어디서 값을 가져올지를 선언하고, `OrdersService`가 주문 ID의 제품 규칙을 검사한다. 바인딩과 제품 유효성은 별개다. DTO 필드의 초기값 `''`도 유효한 주문 ID를 보장하지 않는다. 기본값은 클래스 필드를 정의하고 빌드 계약을 만족시키며, 실제 값의 허용 범위는 별도의 판단이 담당한다.

핸들러가 값을 반환하면 디스패처가 성공 응답을 작성한다. `bigint`를 그대로 JSON에 넘기지 않고 서비스의 공개 결과에서 문자열로 바꾼 까닭이 여기서 드러난다. 내부 계산이 정수라는 사실과 HTTP 직렬화가 가능한 값이라는 사실을 모두 만족시켜야 한다. 핸들러가 이미 `context.response`를 commit했다면 프레임워크는 두 번째 성공 응답을 쓰지 않는다. 이번 코드는 값을 반환하는 한 가지 방식만 택해 응답 소유권을 분명히 했다.

마지막으로 요청 종료는 컨트롤러의 return과 같지 않다. 미들웨어가 `await next()` 이후 수행하는 작업까지 settle되어야 성공 observer가 호출된다. 그 후 finish 통지가 이어지고 필요한 request scope 정리가 이루어진다. 컨트롤러는 성공했지만 바깥 미들웨어가 나중에 실패하는 경우도 있다. 그때 먼저 성공 이벤트를 내보내면 주문 조회 성공률이 과장된다. 관련 회귀 테스트가 결과뿐 아니라 lifecycle 순서를 배열로 검증하는 이유다.

## 실패를 바꿔 넣어 경계를 확인하기

이제 코드 한 군데씩만 바꿔 예상 관찰을 기록한다. 첫째, `TraceAppModule`에서 OrdersModule import를 제거하면 주문 경로는 매칭되지 않아야 하고 `lookupCalls`는 비어 있어야 한다. 둘째, 토큰 등록을 제거하면 시작 또는 DI 해석 경계에서 구성 오류가 드러나야 한다. 이 둘을 확인하면서 요청에 대한 404 테스트와 bootstrap 실패 테스트를 분리한다. 실패가 일어난 시간을 구분하는 것이 계층을 구분하는 가장 쉬운 방법이다.

셋째, 실험 principal을 `account-8`로 바꾸면 같은 주문 조회가 403이어야 한다. principal 설정 자체를 제거하면 401이어야 하고 저장소 호출도 일어나지 않아야 한다. 이것은 인증 fixture가 주는 주체를 사용하는지 확인할 뿐 JWT 검증을 증명하지 않는다. 넷째, fixture의 응답에서 `totalMinor.toString()`을 없애 보자. 해당 오류는 저장소와 라우트의 문제가 아니라 응답 표현 경계의 문제다. 운영에서는 내부 예외를 그대로 노출하지 않는 기본 오류 매핑도 함께 확인해야 한다.

다섯째, 두 개의 조회를 `Promise.all`로 호출해도 반환한 주문 객체는 서로 분리되어야 한다. 현재 조회는 읽기 전용이며 상태 전이를 수행하지 않으므로, 이 결과를 동시 결제 정합성의 증거로 쓰면 안 된다. 주문 변경 경합은 2권의 version 조건부 갱신과 트랜잭션 경계가 담당한다. 여섯째, `await app.close()` 뒤 직접 `app.dispatch()`를 시도하면 HTTP 파이프라인에 들어가기 전에 reject되어야 한다. 종료가 시작되면 admission gate가 닫히는 runtime 계약이지, 종료 이후 모든 요청이 자동으로 특정 HTTP 상태를 받는다는 계약은 아니다.

원인을 찾는 동안 빠른 경로를 무조건 끄거나 모든 호출에 상세 로그를 붙이는 것은 비용이 있다. observer를 설치하면 완전한 lifecycle을 보존하는 fallback 경로가 선택될 수 있다. 요청 body와 인증 토큰을 로그에 복사하는 대신, 매칭된 경로·서비스 진입 여부·응답 상태 같은 최소 증거로 조사하자. 실험의 `lookupCalls`는 그 원칙을 보여 주는 작은 대체물이다.

이 장의 실행 파일은 독자가 재현할 수 있는 실험이며, 본문에 제시한 모든 변형을 이미 실행했다고 주장하지 않는다. 정상·오류 경로의 예상값은 단언으로 명시했다. 실제 운영 호스트에서도 404가 계속되면 다음 증거는 프록시와 어댑터의 원래 요청 경로여야 한다. 서버 소켓을 열지 않은 실험이 그 층까지 통과했다고 확대해서 해석하지 않는다.

우리는 주문 조회를 core의 선언, runtime의 조립, HTTP의 실행으로 나누었다. 다음 질문은 더 앞쪽에 있다. `@Get`과 `@Inject`가 들어 있는 TypeScript는 Node24가 실행할 수 있는 어떤 JavaScript가 되는가? 다음 장에서는 빌드 도구가 해야 하는 일과 해서는 안 되는 일을 분리하고, 테스트에서는 되지만 애플리케이션 빌드에서는 사라지는 메타데이터를 추적한다.

## 소스와 계약 근거

- [core README](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts), [Module·Inject 구현](../../packages/core/src/decorators.ts)
- [runtime README](../../packages/runtime/README.ko.md), [부트스트랩과 애플리케이션 gate](../../packages/runtime/src/bootstrap.ts), [모듈 그래프 컴파일](../../packages/runtime/src/module-graph.ts)
- [HTTP README](../../packages/http/README.ko.md), [라우트 descriptor 생성](../../packages/http/src/mapping.ts), [디스패처](../../packages/http/src/dispatch/dispatcher.ts)
- [컨트롤러 resolve·바인딩·검증·호출](../../packages/http/src/dispatch/dispatch-handler-policy.ts), [HTTP 예외와 상태](../../packages/http/src/exceptions.ts)
- [Web 요청·응답 factory](../../packages/runtime/src/web.ts), [어댑터 없는 셸과 직접 dispatch 테스트](../../packages/runtime/src/application.test.ts), [요청 종료 순서 테스트](../../packages/http/src/dispatch/dispatcher-lifecycle-ordering.test.ts)
