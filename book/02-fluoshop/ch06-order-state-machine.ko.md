# 주문을 상태 머신으로 설계하기

<!-- book:volume=02-fluoshop;chapter=06 -->

[이전: 장바구니 가격을 믿으면 안 되는 이유](./ch05-cart-and-pricing.ko.md) · [2권 목차](./toc.ko.md) · [다음: 마지막 티셔츠를 두 사람이 구매한다면](./ch07-inventory-concurrency.ko.md)

## 상태 필드를 수정했을 뿐인데 돈의 의미가 바뀌었다

장바구니 견적을 서버에서 계산하게 되었으니 이제 주문을 저장하고 싶다. 운영자는 처음에 `status` 문자열 하나면 충분하다고 생각한다. 결제 화면에 들어가면 `pending_payment`, 성공하면 `paid`, 배송 담당자가 처리하면 `shipped`로 바꾸면 될 것 같다. 그러나 “상태 수정” API를 열어 두면 아직 돈을 받지 않은 주문을 `shipped`로 바꾸거나, 이미 출고한 주문을 `pending_payment`로 되돌릴 수도 있다.

실제로 더 먼저 나타나는 문제는 두 관리 화면의 충돌이다. 독자가 결제 대기 주문의 취소 버튼을 누르는 순간, 운영자가 결제 확인을 입력한다. 양쪽 화면은 모두 몇 초 전의 `pending_payment`를 보고 있다. 마지막 저장이 이긴다면 결제를 확인한 주문이 취소로 덮이거나, 취소한 주문이 다시 결제 완료로 살아난다. 어느 쪽도 단순한 화면 표시 오류가 아니다. 환불할지, 재고를 돌려줄지, 배송을 시작할지의 판단이 달라진다.

이번 장의 상태 머신은 별도 프레임워크가 아니다. **허용된 사건과 현재 상태로부터 다음 상태를 계산하는 애플리케이션 함수**다. HTTP는 명령을 받고 저장소는 결과를 보관하지만, “지금 출고를 시작해도 되는가”라는 판단은 `src/orders/order-state.ts`에 모은다. 같은 FluoBlog 애플리케이션의 `OrdersModule`에 이 코드를 넣는다. 계정과 게시글을 옮기거나 주문 서비스를 별도 프로세스로 분리하지 않는다.

결제사 연결은 아직 없다. 여기서 `payment_confirmed`는 나중에 신뢰된 결제 경계가 검증을 마친 뒤 전달할 내부 사건이다. 고객이 보낸 `paid: true`를 그 사건으로 바꾸면 안 된다. 이번 구현은 사건을 전달할 자격과 전이 규칙을 분리해 그 잘못된 연결을 드러낼 수 있게 한다.

## 주문의 현재 모습과 전이의 이유를 함께 남긴다

주문은 이전 장의 견적을 항목 스냅샷으로 복사한다. 저장 후에는 카탈로그의 현재 가격을 조인해서 과거 합계를 다시 만들지 않는다. 재발행한 영수증이 달라지면 고객에게 설명할 근거를 잃는다. `customerId`는 기존 블로그 인증의 subject와 같은 사용자 식별자이고 새 상점 계정이 아니다. 이 예제에서는 subject의 문자열 표현을 그대로 보관한다. 기존 계정 스키마의 실제 키가 다른 DB 타입이면 그 계정과의 매핑은 기존 인증 경계에서 유지한다.

다음은 `prisma/schema.prisma`에 추가할 **모델 부분 구현**이다. 계정과 상품 모델을 대체하지 않는다. 계정 삭제와 주문 보관 정책에 따라 기존 계정과의 외래키 정책을 별도로 유지하되, 아래 코드가 계정 존재를 검증하는 모델이라고 읽지 않는다. 주문 항목의 SKU는 역사적 식별자다. 상품 판매를 중지하거나 상품 설명을 지워도 주문 항목은 남는다.

