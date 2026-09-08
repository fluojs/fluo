# 저장은 됐는데 이벤트가 사라졌다면

<!-- book:volume=02-fluoshop;chapter=14 -->

[이전: 주문 완료를 다른 기능에 알리기](./ch13-domain-events.ko.md) · [2권 목차](./toc.ko.md) · [다음: 실패한 작업을 다시 실행하기](./ch15-reliable-jobs.ko.md)

## 커밋 다음 줄은 실행되지 않을 수 있다

티셔츠 판매를 시작한 금요일, 배포 종료와 결제 웹훅 처리가 겹쳤다. 주문은 `paid`로 저장되었지만 프로세스가 이벤트 발행 전에 끝났다. 고객은 정상 결제된 주문을 갖고 있고 운영자는 결제사와 대사해도 차이를 발견하지 못한다. 빠진 것은 결제가 아니라 영수증 안내를 준비할 책임이다. 앞 장의 프로세스 내부 이벤트에는 재시작 후 찾아볼 발행 기록이 없다. 예외를 더 세밀하게 잡더라도 실행되지 않은 다음 줄을 복구할 수는 없다.

이 문제는 두 저장소에 차례로 쓰는 것만으로 해결되지 않는다. 주문을 먼저 저장하고 Redis에 이벤트를 넣으면 두 호출 사이에 죽을 수 있다. Redis에 먼저 넣으면 주문 트랜잭션이 롤백되었는데 소비자가 결제를 완료했다고 믿을 수 있다. 데이터베이스와 네트워크 큐가 하나의 로컬 트랜잭션인 것처럼 보이는 API를 만들어도 간격은 남는다. 어떤 책임을 어느 저장소에 먼저 남길지를 명시해야 한다.

우리 상점은 아직 같은 PostgreSQL을 사용하는 모듈형 모놀리스다. 이 조건을 이용해 주문과 ‘전달해야 할 사실’을 한 트랜잭션에 저장한다. 이것이 Outbox다. 받는 기능에는 ‘이 소비자가 이 사실을 받아서 어떤 후속 책임을 만들었다’를 기록하는 Inbox를 둔다. Fluo가 자동 생성하는 테이블이 아니며 `EventBusModule`이나 `PrismaModule` 등록만으로 생기는 기능도 아니다. 이 장은 애플리케이션 소유 테이블과 실제 트랜잭션 코드를 작성한다.

## 전달과 업무 완료를 구별하는 스키마

이 장의 소비자는 `notifications.receipt.v1` 하나다. ‘결제 완료 영수증을 준비해 달라’는 의도를 저장할 뿐 실제 메일이나 결제사 호출은 하지 않는다. 이름은 알림 기능의 논리적 소비자이며 서버 인스턴스 ID가 아니다. 서버를 두 대로 늘려도 같은 소비자로 중복을 판정해야 한다. 반대로 배송 준비 기능이 같은 이벤트를 소비한다면 다른 이름과 별도 처리 이력이 필요하다.

다음은 `prisma/schema.prisma`에 추가하는 **세 모델의 완전한 정의**다. 기존 datasource, generator, 계정, `ProductVariant`, 주문, 주문 항목, `Stock`, `Reservation`, 결제·환불 모델을 교체하는 스키마 전체가 아니다. `Order`는 6장의 모델을 그대로 사용하고, 기존 `OrderTransition`에는 아래에서 지정하는 역관계 한 줄을 추가한다. ID는 문자열, `totalMinor`는 PostgreSQL `bigint`에 대응하는 Prisma `BigInt`, 버전은 `Int`다. 결제 Outbox의 `orderVersion`은 0에서 시작하는 주문에 실제 결제 전이를 적용한 뒤의 버전이다.

