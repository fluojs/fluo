# 마지막 티셔츠를 두 사람이 구매한다면

<!-- book:volume=02-fluoshop;chapter=07 -->

[이전: 주문을 상태 머신으로 설계하기](./ch06-order-state-machine.ko.md) · [2권 목차](./toc.ko.md) · [다음: 구매 버튼을 두 번 눌러도 주문은 한 번만](./ch08-idempotent-checkout.ko.md)

## 품절 표시는 늦을 수 있어도 판매 약속은 겹치면 안 된다

FluoBlog의 새 글이 공유되면서 로고 티셔츠 구매도 늘었다. 검은색 M 사이즈가 한 장 남았을 때 두 독자가 동시에 주문한다. 각 브라우저에는 “재고 있음”이 보이고, 각 요청은 서버에서도 재고 1을 읽는다. 서버가 `available > 0`을 확인한 뒤 각각 재고를 0으로 저장하면 주문은 두 건인데 남은 수량은 0이다. 음수가 아니니 안전해 보이지만 이미 두 사람에게 한 장을 약속했다.

Node.js가 한 스레드에서 JavaScript를 실행한다는 사실은 이 문제를 막지 않는다. 첫 요청이 DB 응답을 기다리는 동안 두 번째 요청이 실행될 수 있고, 배포 인스턴스가 둘이면 프로세스도 다르다. 코드의 줄 순서가 시스템 전체의 실행 순서가 되지는 않는다. 프로세스 안의 `Map`이나 mutex로 막더라도 다른 인스턴스와 운영자의 DB 쓰기는 그 잠금을 모른다.

이 장에서는 재고를 보고 판단한 뒤 저장하는 구조를 **조건을 만족할 때만 한 문장으로 차감하는 구조**로 바꾼다. 또 결제 대기 동안 확보한 수량을 예약 행으로 남긴다. 주문 상태와 예약 상태는 별개다. 주문이 `pending_payment`인 동안 예약은 `reserved`이고, 주문이 취소되면 예약은 `released`, 결제를 확정하면 `consumed`가 된다. 예약 시 차감한 판매 가능 수량은 소비 시 다시 차감하지 않는다.

여기까지도 하나의 PostgreSQL과 하나의 Fluo 애플리케이션이다. 재고 정합성을 얻기 위해 Redis 락이나 별도 재고 서버부터 도입하지 않는다. 먼저 데이터가 실제로 저장되는 곳의 원자적 갱신과 트랜잭션을 사용한다. 다음 구현은 개발자가 만드는 `fluo-blog`의 애플리케이션 코드이며, Fluo 패키지가 재고 모델을 생성해 주는 기능은 아니다.

## 재고 숫자의 이름부터 정확히 붙인다

`Stock.available`은 창고에 있는 실물 총량이 아니다. **새 주문에 약속할 수 있는 수량**이다. 티셔츠 10장이 입고되었고 3장을 예약했다면 판매 가능 수량은 7이다. 그 3장이 결제 완료로 바뀌어도 판매 가능 수량은 여전히 7이다. 예약이 취소되어야 다시 10으로 올라간다. 배송 후 반품 입고는 별도 입고 사건이지, 과거 예약을 `released`로 바꾸는 일이 아니다.

이 의미를 정하지 않고 `stock`, `count`, `quantity`를 섞어 쓰면 예약 시 한 번, 결제 시 한 번 차감하는 이중 차감이 생긴다. 물류가 복잡해지면 실물 수량, 파손 수량, 창고별 보유량을 분리하겠지만 이번 판매에서는 단일 창고의 판매 가능 수량과 주문별 예약만 다룬다. 숫자의 의미가 작고 명확해야 경합 시험도 명확해진다.

다음은 `prisma/schema.prisma`의 **추가 모델**이다. 앞 장의 `Order` 모델에는 역방향 필드 `reservations Reservation[]`를 추가한다. 그 외 주문 필드, 항목, 전이 기록은 유지한다. SKU는 앞 장에서 정규화한 ASCII 식별자를 사용한다. `Stock`은 기존 상품 모델의 가격 정보를 복제하지 않는다.

