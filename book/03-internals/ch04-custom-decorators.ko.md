# 커스텀 데코레이터를 안전하게 만들기

<!-- book:volume=03-internals;chapter=04 -->

[이전: 메타데이터는 어디에 저장되는가](./ch03-metadata-ownership.ko.md) · [3권 목차](./toc.ko.md) · [다음: Provider를 내부 표현으로 바꾸기](./ch05-provider-normalization.ko.md)

## 주문 작업에 이름을 붙이고 싶을 때

FluoShop 운영 화면에 주문 관련 도구가 늘었다. 고객의 주문 요약을 읽는 작업과 운영자의 진단 작업이 서로 다른 파일에 흩어져 있다. 담당자는 “이 메서드가 어떤 주문 작업인가”를 코드에서 확인하고, 명시적으로 허용한 작업만 작은 실행기에 연결하고 싶다. 처음에는 별도의 객체에 메서드 이름을 문자열로 적었다. 메서드를 바꿀 때 그 객체를 함께 바꾸지 않으면 등록은 남았는데 실행 대상이 사라졌다.

이 요구는 custom decorator를 고려할 만하다. 다만 `@OrderAction()`을 붙인 순간 권한 검사, 감사 로그, 재시도, 트랜잭션이 자동으로 완성되는 것은 아니다. 이 장의 데코레이터는 **작업 식별자를 메서드 선언 옆에 기록하는 역할만** 한다. 그 기록을 읽고 실제 DI 인스턴스의 메서드에 연결하는 실행기도 이 장에서 직접 구현한다. 데이터베이스·결제사·메시지 브로커는 사용하지 않는다.

앞 장에서 배운 소유권 규칙이 이제 구현 제약이 된다. 부모 클래스의 metadata 배열을 바꾸면 안 된다. 같은 작업을 두 번 선언한 것을 우연한 적용 순서로 해결하면 안 된다. 메타데이터만 기록하려고 원래 메서드의 반환 Promise를 다른 Promise로 바꾸어서도 안 된다. 이런 문제가 생기면 화면에는 작은 편의 기능으로 보이지만 서비스의 실패 의미가 달라진다.

## 먼저 확장의 계약을 작게 정한다

우리의 작업 식별자는 `order.summary.read`와 `order.history.read` 두 가지다. 지금 완성하는 실행 경로는 요약 조회 하나이고, 두 번째 이름은 아래 상속 실험에서 독립된 선언을 구분하는 데 사용한다. 데코레이터가 허용하는 메서드는 두 문자열 인수를 받아 `Promise<OrderSummary>`를 반환하는 public instance method다. 첫 인수는 주문 ID, 두 번째는 이미 신뢰 경계를 통과한 고객 ID다. HTTP 클라이언트가 보낸 `customerId`를 그대로 넘기는 API가 아니다.

상속 정책도 명시한다. 각 클래스가 직접 선언한 작업만 등록하며, 부모의 작업 목록을 자동으로 이어받지 않는다. 자식 클래스가 부모 메서드를 재정의하면서 권한이나 부수 효과를 바꾸었는데 예전 등록이 살아남는 일을 피하려는 선택이다. 공통 구현을 상속할 수는 있지만 외부 실행 대상으로 사용할 작업은 자식에서 명시적으로 다시 선언해야 한다. 이 정책은 Fluo 자체의 모든 metadata 상속 규칙이 아니라 이번 애플리케이션 확장의 규칙이다.

기록에는 주문 ID, 계정, 토큰, 반환 데이터를 넣지 않는다. 클래스 평가 시점에는 요청이 없으며, 클래스 메타데이터는 여러 호출이 공유한다. 저장할 것은 작업 이름과 property key뿐이다. 식별자는 namespace가 있는 `Symbol.for('fluo.book-order-actions.records')` 아래에 둔다. `fluo.standard.*`나 `fluo.metadata.*`는 Fluo 소유 key이므로 사용자 상태를 넣는 데 재사용하지 않는다.

## 기록만 남기는 데코레이터