```prisma
enum OrderStatus {
  pending_payment
  paid
  fulfilling
  shipped
  cancelled
  refund_pending
  refunded
}

model Order {
  id         String            @id
  customerId String
  status     OrderStatus       @default(pending_payment)
  currency   String            @default("KRW")
  totalMinor BigInt
  version    Int               @default(0)
  items      OrderItem[]
  transitions OrderTransition[]
}

model OrderItem {
  orderId       String
  sku           String
  unitMinor     BigInt
  quantity      Int
  discountMinor BigInt
  lineTotalMinor BigInt
  order         Order @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([orderId, sku])
}

model OrderTransition {
  orderId    String
  version    Int
  from       OrderStatus
  to         OrderStatus
  eventName  String
  actorId    String
  occurredAt DateTime @default(now())
  order      Order @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([orderId, version])
}
```

`OrderTransition`은 상태 변경 감사 기록이다. 모든 사건으로 주문을 재구성하는 이벤트 소싱 저장소라고 부르지는 않는다. 주문 생성 당시 모든 외부 증거를 보관하지 않으며, 결제 원장도 아니다. 그럼에도 상태 행만 두는 것보다 유용하다. 주문 버전 4를 누가 어떤 사건으로 만들었는지 답할 수 있고, 상태 변경이 성공했는데 기록은 누락되는 부분 실패를 테스트할 수 있다.

DB에도 표현 가능한 불변식을 둔다. 다음은 앞 모델들의 **마이그레이션 조각**이다. 주문 합계와 항목 합계의 일치는 여러 행을 가로지르므로 이 `CHECK`만으로 보장되지 않는다. 주문 생성 코드가 같은 트랜잭션에서 앞 장의 계산 결과를 그대로 저장해야 한다.

```sql
ALTER TABLE "Order" ADD CONSTRAINT "Order_values_check"
  CHECK ("currency" = 'KRW' AND "totalMinor" >= 0 AND "version" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_values_check"
  CHECK (
    "quantity" BETWEEN 1 AND 99
    AND "unitMinor" >= 0
    AND "discountMinor" BETWEEN 0 AND "unitMinor"
    AND "lineTotalMinor" =
      ("unitMinor" - "discountMinor") * "quantity"
  );
```

상태를 ENUM으로 선언하면 철자는 제한되지만 전이는 제한되지 않는다. DB는 `pending_payment`와 `shipped`가 각각 유효한 값임을 알 뿐, 둘 사이에 결제 확인과 출고 시작이 필요하다는 업무 의미는 모른다. 따라서 HTTP에서 새 상태 문자열을 받아 그대로 `update`하는 코드를 없애는 것이 첫 번째 설계 변경이다.

## 화살표를 그리는 대신 사건의 조건을 구현한다

현재 판매 정책의 전이는 다음과 같다. 이 표는 장식용 다이어그램이 아니라 코드와 시험에서 검토할 명세다. “취소”와 “환불”을 같은 단어로 부르지 않는다. 돈을 받기 전에는 주문을 취소할 수 있다. 돈을 받은 뒤에는 환불을 요청하고, 실제 환불 확인을 받아야 `refunded`로 간다.

| 현재 상태 | 내부 사건 | 다음 상태 | 추가 조건 |
| --- | --- | --- | --- |
| `pending_payment` | `payment_confirmed` | `paid` | 통화와 금액이 주문 스냅샷과 일치 |
| `pending_payment` | `cancel_requested` | `cancelled` | 요청자에게 취소 권한이 있음 |
| `paid` | `fulfillment_started` | `fulfilling` | 출고 담당 경계가 시작을 결정 |
| `fulfilling` | `shipment_recorded` | `shipped` | 비어 있지 않은 발송 참조가 있음 |
| `paid` | `refund_requested` | `refund_pending` | 아직 출고 시작 전인 전액 환불 |
| `refund_pending` | `refund_confirmed` | `refunded` | 환불 확인 금액과 통화가 일치 |

현재 정책은 출고가 시작된 주문의 즉시 환불을 허용하지 않는다. 반품과 부분 환불을 다룰 때 물류 중단 가능성, 회수 결과, 항목별 환불 잔액을 추가해야 한다. 그 비용을 피하려고 `fulfilling`에서 `cancelled`로 가는 지름길을 넣으면 돈과 물건의 상태를 숨기게 된다. 제한이 명확한 작은 모델이 모든 예외를 성공시켜 주는 큰 상태 문자열보다 낫다.

다음은 `src/orders/order-state.ts`의 **완전한 파일**이다. 입력 상태는 저장소에서 읽은 검증된 주문이고, 사건은 애플리케이션 경계에서 타입에 맞게 만든 내부 값이다. 고객 JSON을 타입 단언으로 `OrderEvent`로 바꾸는 용도가 아니다.

