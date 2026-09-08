# 취소와 환불은 되돌리기 버튼이 아니다

<!-- book:volume=02-fluoshop;chapter=11 -->

[이전: 결제 웹훅을 안전하게 처리하기](./ch10-payment-webhooks.ko.md) · [2권 목차](./toc.ko.md) · [다음: 중간에 멈춘 주문을 다시 맞추기](./ch12-reconciliation.ko.md)

## 고객은 취소라고 부르지만 서버가 해야 할 일은 다르다

블로그 독자가 로고 티셔츠를 주문한 직후 사이즈를 잘못 골랐다고 연락했다. 아직 결제 시도를 시작하지 않은 주문이라면 주문을 취소하고 예약 재고를 풀면 된다. 이미 결제가 끝났다면 돈을 돌려주는 작업이 추가된다. 포장까지 시작했다면 창고가 그 티셔츠를 어디에 두었는지도 알아야 한다. 화면의 버튼 이름은 하나여도 서버가 증명해야 하는 사실은 서로 다르다.

가장 위험한 구현은 `order.status = 'cancelled'`를 저장하고 결제 취소 API를 부르는 것이다. DB 변경 뒤 외부 호출이 실패하면 상점은 취소됐다고 말하지만 고객은 돈을 돌려받지 못한다. 순서를 반대로 해도 문제는 남는다. 결제사는 환불했는데 DB 커밋이 실패하면 고객은 환불 중이라는 화면을 계속 보고, 운영자는 다시 환불 버튼을 누른다.

이는 코드 두 줄의 순서를 잘 고르면 사라지는 문제가 아니다. PostgreSQL의 롤백은 결제사의 환불을 되돌리지 못한다. 앞 장에서 서명 검증과 Inbox를 만든 이유가 수신 사실을 보존하기 위해서였다면, 이 장에서 만드는 환불 기록은 우리가 실행하려는 작업을 보존하기 위해서다. 성공했던 청구를 지우는 대신 그 청구에 대응하는 새 업무 사실을 추가한다.

FluoShop은 계속 같은 사용자 ID와 주문 모델을 쓴다. 이 장의 범위는 **배송 처리가 시작되기 전 주문 전체 취소와 전액 환불**이다. `fulfilling`과 `shipped`는 이 자동 경로로 받지 않는다. 부분 환불이나 반품 입고까지 한 번에 일반화하지 않는다. 전액 환불 하나도 외부 성공, 응답 유실, DB 실패라는 세 경계를 정확히 다뤄야 한다.

## 먼저 허용하는 상태 전이를 고정한다

주문이 `pending_payment`이고 PaymentAttempt가 아직 없으면 `cancelled`로 바꿀 수 있다. 시도가 이미 있다면 `prepared`여도 이 고객용 경로에서는 즉시 취소하지 않는다. 호출 직전에 멈춘 것인지, 외부에서는 성공했는데 로컬 기록만 갱신하지 못한 것인지 구분할 수 없기 때문이다. 이전 장의 `prepare()`와 여기의 취소는 같은 주문 행을 먼저 잠그고 시도 유무를 다시 읽는다. 준비가 먼저면 취소를 거부하고, 취소가 먼저면 준비가 거부된다. 7장의 `expire()`가 만료 예약을 반환한 뒤 늦은 성공이 도착하는 경우는 10장의 영속 검토 경로가 맡는다.

주문이 `paid`라면 먼저 `refund_pending`으로 바꾸고 환불 요청을 저장한다. 이 상태부터 배송 작업은 주문을 인수해서는 안 된다. 환불 사실을 확인하고 판매 가능 수량의 보상을 커밋한 뒤에만 `refunded`가 된다. `cancelled`는 청구 없이 끝난 주문이고, `refunded`는 청구와 환불이 모두 존재한 주문이다. 둘을 합치면 매출·환불 집계와 고객 문의에서 중요한 차이가 사라진다.

주문 상태만으로 예약 재고의 상태를 유도하지도 않는다. 예약은 7장에서 정한 `reserved`, `consumed`, `released`를 그대로 쓴다. `paid`일 때는 이미 `consumed`이며 결제 때 판매 가능 수량을 다시 차감하지 않았다. 환불도 그 과거 사실을 `released`로 고치지 않는다. 아직 출고하지 않은 주문에 한해서 별도 보상 기록을 만들고 `Stock.available`을 한 번 증가시킨다. 이미 발송된 물건을 환불했다고 판매 가능 수량을 늘리는 코드는 잘못이다.

