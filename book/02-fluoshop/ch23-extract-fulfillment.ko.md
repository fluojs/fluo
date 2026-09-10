# 배송 처리를 별도 서비스로 꺼내기

<!-- book:volume=02-fluoshop;chapter=23 -->

[이전: 해외 독자에게도 판매하기](./ch22-international-commerce.ko.md) · [2권 목차](./toc.ko.md) · [다음: 메시지 전송 방식을 선택하는 실험실](./ch24-transport-lab.ko.md)

## 첫 서비스 분리는 운영 기록에서 시작한다

해외 독자에게도 안내할 수 있게 된 FluoShop에서 다른 문제가 드러났다. 창고용 라벨 파일을 만드는 배치가 메모리를 많이 사용하고, 배송 연동을 수정할 때마다 블로그 HTTP 프로세스까지 재배포해야 한다. 게시글과 주문 조회 자체는 안정적이다. 계정·상품·주문을 전부 서비스로 나누는 대신, 이미 모듈로 분리해 둔 `FulfillmentModule`의 배송 작업 수락과 실행만 별도 프로세스로 옮길 이유가 생겼다.

분리 전에도 결제 확정과 배송 시작은 다른 시점이었다. 17장의 Saga는 `paid`와 소비된 예약을 확인한 뒤 포장을 요청하고, 확정된 packing 승인을 받아야 `fulfillment.request`를 만든다. 그 로컬 수신자는 주문의 `paid → fulfilling` 전이와 배송 의뢰 접수를 한 DB 트랜잭션에 저장한다. 분리 후에는 주문 DB와 배송 DB를 한 번에 커밋할 수 없으므로 **로컬 배송 의뢰를 Outbox로 영속 접수하는 경계**를 남기고 그 뒤의 작업만 옮긴다. 함수 호출을 `send()`로 바꾸는 것만으로 이전 보장이 유지되지 않는다.

이 장의 완료 지점은 **배송 요청이 별도 서비스의 영속 작업으로 한 번 수락되는 것**이다. 실제 운송장 발급이나 외부 배송사 호출은 하지 않는다. 기존 배송 어댑터는 새 서비스의 작업 실행 단계에 남고, 그 어댑터가 요구하는 멱등성·대사 계약도 유지한다. API가 성공했다고 상자를 보냈다고 말하지 않고, `fulfilling`과 `shipped`를 구분하는 것이 분리의 출발점이다.

## 주문의 권위와 배송의 권위를 나눈다

`AccountsModule`, `PostsModule`, `CatalogModule`, `InventoryModule`, `OrdersModule`, `PaymentsModule`은 기존 `fluo-blog` 프로세스에 남는다. 사용자와 주문 테이블을 배송 DB로 복제해 권위를 둘로 만들지 않는다. 배송 서비스는 자신이 수락한 요청, 배송 작업, 실제 발송 결과를 소유한다. 주문 ID는 서비스 경계를 넘는 식별자이지 다른 DB를 직접 JOIN하라는 초대가 아니다.

주문 DB의 `fulfilling`은 **packing 승인을 검증한 로컬 durable intent 접수**다. 이 커밋은 `paid/version=1 → fulfilling/version=2`, v2 `OrderTransition`, 배송 `FulfillmentOutbox`, `fulfillment.accepted` 사실을 함께 남긴다. 17장의 Saga가 기다리는 acceptance는 이 로컬 사실이며 원격 consumer의 ACK가 아니다. 원격 consumer가 없어도 로컬 접수와 Saga 완료는 가능하고, 그동안 배송 DB에는 작업이 없을 수 있다. 배송 서비스의 `awaiting_dispatch`는 원격 Inbox와 작업이 커밋되었으나 외부 발송은 시작하지 않았다는 별도 상태다. 나중에 실제 발송 증거가 오면 주문 서비스가 `OrderTransitionsService.apply()`로 `shipment_recorded` 전이와 감사를 함께 기록하여 `shipped/version=3`으로 바꾼다. 배송 서비스가 주문 DB를 직접 UPDATE하지 않는다.

주소도 단순히 “고객의 현재 주소 ID”만 보내지 않는다. 고객이 주소록을 수정해도 결제된 주문의 배송지가 바뀌어서는 안 된다. 이번 요청에는 주문 시점에 검증하고 동결한 주소 스냅샷을 넣는다. 필요 이상으로 계정 정보·결제 토큰을 포함하지 않고, 로그에는 주소 원문 대신 `eventId`, `orderId`, 실패 코드만 남긴다. `locale`은 알림 언어이며 배송 국가나 주문 통화를 결정하지 않는다.

다음 `src/fulfillment/fulfillment-request.ts`는 두 프로세스가 같은 버전으로 사용하는 **완전한 계약 파일**이다. 단일 주문을 한 번 배송하는 현재 제품 범위만 다룬다. 분할 배송은 동일 주문에 여러 작업을 허용하는 새 계약이므로 유일 키부터 달라져야 한다.