```prisma
model PaidOrderOutbox {
  id           String   @id
  orderId      String
  customerId   String
  orderVersion Int
  currency     String
  totalMinor   BigInt
  occurredAt   DateTime @default(now())
  deliveredAt  DateTime?
  transition   OrderTransition @relation(fields: [orderId, orderVersion], references: [orderId, version], onDelete: Restrict)
  receipt      ReceiptRequest?

  @@unique([orderId, orderVersion])
  @@index([deliveredAt, occurredAt, id])
}

model EventInbox {
  consumer   String
  eventId    String
  receivedAt DateTime @default(now())

  @@id([consumer, eventId])
}

model ReceiptRequest {
  id           String   @id
  orderId      String
  customerId   String
  orderVersion Int
  currency     String
  totalMinor   BigInt
  createdAt    DateTime @default(now())
  enqueuedAt   DateTime?
  completedAt  DateTime?
  body         String?
  source       PaidOrderOutbox @relation(fields: [id], references: [id], onDelete: Restrict)

  @@unique([orderId, orderVersion])
  @@index([enqueuedAt, createdAt, id])
}
```

6장의 기존 `OrderTransition` 모델 안에는 다음 **역관계 필드**를 추가한다. 실제 FK 열은 위 Outbox의 `(orderId, orderVersion)`이며 이 필드는 새 감사 기록이나 추가 열을 만들지 않는다. Prisma 스키마에도 관계를 선언해야 뒤의 migration이 이 외래키를 불필요한 차이로 삭제하지 않는다.

```prisma
paidOutbox PaidOrderOutbox?
```

처음부터 모든 사건을 담는 JSON 테이블을 만들지 않았다. `PaidOrderOutbox`는 `orders.paid.v1`만 보관하므로 이벤트 종류와 필드가 스키마로 제한된다. 범용 Outbox를 도입하면 저장 형식 버전, 종류별 복원기, 잘못된 페이로드의 격리 정책까지 필요하다. 사건이 하나인 지금은 구체적인 모델이 읽기와 검증에 유리하다. 장기적으로 테이블 수가 부담스러워질 때 바꿀 수 있지만, 그때에도 저장된 과거 버전의 복원 책임은 사라지지 않는다.

`deliveredAt`은 메일 발송 시간이 아니다. 이 장에서는 Inbox와 `ReceiptRequest`가 원자적으로 저장된 시간이다. `enqueuedAt`은 다음 장의 Redis 인계 기록이고, `completedAt`은 실제 영수증 본문 저장 기록이다. 세 시간을 한 `processed` boolean으로 합치면 장애가 어느 경계에서 생겼는지 구별하지 못한다. 운영 화면도 ‘전달됨’, ‘작업 대기’, ‘완료’를 구분해서 보여 주어야 한다.

금액은 Outbox에도 주문 시점 스냅샷으로 저장한다. 나중에 상품 가격을 고치거나 주문이 환불되더라도 ‘그때 어떤 결제가 확인되었나’는 바뀌지 않는다. 물론 환불 후에 오래된 영수증을 현재 결제 상태인 것처럼 보내는 것은 별도 제품 문제다. 이 장의 후속 작업은 과거 결제의 자료를 준비하는 것뿐이며, 발송 가능 여부는 18장의 채널 경계에서 현재 상태와 정책을 다시 확인한다.

독자의 격리 PostgreSQL에서 다음 순서로 마이그레이션을 만든다. 1권의 Prisma CLI와 Client 버전을 그대로 유지한다.

```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name add_paid_outbox --create-only
```

생성된 `migration.sql` 끝에 다음 `CHECK` 제약을 추가한다. 외래키는 위 관계 정의에서 Prisma가 생성한다. `OrderTransition`의 복합 기본 키에 연결해 결제 사건이 가리키는 감사 행을 보존하지만, 그 행이 `payment_confirmed → paid`인지 확인하는 책임은 아래 삽입 지점에 있다.