반품을 지원하게 되면 환불과 실물 회수는 별개 기록이 된다. 회수가 먼저 필요한 상품도 있고 선환불이 가능한 상품도 있다. 어느 쪽이든 보상은 과거를 삭제하는 기능이 아니라 현재 조건에서 수행하는 새 작업이다. 이 원칙을 작은 전액 환불 구현에 먼저 심어 놓는다.

## 환불 키는 요청이 아니라 업무 작업을 식별한다

아래는 `prisma/schema.prisma`에 추가할 **스키마 부분**이다. 기존 Order의 역관계로 `refundRequest RefundRequest?`를 추가한다. 이전 장의 PaymentAttempt, Order 금액·통화·version 필드를 그대로 사용한다. 한 주문에 전액 환불 하나만 허용하므로 `orderId`가 unique다.

```prisma
enum RefundState {
  pending
  succeeded
  review
}

model RefundRequest {
  id               String      @id
  orderId          String      @unique
  order            Order       @relation(fields: [orderId], references: [id])
  attemptId        String
  paymentId        String
  currency         String
  amountMinor      BigInt
  state            RefundState @default(pending)
  providerRefundId String?     @unique
  createdAt        DateTime    @default(now())
  nextCheckAt      DateTime    @default(now())
  reason           String?
  observedResult   Json?
  compensation     RefundStockCompensation?

  @@index([state, nextCheckAt])
}
```

RefundRequest의 `id`는 재시도마다 생성하지 않는다. DB에 저장된 한 ID를 결제사의 환불 멱등성 키로 계속 사용한다. 고객이 버튼을 두 번 누르거나 운영자가 작업을 다시 실행해도 동일한 행을 찾아야 한다. 일시적인 HTTP 요청 ID를 환불 키로 쓰면 재전송마다 다른 돈 보내기가 된다.

보상은 7장의 `Stock`과 `Reservation`을 직접 사용한다. 추가할 모델은 재고 숫자를 복제하는 장부가 아니라 **전액 환불의 재고 보상이 이미 커밋되었다는 영속 중복 방지 기록** 하나다. 아래 모델을 같은 스키마에 추가한다. `RefundRequest.compensation`이 역관계이며 `orderId @id`와 `refundId @unique`로 같은 주문과 환불에 두 번 보상할 수 없게 한다.

```prisma
model RefundStockCompensation {
  orderId   String        @id
  refundId  String        @unique
  refund    RefundRequest @relation(fields: [refundId], references: [id], onDelete: Restrict)
  createdAt DateTime      @default(now())
}
```

보상 기록의 `orderId`도 그 환불의 주문과 같아야 한다. 다음 **마이그레이션 조각**으로 관계와 금액을 제한한다. 기존 `Stock.available >= 0`, 예약 수량 1~99와 `(orderId, sku)` 키는 유지한다. SQL 제약을 포함해 생성한 마이그레이션을 적용하고 Prisma Client를 다시 생성한다.

```sql
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_money_check"
  CHECK ("currency" = 'KRW' AND "amountMinor" > 0);
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_id_order_key"
  UNIQUE ("id", "orderId");
ALTER TABLE "RefundStockCompensation" ADD CONSTRAINT "RefundStockCompensation_order_fk"
  FOREIGN KEY ("refundId", "orderId") REFERENCES "RefundRequest" ("id", "orderId");
```

반환할 수량은 불변인 주문 항목과 `consumed` 예약을 SKU별로 대조한 뒤 예약에서 읽는다. 보상 기록 삽입, 모든 SKU의 `available` 증가, `refund_confirmed` 전이와 감사, 환불 완료를 한 트랜잭션에 둔다. 중간 SKU에서 실패하면 보상 기록도 롤백되므로 다음 실행이 같은 원장을 다시 적용할 수 있다. 보상 기록만 먼저 저장하고 “중복이니 끝”이라고 처리하는 구현은 금지한다.

## 외부 환불을 재현하는 작은 어댑터

`src/payments/refund-gateway.ts`는 다음의 **완전한 파일**이다. 앞 장의 결제 포트를 확장해서 모든 메서드를 한 인터페이스에 넣는 대신, 환불 업무에 필요한 경계를 별도로 명시했다. 실제 어댑터는 같은 결제사 SDK를 공유할 수 있다.