```ts
export const FULFILLMENT_REQUESTED = 'fulfillment.requested.v1';

export interface FulfillmentRequest {
  eventId: string;
  orderId: string;
  orderVersion: number;
  packingApprovalId: string;
  locale: 'ko' | 'en';
  items: Array<{ sku: string; quantity: number }>;
  shipTo: {
    countryCode: 'KR' | 'US';
    city: string;
    line1: string;
    postalCode: string;
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid fulfillment object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new TypeError('Invalid fulfillment text');
  }
  return value;
}

export function parseFulfillmentRequest(value: unknown): FulfillmentRequest {
  const input = record(value);
  const address = record(input.shipTo);
  if (input.locale !== 'ko' && input.locale !== 'en') {
    throw new TypeError('Unsupported notification locale');
  }
  if (address.countryCode !== 'KR' && address.countryCode !== 'US') {
    throw new TypeError('Unsupported shipping country');
  }
  if (input.orderVersion !== 2) {
    throw new TypeError('Invalid order version');
  }
  const orderId = text(input.orderId, 160);
  const eventId = text(input.eventId, 240);
  const packingApprovalId = text(input.packingApprovalId, 240);
  if (eventId !== `${orderId}:fulfillment.request:v1` ||
      packingApprovalId !== `${orderId}:packing.confirmed:v1`) {
    throw new TypeError('Invalid fulfillment identity');
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) {
    throw new TypeError('Invalid shipment items');
  }
  const items = input.items.map((value: unknown) => {
    const item = record(value);
    if (typeof item.quantity !== 'number'
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new TypeError('Invalid shipment quantity');
    }
    return { sku: text(item.sku, 80), quantity: item.quantity };
  }).sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
  if (new Set(items.map((item) => item.sku)).size !== items.length) {
    throw new TypeError('Duplicate shipment SKU');
  }
  return {
    eventId,
    orderId,
    orderVersion: input.orderVersion,
    packingApprovalId,
    locale: input.locale,
    items,
    shipTo: {
      countryCode: address.countryCode,
      city: text(address.city, 100),
      line1: text(address.line1, 200),
      postalCode: text(address.postalCode, 20),
    },
  };
}
```

이 검사는 서비스 입력의 구조·범위 검사다. `orderVersion=2`는 이 단일 배송 흐름에서 이미 로컬 접수를 커밋한 버전이고, 패턴의 `v1`은 메시지 계약 버전이다. 승인 ID의 모양만으로 packing을 증명하지 않는다. 아래 생산자는 실제 승인 행을 확인하며, 원격 큐의 publish 권한은 그 생산자에게만 부여한다. 고객이나 창고의 임의 payload가 원격 큐에 직접 쓰일 수 있다면 이 계약은 성립하지 않는다. 실제 주소 유효성·판매 허가는 주문 생성 경계의 책임이고, SKU 순서 정규화는 같은 요청의 해시를 안정화한다.

## 호출자의 주소 대신 승인한 주문 스냅샷을 읽는다

6장의 `Order`에는 주소 필드가 없었다. 배송지 저장을 위한 다음 **모델 추가분**과 `Order.shippingSnapshot OrderShippingSnapshot?` 역관계를 주문 Prisma 스키마에 넣는다. 상품·계정의 현재 값을 조인하지 않는다. `OrderItem`은 앞 장에서 이미 동결한 SKU·수량을 그대로 사용한다.

```prisma
model OrderShippingSnapshot {
  orderId     String @id
  order       Order @relation(fields: [orderId], references: [id], onDelete: Restrict)
  locale      String
  countryCode String
  city        String
  line1       String
  postalCode  String
}
```

아래는 기존 주문 생성 트랜잭션 안에 추가하는 **저장 조각**이다. `tx`는 그 트랜잭션 client, `order`는 서버가 가격을 재계산해 만든 주문, `verifiedShipping`은 서버 주소 검증·판매 국가 검사와 알림 locale 정규화를 끝낸 값이다. 필드는 위 모델의 `locale`, `countryCode`, `city`, `line1`, `postalCode`이며 고객의 `orderId`나 항목을 포함하지 않는다. 주문·항목·예약과 함께 커밋하고 이 스냅샷을 수정하는 경로는 두지 않는다. 기존 주소 스냅샷 필드가 있다면 생성 시 그 값을 이 모델로 옮기는 명시적 매핑을 적용한다. 이미 결제된 주문에 현재 주소록으로 빈 값을 채워 넣지 않는다.

```ts
await tx.orderShippingSnapshot.create({
  data: {
    orderId: order.id,
    locale: verifiedShipping.locale,
    countryCode: verifiedShipping.countryCode,
    city: verifiedShipping.city,
    line1: verifiedShipping.line1,
    postalCode: verifiedShipping.postalCode,
  },
});
```

17장의 창고 화면도 이 스냅샷과 `OrderItem`을 조회한다. 승인 화면용 내부 조회의 실제 추가 메서드는 다음 **provider 메서드 조각**이다. `this.db`는 기존 공유 `PrismaService`이며 인증된 창고 전용 경계에서만 호출한다. 승인 명령에는 조회한 `orderId`와 결과만 싣고, 조회 데이터를 다시 입력으로 받아 덮어쓰지 않는다. packing 중에도 배송지·항목이 불변이므로 승인 결과의 `orderVersion=1`과 결제된 원본을 일치시킬 수 있다.

```ts
async packingView(orderId: string) {
  const order = await this.db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { orderBy: { sku: 'asc' } }, shippingSnapshot: true },
  });
  if (order.status !== 'paid' || order.version !== 1 || !order.shippingSnapshot) {
    throw new Error('PACKING_SNAPSHOT_UNAVAILABLE');
  }
  return { orderId: order.id, items: order.items, shipTo: order.shippingSnapshot };
}
```

## 주문 커밋과 발행 사이에는 Outbox를 남긴다