```sql
ALTER TABLE "PaidOrderOutbox"
  ADD CONSTRAINT "PaidOrderOutbox_values_check"
    CHECK ("currency" = 'KRW' AND "totalMinor" > 0 AND "orderVersion" >= 1);

ALTER TABLE "ReceiptRequest"
  ADD CONSTRAINT "ReceiptRequest_values_check"
    CHECK ("currency" = 'KRW' AND "totalMinor" > 0 AND "orderVersion" >= 1),
  ADD CONSTRAINT "ReceiptRequest_completion_check"
    CHECK (("completedAt" IS NULL) = ("body" IS NULL));
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

`CHECK`의 의미가 Prisma 생성 타입에 자동 반영되지는 않는다. 이후 migration에서도 이 애플리케이션 소유 SQL을 유지한다. 완료된 Outbox부터 단독 삭제할 수도 없으므로 보존 기간이 지난 요청·Inbox·Outbox를 정리하는 순서를 함께 설계한다.

## 주문 상태와 Outbox를 한 번에 쓰기

새 결제 커밋 서비스를 만들지 않는다. 수정할 파일은 그대로 `src/payments/payment-ledger.ts`이며, `PaymentLedger.prepare(orderId, attemptId)`, `recordObservation(expectedAttemptId, observed)`, `record(event, digest, expectedAttemptId)`의 이름·인자·반환 결정을 바꾸지 않는다. coordinator와 `PaymentReconciler.runBatch()`는 기존 `recordObservation()`을 통해, `PaymentWebhooksController.receive()`는 직접 `record()`를 호출한다. 앞 장의 프로세스 내부 발행만 영속 Outbox 삽입으로 바꾼다.

먼저 13장에서 추가한 `OrderPaidEvent`, `OrderEventsPublisher` import와 publisher 생성자 인자·주입 토큰을 제거한다. `@Inject(PrismaService, OrderInventoryService)`와 기존 `db`, `inventory` 생성자 인자는 남긴다. `record()` 시작의 `publication` 지역 변수와 `const decision = await`를 제거하고 원래의 `return this.db.transaction(async () => {`로 돌린다. 끝의 `announce()`와 `return decision`도 제거한다. 주문·결제 시도 잠금과 트랜잭션의 `ReadCommitted` 옵션은 유지한다. 이 변경 뒤에는 원장이 이벤트 버스를 호출하지 않는다.

다음은 **`record()`의 처음 성공한 결제 분기 끝부분 전체를 교체하는 조각**이다. 시작점은 13장의 `const paid = await this.inventory.confirmPayment(...)`, 끝점은 바로 뒤의 `return finish('applied')`다. 이 지점에 도달하기 전의 PaymentInbox 삽입·digest 검사·기존 결정 반환, 시도와 주문 조회, 결제 식별자·금액·통화 검사, 예약의 SKU·수량·상태·만료 검사, 거절·`review` 처리와 `finish()` 정의를 삭제하지 않는다. `tx`, `order`, `attempt`, `event`, `finish`는 모두 그 기존 콜백의 지역 값이다. 새 입력 타입이나 검증을 대신하는 helper를 가정하지 않는다.

```typescript
const paid = await this.inventory.confirmPayment(
  order.id, order.version, event.currency, BigInt(event.totalMinor),
  { subject: 'system:payment-ledger', scopes: ['payments:confirm'] },
);
const transition = await tx.orderTransition.findUniqueOrThrow({
  where: { orderId_version: { orderId: paid.id, version: paid.version } },
});
await tx.paidOrderOutbox.create({
  data: {
    id: `order-paid:${paid.id}:${paid.version}`,
    orderId: paid.id,
    customerId: paid.customerId,
    orderVersion: paid.version,
    currency: paid.currency,
    totalMinor: paid.totalMinor,
    occurredAt: transition.occurredAt,
  },
});
await tx.paymentAttempt.update({
  where: { id: attempt.id },
  data: { state: 'succeeded', paymentId: event.paymentId },
});
return finish('applied');
```

핵심은 원장을 우회하는 `order.updateMany({ status: 'paid' })`가 없다는 점이다. `confirmPayment()`가 기존 버전 조건과 금액 정책을 적용하고 `OrderTransition`을 쓰며, `Reservation`을 소비한다. SKU는 3장의 `ProductVariant`이고 재고 원장은 7장의 `Stock.available`이다. Outbox 때문에 재고 표를 바꾸거나 결제 때 판매 가능 수량을 다시 줄이지 않는다. 예약이 없거나 이미 해제되었거나 만료되었다면 앞의 원장 판단에서 검토 대상으로 남고 이 성공 분기에는 들어오지 않는다. 경합 때문에 실제 확정이 실패하면 전체 트랜잭션이 예외로 끝나야 한다.

Outbox 삽입 실패는 주문 상태·버전, 전이 감사, 예약 소비, 이번 PaymentInbox 삽입까지 함께 롤백한다. 예외를 잡아 `finish('review')`로 바꾸면 앞의 주문 변경을 커밋할 수 있으므로 이 꼬리 부분에 그런 catch를 추가하지 않는다. 같은 provider 사건의 재전달은 원장의 기존 digest/decision 경로에서 끝나고, 다른 사건 ID로 같은 성공이 와도 이미 성공한 PaymentAttempt에서 끝난다. 둘 다 새 Outbox나 전이 기록을 만들지 않는다.

`eventId`는 앞 장과 같은 결제 전이 ID이고 `occurredAt`도 같은 감사 시각이다. 나중에 환불이 진행되어 주문 버전이 올라가더라도 저장한 봉투를 현재 `Order.version`으로 덮어쓰지 않는다. 결제 후 예약은 이미 `consumed`다. 11장의 환불 보상은 영속 중복 방어와 함께 같은 재고 원장에 별도로 기록되며, 결제 Outbox 재전달을 재고 반환 명령으로 해석하지 않는다.

`PrismaService`의 `current()`는 활성 컨텍스트에서는 트랜잭션 클라이언트를 돌려준다. 루트 PrismaClient를 별도로 주입받아 Outbox를 쓰면 같은 콜백 안에 있는 것처럼 보여도 원자성이 깨질 수 있다. 따라서 트랜잭션에 참여하는 호출은 모두 같은 서비스의 `current()`를 통해 이루어지게 한다. 표준 데코레이터 `@Transaction()`도 사용할 수 있지만, 이 예제에서는 경계와 반환값을 한눈에 보이게 하려고 명시적 `transaction()`을 선택했다.

## 받았다는 기록도 작업과 함께 커밋하기

나쁜 Inbox 구현은 중복을 확인하고 ‘수신 완료’를 저장한 뒤 후속 작업을 시작한다. 그 사이에 종료되면 다음 전달은 ‘이미 받았다’며 건너뛰고 작업은 영원히 만들어지지 않는다. `EventInbox` 행과 `ReceiptRequest` 행은 반드시 같은 트랜잭션에 들어가야 한다. 현재 같은 PostgreSQL에 있으므로 Outbox 완료 표시까지 그 경계 안에서 처리할 수 있다.

다음 `src/notifications/paid-outbox-relay.ts`는 완전한 파일이다. `PaidRow`는 앞의 테이블에서 실제로 선택하는 열의 타입이다. SQL은 값 보간이 가능한 Prisma 태그를 사용하고, 동적인 테이블 이름이나 문자열 연결을 사용하지 않는다.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { OrderPaidEvent } from '../orders/events/order-paid.event.js';

interface PaidRow {
  id: string;
  orderId: string;
  customerId: string;
  orderVersion: number;
  currency: string;
  totalMinor: bigint;
  occurredAt: Date;
}

@Inject(PrismaService, EventBusLifecycleService)
export class PaidOutboxRelay {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly events: EventBusLifecycleService,
  ) {}

  async deliverNext(): Promise<boolean> {
    const event = await this.db.transaction(async () => {
      const tx = this.db.current();
      const rows = await tx.$queryRaw<PaidRow[]>`
        SELECT "id", "orderId", "customerId", "orderVersion",
               "currency", "totalMinor", "occurredAt"
        FROM "PaidOrderOutbox"
        WHERE "deliveredAt" IS NULL
        ORDER BY "occurredAt", "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const row = rows[0];
      if (!row) return null;
      if (row.currency !== 'KRW' || row.totalMinor <= 0n) {
        throw new Error('Invalid paid-order snapshot');
      }
      const accepted = await tx.eventInbox.createMany({
        data: [{ consumer: 'notifications.receipt.v1', eventId: row.id }],
        skipDuplicates: true,
      });
      if (accepted.count === 1) {
        await tx.receiptRequest.create({
          data: {
            id: row.id,
            orderId: row.orderId,
            customerId: row.customerId,
            orderVersion: row.orderVersion,
            currency: row.currency,
            totalMinor: row.totalMinor,
          },
        });
      }
      await tx.paidOrderOutbox.update({
        where: { id: row.id },
        data: { deliveredAt: new Date() },
      });
      return new OrderPaidEvent(
        row.id, row.orderId, row.customerId, row.orderVersion,
        row.currency, row.totalMinor.toString(), row.occurredAt.toISOString(),
      );
    });
    if (!event) return false;
    await this.events.publish(event);
    return true;
  }
}
```

`FOR UPDATE SKIP LOCKED`로 두 relay가 같은 행을 동시에 소유하지 않게 한다. 처리 중 프로세스가 끝나면 PostgreSQL이 트랜잭션을 롤백하고 잠금을 해제하므로 별도 메모리 플래그를 복구할 필요가 없다. 다른 relay는 잠긴 첫 행을 기다리지 않고 다음 행으로 갈 수 있다. 그 대신 서로 다른 행의 처리 순서는 보장하지 않는다. 이 소비자는 각 결제 스냅샷으로 독립적인 요청 하나를 만들므로 전역 순서가 필요 없다. 사건 순서에 의존하는 소비자에 이 전략을 그대로 적용해서는 안 된다.

`createMany(..., skipDuplicates: true)`는 PostgreSQL의 유일성 제약과 함께 중복 수신을 판정한다. 먼저 조회하고 없으면 삽입하는 두 호출보다 경합에 강하다. 중복이면 `ReceiptRequest`를 새로 만들지 않는 이유는 Inbox와 요청이 과거에 함께 커밋되었다는 불변식 때문이다. 운영자가 둘 중 하나를 수동 삭제하면 그 불변식을 깨뜨린다. 복구 작업도 테이블 관계를 이해한 제한된 작업으로 해야 한다.

`events.publish()`는 트랜잭션이 끝난 다음에 있다. 원본 사건은 PaymentLedger가 Outbox에 기록했고, relay는 그 동일 봉투를 복원해 프로세스 안에 알린다. 앞 장의 미리보기처럼 빠르게 반응하는 소비자에게 신호를 보내지만, 그 성공으로 `deliveredAt`을 정하지 않는다. 이 필드는 오직 `notifications.receipt.v1`의 Inbox와 요청 인계 완료를 뜻한다. 다른 소비자까지 ACK했다는 전역 표시가 아니다. 발행 전에 죽어도 다음 장의 작업 인계자가 `ReceiptRequest`를 검색한다. 반대로 이벤트를 두 번 발행해도 영속 요청 수는 늘지 않는다. 이 장의 보장은 ‘같은 데이터베이스 안에서 후속 의도를 한 번 기록한다’이지, 모든 외부 부수 효과를 정확히 한 번 실행한다는 보장이 아니다.

## 실제 모듈 경계와 실행 주체

DB 등록은 바꾸지 않는다. 1권 `src/database/blog-database.module.ts`의 `BlogDatabaseModule`은 `AppSettings`를 주입하는 `PrismaModule.forRootAsync` 등록 값이며, 바깥 `global: true`와 factory 내부 `strictTransactions: true`가 이미 있다. 다음은 `src/app.ts`의 **관련 imports 합성 부분**이다. 기존 항목은 유지하고 이미 있는 등록 값은 한 번만 둔다.

```typescript
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