다음 `src/orders/order-action.ts`는 **완전한 애플리케이션 소유 확장 파일**이다. `OrderSummary`는 이번 조회 실험의 응답 타입이고, `status: 'paid'`는 fixture가 사용하는 한 상태를 한정한 것이다. 전체 주문 상태 모델을 대체하지 않는다. 주문 상태 전이를 구현하는 곳에서는 공통 일곱 상태와 전이 규칙을 유지한다.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

export interface OrderSummary {
  readonly id: string;
  readonly customerId: string;
  readonly status: 'paid';
  readonly currency: 'KRW';
  readonly totalMinor: string;
  readonly version: number;
}

export type OrderActionName = 'order.summary.read' | 'order.history.read';
export type OrderActionHandler<This> = (
  this: This,
  id: string,
  customerId: string,
) => Promise<OrderSummary>;

export interface OrderActionRecord {
  readonly action: OrderActionName;
  readonly method: string | symbol;
}

const RECORDS = Symbol.for('fluo.book-order-actions.records');
const EMPTY: readonly OrderActionRecord[] = Object.freeze([]);

function readOwnRecords(bag: Record<PropertyKey, unknown>) {
  if (!Object.hasOwn(bag, RECORDS)) {
    return EMPTY;
  }
  return bag[RECORDS] as readonly OrderActionRecord[];
}

export function OrderAction(action: OrderActionName) {
  if (action !== 'order.summary.read' && action !== 'order.history.read') {
    throw new TypeError('Unsupported order action');
  }
  return function <This>(
    _value: OrderActionHandler<This>,
    context: ClassMethodDecoratorContext<This, OrderActionHandler<This>>,
  ): void {
    if (context.kind !== 'method' || context.static || context.private) {
      throw new TypeError('OrderAction requires a public instance method');
    }
    if (!context.metadata) {
      throw new Error('Call ensureMetadataSymbol before loading order actions');
    }
    const previous = readOwnRecords(context.metadata);
    if (previous.some((record) =>
      record.action === action || record.method === context.name
    )) {
      throw new Error('Duplicate order action declaration');
    }
    context.metadata[RECORDS] = Object.freeze([
      ...previous,
      Object.freeze({ action, method: context.name }),
    ]);
  };
}