```prisma
enum ReservationState {
  reserved
  released
  consumed
}

model Stock {
  sku          String        @id
  available    Int           @default(0)
  reservations Reservation[]
}

model Reservation {
  orderId   String
  sku       String
  quantity  Int
  state     ReservationState @default(reserved)
  expiresAt DateTime
  order     Order @relation(fields: [orderId], references: [id], onDelete: Restrict)
  stock     Stock @relation(fields: [sku], references: [sku], onDelete: Restrict)

  @@id([orderId, sku])
  @@index([state, expiresAt])
}
```

복합 기본키는 같은 주문의 같은 SKU에 두 예약을 만드는 것을 거부한다. 이것만으로 재고 초과 판매를 막지는 못한다. 서로 다른 주문 ID는 서로 다른 기본키이기 때문이다. 반대로 조건부 재고 차감만 있고 예약 행이 없으면 프로세스가 재시작한 뒤 어떤 주문에 수량을 돌려줘야 하는지 알 수 없다. 두 장치가 각각 다른 실패를 막는다.

아래는 이 모델의 **마이그레이션 조각**이다. 예약 상태 ENUM이 철자를 제한하고, SQL 제약이 수량의 의미를 제한한다. PostgreSQL `integer`의 상한도 적용되므로 무제한 입고 수량을 저장할 수 있다고 가정하지 않는다.

```sql
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_available_check"
  CHECK ("available" >= 0);

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quantity_check"
  CHECK ("quantity" BETWEEN 1 AND 99);
```

## 잠금의 중심을 주문, 재고 순서로 정한다

재고 서비스는 예약을 만들 때 저장된 주문 항목을 읽는다. 호출자가 주문과 다른 SKU나 수량을 다시 전달하지 못하게 하기 위해서다. 가격 계산의 `quantity=2`를 주문에 저장해 놓고 예약 호출에는 `quantity=1`을 전달하는 실수를 구조적으로 줄인다. 주문 생성 유스케이스는 주문과 항목을 만든 직후, 같은 트랜잭션에서 `reserve(orderId)`를 호출한다.

다음은 `src/inventory/inventory.service.ts`의 **완전한 파일**이다. 루트의 공유 `BlogDatabaseModule`과 생성된 Prisma Client가 전제다. `$queryRaw`는 문자열을 이어 붙이지 않는 태그드 템플릿으로 사용한다. 주문 행을 잠그고 DB 시각을 함께 읽는 부분은 PostgreSQL 전용이며, 다른 ORM이나 DB에서도 그대로 동작한다고 주장하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export class OutOfStock extends Error {}
export class ReservationConflict extends Error {}

type LockedOrder = {
  status: string;
  now: Date;
};