@Module({
  imports: [BlogDatabaseModule, PaymentsModule, NotificationsModule],
})
export class AppModule {}
```

`strictTransactions: true`는 트랜잭션 기능이 없는 대체 클라이언트를 조용히 직접 실행으로 처리하지 않게 한다. PostgreSQL의 interactive transaction을 사용하는 이 예제에서는 테스트 대역도 이 요구를 보존해야 한다. Node24는 패키지의 ALS 기반 컨텍스트 경로를 제공한다. 타입만 맞춘 가짜 클라이언트에 실제 롤백이 있다고 생각해서는 안 된다.

`PaymentLedger`는 기존 `PaymentsModule.providers`에만 남고, 그 모듈은 `OrderInventoryService`를 export하는 `OrdersModule`을 import한다. 별도 결제 커밋 provider를 추가하지 않는다. 13장의 사용하지 않는 `OrderEventsPublisher` provider/export와 파일은 제거하되 `PaidPreviewStore`, `PaidPreviewListener`는 유지한다. `src/notifications/notifications.module.ts`에는 아래 등록을 둔다. 앞 장의 루트 `EventBusModule.forRoot()`와 12장까지 이어 온 Cron 등록도 한 개씩 유지한다. 기존 알림 모듈이 있다면 provider와 export를 병합한다.

```typescript
import { Module } from '@fluojs/core';
import { PaidOutboxRelay } from './paid-outbox-relay.js';
import { PaidOutboxTask } from './paid-outbox-task.js';