```ts
export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export type OrderState = Readonly<{
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: string;
  totalMinor: bigint;
  version: number;
}>;

export type OrderEvent =
  | { type: 'payment_confirmed'; currency: string; amountMinor: bigint }
  | { type: 'cancel_requested' }
  | { type: 'fulfillment_started' }
  | { type: 'shipment_recorded'; shipmentRef: string }
  | { type: 'refund_requested' }
  | { type: 'refund_confirmed'; currency: string; amountMinor: bigint };

export class OrderRuleError extends Error {}
export class OrderVersionConflict extends Error {}
export class OrderNotFound extends Error {}
export class OrderAccessDenied extends Error {}

export function decideTransition(
  order: OrderState,
  event: OrderEvent,
): OrderStatus {
  switch (event.type) {
    case 'payment_confirmed':
      if (
        order.status === 'pending_payment' &&
        event.currency === order.currency &&
        event.amountMinor === order.totalMinor
      ) return 'paid';
      break;
    case 'cancel_requested':
      if (order.status === 'pending_payment') return 'cancelled';
      break;
    case 'fulfillment_started':
      if (order.status === 'paid') return 'fulfilling';
      break;
    case 'shipment_recorded':
      if (order.status === 'fulfilling' && event.shipmentRef.trim().length > 0) {
        return 'shipped';
      }
      break;
    case 'refund_requested':
      if (order.status === 'paid') return 'refund_pending';
      break;
    case 'refund_confirmed':
      if (
        order.status === 'refund_pending' &&
        event.currency === order.currency &&
        event.amountMinor === order.totalMinor
      ) return 'refunded';
      break;
    default: {
      const unexpected: never = event;
      throw new OrderRuleError(`Unknown order event: ${String(unexpected)}`);
    }
  }
  throw new OrderRuleError(`Cannot apply ${event.type} to ${order.status}.`);
}

export type OrderActor = Readonly<{
  subject: string;
  scopes: readonly string[];
}>;

export function authorizeOrderEvent(
  order: OrderState,
  event: OrderEvent,
  actor: OrderActor,
): void {
  if (
    (event.type === 'cancel_requested' || event.type === 'refund_requested') &&
    actor.subject === order.customerId
  ) return;
  const scope: Record<OrderEvent['type'], string> = {
    payment_confirmed: 'payments:confirm',
    cancel_requested: 'orders:cancel',
    fulfillment_started: 'orders:fulfill',
    shipment_recorded: 'orders:fulfill',
    refund_requested: 'orders:refund',
    refund_confirmed: 'payments:refund-confirm',
  };
  if (!actor.scopes.includes(scope[event.type])) {
    throw new OrderAccessDenied('Order action is not permitted.');
  }
}
```

함수가 다음 상태만 반환하는 이유는 항목과 가격을 건드릴 권한이 없기 때문이다. `Object.assign(order, payload)`처럼 요청 값을 주문 전체에 덮어쓰지 않는다. 금액 비교도 숫자의 크기가 비슷한지 보는 것이 아니라 통화와 정수 값이 정확히 같은지 확인한다. 28,000원 주문에 28,000달러 입금 확인이 왔다고 결제 완료가 되면 안 된다.

`authorizeOrderEvent`의 권한 이름은 Fluo가 예약한 scope가 아니다. 블로그 인증 결과를 확장한 애플리케이션 정책이다. 고객은 자신의 취소·환불 요청만 할 수 있고, 결제 확인은 `payments:confirm` 권한을 가진 내부 경계만 전달한다. scope가 있다고 임의 금액이 받아들여지지는 않는다. 자격 검사를 통과한 뒤에도 상태 규칙이 다시 금액과 전이를 검사한다.

중복 `payment_confirmed`가 `paid`에 도착하면 이 함수는 오류를 낸다. “같은 상태니까 성공”으로 처리하지 않은 것은 의도적이다. 같은 결제 통지의 재전송인지, 다른 결제가 한 번 더 생긴 것인지 현재 상태만으로 구분할 수 없다. 나중에 결제사 사건 ID를 저장한 경계가 같은 사건임을 확인하고 재생을 처리해야 한다. 상태 머신에 무조건 성공을 넣어 중복 결제를 숨기지 않는다.