분리 전의 직접 호출 대신 주문 DB에 배송 요청 Outbox를 쓴다. 아래는 기존 Prisma 스키마에 추가하는 **모델 조각**이다. 기존 `Order`의 `id`, `customerId`, `status`, `currency`, `totalMinor`, `version`은 그대로다. 이 예제는 `order.id`를 문자열로 사용한다. Fluo 패키지가 이 테이블을 설치하지 않는다.

```prisma
model FulfillmentOutbox {
  id          String    @id
  orderId     String    @unique
  payloadJson String
  publishedAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([publishedAt, createdAt])
}
```

다음 `src/orders/request-fulfillment.ts`는 **완전한 로컬 명령·핸들러 파일**이다. 기존 root의 `BlogDatabaseModule`이 제공하는 `PrismaService`와 `OrderTransitionsService`를 그대로 주입한다. `AdmitFulfillment`에는 저장된 Saga 의도 ID만 있다. 호출자가 paid 주문 ID와 새 주소·항목·권한을 제출해서 배송을 시작하는 이전 입구는 제거한다. 조회한 의도와 packing 승인, 소비된 예약, 동결 스냅샷이 모두 맞아야 접수한다.

```ts
import { Inject } from '@fluojs/core';
import { CommandHandler, type ICommandHandler } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { parseFulfillmentRequest } from '../fulfillment/fulfillment-request.js';
import { OrderTransitionsService } from './order-transitions.service.js';

export class AdmitFulfillment {
  constructor(public readonly intentId: string) {}
}

@Inject(PrismaService, OrderTransitionsService)
@CommandHandler(AdmitFulfillment)
export class RequestFulfillment implements ICommandHandler<AdmitFulfillment> {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly transitions: OrderTransitionsService,
  ) {}

  async execute(command: AdmitFulfillment): Promise<void> {
    await this.prisma.transaction(async () => {
      const intent = await this.prisma.sagaIntent.findUniqueOrThrow({
        where: { id: command.intentId },
      });
      const { orderId } = intent;
      if (intent.kind !== 'fulfillment_request' ||
          intent.id !== `${orderId}:fulfillment.request:v1`) {
        throw new Error('INVALID_FULFILLMENT_INTENT');
      }
      await this.prisma.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const approval = await this.prisma.packingResult.findUnique({ where: { orderId } });
      const saga = await this.prisma.orderSaga.findUniqueOrThrow({ where: { orderId } });
      if (!approval || approval.outcome !== 'confirmed' ||
          approval.requestId !== `${orderId}:packing.request:v1` ||
          approval.orderVersion !== 1 ||
          !['awaiting_fulfillment', 'fulfilled', 'superseded'].includes(saga.phase)) {
        throw new Error('PACKING_APPROVAL_REQUIRED');
      }
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, reservations: true, shippingSnapshot: true },
      });
      const snapshot = order.shippingSnapshot;
      if (!snapshot || order.items.length === 0 ||
          order.items.length !== order.reservations.length ||
          order.items.some(item => !order.reservations.some(row =>
            row.sku === item.sku && row.quantity === item.quantity &&
            row.state === 'consumed'))) {
        throw new Error('FULFILLMENT_SNAPSHOT_CONFLICT');
      }
      const request = parseFulfillmentRequest({
        eventId: intent.id, orderId, orderVersion: 2,
        packingApprovalId: `${orderId}:packing.confirmed:v1`,
        locale: snapshot.locale,
        shipTo: {
          countryCode: snapshot.countryCode, city: snapshot.city,
          line1: snapshot.line1, postalCode: snapshot.postalCode,
        },
        items: order.items.map(({ sku, quantity }) => ({ sku, quantity })),
      });
      const payloadJson = JSON.stringify(request);
      const previous = await this.prisma.fulfillmentOutbox.findUnique({
        where: { id: request.eventId },
      });
      if (previous) {
        if (previous.payloadJson !== payloadJson) {
          throw new Error('FULFILLMENT_REQUEST_CONFLICT');
        }
        return;
      }
      if (order.status === 'refund_pending' || order.status === 'refunded') {
        const refund = await this.prisma.refundRequest.findUnique({ where: { orderId } });
        if (!refund) throw new Error('REFUND_INTENT_MISSING');
        await this.prisma.localOrderFact.upsert({
          where: { id: `${orderId}:fulfillment.superseded:v1` },
          create: {
            id: `${orderId}:fulfillment.superseded:v1`,
            orderId, fact: 'fulfillment.superseded',
          },
          update: {},
        });
        return;
      }
      if (order.status !== 'paid' || order.version !== 1) {
        throw new Error('ORDER_NOT_ADMISSIBLE');
      }
      await this.transitions.apply(
        orderId,
        1,
        { type: 'fulfillment_started' },
        { subject: 'system:packing-approved-admission', scopes: ['orders:fulfill'] },
      );
      await this.prisma.fulfillmentOutbox.create({
        data: { id: request.eventId, orderId: request.orderId, payloadJson },
      });
      await this.prisma.localOrderFact.create({
        data: {
          id: `${orderId}:fulfillment.accepted:v1`,
          orderId, fact: 'fulfillment.accepted',
        },
      });
    });
  }
}
```

기존 `OrdersModule.providers`에 `RequestFulfillment`를 추가한다. 같은 모듈에서 이미 제공하는 `OrderTransitionsService`를 복제하지 않는다. 바깥 `prisma.transaction()`과 `apply()`의 중첩 transaction은 **같은 PrismaService의 ALS 문맥**을 공유한다. 따라서 주문 상태·버전·감사·배송 Outbox·로컬 acceptance 사실 중 어느 쓰기라도 실패하면 모두 롤백된다. 핸들러 안에서 CQRS 사건이나 브로커 메시지를 발행하지 않는다.