@Module({
  providers: [PaidOutboxRelay, PaidOutboxTask],
  exports: [PaidOutboxRelay],
})
export class NotificationsModule {}
```

relay를 등록하는 것만으로 반복 실행되지는 않는다. 다음 **완전한 파일** `src/notifications/paid-outbox-task.ts`가 기존 Cron의 탐색 대상이다. 결제 대사와 별도 회차로 두어 결제사 조회 실패가 영수증 인계를 막지 않게 한다. 이 호출은 활성 트랜잭션 밖에서 시작한다. 회차 전체를 `@Transaction()`으로 감싸면 발행 시점이 최종 커밋보다 앞설 수 있다.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PaidOutboxRelay } from './paid-outbox-relay.js';

@Inject(PaidOutboxRelay)
export class PaidOutboxTask {
  constructor(private readonly relay: PaidOutboxRelay) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'notifications.paid-outbox',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    for (let processed = 0; processed < 100; processed += 1) {
      if (!(await this.relay.deliverNext())) break;
    }
  }
}
```

한 회차의 처리 건수를 제한해 무한 drain을 만들지 않는다. 이는 각 DB 호출 시간까지 보장하는 상한은 아니다. 주기 호출이 겹치더라도 행 잠금이 중복 처리를 막는다. 애플리케이션 종료 시에는 Cron이 새 회차 입장을 닫고 기존 종료 예산 안에서 진행 중인 호출을 기다린다. 재시작 뒤 첫 정기 회차도 테이블을 직접 검색하므로 메모리 이벤트가 없어도 남은 행을 발견한다.