export function getOrderActions(target: Function): readonly OrderActionRecord[] {
  const symbol = ensureMetadataSymbol();
  if (!Object.hasOwn(target, symbol)) {
    return EMPTY;
  }
  const bag = Reflect.get(target, symbol) as Record<PropertyKey, unknown>;
  return readOwnRecords(bag);
}
```

`readOwnRecords()`의 `Object.hasOwn`은 단순 방어 코드가 아니다. 표준 metadata bag은 상속으로 부모의 key를 볼 수 있다. `bag[RECORDS] ?? []`를 가져와 `push()`하면 자식이 부모 소유 배열을 바꾸거나 부모 목록을 의도치 않게 재사용한다. 여기서는 own key만 읽고 새 배열을 기록한다. 배열과 각 record가 원시 값만 포함하므로 둘을 동결하면 반환한 등록 자료의 변경을 막을 수 있다. `Object.freeze(new Map())`만으로 `map.set()`을 막을 수 있다고 가정하는 대신, 필요한 작은 구조에 맞춰 frozen 배열을 선택했다.

하나의 메서드에 두 작업을 붙이는 경우와 서로 다른 메서드에 같은 작업 이름을 붙이는 경우 모두 거부한다. 어느 데코레이터가 먼저 적용됐는지로 승자를 정하지 않는다. metadata는 클래스를 부트스트랩하기 전에도 평가되므로 이 오류는 해당 모듈의 import를 실패시킨다. 운영 요청을 받다가 모호한 등록을 발견하는 것보다 시작 단계에서 고치는 편이 낫다.

반환 타입이 `void`인 것도 중요하다. 이 데코레이터는 원래 메서드를 교체하지 않는다. 그래서 `this`, 인수, 동기 throw, Promise 객체의 동일성, rejection 이유가 원래 메서드 의미대로 유지된다. “아무 일도 하지 않는 래퍼”라는 이름으로 `async function`을 반환하면 원래 메서드가 돌려준 Promise와 다른 객체가 생기며 동기 throw가 rejection으로 바뀔 수 있다. 기록만 필요할 때는 래퍼를 만들지 않는 것이 가장 작은 올바른 구현이다.

reader의 타입 단언은 이 모듈이 소유한 namespace의 writer가 같은 record 형식을 쓴다는 폐쇄된 계약에 근거한다. 외부 JSON이나 임의 플러그인의 값을 이 배열에 넣는 API가 아니다. 나중에 독립 패키지로 배포하여 서로 다른 버전의 writer와 reader가 섞일 수 있다면 record schema와 version 정책을 먼저 정해야 한다. 지금 필요하지 않은 범용 metadata 교환 프로토콜까지 만들지는 않는다.

## 선언의 소비자와 DI를 함께 구현하기

다음 `src/orders/action-orders.ts`는 **완전한 독립 실험 모듈**이다. 기존 운영 OrdersModule과 나란히 등록하지 않는다. `OrderReadPort`는 애플리케이션이 정의한 조회 포트이고, `ORDER_READ_PORT`는 명시적인 DI 토큰이다. fixture는 외부 저장소에 접근하지 않으며, 주문 부재와 다른 고객을 서로 다른 오류 code로 표현한다. HTTP 예외 매핑은 이 파일의 책임이 아니다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  OrderAction,
  getOrderActions,
  type OrderActionName,
  type OrderSummary,
} from './order-action.js';

export interface OrderReadPort {
  read(id: string, customerId: string): Promise<OrderSummary>;
}

export const ORDER_READ_PORT = Symbol('ORDER_READ_PORT');

export class OrderReadError extends Error {
  constructor(readonly code: 'ORDER_NOT_FOUND' | 'ORDER_FORBIDDEN') {
    super(code);
  }
}

const fixture: OrderSummary = Object.freeze({
  id: 'order-1001',
  customerId: 'account-7',
  status: 'paid',
  currency: 'KRW',
  totalMinor: '29000',
  version: 2,
});

const reader: OrderReadPort = {
  async read(id, customerId) {
    if (id !== fixture.id) {
      throw new OrderReadError('ORDER_NOT_FOUND');
    }
    if (customerId !== fixture.customerId) {
      throw new OrderReadError('ORDER_FORBIDDEN');
    }
    return { ...fixture };
  },
};

@Inject(ORDER_READ_PORT)
export class OrdersService {
  constructor(private readonly reader: OrderReadPort) {}

  @OrderAction('order.summary.read')
  readSummary(id: string, customerId: string): Promise<OrderSummary> {
    return this.reader.read(id, customerId);
  }
}

@Inject(OrdersService)
export class OrderActionRunner {
  constructor(private readonly orders: OrdersService) {}

  run(action: OrderActionName, id: string, customerId: string): Promise<OrderSummary> {
    const record = getOrderActions(OrdersService).find(
      (candidate) => candidate.action === action,
    );
    if (!record) {
      throw new Error('Order action is not registered');
    }
    const method: unknown = Reflect.get(this.orders, record.method);
    if (typeof method !== 'function') {
      throw new TypeError('Registered order action is not callable');
    }
    return Reflect.apply(method, this.orders, [id, customerId]) as Promise<OrderSummary>;
  }
}

@Module({
  providers: [
    { provide: ORDER_READ_PORT, useValue: reader },
    OrdersService,
    OrderActionRunner,
  ],
  exports: [OrderActionRunner],
})
export class OrdersModule {}
```

실행기는 모든 provider를 자동 검색하지 않는다. 주입받은 OrdersService와 그 클래스의 선언만 읽는다. 연결할 대상이 하나인데 전역 registry, 자동 탐색기, 부트스트랩 hook을 새로 만드는 것은 문제보다 큰 해법이다. 작업 수가 작으므로 배열 탐색도 충분하다. 나중에 여러 모듈의 실행 대상을 모을 때에는 명시적인 등록 인수와 토큰 목록을 설계해야 하며, 파일 import만으로 전역 실행기에 등록하는 방식으로 바꾸지 않는다.