@Inject(PrismaService)
export class InventoryService {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async reserve(orderId: string): Promise<void> {
    await this.prisma.transaction(async () => {
      const orders = await this.prisma.$queryRaw<LockedOrder[]>`
        SELECT "status", transaction_timestamp() AS "now"
        FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = orders[0];
      if (!order || order.status !== 'pending_payment') {
        throw new ReservationConflict('Order cannot acquire a reservation.');
      }
      const items = await this.prisma.orderItem.findMany({
        where: { orderId },
        orderBy: { sku: 'asc' },
      });
      if (items.length === 0) {
        throw new ReservationConflict('An order must contain items.');
      }
      const existing = await this.prisma.reservation.count({ where: { orderId } });
      if (existing !== 0) {
        throw new ReservationConflict('Order already has reservation history.');
      }
      const expiresAt = new Date(order.now.getTime() + 15 * 60 * 1000);
      for (const item of items) {
        const changed = await this.prisma.stock.updateMany({
          where: { sku: item.sku, available: { gte: item.quantity } },
          data: { available: { decrement: item.quantity } },
        });
        if (changed.count !== 1) throw new OutOfStock(item.sku);
        await this.prisma.reservation.create({
          data: {
            orderId,
            sku: item.sku,
            quantity: item.quantity,
            state: 'reserved',
            expiresAt,
          },
        });
      }
    });
  }

  async settle(
    orderId: string,
    outcome: 'released' | 'consumed',
  ): Promise<number> {
    return this.prisma.transaction(async () => {
      const orders = await this.prisma.$queryRaw<LockedOrder[]>`
        SELECT "status", transaction_timestamp() AS "now"
        FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = orders[0];
      const expected = outcome === 'released' ? 'cancelled' : 'paid';
      if (!order || order.status !== expected) {
        throw new ReservationConflict('Order and reservation outcome disagree.');
      }
      const rows = await this.prisma.reservation.findMany({
        where: { orderId },
        orderBy: { sku: 'asc' },
      });
      if (rows.length === 0) {
        throw new ReservationConflict('Reservation history is missing.');
      }
      let changedCount = 0;
      for (const row of rows) {
        if (row.state === outcome) continue;
        if (row.state !== 'reserved') {
          throw new ReservationConflict('Reservation has another final outcome.');
        }
        if (outcome === 'consumed' && row.expiresAt <= order.now) {
          throw new ReservationConflict('Reservation expired before confirmation.');
        }
        const changed = await this.prisma.reservation.updateMany({
          where: { orderId, sku: row.sku, state: 'reserved' },
          data: { state: outcome },
        });
        if (changed.count !== 1) {
          throw new ReservationConflict('Reservation changed concurrently.');
        }
        if (outcome === 'released') {
          await this.prisma.stock.update({
            where: { sku: row.sku },
            data: { available: { increment: row.quantity } },
          });
        }
        changedCount += 1;
      }
      return changedCount;
    });
  }
}
```

핵심은 `available: { gte: item.quantity }`와 `decrement`가 하나의 `UPDATE`에 들어간다는 것이다. 두 주문이 마지막 한 장을 동시에 차감하려 하면 PostgreSQL은 같은 재고 행의 쓰기를 직렬화한다. 먼저 커밋한 주문 뒤에 실행되는 갱신은 최신 행에서 수량 조건을 다시 판단하고, 수량이 부족하면 변경 건수 0이 된다. 애플리케이션은 그 숫자를 반드시 확인한다. 예외가 없었다는 이유로 예약 성공이라고 반환하면 조건부 갱신을 사용한 의미가 사라진다.

주문 행을 먼저 잠그는 이유는 같은 주문의 예약 생성, 취소, 결제 확정을 서로 엇갈리지 않게 하기 위해서다. 여러 SKU는 항상 같은 `sku` 정렬 순서로 처리한다. A 주문은 티셔츠부터, B 주문은 스티커부터 잠그면 서로 상대의 잠금을 기다리는 순환이 생길 수 있다. 순서를 통일하면 이 경로의 교착 가능성을 줄인다. 다른 관리 경로도 같은 순서를 지켜야 하며, 시스템 전체에 교착이 절대 없어진다는 보장은 아니다.

예약 행을 만든 뒤 두 번째 SKU가 부족하면 앞의 차감과 예약도 모두 롤백된다. 상품별 부분 성공을 반환하지 않는 것은 현재 제품 정책이다. 독자는 장바구니에 담은 묶음을 한 주문으로 확인했다. 일부만 주문하는 기능이 필요하면 화면에서 새 견적을 보여 주고 다시 동의받아야 한다. 트랜잭션 내부에서 `OutOfStock`을 잡고 다음 SKU로 넘어가는 방식으로 그 정책을 몰래 바꾸지 않는다.

`settle`은 재고 반환을 먼저 하지 않는다. 먼저 예약의 상태 전이가 가능한지 확인하고, `reserved`에서 `released`로 바뀐 행에 대해서만 수량을 더한다. 같은 작업이 반복되면 이미 `released`인 행을 건너뛰므로 재고가 두 번 늘어나지 않는다. `consumed` 예약을 `released`로 바꾸는 것은 거부한다. 결제 완료 상품의 환불과 재입고는 별도 정책이며 이 메서드의 재시도와 같지 않다.

## 예약 만료와 주문 취소를 하나의 업무 작업으로 묶는다

예약 시간이 지났다고 DB가 자동으로 수량을 돌려주지는 않는다. `expiresAt`은 판단에 사용할 데이터다. 예약 행을 TTL로 삭제하는 것만으로는 재고 수량이 복구되지 않고 왜 반환했는지도 사라진다. 이번 장에서는 주문 하나를 만료 처리하는 유스케이스까지 구현하고, 어떤 주문을 언제 찾아 실행할지는 후속 정기 작업 장의 책임으로 남긴다. 핵심 만료 처리를 작업 스케줄러의 이름으로 대신하지 않는다.

다음은 `src/orders/order-inventory.service.ts`의 **완전한 파일**이다. 일반 취소와 검증된 결제 확인 역시 같은 바깥 트랜잭션에서 상태와 예약을 함께 바꾼다. 아래 `confirmPayment`는 실제 결제 API를 호출하지 않는다. 앞 장에서 정의한 신뢰된 사건을 받는 내부 연결점이다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import type { OrderActor } from './order-state.js';

@Inject(PrismaService, OrderTransitionsService, InventoryService)
export class OrderInventoryService {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly transitions: OrderTransitionsService,
    private readonly inventory: InventoryService,
  ) {}

  async cancel(id: string, version: number, actor: OrderActor) {
    return this.prisma.transaction(async () => {
      const order = await this.transitions.apply(
        id, version, { type: 'cancel_requested' }, actor,
      );
      await this.inventory.settle(id, 'released');
      return order;
    });
  }

  async confirmPayment(
    id: string,
    version: number,
    currency: string,
    amountMinor: bigint,
    actor: OrderActor,
  ) {
    return this.prisma.transaction(async () => {
      const order = await this.transitions.apply(
        id, version, { type: 'payment_confirmed', currency, amountMinor }, actor,
      );
      await this.inventory.settle(id, 'consumed');
      return order;
    });
  }

  async expire(id: string): Promise<boolean> {
    return this.prisma.transaction(async () => {
      const rows = await this.prisma.$queryRaw<Array<{
        status: string;
        version: number;
        now: Date;
      }>>`
        SELECT "status", "version", transaction_timestamp() AS "now"
        FROM "Order" WHERE "id" = ${id} FOR UPDATE
      `;
      const order = rows[0];
      if (!order || order.status !== 'pending_payment') return false;
      const reservations = await this.prisma.reservation.findMany({
        where: { orderId: id },
      });
      if (
        reservations.length === 0 ||
        reservations.some(row =>
          row.state !== 'reserved' || row.expiresAt > order.now)
      ) return false;
      await this.transitions.apply(
        id,
        order.version,
        { type: 'cancel_requested' },
        { subject: 'system:reservation-expiry', scopes: ['orders:cancel'] },
      );
      await this.inventory.settle(id, 'released');
      return true;
    });
  }
}
```