## 간격을 고정해서 실패를 재현하기

이 장의 검증에는 별도의 테스트 PostgreSQL과 생성된 PrismaClient가 필요하다. 운영 데이터베이스에 마이그레이션하거나 프로세스를 강제 종료하는 실험을 하지 않는다. 스키마 적용과 seed는 독자의 격리 환경에서 수행하며, 원고 작성 중 실제 DB 연결 실험을 통과했다고 주장하지 않는다. 단위 테스트에서 `transaction(fn) { return fn(); }`처럼 대체하면 원자성을 전혀 검증하지 못한다.

첫 실험은 발행 전 종료를 운영 프로세스 종료 없이 재현한다. 7~10장의 생성 경로로 주문과 예약, 결제 시도를 준비하고 `PaymentLedger.record()`만 실행한 다음 relay를 호출하지 않는다. 첫 전이 전 버전이 0인 fixture라면 주문은 `paid`, 버전은 1이고 같은 버전의 `OrderTransition`과 Outbox가 각각 1건이어야 한다. 예약은 `consumed`이며 `Stock.available`은 결제 전과 같다. Outbox의 `deliveredAt`은 `null`, `ReceiptRequest`는 0건이다. 새 애플리케이션 인스턴스로 같은 DB에 연결해 `deliverNext()`를 실행하면 요청이 1건 생겨야 한다. `setTimeout`으로 운 좋게 종료 시점을 맞출 필요가 없다.