`Reflect.apply(method, this.orders, ...)`는 단순한 문법 선택이 아니다. `method(id, customerId)`처럼 분리한 함수를 그대로 호출하면 `this.reader`가 사라질 수 있다. 실행기는 DI가 생성한 인스턴스를 수신자로 유지한다. 또 `run()` 자체를 불필요하게 `async`로 만들지 않아 정상 호출에서 원래 Promise를 그대로 반환한다. 등록이 없는 경우는 동기 오류이고, 등록된 조회가 실패한 경우는 해당 Promise의 rejection이다. 이 구분을 합치고 싶다면 실행기 API 계약을 의도적으로 바꿔야 한다.

명시적 provider 등록과 custom metadata 기록의 역할도 다르다. `@OrderAction`은 OrdersService를 컨테이너에 추가하지 않는다. `@Inject`는 포트를 자동 구현하지 않는다. `exports: [OrderActionRunner]`는 다른 기능 모듈에 실행기를 공개하지만 fixture 포트까지 공개하지 않는다. 실제 앱에서는 필요한 소비 모듈이 OrdersModule을 import하고 OrderActionRunner를 주입받는다. 작은 확장도 이 imports·providers·exports 경계를 통과해야 한다.

## 정상·실패·중복을 같은 실험에서 확인하기

아래 `src/order-actions-main.ts`는 **완전한 실행 진입점**이다. 표준 metadata가 준비된 다음에만 decorated module을 import한다. 앞 장들의 Vite 실험 설정처럼 이 파일을 별도 SSR 진입점으로 빌드하여 Node24에서 실행한다. 운영 HTTP handler를 추가하는 예제가 아니며 어떤 외부 전송도 수행하지 않는다.

```ts
import assert from 'node:assert/strict';
import { ensureMetadataSymbol } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

ensureMetadataSymbol();
const { getOrderActions } = await import('./orders/order-action.js');
const { OrdersModule, OrdersService, OrderActionRunner, OrderReadError } =
  await import('./orders/action-orders.js');

assert.deepEqual(getOrderActions(OrdersService), [{
  action: 'order.summary.read',
  method: 'readSummary',
}]);

const app = await FluoFactory.createApplicationContext(OrdersModule);
try {
  const runner = await app.get(OrderActionRunner);
  const [first, second] = await Promise.all([
    runner.run('order.summary.read', 'order-1001', 'account-7'),
    runner.run('order.summary.read', 'order-1001', 'account-7'),
  ]);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.totalMinor, '29000');

  await assert.rejects(
    runner.run('order.summary.read', 'order-1001', 'account-8'),
    (error: unknown) =>
      error instanceof OrderReadError && error.code === 'ORDER_FORBIDDEN',
  );
  await assert.rejects(
    runner.run('order.summary.read', 'order-9999', 'account-7'),
    (error: unknown) =>
      error instanceof OrderReadError && error.code === 'ORDER_NOT_FOUND',
  );
  assert.throws(
    () => runner.run('order.history.read', 'order-1001', 'account-7'),
    /not registered/,
  );
  console.log('order action integration assertions passed');
} finally {
  await app.close();
}
```

이 실험에서 성공 응답만 비교하면 부족하다. 두 결과의 참조가 다르다는 단언은 fixture 원본을 호출자끼리 공유하지 않는지 확인한다. 403에 해당할 도메인 오류와 없는 주문 오류는 metadata가 아니라 서비스 경계에서 발생한다. 등록되지 않은 작업은 서비스에 도달하기 전에 동기적으로 실패한다. 각각 다른 실패 경계를 고정해야 실행기의 동작이 어디까지인지 알 수 있다.

동시 조회의 성공은 재고 경합이나 중복 결제의 안전성을 증명하지 않는다. 이번 포트에는 쓰기가 없으며 retry도 없다. `@OrderAction('order.cancel')` 같은 이름을 나중에 추가한다고 멱등성이나 보상이 생기지 않는다. 취소와 환불은 2권의 상태·version·영속 작업 계약으로 구현해야 한다. decorator 이름이 업무 보장을 암시하게 되는 순간부터 문서와 테스트가 그 보장을 감당해야 한다.

## 상속 오염과 호출 의미를 별도로 시험하기