만료 처리는 주문 잠금을 잡은 뒤 상태를 다시 읽는다. 스케줄러가 몇 초 전 찾은 목록만 믿지 않는다. 결제 확정이 먼저 커밋했다면 `paid`를 보고 종료하고, 만료가 먼저 커밋했다면 결제 확정은 상태 규칙이나 버전 조건에서 거부된다. 주문만 취소되고 재고는 묶인 채 남거나, 재고만 반환됐는데 주문은 여전히 결제 가능한 부분 상태를 만들지 않는다.

시간은 애플리케이션 인스턴스별 시계 대신 PostgreSQL의 `transaction_timestamp()`를 쓴다. 이 값은 현재 트랜잭션의 시작 시각이다. 긴 잠금 대기는 실제 사용 가능한 예약 시간을 줄일 수 있으므로 주문 트랜잭션은 짧아야 한다. 네트워크 결제 호출이나 사용자의 추가 입력을 이 경계 안에서 기다리지 않는다. 서버가 15분을 보장한다고 화면에 약속하려면 저장된 만료 시각을 응답으로 보내고 그 기준을 설명해야 한다.

늦은 결제 확인을 거부하는 것이 실제 결제를 취소하는 것은 아니다. 외부 결제사가 이미 돈을 받았는데 예약은 만료되었다면, 애플리케이션에는 대사와 환불 판단이 필요하다. 이번 장에서는 실제 결제를 하지 않으므로 이 경합을 내부 확인 사건으로 재현한다. 다음 결제 장들에서는 외부 증거를 잃지 않고 불일치를 보관하는 처리가 추가된다. DB 트랜잭션이 외부 결제까지 되돌린다는 설명은 하지 않는다.