다음은 그 fixture를 사용하는 **통합 테스트 본문**이다. `ledger`와 `db`는 같은 테스트 앱에서 resolve한 실제 원장·PrismaService, `event`와 `digest`는 검증된 로컬 성공 관찰이며 `orderId`, `sku`는 fixture의 값이다. 예약 생성과 `prepare()` 뒤의 값을 기준으로 비교한다.

```typescript
const before = await db.current().order.findUniqueOrThrow({ where: { id: orderId } });
const stockBefore = await db.current().stock.findUniqueOrThrow({ where: { sku } });
expect(await ledger.record(event, digest)).toBe('applied');
const paid = await db.current().order.findUniqueOrThrow({ where: { id: orderId } });
expect(paid.status).toBe('paid');
expect(paid.version).toBe(before.version + 1);
const transition = await db.current().orderTransition.findUniqueOrThrow({
  where: { orderId_version: { orderId, version: paid.version } },
});
expect(transition.eventName).toBe('payment_confirmed');
const outbox = await db.current().paidOrderOutbox.findUniqueOrThrow({
  where: { orderId_orderVersion: { orderId, orderVersion: paid.version } },
});
expect(outbox.id).toBe(`order-paid:${orderId}:${paid.version}`);
expect(outbox.occurredAt).toEqual(transition.occurredAt);
expect(outbox.deliveredAt).toBeNull();
expect(await db.current().reservation.findUniqueOrThrow({
  where: { orderId_sku: { orderId, sku } },
})).toMatchObject({ state: 'consumed' });
expect((await db.current().stock.findUniqueOrThrow({ where: { sku } })).available)
  .toBe(stockBefore.available);

await ledger.record(event, digest);
expect(await db.current().paidOrderOutbox.count({ where: { orderId } })).toBe(1);
expect(await db.current().orderTransition.count({ where: { orderId } })).toBe(1);
```

Outbox 실패가 확정 전체를 되돌리는지도 시험한다. 격리 DB의 `PaidOrderOutbox`에 테스트 연결에서만 임시 `CHECK (false) NOT VALID` 제약을 추가하면 기존 행을 변경하지 않고 새 삽입을 거부할 수 있다. 새 fixture의 성공 관찰은 예외로 끝나고 주문의 상태·버전, `reserved` 예약, `Stock.available`, PaymentAttempt가 호출 전과 같아야 한다. 그 fixture의 PaymentInbox·OrderTransition·Outbox는 모두 없어야 한다. 테스트 `finally`에서 제약을 제거한 뒤 같은 관찰을 다시 넣으면 위 성공 조건을 만족해야 한다. 이 시험은 다른 DB 실험과 병렬 실행하지 않는다.

예약이 누락·해제·만료된 성공 관찰은 `review`만 남기며 결제 전이·Outbox가 생기지 않는지, 금액 불일치와 취소 경합에서도 같은 경계를 지키는지 각각 시험한다. 동일 사건뿐 아니라 다른 eventId로 같은 paymentId의 성공을 다시 관찰해도 Outbox는 늘지 않아야 한다. 순수 상태 머신 테스트만으로는 이 저장 불변식들을 증명할 수 없다.

relay 쪽에서는 Inbox 삽입 뒤 요청 저장 실패를 만든다. 별도 격리 DB의 `ReceiptRequest`에 같은 방식의 임시 삽입 거부 제약을 두고 `deliverNext()`를 호출한다. 호출은 실패하고 방금 삽입하려던 Inbox 행은 없어야 하며 Outbox의 `deliveredAt`은 여전히 `null`이어야 한다. `finally`에서 제약을 제거한 뒤 재호출하면 정상 처리되어야 한다. 외래키를 깨뜨린 가짜 요청을 seed하지 않고 실제 rollback을 확인하는 실험이다.

세 번째는 두 relay의 경합이다. 독립 연결을 사용한 두 테스트 애플리케이션에서 동시에 `deliverNext()`를 호출한다. 사건을 하나만 넣었다면 두 반환값 중 하나만 `true`이고 요청과 Inbox는 각각 1건이어야 한다. 검사에는 다음 읽기 전용 SQL을 쓸 수 있다. fixture가 사용하는 ID에 맞춰 값만 바꾼다.