중복 명령은 주문 잠금을 얻은 뒤 기존 Outbox를 원본 스냅샷과 비교한다. 이미 `fulfilling` 또는 `shipped`여도 같은 접수는 재사용하며 새 버전을 만들지 않는다. 주문당 unique 키도 두 번째 의뢰를 막는다. 예약은 확인만 하고 `settle('consumed')`나 추가 차감을 호출하지 않는다. 결제는 계속 `PaymentLedger.prepare/record`와 `OrderInventoryService.confirmPayment()`를 통한다.

11장의 `RefundService.request`도 같은 주문 행을 먼저 잠근다. 환불이 먼저 `refund_pending`과 `RefundRequest`를 커밋하면 배송 Outbox나 acceptance는 생기지 않고 `fulfillment.superseded`가 Saga를 종료시킨다. 기존 환불 실행기가 그 환불을 끝내며 새 환불 의도를 만들지 않는다. 접수가 먼저 커밋하면 환불 요청은 409이고 외부 환불 실행도 시작하지 않는다. consumer 부재·실패 큐·ACK 유실은 이 결정을 되돌릴 근거가 아니다. `fulfilling → paid/refund_pending`으로 되돌리거나 Outbox를 지워 자동 환불하는 경로는 없다.

## 저장한 명령과 acceptance를 누가 실행하는가

`src/orders/saga/fulfillment-intent-relay.ts`의 다음 **완전한 provider 파일**이 17장의 의도를 실제로 소비한다. 새 종류의 큐 payload를 임의로 만드는 대신 저장된 ID로 CQRS 명령을 복원한다.

```ts
import { Inject } from '@fluojs/core';
import { CommandBusLifecycleService } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { AdmitFulfillment } from '../request-fulfillment.js';

@Inject(PrismaService, CommandBusLifecycleService)
export class FulfillmentIntentRelay {
  constructor(
    private readonly db: PrismaServiceFacade<PrismaClient>,
    private readonly commands: CommandBusLifecycleService,
  ) {}

  async runBatch(): Promise<number> {
    const rows = await this.db.sagaIntent.findMany({
      where: { kind: 'fulfillment_request', dispatchedAt: null },
      orderBy: { id: 'asc' }, take: 20,
    });
    for (const row of rows) {
      await this.commands.execute(new AdmitFulfillment(row.id));
      await this.db.sagaIntent.updateMany({
        where: { id: row.id, dispatchedAt: null },
        data: { dispatchedAt: new Date() },
      });
    }
    return rows.length;
  }
}
```

기존 `OrdersModule`에 `FulfillmentIntentRelay`를 import해 provider와 export로 추가한다. 17장의 `PrismaSagaStore` 등록과 `LocalOrderFactRelay`도 같은 모듈에 남긴다. 실제 작업 실행기에서 호출할 순서는 다음 **배치 진입 파일** `src/orders/saga/run-fulfillment-handoff.ts`다. 두 인자는 각각 그 모듈에서 주입받은 relay다. 기존 작업 실행기는 bootstrap 후 기동 복구와 반복 배치에서 이 함수를 `await`하며 실패는 기존 재예약 경계까지 전파한다. 종료하면 새 배치를 시작하지 않고 진행 중 호출을 기다린다.

```ts
import type { LocalOrderFactRelay } from './local-order-fact-relay.js';
import type { FulfillmentIntentRelay } from './fulfillment-intent-relay.js';

export async function runFulfillmentHandoff(
  facts: LocalOrderFactRelay,
  intents: FulfillmentIntentRelay,
): Promise<void> {
  await facts.runBatch();
  await intents.runBatch();
  await facts.runBatch();
}
```

첫 호출은 packing 사실을 `OrderFact → OrderSaga → AdvanceOrderHandler → PrismaSagaStore`로 소비해 명령을 만들고, 두 번째는 로컬 접수를 커밋하고, 세 번째는 저장된 acceptance를 같은 Saga 경로로 돌려준다. 한 번에 배치 전체가 소진된다는 보장은 없으므로 다음 배치도 저장소를 읽는다. 프로세스 메모리에 보관한 “다음 단계”로 복구하지 않는다.

접수 커밋 직후 죽으면 `${orderId}:fulfillment.accepted:v1`은 `deliveredAt=null`로 남는다. 새 프로세스의 facts 배치는 그것을 소비하고, 미표시 명령 재실행은 원래 Outbox를 찾아 끝난다. Saga 소비 직후 죽으면 같은 acceptance 재전달은 `SagaInbox`에서 끝나며 `revision`과 의도가 늘지 않는다. Saga consumer를 등록하지 않았다면 17장의 relay가 `SAGA_NOT_CONSUMED`를 내고 행을 미전달로 유지한다. 이 복구에는 원격 RabbitMQ consumer가 필요하지 않다.

이 배치와 아래 브로커 relay는 **활성 트랜잭션 밖의 작업 진입점**이다. 같은 facade의 중첩 `transaction()` 반환을 최외곽 커밋으로 오해하지 않는다. request-wide transaction으로 배치를 감싸거나 Saga `handle`에서 다시 호출하면 미커밋 사실을 발행하거나 자기 잠금을 기다릴 수 있다.