```ts
export const REFUND_GATEWAY = Symbol('REFUND_GATEWAY');

export type RefundCommand = Readonly<{
  refundKey: string;
  orderId: string;
  attemptId: string;
  paymentId: string;
  currency: 'KRW';
  amountMinor: bigint;
}>;

export type RefundResult =
  | { kind: 'unknown' }
  | { kind: 'rejected'; reason: string }
  | {
      kind: 'succeeded';
      refundId: string;
      paymentId: string;
      currency: 'KRW';
      amountMinor: bigint;
    };

export interface RefundGateway {
  refund(command: RefundCommand): Promise<RefundResult>;
}
```

아래 **완전한 파일** `src/payments/local-refund-gateway.ts`는 이전 장의 LocalPaymentGateway와 같은 결제 기록을 DI로 조회한다. 실제 외부 전송은 없다. 성공을 기록한 뒤 응답만 잃는 스위치를 제공한다.

```ts
import { Inject } from '@fluojs/core';
import {
  PAYMENT_GATEWAY, type PaymentGateway,
} from './payment-gateway.js';
import type {
  RefundCommand, RefundGateway, RefundResult,
} from './refund-gateway.js';

@Inject(PAYMENT_GATEWAY)
export class LocalRefundGateway implements RefundGateway {
  private readonly refunds = new Map<
    string, { command: RefundCommand; result: RefundResult }
  >();
  private loseNextReply = false;

  constructor(private readonly payments: PaymentGateway) {}

  loseNextResponse(): void {
    this.loseNextReply = true;
  }

  async refund(command: RefundCommand): Promise<RefundResult> {
    const existing = this.refunds.get(command.refundKey);
    if (existing) {
      const saved = existing.command;
      if (
        saved.orderId !== command.orderId ||
        saved.attemptId !== command.attemptId ||
        saved.paymentId !== command.paymentId ||
        saved.currency !== command.currency ||
        saved.amountMinor !== command.amountMinor
      ) {
        throw new Error('Refund key reused with different input');
      }
      return existing.result;
    }
    const payment = await this.payments.lookup(command.attemptId);
    if (
      !payment || payment.state !== 'succeeded' ||
      payment.orderId !== command.orderId ||
      payment.paymentId !== command.paymentId ||
      payment.currency !== command.currency ||
      payment.totalMinor !== command.amountMinor
    ) {
      return { kind: 'rejected', reason: 'Payment does not match refund' };
    }
    const result: RefundResult = Object.freeze({
      kind: 'succeeded',
      refundId: `local_refund_${command.refundKey}`,
      paymentId: command.paymentId,
      currency: command.currency,
      amountMinor: command.amountMinor,
    });
    this.refunds.set(command.refundKey, {
      command: Object.freeze({ ...command }), result,
    });
    if (this.loseNextReply) {
      this.loseNextReply = false;
      return { kind: 'unknown' };
    }
    return result;
  }
}
```

이 모형의 Map은 실제 결제사 저장소의 대역이다. 우리 서버의 재시작 복구를 시험할 때 결제사 대역까지 함께 초기화하면 다른 실험이 된다. 결제사가 이미 환불한 사실은 유지한 채 상점 인스턴스만 다시 만드는 것이 응답 유실 복구 실험이다. 프로덕션에서 이 Map을 쓰는 것은 허용되는 구현이 아니다.

결제사의 환불 키가 일정 시간이 지나면 만료된다면 그 기간 이후 같은 키를 재전송하는 것조차 안전하지 않을 수 있다. 자동 재시도 기간을 키 보존 기간보다 짧게 제한하고, 이후에는 원거래·환불 내역 조회나 운영 검토로 넘겨야 한다. 포트가 동일한 결과를 반환한다는 계약은 실제 결제사가 제공하는 보장을 확인한 뒤에만 성립한다.

## 의도 저장, 외부 실행, 완료 반영