```sql
SELECT "status", "version" FROM "Order" WHERE "id" = 'order-14';
SELECT "id", "deliveredAt" FROM "PaidOrderOutbox"
WHERE "orderId" = 'order-14';
SELECT "consumer", "eventId" FROM "EventInbox"
WHERE "consumer" = 'notifications.receipt.v1';
SELECT "id", "enqueuedAt", "completedAt" FROM "ReceiptRequest"
WHERE "orderId" = 'order-14';
```

중복 재생도 검증한다. 테스트 전용 데이터에서 이미 처리한 Outbox의 `deliveredAt`만 다시 `null`로 만들고 relay를 실행한다. 동일한 Inbox 키가 있어 요청은 늘지 않아야 한다. 이 조작은 ‘재전달’을 만드는 테스트 준비일 뿐 운영 복구 절차가 아니다. Inbox 삭제로 재시도를 흉내 내면 중복 방어를 우회하므로 잘못된 테스트가 된다.

## 남은 실패를 운영 가능한 책임으로 바꾸기

이 구현은 의도를 잃지 않지만 모든 오류를 자동 해결하지 않는다. 잘못된 통화나 손상된 스냅샷은 재시도해도 고쳐지지 않는다. 예제는 해당 행을 실패로 남기고 회차를 종료한다. 다음 회차에서도 같은 행이 막힐 수 있으므로 가장 오래된 미전달 시간과 실패 event ID를 운영 경보로 남겨야 한다. 자동 격리 상태를 추가할 때에는 격리가 삭제나 완료를 뜻하지 않게 하고, 원본·오류·담당자 조치를 함께 보존한다.

테이블 보존 정책도 기능이다. Inbox를 너무 빨리 지우면 늦은 재전달이 새 요청으로 해석된다. Outbox를 지우면 어떤 사실을 언제 전달했는지 조사하기 어렵다. 고객 개인정보 보존 정책과 재전달 가능 기간을 함께 정하고, 완료 행만 묶어서 정리한다. 아직 전달하지 않은 행을 날짜만 보고 지워서는 안 된다.

작은 서비스에서 모든 반응이 주문 저장과 같은 짧은 DB 갱신이라면 직접 같은 트랜잭션에 넣는 편이 더 간단할 수 있다. Outbox/Inbox는 느린 후속 처리와 재시작 복구를 분리하는 비용을 지불할 이유가 있을 때 도입한다. 우리는 이제 영수증 준비 의도가 영속적으로 쌓이는 지점에 도달했다. 다음 장에서는 그 의도를 Redis 작업으로 넘기되, ‘큐에 넣었다’와 ‘실행을 끝냈다’ 사이의 새 간격을 다룬다.

## 구현 근거

- [Prisma 등록·트랜잭션·수명주기 계약](../../packages/prisma/README.ko.md)
- [Prisma 공개 export](../../packages/prisma/src/index.ts), [트랜잭션 핸들 타입](../../packages/prisma/src/types.ts)
- [ALS 컨텍스트와 current 구현](../../packages/prisma/src/service.ts)
- [Prisma 모듈 및 트랜잭션 테스트](../../packages/prisma/src/module.test.ts)
- [event-bus의 성공 의미와 한계](../../packages/event-bus/README.ko.md)
- [리스너 실패 격리 구현](../../packages/event-bus/src/service.ts), [관련 테스트](../../packages/event-bus/src/module.test.ts)
- [결제 원장과 멱등한 수신](./ch10-payment-webhooks.ko.md), [재고 소비 경계](./ch07-inventory-concurrency.ko.md), [감사 전이 스키마](./ch06-order-state-machine.ko.md)

[이전: 주문 완료를 다른 기능에 알리기](./ch13-domain-events.ko.md) · [2권 목차](./toc.ko.md) · [다음: 실패한 작업을 다시 실행하기](./ch15-reliable-jobs.ko.md)