별도의 배송 Outbox 전달자는 `MICROSERVICE` facade에 `emit()`하고 성공한 레코드에만 `publishedAt`을 적는다. `src/fulfillment/fulfillment-relay.ts`는 **완전한 provider 파일**이며 같은 global `PrismaService`를 사용한다. 이 relay의 완료는 로컬 `fulfillment.accepted`와도 다른 브로커 발행 확인이다.

```ts
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { FULFILLMENT_REQUESTED, parseFulfillmentRequest } from './fulfillment-request.js';

@Inject(PrismaService, MICROSERVICE)
export class FulfillmentRelay {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly microservice: Microservice,
  ) {}

  async runBatch(): Promise<number> {
    const rows = await this.prisma.fulfillmentOutbox.findMany({
      where: { publishedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    for (const row of rows) {
      const payload = parseFulfillmentRequest(JSON.parse(row.payloadJson));
      await this.microservice.emit(FULFILLMENT_REQUESTED, payload);
      await this.prisma.fulfillmentOutbox.updateMany({
        where: { id: row.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }
    return rows.length;
  }
}
```

기존 작업 실행기가 `runBatch()`를 호출하고 실패한 배치를 다시 예약한다. 이 함수 안에 무한 재시도나 sleep을 숨기지 않는다. 발행 성공 직후 프로세스가 죽으면 DB 표시는 남지 않아서 같은 이벤트가 다시 간다. 두 전달자가 같은 배치를 읽어도 중복 가능성은 있다. 처리량을 높이려면 claim·lease를 추가할 수 있지만, 중복 제거의 마지막 책임은 수신 Inbox에 남는다. `publishedAt`은 배송 완료 시각이 아니다.

## 배송 DB에서는 Inbox와 작업을 함께 저장한다

배송 프로세스의 Prisma 스키마에는 다음 **모델 조각**을 둔다. 앞의 Outbox와는 다른 DB다. 아래의 `FULFILLMENT_DB`는 이 별도 프로세스만 사용하는 raw client 토큰이며, 모놀리스의 `BlogDatabaseModule` 옆에 두 번째 wrapper를 만드는 것이 아니다. `ShipmentJob.orderId`의 기본 키가 현재의 “주문 하나, 배송 작업 하나” 정책을 표현한다. 외부 `Order`에 대한 DB 외래 키는 만들지 않는다.

```prisma
model FulfillmentInbox {
  eventId     String   @id
  payloadHash String
  receivedAt  DateTime @default(now())
}

model ShipmentJob {
  orderId      String   @id
  eventId      String   @unique
  orderVersion Int
  payloadJson  String
  status       String   @default("awaiting_dispatch")
  createdAt    DateTime @default(now())
}
```

`src/fulfillment/fulfillment-handler.ts`는 위 배송용 모델로 생성한 client를 사용하는 **완전한 파일**이다. 두 프로세스의 `@prisma/client`는 각각 자기 스키마로 생성한다. 하나의 모놀리스 client가 양쪽 DB에 자동으로 연결된다는 뜻이 아니다.

```ts
import { createHash } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { EventPattern } from '@fluojs/microservices';
import type { PrismaClient } from '@prisma/client';
import { FULFILLMENT_REQUESTED, parseFulfillmentRequest } from './fulfillment-request.js';

export const FULFILLMENT_DB = Symbol('shop.fulfillment-db');

@Inject(FULFILLMENT_DB)
export class FulfillmentHandler {
  constructor(private readonly db: PrismaClient) {}

  @EventPattern(FULFILLMENT_REQUESTED)
  async accept(value: unknown): Promise<void> {
    const request = parseFulfillmentRequest(value);
    const payloadJson = JSON.stringify(request);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');

    await this.db.$transaction(async (tx) => {
      await tx.fulfillmentInbox.createMany({
        data: [{ eventId: request.eventId, payloadHash }],
        skipDuplicates: true,
      });
      const inbox = await tx.fulfillmentInbox.findUniqueOrThrow({
        where: { eventId: request.eventId },
      });
      if (inbox.payloadHash !== payloadHash) {
        throw new Error('FULFILLMENT_EVENT_CONFLICT');
      }

      await tx.shipmentJob.createMany({
        data: [{
          orderId: request.orderId,
          eventId: request.eventId,
          orderVersion: request.orderVersion,
          payloadJson,
        }],
        skipDuplicates: true,
      });
      const job = await tx.shipmentJob.findUniqueOrThrow({
        where: { orderId: request.orderId },
      });
      if (job.eventId !== request.eventId || job.payloadJson !== payloadJson) {
        throw new Error('FULFILLMENT_ORDER_CONFLICT');
      }
    });
  }
}
```

PostgreSQL의 유일 제약과 트랜잭션이 병렬 중복을 조정한다. `createMany(..., skipDuplicates: true)` 뒤 기존 레코드를 반드시 비교하는 이유는 “이미 존재한다”가 “같은 의미다”와 같지 않기 때문이다. 같은 이벤트 ID로 주소가 바뀌거나, 같은 주문에 새 이벤트 ID가 붙어 들어오면 충돌로 드러낸다. Inbox만 적고 작업 생성을 실패했을 때는 둘 다 롤백된다. 정상 처리 후 재전달은 같은 저장 결과를 확인하고 끝난다.

이 handler는 원격 작업만 접수하며 `fulfillment.accepted`를 발행하지 않는다. 그 이름은 이미 생산자 DB의 로컬 접수 사실로 사용했다. 원격 저장의 증거는 이 DB의 Inbox·`ShipmentJob`이고, 최종 shipping 증거는 실제 배송 결과다. 서로의 이름을 바꿔 쓰지 않는다.