다음 `src/orders/order-action-probe.ts`는 **완전한 추가 실험 파일**이다. 이 파일은 `context.metadata`를 사용하므로 앞 진입점의 preload 뒤에서 `await import('./orders/order-action-probe.js')`로 불러온다. 그 한 줄을 추가하면 통합 실험과 함께 실행할 수 있다. 파일 자체를 preload 없이 먼저 static import하지 않는다. `Promise.withResolvers()`는 Node24에서 사용하는 표준 API이며, TypeScript의 `lib`에는 `ES2024` 이상과 표준 데코레이터 타입인 `ESNext.Decorators`가 필요하다.

```ts
import assert from 'node:assert/strict';
import {
  OrderAction,
  getOrderActions,
  type OrderSummary,
} from './order-action.js';

const pending = Promise.withResolvers<OrderSummary>();
const calls: string[] = [];

class ParentReader {
  readonly marker = 'parent';

  @OrderAction('order.summary.read')
  readSummary(id: string, customerId: string): Promise<OrderSummary> {
    calls.push(`${this.marker}:${id}:${customerId}`);
    return pending.promise;
  }
}

class ChildReader extends ParentReader {
  @OrderAction('order.history.read')
  readHistory(id: string, customerId: string): Promise<OrderSummary> {
    return this.readSummary(id, customerId);
  }
}

class UndeclaredChild extends ParentReader {}

assert.deepEqual(getOrderActions(ParentReader), [{
  action: 'order.summary.read',
  method: 'readSummary',
}]);
assert.deepEqual(getOrderActions(ChildReader), [{
  action: 'order.history.read',
  method: 'readHistory',
}]);
assert.deepEqual(getOrderActions(UndeclaredChild), []);

assert.throws(() => {
  class DuplicateReader {
    @OrderAction('order.summary.read')
    @OrderAction('order.summary.read')
    readSummary(_id: string, _customerId: string): Promise<OrderSummary> {
      return pending.promise;
    }
  }
  return DuplicateReader;
}, /Duplicate order action/);

assert.throws(() => {
  class StaticReader {
    @OrderAction('order.summary.read')
    static readSummary(_id: string, _customerId: string): Promise<OrderSummary> {
      return pending.promise;
    }
  }
  return StaticReader;
}, /public instance method/);

const value = new ParentReader().readSummary('order-1001', 'account-7');
assert.equal(value, pending.promise);
assert.deepEqual(calls, ['parent:order-1001:account-7']);
const failure = new Error('Read port unavailable');
const checked = assert.rejects(value, (error: unknown) => error === failure);
pending.reject(failure);
await checked;
console.log('order action semantics assertions passed');
```

Promise 시험은 시간을 재지 않는다. 먼저 반환한 Promise에 rejection 단언을 연결하고, 직접 소유한 deferred를 reject한 뒤 그 단언을 await한다. 고정된 sleep이나 운에 맡긴 polling 없이 정확한 사건을 기다린다. 반환 Promise가 같다는 단언은 불필요한 async wrapper를 도입하면 실패하므로 실제 회귀를 검출한다. 거부 이유도 객체 동일성으로 확인하여 래퍼가 오류를 새 Error로 바꾸거나 삼키는지 드러낸다.

상속 시험에서는 자식에 작업을 추가한 뒤 부모 배열이 그대로인지 확인하고, 아무것도 선언하지 않은 자식은 빈 목록인지 확인한다. 이것이 의도한 own-only 정책이다. 자식이 부모 구현을 호출하는 것은 언어의 상속이며 허용하지만, 실행기에 자동으로 공개되는 것은 별도 문제다. symbol 이름의 public method도 property key를 문자열로 강제 변환하지 않았으므로 기록할 수 있다. 다만 이를 JSON 목록으로 공개하려면 symbol의 외부 식별 규칙을 별도로 정해야 한다.

private method는 decorator context의 `private` 검사로 거부한다. static method와 동일하게 import 단계에서 실패해야 하며, 실행기가 `Reflect.get`으로 우연히 접근할 때까지 미루지 않는다. 필드나 getter에 붙인 경우도 타입 검사와 `kind` 검사 경계 밖이다. “어떤 멤버든 일단 받는다”는 범용 데코레이터는 호출·초기화·수신자 의미가 달라져 검증할 계약이 크게 늘어난다. 지금 필요한 표면만 지원하는 편이 유지보수하기 쉽다.