다음 두 블록은 `src/inventory/inventory.module.ts`와 앞 장의 `src/orders/orders.module.ts`를 **갱신한 등록 파일**이다. 두 모듈은 `src/database/blog-database.module.ts`의 같은 `BlogDatabaseModule` 객체를 import한다. `InventoryService`를 `OrdersModule.providers`에 다시 넣어 별도 인스턴스를 만들지 않는다.

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
```

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrderInventoryService } from './order-inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';

@Module({
  imports: [BlogDatabaseModule, InventoryModule],
  providers: [OrderTransitionsService, OrderInventoryService],
  exports: [OrderInventoryService],
})
export class OrdersModule {}
```

이제 외부 기능에는 상태만 바꾸는 서비스 대신 `OrderInventoryService`를 공개한다. 그래야 취소 기능을 호출하면서 재고 반환을 빠뜨리기 어렵다. 내부에는 여전히 순수 상태 결정과 저장 서비스가 따로 있어 각각의 불변식을 시험할 수 있다. 모듈의 export 목록도 어떤 업무 작업을 다른 기능에 허용하는지 표현하는 계약이다.

## 두 연결로 마지막 한 장을 직접 경합시킨다

잠금 동작은 배열을 쓰는 가짜 저장소로 증명하지 않는다. 다음 실험에는 운영과 분리된 PostgreSQL, 위 마이그레이션, `available=1`인 `FLUO-TEE-BLK-M` 행이 필요하다. 실제 실행 전후의 데이터는 실습자가 관리한다. 이 원고에서는 DB를 생성하거나 수정하지 않았으며, 아래는 **수동 경합 실험용 SQL**과 관찰할 결과다.

첫 번째 연결 A에서 다음 문장을 실행하고 트랜잭션을 열린 채 둔다. 결과는 `available=0`인 한 행이어야 한다.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
UPDATE "Stock"
SET "available" = "available" - 1
WHERE "sku" = 'FLUO-TEE-BLK-M' AND "available" >= 1
RETURNING "available";
```

두 번째 연결 B에서 같은 문장을 실행한다. A가 잡은 행 잠금 때문에 아직 결과가 나오지 않아야 한다. 기다린 시간을 성공 조건으로 삼지 않는다. 세 번째 관찰 연결에서 `pg_stat_activity`의 해당 B 세션과 `pg_blocking_pids(B의_PID)`를 확인해 A가 차단자임을 확인할 수 있다. 관찰 권한은 개발 DB 안에서만 준비한다.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
UPDATE "Stock"
SET "available" = "available" - 1
WHERE "sku" = 'FLUO-TEE-BLK-M' AND "available" >= 1
RETURNING "available";
```

A에서 `COMMIT;`을 실행하면 B의 갱신은 반환 행 0개로 끝나야 한다. B는 `ROLLBACK;`으로 닫는다. 반대로 초기 수량 1로 실험을 다시 준비하고 A를 `ROLLBACK;`하면 B가 한 행을 차감할 수 있어야 한다. 이 차이가 커밋된 예약과 취소된 시도의 차이다. 재고를 먼저 조회한 TypeScript 조건문만으로는 이 실행 순서를 제어할 수 없다.

애플리케이션 통합 시험에서는 이 원리를 여러 불변식으로 확장한다.

| 상황 | 실행 순서 또는 실패 주입 | 관찰할 결과 |
| --- | --- | --- |
| 마지막 한 장 | 서로 다른 두 주문의 예약을 동시에 요청 | 예약 성공 한 건, 다른 요청은 `OutOfStock`, 수량 0 |
| 묶음 중 하나 품절 | 첫 SKU 차감 후 두 번째 SKU 조건 실패 | 두 SKU 모두 원래 수량, 해당 주문 예약 행 0개 |
| 중복 반환 | 취소된 주문의 `settle(id, 'released')`를 두 번 호출 | 첫 호출만 상태 변경 수가 양수, 두 번째는 0, 수량은 한 번만 증가 |
| 소비 후 반환 | 결제 확정된 예약을 반환하려고 시도 | `ReservationConflict`, 판매 가능 수량 변화 없음 |
| 만료 작업 재실행 | 과거 `expiresAt`를 저장한 뒤 `expire` 두 번 호출 | 첫 호출 `true`, 다음 호출 `false`, 취소 감사 행 한 건 |
| 반환 도중 DB 오류 | 예약 변경 뒤 재고 갱신을 실패시킴 | 예약도 여전히 `reserved`, 부분 반환 없음 |