여기에는 프로세스 메모리의 `Set`이나 Redis TTL 키가 없다. 배송 작업보다 짧은 멱등성 보존 기간은 늦은 재전달을 새 작업으로 오해하게 만든다. Inbox 보존과 삭제는 주문·배송 기록의 보존 정책과 함께 정한다. 실제 배송사 API 호출은 이 DB 트랜잭션 안에서 하지 않는다. 오래 열린 트랜잭션이 외부 지연을 기다리지 않도록 작업 실행 단계와 분리하고, 운송장 생성의 중복은 그 단계의 안정적인 요청 키와 대사로 다룬다.

## RabbitMQ의 ACK 정책은 우리가 연결한다

`RabbitMqMicroserviceTransport`는 `amqplib` connection을 자동 생성하지 않는다. `publisher.publish(queue, message)`와 `consumer.consume(queue, handler)`·`cancel(queue)`를 애플리케이션이 전달한다. 큐 이름만 적었다고 durable queue, publisher confirm, 실패 재시도, DLX가 자동으로 생기지 않는다.

다음 `src/fulfillment/rabbit-events.ts`는 **이벤트 전용 조합 파일**이다. 준비된 `ConfirmChannel`과 소비 channel을 받으며 실제 연결 생성은 기존 설정·bootstrap 경계가 소유한다. 이 파일을 실행하면 선언된 실습 큐를 만들 수 있으므로, 본문 검토에서는 실행하지 않는다. 기존 운영 큐에 임의로 적용하지 않고 격리된 RabbitMQ 실습 환경에서만 연결한다.

```ts
import type { Channel, ConfirmChannel } from 'amqplib';
import type { RabbitMqMicroserviceTransportOptions } from '@fluojs/microservices';

const eventQueue = 'shop.fulfillment.requests.v1';
const failedQueue = 'shop.fulfillment.failed.v1';

export async function rabbitEventOptions(
  publisherChannel: ConfirmChannel,
  consumerChannel: Channel,
  role: 'producer' | 'worker',
  reportChannelError: (error: unknown) => void,
): Promise<RabbitMqMicroserviceTransportOptions> {
  await publisherChannel.assertQueue(failedQueue, { durable: true });
  await publisherChannel.assertQueue(eventQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': failedQueue,
    },
  });
  await consumerChannel.prefetch(8);
  const tags = new Map<string, string>();

  return {
    eventQueue,
    messageQueue: 'shop.fulfillment.unused-rpc.v1',
    publisher: {
      publish(queue, message) {
        return new Promise<void>((resolve, reject) => {
          publisherChannel.sendToQueue(queue, Buffer.from(message), {
            persistent: true,
            contentType: 'application/json',
          }, (error: unknown) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
    },
    consumer: {
      async consume(queue, handler) {
        if (role !== 'worker' || queue !== eventQueue) return;
        const reply = await consumerChannel.consume(queue, (message) => {
          if (message === null) return;
          void Promise.resolve()
            .then(() => handler(message.content.toString('utf8')))
            .then(
              () => consumerChannel.ack(message),
              () => consumerChannel.nack(message, false, false),
            )
            .catch(reportChannelError);
        }, { noAck: false });
        tags.set(queue, reply.consumerTag);
      },
      async cancel(queue) {
        const tag = tags.get(queue);
        if (tag === undefined) return;
        await consumerChannel.cancel(tag);
        tags.delete(queue);
      },
    },
  };
}
```

이 조합은 의도적으로 `send()`용 reply queue를 구독하지 않는다. producer가 자신의 outbound event queue까지 소비하면 배송 워커에게 가야 할 메시지를 가로챌 수 있기 때문이다. worker만 배송 큐를 구독하고, 생산자는 등록 과정에서 호출되는 consume을 무작업으로 끝낸다. RPC가 필요한 경우에는 역할별 request/reply topology를 별도로 구현해야 하며 이 파일을 범용 RabbitMQ adapter라고 부르면 안 된다.

publisher의 Promise는 confirm callback을 기다린다. 이것은 브로커 수락의 근거이지 원격 handler 완료의 근거가 아니다. 작은 배치를 순차 발행하므로 이 예제는 무제한 버퍼링을 하지 않는다. 처리량을 늘릴 때는 channel의 backpressure와 outstanding confirm 상한을 추가로 관리한다. 선언한 durable queue와 persistent 메시지도 실제 브로커의 복제·디스크·운영 설정을 대신하지 않는다.

소비 쪽은 handler Promise가 끝난 다음 ACK한다. 실패하면 즉시 무한 재큐잉하지 않고 선언한 실패 큐로 격리한다. `reportChannelError`는 예외를 던지지 않는 애플리케이션 계측 callback이어야 한다. DB 일시 장애와 스키마 오류 모두 이 첫 정책에서는 격리된다. 운영자는 원인을 고친 뒤 같은 이벤트 ID로 재전달한다. 자동 지연 재시도가 필요해지면 횟수와 격리 한도를 명시한 별도 재시도 경로를 만든다.

Fluo는 RabbitMQ의 이벤트 handler 완료까지 consumer callback을 pending 상태로 유지하고, 이벤트 handler 실패를 callback rejection으로 돌려준다. 그래서 이 ACK 정책이 가능하다. 반면 request handler 실패는 오류 응답 발행에 성공하면 callback이 정상 완료될 수 있다. “모든 handler 오류는 재전달된다”는 규칙으로 일반화하면 안 된다.

## 모듈 등록과 프로세스 경계를 완성한다