## 언제 래퍼나 가드를 선택해야 하는가

이 예제는 라벨과 명시적 실행 대상 연결을 해결한다. 요청의 인증 상태를 확인하려면 HTTP 가드가 더 적절하고, 핸들러 결과를 공통 변환하려면 인터셉터가 더 적절하다. 실행 시간 관측이 필요하면 현재 요청 lifecycle의 observer와 실제 서비스 경계를 고려한다. metadata decorator 하나에 이를 모두 넣으면 선언 평가 시점, 호출 시점, HTTP 완료 시점이 섞인다.

도메인 메서드 자체에 래퍼가 꼭 필요하다면 `this`와 인수를 그대로 전달하고 반환 방식별 의미를 정해야 한다. 동기 함수, Promise 함수, async iterator는 완료의 의미가 다르다. `finally`에서 실행한 관측 코드가 throw하면 원래 성공이나 실패를 덮어쓸 수 있다. 취소 signal을 받는 함수에 자동 retry를 붙이면 요청이 끝난 뒤 작업이 다시 실행될 수도 있다. 이 요구를 감당할 이유가 없다면 일반 함수나 명시적인 서비스 호출이 더 낫다.

우리 실행기는 명시적인 선언과 DI를 연결했지만, 모든 프로바이더를 호출할 수 있는 원격 관리 API는 아니다. HTTP 경계에 노출하려면 작업별 인가, 입력 검증, 요청 식별과 오류 매핑을 정의해야 한다. 지금의 `OrderActionName` 목록을 그대로 클라이언트에게 받아 임의 실행을 열어 놓는 것은 이 장의 결과가 아니다. 작업 라벨은 허가증이 아니라 실행기에 넣을 수 있는 선언의 이름이다.

패키지로 배포하는 시점에는 또 다른 비용이 생긴다. 공개 record shape, namespace, 중복 선언 정책, 상속 정책이 소비자 계약이 된다. metadata 확장은 `context.metadata`와 core의 심벌 경계를 유지해야 하며, 모듈 등록은 명시적인 entrypoint를 통해 opt in해야 한다. 환경변수를 import 시점에 읽거나 Fluo 내부 key를 수정하여 “자동 연결”을 만들지 않는다. 이 장은 애플리케이션 내부 구현으로 범위를 제한하고, 패키지 배포와 버전 관리는 뒤의 확장 패키지 장에서 다룬다.

본문의 실험들은 정상·중복·상속·비동기 실패를 관찰할 수 있도록 완전한 코드와 기대 단언을 제공한다. 원고에 실린 모든 변형이나 운영 호스트까지 실행됐다는 주장은 하지 않는다. 중요한 결과는 데코레이터를 더 많이 사용한 것이 아니라, 선언이 저장되는 위치와 선언을 읽는 소비자, DI가 제공하는 실제 인스턴스가 분명해졌다는 점이다.

다음 장은 이 마지막 연결을 더 깊이 살핀다. 지금 `providers` 배열에는 클래스와 `{ provide, useValue }`가 섞여 있다. 프레임워크는 이런 여러 선언 형태를 어떤 내부 표현으로 정규화하고, 잘못된 조합을 언제 거부하는가? custom decorator의 경계를 지킨 채 DI의 실제 알고리즘으로 이동할 준비가 되었다.

## 소스와 계약 근거

- [core README의 공개 데코레이터·심벌 경계](../../packages/core/README.ko.md), [root 공개 export](../../packages/core/src/index.ts), [class-level Inject 구현](../../packages/core/src/decorators.ts)
- [표준 metadata own·inherited 조회 구현](../../packages/core/src/metadata/shared.ts), [표준 변환 실험](../../packages/core/src/decorator-transform.test.ts), [상속·era 우선순위 회귀](../../packages/core/src/metadata-precedence.test.ts)
- [공개·내부 통합 경계 테스트](../../packages/core/src/public-api.test.ts), [확장 namespace·등록·금지 패턴 계약](../../docs/contracts/third-party-extension-contract.ko.md)
- [runtime의 DI-only context와 종료 계약](../../packages/runtime/README.ko.md), [Vite 표준 데코레이터 변환 계약](../../packages/vite/README.ko.md)