만료 시험에 15분짜리 대기는 필요하지 않다. 테스트 데이터의 `expiresAt`를 DB 기준 과거로 저장하고 그 커밋을 기다린 뒤 `expire`를 호출한다. 미래 시각 행에는 `false`가 반환되어야 한다. 정해진 시간을 자고 결과를 추정하는 시험보다 빠르고 결정적이다. 동시성 시험은 연결 풀에 최소 두 작업 연결과 필요한 관찰 연결을 확보해야 한다. 풀 크기가 1인 시험은 모든 코드를 직렬화해 결함을 숨길 수 있다.

## 더 강한 잠금이 항상 더 좋은 것은 아니다

모든 주문을 `Serializable`로 실행하는 방법도 있다. 그러나 충돌이 사라지는 것이 아니라 일부 트랜잭션이 직렬화 실패로 종료되고 애플리케이션이 전체 작업을 다시 시도해야 할 수 있다. 지금의 재고 불변식은 특정 행의 조건부 갱신으로 표현할 수 있어 기본 `ReadCommitted`와 짧은 명시적 잠금으로 설명 가능하다. 여러 창고에 걸친 총량 제약처럼 읽기 집합 전체가 판단에 영향을 주면 선택을 다시 검토한다.

재시도는 재고 수량을 한 번 더 빼는 함수를 무조건 다시 호출하는 일이 아니다. 실패한 바깥 트랜잭션이 전부 롤백되었는지, 같은 주문 생성 의도인지 확인해야 한다. `@fluojs/prisma`의 `transaction`은 활성 문맥을 공유하지만 애플리케이션의 교착 재시도 정책이나 예약 멱등성을 자동으로 제공하지 않는다. 이 장의 `reserve`는 이미 예약 이력이 있는 주문을 거부한다. 성공 여부가 불명확한 구매 요청을 다루는 책임은 다음 장의 멱등성 기록에 둔다.

판매 가능 수량이 화면에서 잠시 틀리는 것은 허용할 수 있다. 주문을 생성할 때 재고가 부족하면 409로 알려 장바구니를 다시 확인하게 한다. 반면 주문이 성공했다고 답한 뒤 “사실 그 티셔츠는 없었습니다”라고 연락하는 것은 다른 수준의 실패다. 이번 장의 비용인 행 잠금, 예약 기록, 만료 처리는 그 판매 약속을 지키기 위해 지불한다.

이제 두 독자가 마지막 한 장을 동시에 사는 경우에는 한 명만 예약을 얻는다. 그런데 같은 독자가 두 번 클릭해 두 주문을 만드는 경우는 아직 남았다. 재고가 충분하면 두 요청 모두 정당하게 수량을 확보할 수 있다. 다음 장에서는 “동일한 구매 의도”를 식별하고, 응답이 유실되어도 이미 생성한 주문을 다시 돌려주는 흐름을 완성한다.

## 근거와 이어 읽기

- [Prisma 모듈 등록, facade, 수동 트랜잭션](../../packages/prisma/README.ko.md)
- [서비스 트랜잭션 실행과 종료 경계](../../packages/prisma/src/service.ts)
- [트랜잭션 옵션과 클라이언트 추론 타입](../../packages/prisma/src/types.ts)
- [모듈·중첩 트랜잭션·strict 모드 테스트](../../packages/prisma/src/module.test.ts)
- [활성 트랜잭션 재사용과 예외 기반 롤백 계약](../../docs/architecture/transactions.ko.md)
- [주문 상태와 버전 제어의 앞 장 구현](./ch06-order-state-machine.ko.md)

[이전: 주문을 상태 머신으로 설계하기](./ch06-order-state-machine.ko.md) · [2권 목차](./toc.ko.md) · [다음: 구매 버튼을 두 번 눌러도 주문은 한 번만](./ch08-idempotent-checkout.ko.md)