배송 프로세스의 `src/app.ts`는 다음 **완전한 모듈 조합 파일**이다. `PrismaClient` 생성·연결과 RabbitMQ channel 생성은 호출자가 끝낸 뒤 전달한다.

```ts
import { Module } from '@fluojs/core';
import {
  MicroservicesModule,
  RabbitMqMicroserviceTransport,
  type RabbitMqMicroserviceTransportOptions,
} from '@fluojs/microservices';
import type { PrismaClient } from '@prisma/client';
import { FULFILLMENT_DB, FulfillmentHandler } from './fulfillment/fulfillment-handler.js';

export function createFulfillmentModule(
  db: PrismaClient,
  options: RabbitMqMicroserviceTransportOptions,
) {
  @Module({
    imports: [
      MicroservicesModule.forRoot({
        transport: new RabbitMqMicroserviceTransport(options),
      }),
    ],
    providers: [
      { provide: FULFILLMENT_DB, useValue: db },
      FulfillmentHandler,
    ],
  })
  class FulfillmentModule {}

  return FulfillmentModule;
}
```

준비된 client를 `useValue`로 등록했다고 `$disconnect()` 소유권이 자동 이전되지는 않는다. 소비자는 명시적 토큰과 class-level `@Inject`로 연결하고, creator가 자원 정리를 책임진다. `@EventPattern`이 붙은 클래스도 `providers`에 없으면 탐색되지 않는다.

주문 프로세스에는 `src/fulfillment/fulfillment-publisher.module.ts`의 다음 **완전한 조합 파일**을 둔다. 기존 `OrdersModule`이 반환된 모듈을 import하고 작업 실행기가 `FulfillmentRelay`를 주입받는다. root `src/app.ts`가 이미 `BlogDatabaseModule`을 import하므로 여기서 DB를 재등록하지 않는다. `producerOptions`는 앞 함수의 `role: 'producer'` 결과다. 이미 microservice 등록이 있는 프로세스라면 독립 root 등록을 중복하는 대신 그 소유 모듈에서 발행 경로를 조합한다.

```ts
import { Module } from '@fluojs/core';
import {
  MicroservicesModule,
  RabbitMqMicroserviceTransport,
  type RabbitMqMicroserviceTransportOptions,
} from '@fluojs/microservices';
import { FulfillmentRelay } from './fulfillment-relay.js';

export function createFulfillmentPublisherModule(
  producerOptions: RabbitMqMicroserviceTransportOptions,
) {
  @Module({
    imports: [
      MicroservicesModule.forRoot({
        transport: new RabbitMqMicroserviceTransport(producerOptions),
      }),
    ],
    providers: [FulfillmentRelay],
    exports: [FulfillmentRelay],
  })
  class FulfillmentPublisherModule {}

  return FulfillmentPublisherModule;
}
```

배송 `src/main.ts`의 시작 부분은 다음 **애플리케이션 조각**이다. `db`는 배송용으로 연결 완료된 client, `workerOptions`는 연결 완료된 두 channel로 만든 `role: 'worker'` 옵션이다. 생략된 변수에 업무 처리를 숨기는 코드가 아니라 기존 bootstrap이 소유하는 자원 입력이다.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createFulfillmentModule } from './app.js';