## 결정과 저장 사이의 틈을 버전으로 닫는다

순수 함수가 정확해도 저장 직전 다른 요청이 주문을 바꿀 수 있다. 해결책은 판단할 때 읽은 버전을 쓰기 조건에 넣는 것이다. 아래는 `src/orders/order-transitions.service.ts`의 **완전한 파일**이다. 루트가 소유하는 기존 `BlogDatabaseModule`과 여기 정의한 Prisma 모델이 필요하다. 이 서비스는 상태와 감사 기록만 소유한다. 결제 전송이나 재고 반환까지 수행한다고 해석하면 안 된다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  OrderNotFound,
  OrderRuleError,
  OrderVersionConflict,
  authorizeOrderEvent,
  decideTransition,
  type OrderActor,
  type OrderEvent,
} from './order-state.js';

@Inject(PrismaService)
export class OrderTransitionsService {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async apply(
    id: string,
    expectedVersion: number,
    event: OrderEvent,
    actor: OrderActor,
  ) {
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= 2_147_483_647
    ) {
      throw new OrderRuleError('Invalid order version.');
    }
    return this.prisma.transaction(async () => {
      const current = await this.prisma.order.findUnique({ where: { id } });
      if (!current) throw new OrderNotFound(id);
      authorizeOrderEvent(current, event, actor);
      if (current.version !== expectedVersion) {
        throw new OrderVersionConflict(id);
      }
      const next = decideTransition(current, event);
      const changed = await this.prisma.order.updateMany({
        where: { id, version: expectedVersion, status: current.status },
        data: { status: next, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new OrderVersionConflict(id);
      await this.prisma.orderTransition.create({
        data: {
          orderId: id,
          version: expectedVersion + 1,
          from: current.status,
          to: next,
          eventName: event.type,
          actorId: actor.subject,
        },
      });
      return { ...current, status: next, version: expectedVersion + 1 };
    });
  }
}
```

여기서는 서비스 메서드 전체를 명시적 `transaction`으로 감쌌다. 트랜잭션은 두 쓰기의 원자성을 제공하고, `where.version`은 오래된 판단의 덮어쓰기를 막는다. 둘은 서로 대체되지 않는다. `ReadCommitted` 트랜잭션 안에서 읽었다는 이유만으로 두 요청이 같은 버전을 보는 일이 사라지지는 않는다.

첫 요청이 버전 0에서 1로 바꾼 후 두 번째 요청의 조건부 갱신이 실행되면, 두 번째는 변경 건수 0을 받는다. 그 요청은 감사 기록을 만들지 않고 예외로 끝난다. 반대로 갱신은 성공했는데 감사 행 삽입이 실패하면 트랜잭션 전체가 롤백된다. 이 구현은 `shouldRollback`을 설정하지 않았으므로 오류를 잡아서 `{ ok: false }`를 반환하면 앞의 갱신이 커밋될 수 있다. 이 장의 DB 원자성 경계에서는 실패를 예외로 전달한다.

소비자 Result로 예상된 거절을 표현하려면 [반환값 기반 롤백 계약](../../docs/architecture/transactions.ko.md#반환값-기반-롤백)에 따라 마지막 Fluo boundary에 predicate를 명시하는 별도 선택이 필요하다. 성공한 rollback 뒤 같은 루트 실패값을 받는 것과 commit 성공은 다르다. 중첩 opt-in 실패가 표시한 sticky rollback-only도 루트에서 무시할 수 없으며 native 오류는 계속 전파된다. 이 기능이 주문 전이 규칙이나 아래 예외 기반 HTTP 계약을 자동으로 바꾸지는 않는다.

Result rollback에는 native 증거에 기반한 `rollbackObserver` 등록도 필요합니다. Sentinel이나 local session 상태는 rollback 성공 증거가 아닙니다. Capability가 없으면 callback 전에 거부하고, 확인이 누락되거나 실패하면 native 오류 또는 `TransactionRollbackUnconfirmedError`를 던지며 정상 Result로 바꾸지 않습니다. 구체적인 등록 helper와 지원 범위는 위 공유 계약을 따릅니다.

다음은 `src/orders/orders.module.ts`의 **이 단계 등록 파일**이다. 이후 장에서 같은 모듈에 주문 생성 서비스와 재고 모듈을 추가한다. 여러 `OrdersModule`을 병렬로 만드는 것이 아니다.

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { OrderTransitionsService } from './order-transitions.service.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [OrderTransitionsService],
  exports: [OrderTransitionsService],
})
export class OrdersModule {}
```

루트 `src/app.ts`는 이 모듈을 기존 계정·게시글·상품 모듈과 함께 import한다. 상태 전이의 HTTP 어댑터는 `OrderNotFound`를 404, `OrderAccessDenied`를 403, `OrderVersionConflict`와 `OrderRuleError`의 전이 거부를 409로 변환한다. 잘못된 요청 형식은 어댑터에서 먼저 400으로 거부한다. 위 애플리케이션 `Error` 클래스가 이름만으로 Fluo의 HTTP 예외가 되는 것은 아니다.

중요한 경계가 하나 남아 있다. 지금의 `apply`를 고객용 “모든 사건 실행” 엔드포인트로 공개하지 않는다. 취소 라우트는 서버가 `cancel_requested` 사건을 직접 만들고, 결제 확인 경계는 검증한 금액을 넣는다. 뒤에서 재고 반환을 붙인 취소 유스케이스는 바깥 트랜잭션 안에서 상태 변경과 반환을 함께 호출한다. 이 서비스의 중첩 `transaction`은 같은 Prisma 등록의 활성 문맥을 재사용한다. 내부 메서드마다 다른 격리 옵션을 넣어 그 의도를 바꾸지 않는다.

## 성공 경로보다 금지된 경로가 더 많은 시험

다음은 `src/orders/order-state.test.ts`의 **완전한 순수 테스트 파일**이다. 동기 함수 시험이므로 대기 시간이나 데이터베이스가 필요하지 않다. 빌드된 두 파일을 Node.js 24의 `node --test`로 실행할 수 있다. 문자열 설명이 아니라 반환 상태, 오류 종류, 권한 거부를 검증한다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OrderAccessDenied,
  OrderRuleError,
  authorizeOrderEvent,
  decideTransition,
  type OrderState,
  type OrderStatus,
} from './order-state.js';

const order: OrderState = {
  id: 'order-1',
  customerId: 'reader-1',
  status: 'pending_payment',
  currency: 'KRW',
  totalMinor: 28_000n,
  version: 0,
};

test('accepts matching payment but rejects amount and currency mismatches', () => {
  assert.equal(decideTransition(order, {
    type: 'payment_confirmed', currency: 'KRW', amountMinor: 28_000n,
  }), 'paid');
  for (const event of [
    { type: 'payment_confirmed' as const, currency: 'KRW', amountMinor: 1n },
    { type: 'payment_confirmed' as const, currency: 'USD', amountMinor: 28_000n },
  ]) {
    assert.throws(() => decideTransition(order, event), OrderRuleError);
  }
});

test('never allows cancellation after payment', () => {
  const states: OrderStatus[] = [
    'paid', 'fulfilling', 'shipped', 'cancelled', 'refund_pending', 'refunded',
  ];
  for (const status of states) {
    assert.throws(
      () => decideTransition({ ...order, status }, { type: 'cancel_requested' }),
      OrderRuleError,
    );
  }
});

test('requires a shipment reference and a confirmed refund', () => {
  assert.throws(() => decideTransition(
    { ...order, status: 'fulfilling' },
    { type: 'shipment_recorded', shipmentRef: ' ' },
  ), OrderRuleError);
  assert.equal(decideTransition(
    { ...order, status: 'paid' }, { type: 'refund_requested' },
  ), 'refund_pending');
  assert.equal(decideTransition(
    { ...order, status: 'refund_pending' },
    { type: 'refund_confirmed', currency: 'KRW', amountMinor: 28_000n },
  ), 'refunded');
});

test('ownership does not grant permission to confirm payment', () => {
  const actor = { subject: order.customerId, scopes: [] };
  assert.doesNotThrow(() =>
    authorizeOrderEvent(order, { type: 'cancel_requested' }, actor));
  assert.throws(() => authorizeOrderEvent(order, {
    type: 'payment_confirmed', currency: 'KRW', amountMinor: 28_000n,
  }, actor), OrderAccessDenied);
});
```

경합 시험은 실제 PostgreSQL을 사용해야 한다. 개발 전용 DB에 버전 0의 결제 대기 주문 한 건을 만들고, 두 연결에서 같은 `expectedVersion=0`으로 취소와 결제 확인을 실행한다. 시작 순서와 무관하게 성공한 상태 변경은 하나, 감사 행도 하나, 최종 버전은 1이어야 한다. 두 요청을 순차 실행해도 오래된 버전 거부는 확인할 수 있지만, 그 결과만으로 잠금 경합까지 시험했다고 주장하지 않는다.

더 강한 재현이 필요하면 두 연결이 조회를 끝냈다는 신호를 테스트 장벽에 전달한 뒤 갱신을 함께 허용한다. “100ms면 둘 다 읽었겠지”라는 지연은 쓰지 않는다. 별도 시험에서는 `OrderTransition` 삽입이 제약 위반으로 실패하도록 개발용 데이터를 준비한다. 실행 후 주문의 상태와 버전도 원래 값이어야 한다. 이 장의 PostgreSQL 시험은 재현 절차와 기대 결과이며, 이 원고에 실제 연결 실행 결과가 포함된 것은 아니다.

## 상태 하나로 모든 사실을 압축하지 않는다

주문 상태에 `stock_reserved_and_payment_started` 같은 이름을 추가하고 싶어질 수 있다. 그러나 주문, 재고 예약, 결제 시도는 서로 다른 속도로 진행한다. 결제 대기 주문에 예약이 만료될 수도 있고, 취소된 주문에 늦은 결제 확인이 도착할 수도 있다. 이를 하나의 ENUM에 모두 넣으면 조합 수가 늘고, 어느 기능이 상태를 수정할 권한을 갖는지 흐려진다.

이번 장은 주문의 업무 단계만 제한했다. 재고 예약이 실제로 존재하는지, 결제사 통지가 진짜인지, 발송 참조에 대응하는 배송 기록이 저장되었는지는 각 경계가 책임져야 한다. `shipmentRef`가 빈 문자열이 아님을 확인하는 것과 실제 배송을 증명하는 것은 다르다. 추후 배송 유스케이스는 배송 기록 저장과 이 전이를 묶는다. 상태 머신이 돈과 물건을 자동으로 움직인다고 설명하지 않는 것이 이 구조의 정직한 한계다.

한편 모든 시스템에 처음부터 감사 테이블이나 상태 머신 라이브러리가 필요한 것은 아니다. 초안과 발행만 있는 작은 게시글에는 두 조건문으로도 충분했다. FluoShop에서 별도 파일과 감사 기록을 둔 이유는 상태를 바꾸는 주체가 고객, 결제 경계, 배송 담당으로 늘었고 잘못된 덮어쓰기의 비용이 커졌기 때문이다. 새로운 패턴을 도입할 시점은 모듈 수가 아니라 지켜야 할 불변식이 늘어나는 순간이다.

다음 장에서는 아직 답하지 않은 질문으로 넘어간다. 주문 상태를 완벽히 지켜도 마지막 티셔츠 한 장을 두 주문에 약속할 수 있다. `pending_payment`를 저장하기 전에 무엇을 원자적으로 확보해야 하는지, 예약을 취소할 때 어떻게 정확히 한 번만 돌려줄지 구현한다.

## 근거와 이어 읽기

- [이전 장의 금액 계산과 스냅샷 계약](./ch05-cart-and-pricing.ko.md)
- [공통 주문 필드와 상태 이름](../EDITORIAL.ko.md)
- [Prisma 서비스 트랜잭션과 중첩 경계 계약](../../packages/prisma/README.ko.md)
- [트랜잭션 실행 구현](../../packages/prisma/src/service.ts), [모듈과 트랜잭션 테스트](../../packages/prisma/src/module.test.ts)
- [HTTP 예외 생성자와 실제 상태 코드](../../packages/http/src/exceptions.ts)
- [명시적인 클래스 주입과 모듈 등록](../../packages/core/README.ko.md)

[이전: 장바구니 가격을 믿으면 안 되는 이유](./ch05-cart-and-pricing.ko.md) · [2권 목차](./toc.ko.md) · [다음: 마지막 티셔츠를 두 사람이 구매한다면](./ch07-inventory-concurrency.ko.md)