다음 `src/payments/refund-service.ts`는 위 스키마와 포트를 전제로 하는 **완전한 서비스 파일**이다. 고객 식별자는 기존 인증 경계에서 검증한 subject를 전달한다. 요청 본문의 `customerId`를 이 인자에 넘겨서는 안 된다. `NotFoundException`, `ForbiddenException`, `ConflictException`은 실제 HTTP 예외이며 여기서는 기존 주문 API에 해당 상태 코드를 전달하기 위해 사용한다.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import {
  ConflictException, ForbiddenException, NotFoundException,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { reservationIssue } from '../inventory/reservation-policy.js';
import { OrderInventoryService } from '../orders/order-inventory.service.js';
import { OrderTransitionsService } from '../orders/order-transitions.service.js';
import {
  REFUND_GATEWAY, type RefundGateway,
} from './refund-gateway.js';

@Inject(PrismaService, REFUND_GATEWAY, OrderInventoryService, OrderTransitionsService)
export class RefundService {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly gateway: RefundGateway,
    private readonly inventory: OrderInventoryService,
    private readonly transitions: OrderTransitionsService,
  ) {}

  async request(orderId: string, customerId: string) {
    return this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.customerId !== customerId) {
        throw new ForbiddenException('Order belongs to another customer');
      }
      const existing = await tx.refundRequest.findUnique({ where: { orderId } });
      if (existing) return { kind: 'refund' as const, id: existing.id };
      if (order.status === 'cancelled') return { kind: 'cancelled' as const };
      const payment = await tx.paymentAttempt.findUnique({ where: { orderId } });
      if (order.status === 'pending_payment' && !payment) {
        await this.inventory.cancel(
          orderId, order.version, { subject: customerId, scopes: [] },
        );
        return { kind: 'cancelled' as const };
      }
      if (
        order.status !== 'paid' || !payment ||
        payment.state !== 'succeeded' || !payment.paymentId ||
        order.currency !== 'KRW' || payment.currency !== order.currency ||
        payment.totalMinor !== order.totalMinor
      ) {
        throw new ConflictException('Order cannot use automatic refund');
      }
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const rows = await tx.reservation.findMany({ where: { orderId } });
      const issue = reservationIssue(items, rows, 'consumed', new Date(0));
      if (issue) throw new ConflictException(issue);
      await this.transitions.apply(
        orderId, order.version, { type: 'refund_requested' },
        { subject: customerId, scopes: [] },
      );
      const refund = await tx.refundRequest.create({
        data: {
          id: randomUUID(), orderId, attemptId: payment.id,
          paymentId: payment.paymentId,
          currency: order.currency, amountMinor: order.totalMinor,
        },
      });
      return { kind: 'refund' as const, id: refund.id };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async execute(refundId: string, now = new Date()): Promise<void> {
    const saved = await this.db.current().refundRequest.findUniqueOrThrow({
      where: { id: refundId }, include: { order: true },
    });
    if (saved.state !== 'pending') return;
    if (
      saved.order.status !== 'refund_pending' ||
      saved.createdAt.getTime() <= now.getTime() - 86_400_000
    ) {
      await this.db.current().refundRequest.updateMany({
        where: { id: refundId, state: 'pending' },
        data: {
          state: 'review',
          reason: saved.order.status !== 'refund_pending'
            ? 'order_not_refund_pending' : 'automatic_window_elapsed',
        },
      });
      return;
    }
    if (saved.currency !== 'KRW' || saved.amountMinor <= 0n) {
      throw new Error('Invalid stored refund');
    }
    const result = await this.gateway.refund({
      refundKey: saved.id, orderId: saved.orderId, attemptId: saved.attemptId,
      paymentId: saved.paymentId, currency: saved.currency,
      amountMinor: saved.amountMinor,
    });

    await this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${saved.orderId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "RefundRequest" WHERE "id" = ${refundId} FOR UPDATE
      `;
      const current = await tx.refundRequest.findUniqueOrThrow({
        where: { id: refundId }, include: { order: true },
      });
      if (result.kind === 'unknown') {
        if (current.state !== 'pending') return;
        await tx.refundRequest.update({
          where: { id: refundId },
          data: { nextCheckAt: new Date(now.getTime() + 300_000) },
        });
        return;
      }
      const observedResult = result.kind === 'succeeded'
        ? {
            kind: result.kind, refundId: result.refundId,
            paymentId: result.paymentId, currency: result.currency,
            amountMinor: result.amountMinor.toString(),
          }
        : { kind: result.kind, reason: result.reason };
      if (current.state === 'succeeded') return;
      if (current.state === 'review') {
        if (result.kind === 'succeeded' || current.observedResult === null) {
          await tx.refundRequest.update({
            where: { id: refundId }, data: { observedResult },
          });
        }
        return;
      }
      const review = async (reason: string) => {
        await tx.refundRequest.update({
          where: { id: refundId },
          data: { state: 'review', reason, observedResult },
        });
      };
      if (
        result.kind === 'rejected' ||
        result.paymentId !== current.paymentId ||
        result.currency !== current.currency ||
        result.amountMinor !== current.amountMinor ||
        current.order.status !== 'refund_pending'
      ) {
        await review('refund_result_or_order_mismatch');
        return;
      }
      const items = await tx.orderItem.findMany({
        where: { orderId: current.orderId },
      });
      const reservations = await tx.reservation.findMany({
        where: { orderId: current.orderId }, orderBy: { sku: 'asc' },
      });
      const issue = reservationIssue(items, reservations, 'consumed', now);
      if (issue) {
        await review(issue);
        return;
      }
      const already = await tx.refundStockCompensation.findUnique({
        where: { orderId: current.orderId },
      });
      if (already) {
        await review('compensation_exists_without_completed_refund');
        return;
      }
      await tx.refundStockCompensation.create({
        data: { orderId: current.orderId, refundId: current.id },
      });
      for (const reservation of reservations) {
        await tx.stock.update({
          where: { sku: reservation.sku },
          data: { available: { increment: reservation.quantity } },
        });
      }
      await this.transitions.apply(
        current.orderId, current.order.version,
        {
          type: 'refund_confirmed', currency: result.currency,
          amountMinor: result.amountMinor,
        },
        { subject: 'system:refund-ledger', scopes: ['payments:refund-confirm'] },
      );
      await tx.refundRequest.update({
        where: { id: refundId },
        data: {
          state: 'succeeded', providerRefundId: result.refundId,
          observedResult, reason: null,
        },
      });
    }, { isolationLevel: 'ReadCommitted' });
  }
}
```

`request()` 안에는 외부 호출이 없다. 두 고객 요청이 동시에 와도 주문 버전과 unique 제약으로 환불 의도는 하나만 커밋된다. 경합에서 실패한 요청은 같은 주문을 다시 읽어 기존 환불을 보여준다. 오류를 무조건 성공으로 삼키지 않는다. 기존 행이 있는지 확인하는 것은 반드시 트랜잭션 밖의 재시도 경계에서 수행한다.

`execute()`는 저장된 금액과 키만 읽어 외부 호출하고, 그 뒤 새 트랜잭션을 연다. 따라서 이 메서드 전체에 `@Transaction()`을 붙이거나 request-wide 트랜잭션 인터셉터로 감싸면 설계가 깨진다. 외부 실행은 활성 ambient transaction 밖에서 호출해야 한다. 새 서비스 `@Transaction()`이 권장되는 일반적인 DB 작업과 달리, 여기서는 서로 분리된 두 경계를 코드에서 보이게 하는 것이 더 중요하다. 두 번째 인자인 `now`는 내부 작업의 시각 입력이며, 다음 장의 대사와 테스트가 같은 시각 기준을 사용할 수 있게 한다. 고객이 보내는 시각을 이 값으로 받지는 않는다.

두 실행자가 동시에 같은 환불을 호출할 수 있다. 이것을 완전히 막는 대신 외부 멱등성 키와 DB 상태 검사로 같은 효과에 수렴시킨다. 첫 실행자가 완료를 저장했다면 뒤 실행자는 `pending`이 아니므로 아무것도 바꾸지 않는다. 첫 실행자가 결제사 성공 뒤 죽었다면 다음 실행자가 같은 결과를 받아 로컬 완료를 이어 간다.

외부 응답을 기다리는 동안 24시간 경계를 넘어 대사가 요청을 `review`로 바꿀 수도 있다. 뒤늦게 성공을 받은 실행자는 주문 잠금 다음에 환불 행도 잠그고, `review`와 그 사유를 유지한 채 `observedResult`에 성공 증거를 남긴다. 저장된 성공 증거를 뒤늦은 거절로 지우지 않는다. 이 분기는 재고 보상이나 주문 완료를 실행하지 않는다. `succeeded`의 중복 완료와 `review`의 추가 증거를 같은 조기 반환으로 처리하면 외부 성공을 잃는다.

예약 원장이 맞지 않으면 쓰기 전에 환불 결과와 사유를 `review`로 커밋한다. 이미 외부에서 환불한 사실을 잃지 않으며, 잘못된 수량을 자동 복구하지 않는다. 반대로 재고 갱신·감사 삽입·최종 환불 저장에서 DB 오류가 나면 예외를 전파해 보상 기록까지 전체 롤백한다. 외부 환불은 남으므로 `pending`의 같은 ID로 재실행해 완료 반영만 이어 간다. `review`는 자동 재시도의 대상이 아니다.

배송 인수는 6장의 `fulfillment_started`를 통해 `paid → fulfilling`만 허용한다. 이때 예약을 다시 소비하거나 재고를 또 차감하지 않는다. 환불 요청이 먼저 `refund_pending`을 커밋하면 배송 전이는 거부되고, 배송이 먼저 이기면 환불 요청은 409다. 늦은 환불 결과가 `fulfilling`·`shipped`에서 관찰되어도 자동 보상하지 않는다. 반품 입고 기능을 구현하지 않았기 때문에 가능한 주문인 척 수량을 늘리지 않는다.

## 고객 취소 입구와 내부 환불 실행을 나눈다

다음 **완전한 파일** `src/payments/refund-actions.controller.ts`는 `POST /orders/:id/cancel`을 추가한다. 요청의 고객 ID나 환불 금액은 받지 않는다. 이 입구는 의도만 저장하고 실제 외부 환불은 12장의 `RefundService.execute` 호출에 맡긴다. 따라서 `kind: refund`는 환불 완료가 아니라 저장된 환불 작업 ID를 뜻한다.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException, ConflictException, Controller, Header, HttpCode, Post,
  UnauthorizedException, type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { z } from 'zod';
import { ReservationConflict } from '../inventory/inventory.service.js';
import {
  OrderRuleError, OrderVersionConflict,
} from '../orders/order-state.js';
import { RefundService } from './refund-service.js';

const cancellationInput = z.object({
  orderId: z.string().min(1).max(160),
  body: z.object({}).strict().optional(),
});

@Controller('/orders')
@Inject(RefundService)
export class RefundActionsController {
  constructor(private readonly refunds: RefundService) {}

  @Post('/:id/cancel')
  @UseAuth('blog-jwt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async request(_input: unknown, context: RequestContext) {
    const subject = context.principal?.subject;
    if (!subject) throw new UnauthorizedException();
    const input = cancellationInput.safeParse({
      orderId: context.request.params.id, body: context.request.body,
    });
    if (!input.success) throw new BadRequestException('Invalid cancellation request');
    try {
      return await this.refunds.request(input.data.orderId, subject);
    } catch (error) {
      if (
        error instanceof ReservationConflict ||
        error instanceof OrderRuleError ||
        error instanceof OrderVersionConflict
      ) throw new ConflictException(error.message);
      throw error;
    }
  }
}
```

PaymentsModule의 **등록 확장 부분**은 다음과 같다. 앞 장의 imports/providers/controllers/exports를 지우지 않고 각 배열에 아래 항목을 추가한다. 파일 상단에 다음 import를 추가하고 메타데이터에 병합한다.

```ts
import { LocalRefundGateway } from './local-refund-gateway.js';
import { RefundActionsController } from './refund-actions.controller.js';
import { REFUND_GATEWAY } from './refund-gateway.js';
import { RefundService } from './refund-service.js';
```

```ts
providers: [
  { provide: REFUND_GATEWAY, useClass: LocalRefundGateway },
  RefundService,
],
controllers: [RefundActionsController],
exports: [RefundService],
```

`OrdersModule.exports`는 `[OrderInventoryService, OrderTransitionsService]`로 확장한다. 두 클래스는 이미 같은 모듈의 providers에 있으며 중복 등록하지 않는다. 결제 전 취소는 전자의 `cancel`, 환불 요청·확정은 후자의 `apply`를 사용한다. PaymentsModule은 기존처럼 OrdersModule을 import하고 반대 방향의 import는 만들지 않는다. 기본 PrismaService는 루트에서 한 번 등록한 `BlogDatabaseModule`이 제공한다.

`request()`가 반환한 ID는 영속 작업 식별자다. 12장 대사를 추가하기 전 실습에서는 컨테이너에서 해석한 RefundService에 `await service.execute(id)`를 호출해 환불을 진행할 수 있다. 외부 호출 없이 의도만 만든 시점과 실제 완료 시점을 따로 관찰한다. `void service.execute()`로 관찰되지 않는 Promise를 만들지 않는다.

## 환불 실패를 재현하는 순서

아래는 `src/payments/local-refund-gateway.test.ts`의 **완전한 테스트 파일**이다. 결제와 환불을 외부 호출 없이 재현하며, 결과 유실 뒤 같은 환불 식별자가 반환되는지 확인한다.

```ts
import { expect, it } from 'vitest';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { LocalRefundGateway } from './local-refund-gateway.js';

it('returns the original refund after losing its response', async () => {
  const payments = new LocalPaymentGateway();
  await payments.charge({
    attemptId: 'attempt-101', orderId: 'order-101',
    currency: 'KRW', totalMinor: 29_000n,
  });
  const refunds = new LocalRefundGateway(payments);
  const command = {
    refundKey: 'refund-101', attemptId: 'attempt-101', orderId: 'order-101',
    paymentId: 'local_attempt-101', currency: 'KRW' as const,
    amountMinor: 29_000n,
  };
  refunds.loseNextResponse();
  expect(await refunds.refund(command)).toEqual({ kind: 'unknown' });
  expect(await refunds.refund(command)).toEqual({
    kind: 'succeeded', refundId: 'local_refund_refund-101',
    paymentId: 'local_attempt-101', currency: 'KRW', amountMinor: 29_000n,
  });
  await expect(refunds.refund({ ...command, amountMinor: 1n })).rejects.toThrow();
});
```

독자의 앱에서는 `pnpm exec vitest run src/payments/local-refund-gateway.test.ts`로 실행한다. 이 테스트는 결제사 대역의 멱등성만 확인한다. PostgreSQL 정합성은 다음 순서로 별도 통합 시험한다. 8장에서 생성한 버전 0 주문을 9·10장의 실제 조정자로 결제해 `paid`, version 1, 29,000 KRW를 만든다. 발행된 Product의 ProductVariant와 주문 항목 수량은 1, 티셔츠 `Stock.available=9`, 해당 `(orderId, sku)` 예약은 `consumed`다. 시도와 결제사 대역은 같은 성공 식별자를 유지하고 보상 기록은 아직 없다.

먼저 `request(orderId, customerId)`를 호출한다. 기대 결과는 주문 `refund_pending`, version 2, `refund_requested` 감사 한 행, RefundRequest 한 행이며 수량은 9다. 이어 `loseNextResponse()` 후 `execute(id, fixedNow)`를 호출한다. 외부 대역에는 환불이 생겼지만 DB는 여전히 `pending`이어야 한다. 같은 ID로 다시 실행하면 주문 `refunded`, version 3, `refund_confirmed` 감사 한 행, 환불 `succeeded`, 예약은 **그대로 `consumed`**, 수량은 10, RefundStockCompensation은 정확히 한 행이다. 세 번째 실행과 컨테이너 재생성 뒤 실행에서도 이 숫자가 변하지 않아야 한다.

경합 시험에서는 같은 주문의 환불 요청 두 개를 동시에 시작한다. 둘 다 즉시 성공할 필요는 없지만 최종 환불 행은 하나여야 한다. 실패한 요청을 재호출하면 같은 ID를 얻어야 한다. 배송 인수와의 경합에서는 주문의 조건부 갱신 직전에 시험용 Promise 경계를 두고 두 작업을 함께 해제한다. 환불과 배송이 둘 다 성공한 결과는 허용하지 않는다.

부분 실패 시험은 완료 트랜잭션 안의 두 번째 SKU 갱신이나 OrderTransition 삽입을 실패시킨다. 외부 대역의 환불은 남고 첫 SKU의 수량·보상 기록·주문·감사·RefundRequest 변경은 모두 롤백되어야 한다. 같은 ID를 재실행하면 외부 환불 식별자는 바뀌지 않고 로컬 완료만 끝난다. 이 실험은 실제 트랜잭션 DB가 필요하며, 원고 작성 중에는 실행하지 않았다.

추가로 예약 하나를 제거하거나 `released`로 바꾼 상태에서 외부 성공을 반영하면 `review`, `observedResult`, `reason`이 남고 재고는 증가하지 않아야 한다. `fulfilling`·`shipped`의 요청은 409이며 환불 의도와 외부 호출이 없어야 한다. 생성 후 정확히 24시간인 `pending` 환불도 외부 호출 없이 `automatic_window_elapsed`로 검토 대상이 된다. 결제 시도 없는 주문의 취소는 버전 0→1, `cancel_requested` 감사 한 행, 예약 `released`, 판매 가능 수량 증가 한 번을 확인하고, 중복 취소는 이를 반복하지 않아야 한다.

24시간 경계의 경합은 대역에 `entered`와 `release` Promise를 두어 재현한다. A의 환불 호출 진입 신호를 먼저 기다리고, 고정 시각을 경계로 옮긴 B의 대사를 완료해 `review`를 확인한 다음 A의 성공 응답을 해제한다. 최종 환불은 `review`, 사유는 `automatic_window_elapsed`, `observedResult.refundId`는 외부 성공 ID여야 한다. 주문·수량·보상 기록은 변하지 않아야 하며 실제 시간을 기다리는 sleep은 사용하지 않는다.

환불 사실은 운영 로그에서 청구 사실과 연결되어야 한다. 주문 ID만 남기면 동일 고객의 여러 주문을 잘못 결합할 수 있고, 결제사 오류 메시지를 원문으로 모두 남기면 민감한 값이 섞일 수 있다. 환불 ID, 원결제 ID, 작업 상태, 재시도 가능 여부를 구조화해 기록하고 금액은 문자열로 직렬화한다. 고객 화면의 “환불 완료”도 외부 사실과 로컬 완료 반영의 경계를 따라야 한다.

## 자동화의 끝을 정하고 다음 작업으로 연결하기

모든 실패를 무한히 자동 재시도하는 것은 운영 정책이 아니다. 결제 금액 불일치, 알 수 없는 원결제, 환불 키 보존 기간 초과는 `review`와 사람의 판단이 필요하다. 네트워크 오류나 완료 저장 실패처럼 같은 작업을 안전하게 반복할 수 있는 경우만 자동 경로에 남긴다. 작업을 재시도한다는 말과 돈을 새로 보낸다는 말을 구분하는 것이 핵심이다.

부분 환불을 도입한다면 `orderId @unique`를 단순히 제거하는 것으로 끝나지 않는다. 청구 금액 이하라는 총합 제약, 동일 상품 수량을 두 번 환불하지 않는 배분 기록, 할인·배송비 분배, 동시 환불 합산을 잠그는 경계가 필요하다. 지금 규모에서 전액 환불만 지원하는 선택은 이러한 비용을 늦추는 명시적인 제품 결정이다.

이제 취소는 가능한 상태에서만 실행되고, 환불은 영속 ID를 가진 작업이 되었다. 하지만 요청을 저장한 직후 프로세스가 종료되면 누가 다시 실행할까. 다음 장은 이런 중단 지점을 사람의 기억이 아니라 DB 조회와 정기 작업으로 찾아내는 대사를 구현한다.

## 근거와 확인 범위

- [Prisma README](../../packages/prisma/README.ko.md), [공개 export](../../packages/prisma/src/index.ts), [트랜잭션 타입](../../packages/prisma/src/types.ts): `transaction()`과 `current()`, 중첩 경계 재사용 및 strict 모드.
- [Prisma 서비스 구현](../../packages/prisma/src/service.ts), [서비스 통합 테스트](../../packages/prisma/src/vertical-slice.test.ts), [종료 drain 테스트](../../packages/prisma/src/shutdown-drain-status.test.ts): 트랜잭션과 클라이언트 수명주기의 근거.
- [HTTP 예외 구현](../../packages/http/src/exceptions.ts): 403·404·409 매핑.
- [앞 장의 수신 기록](./ch10-payment-webhooks.ko.md), [편집 계약](../EDITORIAL.ko.md): 동일 주문·금액·예약 수명주기의 전제.

이 장의 환불 저장소와 재고 보상은 애플리케이션 소유 코드다. Fluo 등록이 외부 환불 원자성이나 재시작 복구를 제공하지 않는다. 실제 결제·환불·인프라 변경은 실행하지 않았다.

[이전: 결제 웹훅을 안전하게 처리하기](./ch10-payment-webhooks.ko.md) · [2권 목차](./toc.ko.md) · [다음: 중간에 멈춘 주문을 다시 맞추기](./ch12-reconciliation.ko.md)