const application = await FluoFactory.createMicroservice(
  createFulfillmentModule(db, workerOptions),
);
await application.listen();
```

종료에서는 새 작업을 받지 않게 한 뒤 `application.close()`를 기다리고, caller-owned consumer channel, publisher channel, connection, Prisma client를 닫는다. Fluo facade는 이미 수락한 inbound handler가 settle한 뒤 transport subscription을 정리하지만, 전달받은 RabbitMQ 자원을 대신 닫지 않는다. bootstrap 실패·close 실패 때도 각 자원 정리를 시도하고 원래 오류와 정리 오류를 함께 보고하는 기존 수명주기 경계를 유지한다. DB 호출이 영원히 멈추면 drain도 끝나지 않으므로 DB timeout과 호스트 종료 유예 시간도 운영 설정에 포함한다.

## 실패를 끼워 넣고 저장 결과를 확인한다

검증은 이벤트가 “도착했다”는 로그가 아니라 DB 행과 ACK 순서로 한다. 격리된 두 PostgreSQL DB와 RabbitMQ에서 앞 장의 구매·결제 경계로 `paid/version=1`, 소비된 예약, 배송지 스냅샷이 있는 주문을 준비한다. `payment.confirmed`를 Saga에 전달해도 packing 승인 전에는 배송 의도가 없어야 한다. 없는 의도 ID로 `AdmitFulfillment`를 보내거나 저장된 승인 없이 배송 의도를 주입한 부정 fixture를 실행하면 접수·v2 감사·acceptance가 모두 없어야 한다.

신뢰된 `RecordPackingResult`와 `runFulfillmentHandoff`를 통과하면 `fulfilling/version=2`, v2 감사, 배송 Outbox, 로컬 acceptance와 그 SagaInbox가 각각 하나다. 외부 consumer를 시작하지 않아도 Saga는 `fulfilled`가 되지만 배송 DB의 Inbox·작업은 0이다. 브로커 relay까지 실행해 confirm을 받아도 원격 저장은 여전히 0일 수 있다. Outbox 또는 acceptance 삽입 실패를 주입하면 v2 전이와 감사까지 함께 롤백되어 `paid/version=1`이고 재고도 그대로여야 한다.

접수 명령 완료 직후, 사실 relay를 호출하기 전에 주문 프로세스를 종료한다. 재기동 후 같은 DB에서 미표시 의도와 acceptance를 읽어 배치를 실행하면 원래 의도·acceptance ID로 Saga를 끝내야 한다. 별도 실험은 SagaInbox 커밋 뒤 `deliveredAt` 표시 전에 끊는다. 재발행 후 Saga revision, 접수 감사, 배송 의도가 늘지 않아야 한다. 로컬 Saga provider를 빼고 relay만 실행하면 `SAGA_NOT_CONSUMED`이며 전달 표시도 남지 않아야 한다.

환불 경쟁은 두 주문 fixture로 양쪽 순서를 각각 강제한다. 주문 잠금 획득 신호 뒤 다른 연결의 `RefundService.request` 또는 `AdmitFulfillment`를 시작하고 잠금 보유자를 커밋한다. 환불 선행은 `refund_pending`·환불 요청 하나·`superseded` 사실만 남고 배송 Outbox·acceptance는 0이다. 배송 선행은 `fulfilling/version=2`이며 환불은 409, 환불 요청·외부 환불 호출은 0이다. Queue에 들어간 배송 명령 자체를 환불 차단 기준으로 삼지 않는다.

같은 이벤트를 두 번, 그리고 별도 소비 연결에서 동시에 전달한다. 최종 Inbox와 `ShipmentJob`은 각각 하나여야 한다. 같은 `eventId`에 수량만 바꾼 요청은 충돌로 격리되어 원본 작업이 바뀌지 않아야 한다. 같은 주문에 새로운 `eventId`를 부여한 요청도 두 번째 배송을 만들지 않아야 한다. 이러한 검증은 두 개의 DB 연결을 사용해야 하며 in-memory `Set` 대역 통과로 대체하지 않는다.

DB 트랜잭션을 커밋한 직후 ACK 전에 소비 연결을 끊으면 브로커는 미확인 delivery를 재전달할 수 있다. 새 프로세스가 같은 요청을 수락해도 작업은 늘지 않아야 한다. 반대로 작업 생성 단계에 실패를 주입하면 Inbox도 남지 않아야 한다. ACK 전에 실패한 delivery는 실패 큐에 나타나고, 원인을 제거해 같은 payload를 다시 넣으면 정상 수락되어야 한다. 장애 주입 지점은 handler 완료 신호·transaction commit 신호·consumer ACK callback으로 잡는다. 몇 초 sleep 후 프로세스를 죽이는 테스트는 경계가 불명확하다.

중단 후 배포를 되돌릴 때도 구형 모놀리스와 새 워커가 동시에 배송 작업을 실행하지 않게 한다. 먼저 새 소비자를 배포하되 발행 전환은 닫아 두고, 계약·권한·DB 준비를 확인한 뒤 주문 쪽의 대상 경로를 전환한다. 기존 미완료 배송 작업의 소유자를 기록해 어느 실행기가 끝낼지 정한다. 역전환 역시 그 기록을 따라야 한다. 같은 주문을 두 시스템에 보내 보고 결과를 비교하는 식의 이중 실배송은 비교 실험이 아니다.

## 필요한 만큼만 분리한 상태

배송 분리로 얻은 것은 독립 배포와 자원 격리다. 지불한 비용은 계약 버전, Outbox 지연, Inbox 보존, 브로커 운영, 장애 시 대사다. 배송량이 작고 모놀리스 작업 실행기로 충분하면 이 비용을 내지 않는 편이 낫다. 이 장 이전의 모듈형 설계는 미완성 단계가 아니라 유효한 운영 선택이다.

이제 주문 서비스는 배송 의뢰를 영속적으로 만들고, 배송 서비스는 중복 요청을 같은 작업으로 수렴시킨다. `emit()`의 완료를 `shipped`로 오해하지 않는 경계도 세웠다. 다음 장에서는 이 계약을 유지한 채 전송 방식을 비교한다. 모든 브로커를 도입하는 것이 아니라, 어떤 완료·복구·소유권이 필요한지 작은 실험으로 판단한다.

## 근거와 검증 범위

이 장은 애플리케이션 소유 Outbox·Inbox·Prisma 모델과 연결 조합을 정의한다. 저장소에 완성된 두 서비스 배포가 존재한다고 주장하지 않는다. 실제 브로커 큐 생성, DB migration, 배송사 요청은 실행하지 않았으며, 위 장애 주입의 예상 결과는 독립된 통합 환경에서 확인해야 한다.

- [microservices README: 완료 경계와 caller-owned 자원](../../packages/microservices/README.ko.md)
- [공개 transport·facade 계약](../../packages/microservices/src/types.ts)
- [RabbitMQ transport: consumer 완료·응답·종료](../../packages/microservices/src/transports/rabbitmq-transport.ts)
- [RabbitMQ adapter 테스트](../../packages/microservices/src/transports/rabbitmq-transport.test.ts)
- [MICROSERVICE 등록과 alias 구성](../../packages/microservices/src/module.ts)
- [handler 탐색·clone·inbound drain](../../packages/microservices/src/service.ts)
- [provider 토큰별 handler 탐색 회귀 테스트](../../packages/microservices/src/handler-discovery-provider-token.test.ts)
- [Prisma README: 같은 facade의 중첩 트랜잭션 문맥](../../packages/prisma/README.ko.md)

[이전 장](./ch22-international-commerce.ko.md) · [2권 목차](./toc.ko.md) · [다음 장](./ch24-transport-lab.ko.md)
