# 장애 훈련으로 FluoShop 완성하기

<!-- book:volume=02-fluoshop;chapter=28 -->

[이전: 판매 이벤트를 관측하고 병목 찾기](./ch27-sale-observability.ko.md) · [목차](./toc.ko.md) · [다음 권: 주문 요청 하나를 소스 끝까지 따라가기](../03-internals/ch01-trace-an-order.ko.md)

## 마지막 기능은 실패한 주문을 설명하는 능력이다

두 번째 판매를 앞두고 운영자가 묻는다. “배송 워커를 배포하다가 멈추면 이미 결제한 주문은 어떻게 되나요?” 준비한 답이 “큐가 알아서 재시도합니다”뿐이라면 아직 상점이 완성되지 않았다. 큐는 데이터베이스의 커밋을 모르고, 데이터베이스는 브로커의 ACK를 모른다. 웹훅 응답을 잃은 결제사와 프로세스가 죽은 배송 작업은 서로 다른 실패이며 복구 근거도 다르다.

이 장은 FluoBlog에서 출발한 같은 애플리케이션을 마무리한다. 계정과 게시글은 그대로 있고, 모듈형 상점에서 배송만 별도 프로세스로 분리했다. 새로운 마이크로서비스들을 더 만드는 대신 지금의 경계를 시험한다. 테스트 더블로 실패 순서를 제어하고, 별도의 실제 DB·Redis·RabbitMQ 실험에서 영속성과 수명주기를 확인하는 두 층을 구분한다.

기준 원장은 이미 정해져 있다. `BlogDatabaseModule`이 단일 async global Prisma 등록을 소유한다. SKU 가격은 `ProductVariant`, 판매 가능 재고는 `Stock.available`, 예약은 `(orderId, sku)` 복합 키의 `Reservation`이다. 결제 확정 때 예약을 `consumed`로 바꾸지만 재고를 또 차감하지 않는다. 주문은 버전 0에서 시작하고 `OrderTransitionsService.apply`가 상태·버전·`OrderTransition` 감사를 함께 저장한다. `OrderInventoryService.confirmPayment`와 `PaymentLedger.prepare/record`를 우회하는 훈련용 결제 경로를 만들지 않는다.

실행 기준은 Node24와 pnpm10이다. 아래 파일은 독자가 만든 `fluo-blog`의 실험 코드이며, 전체 장의 완성 앱이 이 저장소에 이미 있다는 의미가 아니다. 실제 청구, 배송 발주, 이메일 발송은 하지 않는다. 외부 효과는 기록형 어댑터로 교체하고 실습 저장소의 최종 상태와 관측 신호를 확인한다.

## 장애를 무작위로 넣기 전에 불변식을 적는다

장애를 발생시키는 도구보다 먼저 성공 조건을 정한다. 같은 구매 요청의 재시도는 기존 주문을 가리켜야 한다. 마지막 상품을 놓고 경합한 두 주문은 판매 가능 수량을 음수로 만들면 안 된다. 결제 확정 뒤 같은 메시지를 다시 받아도 예약을 두 번 소비하면 안 된다. 상태가 바뀌었는데 감사 기록이 없는 주문도 없어야 한다.

각 실험의 실패 위치는 하나만 고른다. DB 커밋 전 실패와 커밋 후 응답 유실을 같은 “결제 실패”로 합치면 안 된다. 커밋 전 실패는 상태를 남기지 않아야 하지만, 커밋 후 응답 유실은 이미 남은 상태를 다시 찾아야 한다. 이 구분을 해야 재시도라는 같은 동작이 어떤 경우에는 안전하고 어떤 경우에는 중복 청구를 만들 수 있는지 설명할 수 있다.

훈련 기록에는 초기 상태, 입력의 멱등성 키, 실패를 발생시킨 정확한 경계, 관측한 완료 신호, 최종 원장 상태를 남긴다. 로그 한 줄이 아니라 DB와 전달 경계 양쪽의 증거가 필요하다. “500이 났다”만으로 롤백을 증명할 수 없고 “메시지 전송 성공”만으로 배송 수신자의 커밋을 증명할 수 없다.

이번 실험은 17→23장의 로컬 접수부터 원격 전달까지 경계를 차례로 시험한다. `fulfilling/version=2`와 Saga의 `fulfilled`는 packing 승인을 검증한 **로컬 durable intent 접수**이며 원격 consumer 수락이나 발송 완료가 아니다. 먼저 승인 부재와 접수 후 통지 유실을 실제 주문 DB에서 시험한다. 그 뒤 Queue worker 실패와 RabbitMQ의 publish·consumer 완료를 분리해 시험한다.

## 로컬 접수 직후 멈추고 같은 DB로 재시작한다

먼저 격리된 주문 DB에 17·23장의 모델을 적용하고 실제 `PrismaSagaStore`, 명령 핸들러, 두 로컬 relay를 등록한다. 구매·결제 fixture는 기존 checkout과 `PaymentLedger.prepare/record`를 통과하여 `paid/version=1`, `consumed` 예약, 동결 배송지를 만들고, 결제 사실까지 Saga가 소비해 `awaiting_packing`에 있어야 한다. 이 시험 중에는 자동 배치와 원격 배송 consumer를 시작하지 않는다. 다른 주문과 SKU를 공유하지 않아야 재고 비교에 외부 판매가 섞이지 않는다.

다음 `src/fulfillment/drills/local-admission.drill.ts`는 **DB 통합 시험용 두 단계 실행 파일**이다. `LiveAdmission`의 값은 부트스트랩한 실제 앱에서 해석한 provider이며 mock 저장소가 아니다. 첫 단계의 반환값은 시험 관찰값일 뿐 복구 엔진의 입력이 아니다. 앱을 종료하고 같은 DB로 새 컨테이너를 만든 뒤 두 번째 단계를 호출한다. `notifyBeforeStop=false`는 접수 커밋 후 Saga 통지 전, `true`는 Saga 커밋 후 전달 표시 전의 중단 상태를 만든다. 각각 새로운 주문 fixture로 실행한다.

```ts
import assert from 'node:assert/strict';
import type { CommandBusLifecycleService, CqrsEventBusService } from '@fluojs/cqrs';
import type { PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { AdmitFulfillment } from '../../orders/request-fulfillment.js';
import { OrderFact } from '../../orders/saga/order-saga.js';
import { RecordPackingResult } from '../../orders/saga/record-packing-result.js';
import { runFulfillmentHandoff } from '../../orders/saga/run-fulfillment-handoff.js';
import type { LocalOrderFactRelay } from '../../orders/saga/local-order-fact-relay.js';
import type { FulfillmentIntentRelay } from '../../orders/saga/fulfillment-intent-relay.js';
import type { OrderActor } from '../../orders/order-state.js';
import { parseFulfillmentRequest } from '../fulfillment-request.js';

export interface LiveAdmission {
  db: PrismaServiceFacade<PrismaClient>;
  commands: CommandBusLifecycleService;
  events: CqrsEventBusService;
  facts: LocalOrderFactRelay;
  intents: FulfillmentIntentRelay;
}

export async function beforeAdmissionStop(
  live: LiveAdmission,
  orderId: string,
  actor: OrderActor,
  notifyBeforeStop: boolean,
) {
  const { db, commands, events, facts } = live;
  const original = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { orderBy: { sku: 'asc' } },
      reservations: { orderBy: { sku: 'asc' } }, shippingSnapshot: true,
    },
  });
  assert.equal(original.status, 'paid');
  assert.equal(original.version, 1);
  assert.ok(original.shippingSnapshot);
  assert.equal((await db.orderSaga.findUniqueOrThrow({ where: { orderId } })).phase,
    'awaiting_packing');
  const stock = await db.stock.findMany({
    where: { sku: { in: original.items.map(item => item.sku) } },
    orderBy: { sku: 'asc' },
  });
  const intentId = `${orderId}:fulfillment.request:v1`;
  const acceptanceId = `${orderId}:fulfillment.accepted:v1`;
  await assert.rejects(commands.execute(new AdmitFulfillment(intentId)));
  const rollbackProbe = new Error('ROLLBACK_INVALID_FIXTURE');
  try {
    await db.transaction(async () => {
      await db.sagaIntent.create({
        data: { id: intentId, orderId, kind: 'fulfillment_request' },
      });
      await db.orderSaga.update({
        where: { orderId }, data: { phase: 'awaiting_fulfillment' },
      });
      await assert.rejects(commands.execute(new AdmitFulfillment(intentId)),
        /PACKING_APPROVAL_REQUIRED/);
      throw rollbackProbe;
    });
  } catch (error) {
    if (error !== rollbackProbe) throw error;
  }
  await assert.rejects(events.publish(new OrderFact(
    `${orderId}:packing.confirmed:v1`, orderId, 'packing.confirmed',
  )), /UNTRUSTED_LOCAL_FACT/);
  await assert.rejects(commands.execute(new RecordPackingResult(
    orderId, 'confirmed', { subject: original.customerId, scopes: [] },
  )), /PACKING_ACCESS_DENIED/);
  assert.equal(await db.packingResult.count({ where: { orderId } }), 0);
  assert.equal(await db.fulfillmentOutbox.count({ where: { orderId } }), 0);
  assert.equal(await db.localOrderFact.count({ where: { id: acceptanceId } }), 0);
  assert.equal(await db.orderTransition.count({ where: { orderId, version: 2 } }), 0);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'paid');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).version, 1);

  await commands.execute(new RecordPackingResult(orderId, 'confirmed', actor));
  await commands.execute(new RecordPackingResult(orderId, 'confirmed', actor));
  await facts.runBatch();
  await commands.execute(new AdmitFulfillment(intentId));
  const admitted = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(admitted.status, 'fulfilling');
  assert.equal(admitted.version, 2);
  assert.equal((await db.sagaIntent.findUniqueOrThrow({
    where: { id: intentId },
  })).dispatchedAt, null);
  assert.equal((await db.localOrderFact.findUniqueOrThrow({
    where: { id: acceptanceId },
  })).deliveredAt, null);
  if (notifyBeforeStop) {
    await events.publish(new OrderFact(acceptanceId, orderId, 'fulfillment.accepted'));
  }
  assert.equal((await db.orderSaga.findUniqueOrThrow({ where: { orderId } })).phase,
    notifyBeforeStop ? 'fulfilled' : 'awaiting_fulfillment');
  return { original, stock, intentId, acceptanceId };
}

export async function afterAdmissionRestart(
  live: LiveAdmission,
  before: Awaited<ReturnType<typeof beforeAdmissionStop>>,
): Promise<void> {
  const { db, commands, events, facts, intents } = live;
  const { original, stock, intentId, acceptanceId } = before;
  const orderId = original.id;
  await runFulfillmentHandoff(facts, intents);
  const saga = await db.orderSaga.findUniqueOrThrow({ where: { orderId } });
  assert.equal(saga.phase, 'fulfilled');
  await Promise.all([
    commands.execute(new AdmitFulfillment(intentId)),
    commands.execute(new AdmitFulfillment(intentId)),
  ]);
  const accepted = new OrderFact(acceptanceId, orderId, 'fulfillment.accepted');
  await events.publish(accepted);
  await events.publish(accepted);
  assert.equal((await db.orderSaga.findUniqueOrThrow({ where: { orderId } })).revision,
    saga.revision);
  assert.equal(await db.sagaIntent.count({
    where: { orderId, kind: 'fulfillment_request' },
  }), 1);
  assert.equal(await db.sagaInbox.count({ where: { orderId, eventId: acceptanceId } }), 1);
  assert.equal(await db.localOrderFact.count({ where: { id: acceptanceId } }), 1);
  assert.notEqual((await db.localOrderFact.findUniqueOrThrow({
    where: { id: acceptanceId },
  })).deliveredAt, null);
  const transition = await db.orderTransition.findUniqueOrThrow({
    where: { orderId_version: { orderId, version: 2 } },
  });
  assert.equal(transition.from, 'paid');
  assert.equal(transition.to, 'fulfilling');
  assert.equal(transition.eventName, 'fulfillment_started');
  const outbox = await db.fulfillmentOutbox.findUniqueOrThrow({ where: { id: intentId } });
  assert.equal(await db.fulfillmentOutbox.count({ where: { orderId } }), 1);
  assert.equal(outbox.publishedAt, null);
  const request = parseFulfillmentRequest(JSON.parse(outbox.payloadJson));
  assert.equal(request.orderVersion, 2);
  assert.equal(request.packingApprovalId, `${orderId}:packing.confirmed:v1`);
  assert.deepEqual(request.items, original.items.map(({ sku, quantity }) => ({ sku, quantity })));
  const snapshot = original.shippingSnapshot;
  assert.ok(snapshot);
  assert.equal(request.locale, snapshot.locale);
  assert.deepEqual(request.shipTo, {
    countryCode: snapshot.countryCode, city: snapshot.city,
    line1: snapshot.line1, postalCode: snapshot.postalCode,
  });
  const current = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(current.status, 'fulfilling');
  assert.equal(current.version, 2);
  assert.deepEqual(await db.reservation.findMany({
    where: { orderId }, orderBy: { sku: 'asc' },
  }), original.reservations);
  assert.deepEqual(await db.stock.findMany({
    where: { sku: { in: original.items.map(item => item.sku) } },
    orderBy: { sku: 'asc' },
  }), stock);
}
```

시험 caller는 첫 앱에서 `await beforeAdmissionStop(live, orderId, warehouseActor, false)`의 반환을 받은 뒤 앱을 닫고, 새 앱에서 해석한 `live`로 `await afterAdmissionRestart(live, before)`를 호출한다. 다음 fixture에서는 마지막 인자를 `true`로 바꾼다. 앱 사이에서 DB를 초기화하거나 이전 `MemorySagaStore` 객체를 재사용하지 않는다. 강제 종료 자체를 시험하려면 첫 단계가 완료했다는 IPC 신호를 부모 시험기가 **시작 전에 구독**하고, 신호 직후 자식 프로세스를 종료한다. 몇 초 잔 뒤 커밋했을 것이라고 추정하지 않는다.

이 시험은 원격 consumer뿐 아니라 브로커 relay도 시작하지 않으므로 `publishedAt=null`인데도 로컬 Saga가 끝나야 한다. 실제 RabbitMQ 실험에서는 이어서 `FulfillmentRelay.runBatch()`만 실행해 confirm을 받고, 여전히 consumer가 없는 배송 DB에서 `FulfillmentInbox`·`ShipmentJob`이 0임을 확인한다. 이후 worker를 시작하고 두 행이 함께 커밋된 뒤 ACK되는지를 아래 전달 실험과 같은 경계에서 관찰한다.

## 하나의 배송 요청을 두 전달 경로에서 공유하기

다음 완전한 파일 `src/fulfillment/drills/shipment-contract.ts`는 **23장의 실제 wire DTO와 parser를 재사용**한다. 훈련이라고 주소·항목·packing 승인 ID를 뺀 별도 계약을 만들지 않는다. `ShipmentJob`은 이 요청을 Queue로 나르는 실험용 클래스이며 배송 DB의 같은 이름의 Prisma 모델과는 다르다.

```ts
import type { FulfillmentRequest } from '../fulfillment-request.js';
export {
  FULFILLMENT_REQUESTED as SHIPMENT_PATTERN,
  parseFulfillmentRequest as parseShipmentRequest,
} from '../fulfillment-request.js';

export const SHIPMENT_INBOX = Symbol('shop.drill.shipment-inbox');
export type ShipmentRequest = FulfillmentRequest;
export interface ShipmentInbox {
  accept(request: ShipmentRequest): Promise<'applied' | 'duplicate'>;
}

export class ShipmentJob {
  constructor(public readonly request: ShipmentRequest) {}
}
```

패턴의 `v1`은 전송 스키마 버전이고 `orderVersion=2`는 `paid/version=1`에서 로컬 접수 전이를 마친 버전이다. 승인 ID의 철자만 맞는다고 실제 승인이 생기지는 않는다. 생산자의 저장소 검증과 큐의 publish 권한은 23장의 계약 그대로다. 수신자의 DTO 검사는 그 검증을 대체하지 않는다.

완전한 파일 `src/fulfillment/drills/shipment-handlers.ts`는 같은 수신 작업을 Queue와 RabbitMQ에서 호출한다. Queue class에는 정확한 `ShipmentJob` constructor를 등록한다. 예외는 성공으로 바꾸지 않고 호출자에게 전파한다. 두 전달 경로를 동시에 운영하라는 권장이 아니라 같은 실패 계약을 각각 시험할 수 있게 한 구성이다.

```ts
import { Inject } from '@fluojs/core';
import { EventPattern, MICROSERVICE, type Microservice } from '@fluojs/microservices';
import { QueueLifecycleService, QueueWorker } from '@fluojs/queue';
import {
  parseShipmentRequest,
  SHIPMENT_INBOX,
  SHIPMENT_PATTERN,
  ShipmentJob,
  type ShipmentInbox,
  type ShipmentRequest,
} from './shipment-contract.js';

@Inject(SHIPMENT_INBOX)
@QueueWorker(ShipmentJob, {
  jobName: 'shop-drill-shipments-v1',
  attempts: 3,
  backoff: { type: 'exponential', delayMs: 100 },
  concurrency: 1,
})
export class ShipmentWorker {
  constructor(private readonly inbox: ShipmentInbox) {}

  async handle(job: ShipmentJob) {
    return this.inbox.accept(parseShipmentRequest(job.request));
  }
}

@Inject(SHIPMENT_INBOX)
export class ShipmentEventHandler {
  constructor(private readonly inbox: ShipmentInbox) {}

  @EventPattern(SHIPMENT_PATTERN)
  async handle(payload: unknown) {
    return this.inbox.accept(parseShipmentRequest(payload));
  }
}

@Inject(QueueLifecycleService)
export class ShipmentQueuePublisher {
  constructor(private readonly queue: QueueLifecycleService) {}

  async publish(request: ShipmentRequest) {
    const value = parseShipmentRequest(request);
    return this.queue.enqueue(
      new ShipmentJob(value),
      { deduplicationKey: value.eventId },
    );
  }
}

@Inject(MICROSERVICE)
export class ShipmentEventPublisher {
  constructor(private readonly microservice: Microservice) {}

  async publish(request: ShipmentRequest) {
    await this.microservice.emit(SHIPMENT_PATTERN, parseShipmentRequest(request));
  }
}
```

Queue는 `enqueue(name, payload)`가 아니라 `enqueue(jobInstance, options?)`를 사용한다. 같은 필드의 객체 리터럴이나 다른 파일에서 다시 선언한 클래스는 등록된 constructor와 다르므로 거절된다. 직렬화는 JSON object를 요구하고 worker에서는 등록된 prototype을 다시 입힌다. 생성자에서 네트워크 연결을 열거나 비밀 필드를 계산하는 방식은 메시지 복원 계약으로 적합하지 않다.

`deduplicationKey`는 반복 enqueue의 backing job ID를 안정적으로 만드는 기능이다. 작업 보관 정책과 데이터 수명에 걸친 영구적인 비즈니스 멱등성을 대신하지 않는다. RabbitMQ 재전달, 운영자의 재실행, 다른 생산자의 중복 입력까지 막으려면 수신자 원장에 사건 ID와 효과를 함께 저장해야 한다. Queue deduplication과 Inbox를 각각 다른 위치의 중복 방지로 이해한다.

## 실패 위치를 제어하는 수신자와 브로커

다음 완전한 파일 `src/fulfillment/drills/doubles.ts`는 **테스트 전용 구현**이다. `DrillInbox`는 커밋 직전 신호를 제공하고, 실패하면 staged 값을 공개 상태에 반영하지 않는다. `ControlledBroker`는 publish와 실제 delivery를 분리한다. publish가 즉시 handler를 호출하는 fake를 쓰면 `emit()`이 원격 완료를 기다린다는 잘못된 가정을 테스트가 오히려 강화할 수 있다.

```ts
import type { RabbitMqMicroserviceTransportOptions } from '@fluojs/microservices';
import type { ShipmentInbox, ShipmentRequest } from './shipment-contract.js';

export class DrillInbox implements ShipmentInbox {
  readonly events = new Map<string, ShipmentRequest>();
  readonly effects = new Map<string, ShipmentRequest>();
  beforeCommit: () => Promise<void> = async () => {};

  async accept(request: ShipmentRequest): Promise<'applied' | 'duplicate'> {
    const existing = this.events.get(request.eventId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new Error('Event identity was reused with a different payload.');
      }
      return 'duplicate';
    }
    const previous = this.effects.get(request.orderId);
    if (previous && previous.eventId !== request.eventId) {
      throw new Error('A different shipment request already exists for this order.');
    }
    const staged = structuredClone(request);
    await this.beforeCommit();
    this.effects.set(staged.orderId, staged);
    this.events.set(staged.eventId, staged);
    return 'applied';
  }
}

type DeliveryHandler = (message: string) => Promise<void> | void;

export class ControlledBroker {
  readonly published: Array<{ queue: string; message: string }> = [];
  readonly accepted: number[] = [];
  readonly rejected: number[] = [];
  readonly cancelled: string[] = [];
  private readonly handlers = new Map<string, DeliveryHandler>();

  readonly publisher: RabbitMqMicroserviceTransportOptions['publisher'] = {
    publish: async (queue, message) => {
      this.published.push({ queue, message });
    },
  };

  readonly consumer: RabbitMqMicroserviceTransportOptions['consumer'] = {
    consume: async (queue, handler) => {
      this.handlers.set(queue, handler);
    },
    cancel: async (queue) => {
      this.handlers.delete(queue);
      this.cancelled.push(queue);
    },
  };

  async deliver(index: number): Promise<void> {
    const record = this.published[index];
    if (!record) throw new Error('No published delivery at this index.');
    const handler = this.handlers.get(record.queue);
    if (!handler) throw new Error('No consumer for this queue.');
    try {
      await handler(record.message);
      this.accepted.push(index);
    } catch (error) {
      this.rejected.push(index);
      throw error;
    }
  }
}
```

이 fake의 두 Map은 PostgreSQL을 대신하는 영속 구현이 아니다. 이번 순차 실패·재전달 실험에서 효과와 Inbox가 동시에 보이는 경계만 표현한다. 여러 프로세스의 동시 소비, DB 격리 수준, 재시작 복구를 증명하지 않는다. 실제 수신자에서는 같은 원자적 DB 트랜잭션 안에 고유 사건 키와 배송 요청을 기록해야 한다. 메모리 Map을 운영 provider로 바꾸어 등록하는 일은 하지 않는다.

`accepted`와 `rejected`도 실제 AMQP ACK/NACK 명령이 아니라 collaborator가 본 완료 결과다. Fluo의 RabbitMQ adapter는 consumer callback의 완료 경계를 제공하지만, durable queue, publisher confirm, ACK 정책, 재시도 큐와 DLX는 애플리케이션이 공급한 broker collaborator의 책임이다. 이 실험이 그 경계를 정확하게 시험하는지와 실제 RabbitMQ 설정이 그 결과를 어떻게 처리하는지는 구분해서 검증한다.

## 모듈 그래프를 통과하는 전달 실험

다음 완전한 파일 `src/fulfillment/drills/delivery.slice.test.ts`는 `@fluojs/testing`으로 실제 모듈 그래프를 컴파일한다. transport 클래스만 직접 호출하는 테스트와 달리 `@EventPattern` 탐색, class-level DI, `MICROSERVICE` facade, consumer 완료가 함께 연결된다. `overrideProvider`는 compile 전에 적용하므로 handler는 교체된 동일 inbox를 받는다.

```ts
import { Module } from '@fluojs/core';
import {
  MICROSERVICE,
  MicroservicesModule,
  RabbitMqMicroserviceTransport,
  type Microservice,
} from '@fluojs/microservices';
import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { ControlledBroker, DrillInbox } from './doubles.js';
import { SHIPMENT_INBOX, SHIPMENT_PATTERN } from './shipment-contract.js';
import { ShipmentEventHandler } from './shipment-handlers.js';

it('separates publish, failed delivery, and duplicate-safe application', async () => {
  const broker = new ControlledBroker();
  const inbox = new DrillInbox();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  inbox.beforeCommit = async () => {
    entered.resolve();
    await release.promise;
    throw new Error('Injected write failure.');
  };

  @Module({
    imports: [MicroservicesModule.forRoot({
      transport: new RabbitMqMicroserviceTransport({
        publisher: broker.publisher,
        consumer: broker.consumer,
        eventQueue: 'shop.drill.events',
        messageQueue: 'shop.drill.requests',
        responseQueue: 'shop.drill.responses',
      }),
    })],
    providers: [
      { provide: SHIPMENT_INBOX, useValue: new DrillInbox() },
      ShipmentEventHandler,
    ],
  })
  class DeliveryDrillModule {}

  const module = await Test.createTestingModule({ rootModule: DeliveryDrillModule })
    .overrideProvider(SHIPMENT_INBOX, inbox)
    .compile();
  let delivery: Promise<void> | undefined;
  try {
    const microservice = await module.resolve<Microservice>(MICROSERVICE);
    await microservice.listen();
    const request = {
      eventId: 'order-1:fulfillment.request:v1',
      orderId: 'order-1',
      orderVersion: 2,
      packingApprovalId: 'order-1:packing.confirmed:v1',
      locale: 'ko',
      items: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1 }],
      shipTo: {
        countryCode: 'KR', city: 'Seoul', line1: '1 Example Road', postalCode: '04524',
      },
    };
    await microservice.emit(SHIPMENT_PATTERN, request);
    expect(broker.published).toHaveLength(1);
    expect(inbox.effects.size).toBe(0);

    delivery = broker.deliver(0);
    const rejected = expect(delivery).rejects.toThrow('Injected write failure.');
    await entered.promise;
    expect(broker.accepted).toHaveLength(0);
    expect(inbox.effects.size).toBe(0);
    release.resolve();
    await rejected;
    expect(broker.rejected).toEqual([0]);
    expect(inbox.events.size).toBe(0);

    inbox.beforeCommit = async () => {};
    await broker.deliver(0);
    await broker.deliver(0);
    expect(broker.accepted).toEqual([0, 0]);
    expect(inbox.effects.size).toBe(1);
    expect(inbox.events.size).toBe(1);
    await microservice.emit(SHIPMENT_PATTERN, {
      ...request, items: [{ sku: 'FLUO-TEE-BLK-M', quantity: 2 }],
    });
    await expect(broker.deliver(1)).rejects.toThrow(
      'Event identity was reused with a different payload.',
    );
    expect(inbox.effects.get('order-1')?.items[0]?.quantity).toBe(1);
    await microservice.close();
    await expect(microservice.emit(SHIPMENT_PATTERN, {})).rejects.toThrow();
    expect(broker.published).toHaveLength(2);
    expect(broker.cancelled).toHaveLength(3);
  } finally {
    release.resolve();
    await delivery?.catch(() => {});
    await module.container.dispose();
  }
}, 2_000);
```

신호 객체는 delivery를 시작하기 전에 만든다. 콜백 진입을 확인한 뒤에만 중간 상태를 검사하고 명시적으로 해제하므로 컴퓨터가 빠르거나 느린 것에 의존하지 않는다. 마지막 2초는 성공을 기다리는 고정 지연이 아니라 테스트 전체가 멈췄을 때 실패시키는 상한이다. 실제 큐 백오프 시간을 검증하지 않는 이 실험에 `sleep(100)`을 끼워 넣을 이유가 없다.

첫 `emit()`이 끝났을 때 효과는 0이다. 이것이 producer 완료의 경계다. 첫 delivery가 실패하면 callback은 reject하고 Inbox도 효과도 없다. 두 번째 delivery는 적용되고 세 번째는 같은 사건의 중복으로 완료된다. 실제 collaborator라면 여기서 성공한 중복도 ACK 가능한 결과로 취급할 수 있다. “중복은 오류”라고 무조건 재시도하면 이미 처리된 사건이 영원히 순환할 수 있다.

마지막으로 facade를 닫은 뒤 새 emit이 publisher까지 도달하지 않는지 확인한다. cancel 횟수는 이 실험에서 구성한 event·request·response 세 큐에 대한 구독 정리다. Caller-owned connection이나 channel을 Fluo가 닫았다는 증거는 아니다. 실제 종료에서는 먼저 facade가 수락한 handler를 정리하고 구독을 분리한 뒤, 애플리케이션이 자신이 만든 broker 자원을 닫아야 한다.

이 테스트가 실패했을 때 원인을 좁히기도 쉽다. emit 직후 효과가 생기면 broker double이 publish와 delivery를 합쳤는지 먼저 본다. 첫 실패가 accepted에 남으면 consumer 완료를 기다리지 않은 것이다. 세 번째 전달 뒤 효과가 늘면 수신자 멱등성이 깨졌다. 종료 뒤 published가 늘면 terminal ingress gate가 새 작업을 막지 못한 것이다.

## Queue 재시도는 별도 Redis 실험으로 확인한다

앞의 테스트는 Queue를 시작하지 않았다. `ShipmentWorker`의 데코레이터를 읽거나 `handle()`을 직접 세 번 호출해 놓고 BullMQ 재시도가 검증되었다고 말할 수는 없다. 실제 재시도, 직렬화, 부트스트랩 이후 processor 시작과 dead-letter 기록은 Redis 기반 Queue를 구성한 별도 실험에서 확인한다.

다음 완전한 파일 `src/fulfillment/drills/queue-drill.module.ts`는 그 실험의 독립 루트다. 기존 상점 앱에 기본 Redis나 Queue 등록을 중복 추가하지 않는다. `redisPort`는 미리 준비한 격리된 로컬 Redis의 포트이며, 훈련용 inbox는 앞의 `DrillInbox`를 전달할 수 있다. 이 모듈로 운영 배송을 처리하지 않는다.

```ts
import { Module } from '@fluojs/core';
import { QueueModule } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';
import { SHIPMENT_INBOX, type ShipmentInbox } from './shipment-contract.js';
import { ShipmentQueuePublisher, ShipmentWorker } from './shipment-handlers.js';

export function createQueueDrillModule(redisPort: number, inbox: ShipmentInbox) {
  @Module({
    imports: [
      RedisModule.forRoot({ host: '127.0.0.1', port: redisPort }),
      QueueModule.forRoot({
        ownershipNamespace: 'shop-drill-local-redis-db0',
        ownershipEnforcement: 'reject',
        workerShutdownTimeoutMs: 2_000,
        defaultDeadLetterMaxEntries: 100,
      }),
    ],
    providers: [
      { provide: SHIPMENT_INBOX, useValue: inbox },
      ShipmentWorker,
      ShipmentQueuePublisher,
    ],
    exports: [ShipmentQueuePublisher],
  })
  class QueueDrillModule {}
  return QueueDrillModule;
}
```

`ownershipNamespace`는 Redis 키의 접두사를 바꾸지 않는다. 같은 backend와 BullMQ prefix를 쓰는 등록의 소유권 충돌을 검사하는 식별자다. 실제 격리는 별도 Redis 환경과 고유 `jobName`으로 보장한다. 같은 namespace를 쓰면서 이름만 바꾸면 자동으로 데이터를 분리해 준다고 오해하지 않는다. 한 job class와 실제 jobName은 worker 하나만 소유해야 하며, worker는 모듈의 singleton provider로 명시적으로 등록한다.

첫 Queue 실험은 `beforeCommit`이 앞의 두 시도에서만 예외를 던지고 세 번째에는 완료되게 만든다. 시도 진입을 기록하는 배열과 세 번째 완료를 알리는 promise를 **enqueue 전에** 준비한다. bootstrap이 끝난 앱에서 `ShipmentQueuePublisher.publish()`를 호출하고 그 신호를 기다린다. 기대 결과는 시도 세 번, 효과 한 번, Inbox 한 건이다. producer가 반환한 job ID는 저장된 작업의 ID이며 배송 완료 응답이 아니다.

두 번째 실험은 세 시도 모두 실패시킨다. 패키지에서 public으로 제공하는 읽기 경로는 다음과 같다. `queue`는 초기화된 앱에서 주입한 `QueueLifecycleService` 또는 `Queue` facade다. 이 코드는 **운영 조사 부분 구현**이며 worker를 새로 시작하거나 재실행하지 않는다.

```ts
import type { Queue } from '@fluojs/queue';

export async function inspectShipmentFailures(queue: Queue) {
  const result = await queue.inspectDeadLetters('shop-drill-shipments-v1', { limit: 25 });
  return {
    malformedRecordCount: result.malformedRecordCount,
    failures: result.records.map((record) => ({
      jobId: record.jobId,
      attemptsMade: record.attemptsMade,
      failedAt: record.failedAt,
      errorMessage: record.errorMessage,
    })),
  };
}
```

worker 실패와 dead-letter 저장은 같은 순간이 아닐 수 있다. 실제 저장 완료의 신호를 관찰할 수 있는 패키지 회귀 테스트에서는 그 완료 뒤 inspection을 수행한다. 운영 실험에서는 broker 이벤트나 별도 관찰기의 기록 완료 신호를 사용하고, 임의로 잠깐 잔 뒤 목록이 있다고 단언하지 않는다. public inspection은 조회 API이지 “이 작업의 dead-letter 저장이 끝날 때까지 기다리는” API가 아니다.

dead-letter는 BullMQ job을 다른 큐로 옮기는 기능이 아니다. 재시도를 소진한 작업에 대한 별도 Redis 레코드를 append한다. 기본 보관은 job별 최근 1,000개이며 이 실험에서는 100개로 줄였다. inspection은 유효 레코드를 최신순으로 반환하고 손상된 항목 수를 별도로 보고한다. 보관 한도 밖 기록이나 종료 중 완료되지 못한 기록까지 영원히 남는 감사 원장으로 취급하지 않는다.

복구는 목록 전체를 그대로 다시 enqueue하는 버튼으로 만들지 않는다. 먼저 현재 주문·배송 원장을 확인하고, 사건 ID와 메시지 스키마를 검증한다. 이미 성공한 효과면 중복으로 닫고, 재처리할 수 있는 일시적 실패만 같은 비즈니스 identity로 다시 제출한다. Queue의 deduplication 때문에 기존 실패 job ID가 남아 있는 상황도 고려하여 job 보관·재실행 정책과 비즈니스 Inbox를 함께 설계한다. raw dead-letter payload는 `unknown`이며 신뢰된 생성자 인스턴스가 아니다.

## 구매 흐름 전체를 잇는 훈련표

전달 경계를 통과했다면 기존 제품 구현에서 다음 사례를 연결한다. 이 표는 다른 저장소 모델을 만들라는 요구가 아니라 앞선 장의 원장에 대해 관찰할 최종 조건이다. 각 실험은 새 fixture에서 시작하여 다른 실험의 미처리 작업이나 멱등성 키를 재사용하지 않는다.

| 실패 위치 | 주입할 사건 | 반드시 관찰할 최종 결과 |
| --- | --- | --- |
| 가격 재확인 | 장바구니 담기 뒤 `ProductVariant` 가격 또는 판매 상태 변경 | 서버 원본으로 재검증하고 과거 주문 스냅샷은 불변 |
| 재고 예약 | 마지막 한 개에 두 주문 동시 요청 | `Stock.available`은 음수가 아니며 성공 예약은 하나 |
| 결제 확정 | 같은 성공 결과 두 번 기록 | 예약은 한 번만 `consumed`, 추가 재고 차감 없음 |
| 상태 전이 | `OrderTransition` 삽입에서 실패 | 주문 상태·버전도 롤백되고 감사만 또는 상태만 남지 않음 |
| 청구 응답 유실 | 저장된 시도 ID로 청구 뒤 응답 경계 실패 | 새 무관한 시도를 만들지 않고 같은 시도 증거로 조회·대사 |
| packing 승인 부재 | paid 주문에 없는 의도 ID 또는 승인 없는 `fulfillment_request` 행으로 `AdmitFulfillment` 실행 | `paid/version=1`, v2 감사·배송 Outbox·acceptance 0; 후자는 `PACKING_APPROVAL_REQUIRED` |
| packing 결과 충돌 | 같은 요청의 confirmed 뒤 rejected 기록 | `PACKING_RESULT_CONFLICT`, 원래 승인·로컬 사실 유지 |
| 로컬 접수 롤백 | `FulfillmentOutbox` 또는 acceptance 삽입에서 DB 실패 주입 | `paid/version=1`, v2 감사·Outbox·acceptance 모두 0, 재고 불변 |
| 로컬 접수 중복 | 같은 저장 의도 ID를 두 연결에서 실행 | `fulfilling/version=2`, 접수 감사·Outbox·acceptance 각각 1 |
| 로컬 커밋 뒤 중단 | `beforeAdmissionStop(..., false)` 뒤 새 앱으로 복구 | 원래 acceptance ID 소비, Saga `fulfilled`, 배송 의도는 1 |
| Saga 통지 뒤 중단 | `beforeAdmissionStop(..., true)` 뒤 새 앱으로 복구 | acceptance Inbox 1, Saga revision 추가 증가 없음 |
| 로컬 consumer 부재 | `OrderSaga` provider 없이 `LocalOrderFactRelay.runBatch()` 실행 | `SAGA_NOT_CONSUMED`, `deliveredAt=null`; 등록 복구 후 같은 사실 소비 |
| 원격 consumer 부재 | packing 승인·로컬 배치·브로커 confirm까지만 실행 | 주문 `fulfilling/version=2`, Saga `fulfilled`, 원격 Inbox·작업 0, `shipped` 아님 |
| 환불이 먼저 접수 | 주문 잠금 아래 `RefundService.request`를 먼저 커밋한 뒤 배송 명령 실행 | `refund_pending`, 환불 요청 1, 배송 Outbox·acceptance 0, Saga `superseded` |
| 배송이 먼저 접수 | 로컬 접수 커밋 뒤 `RefundService.request` 실행 | `fulfilling/version=2`, 환불 409, 환불 요청·외부 환불 호출 0 |
| 이벤트 발행 | 주문 커밋 뒤 publish 실패 | Outbox가 미처리로 남고 재발행 후 수신 효과는 한 번 |
| 배송 적용 | 수신 DB 커밋 뒤 ACK 전 연결 유실 | 재전달은 가능하지만 Inbox와 배송 효과는 중복되지 않음 |
| 종료 | handler 실행 중 종료 후 새 요청 | 새 작업은 거절되고 수락된 작업은 계약에 따라 정리 또는 재전달 |

재고 실험에서 확인할 수량은 `Stock.available`이다. 예약 시 이미 줄었으므로 결제 확정에서 다시 줄이면 같은 티셔츠를 두 번 소비한다. 취소는 결제 전 `released`로 전이한 예약만 한 번 반환하고, 결제 후 환불은 별도 영속 보상 기록을 따른다. 다른 `onHand - reserved` 계산을 훈련 코드에 넣으면 제품과 테스트가 서로 다른 장부를 검증하게 된다.

상태 전이 실험에서는 주문 버전과 감사 행을 함께 본다. 새 주문은 버전 0이고 성공한 전이마다 규칙에 따라 증가한다. Outbox 행이 있다는 사실만으로 모든 상태 전이 감사가 보존되었다고 할 수 없다. 이벤트 배포 기록과 `OrderTransition`은 목적이 다르다. 하나를 다른 하나의 대용으로 검사하지 않는다.

HTTP 경계는 실제 애플리케이션의 `Test.createApp({ rootModule })`으로 검사한다. 인증이 필요한 요청에는 테스트 principal을 명시하고, 생성한 주문을 다시 `/orders/:id`에서 조회하여 같은 사용자에게 같은 상태가 보이는지 확인한다. `principal()`은 synthetic principal 주입이지 JWT 서명 검증 시험이 아니다. JWT 경계를 시험할 때는 실제 검증 경로로 발급·검증한 토큰을 보내고, 이 둘의 증거를 분리한다.

`Test.createTestingModule(...).overrideProvider(...)`로 결제 어댑터를 기록형 구현으로 바꾸더라도 `PaymentLedger`와 `OrderInventoryService` 자체를 성공 mock으로 바꾸지 않는다. 그렇게 하면 이 장이 확인하려는 멱등성·예약 소비·상태 감사가 테스트에서 사라진다. 외부 효과만 교체하고 내부 트랜잭션은 실제 실습 DB에서 수행하는 통합 시험이 필요하다.

## 종료는 마지막 요청 다음의 또 하나의 상태 전이다

Queue는 전체 bootstrap-ready handoff 이후에 worker processor를 시작한다. 모듈 초기화 중 enqueue가 가능하다는 사실을 worker가 이미 처리 중이라는 뜻으로 읽지 않는다. 시작 단계가 실패하면 준비되지 않은 작업자가 메시지를 처리하지 않았는지, 실패 상태가 관측에 남았는지 확인한다. 개발 환경에서 정상 시작만 해 본 것으로 배포 시작의 안전성을 보증하지 않는다.

종료가 시작되면 Queue는 새 enqueue를 거절한다. graceful worker close가 실패하거나 예산을 넘으면 force-close를 시도하며 각 단계에 `workerShutdownTimeoutMs` 예산이 적용된다. 따라서 2초를 설정했다고 애플리케이션 전체가 반드시 2초 안에 종료되는 것은 아니다. dead-letter 쓰기 정리도 별도 한도가 있으며 기록이 Redis에 도착하지 못한 채 종료가 계속될 수 있다. 종료 로그의 실패를 지우지 말고 다음 기동의 대사 근거와 함께 보관한다.

RabbitMQ의 원시 adapter와 programmatic `Microservice` facade도 구분한다. 애플리케이션은 `MICROSERVICE`를 주입해 사용한다. facade close는 이미 수락한 handler의 정리와 새로운 ingress 거절을 조율한 뒤 transport 구독을 해제한다. caller-owned publisher, consumer, channel, connection은 그다음 애플리케이션이 닫는다. 단순히 connection부터 끊어 놓고 handler가 깨끗하게 끝났다고 판단할 수 없다.

종료 실험에는 두 개의 관찰 신호가 필요하다. 첫째는 handler가 진입했다는 신호이고, 둘째는 그 작업이 커밋·롤백 또는 명시적 실패로 끝났다는 신호다. 첫 신호 뒤 종료를 시작하고 새 작업이 거절되는지 본다. 둘째 신호 뒤에만 실제 DB 연결 정리 순서를 판단한다. shutdown을 기다리는 테스트 자신이 handler를 해제하지 않아 교착을 만드는 일도 피해야 한다.

## 회고로 두 번째 권을 닫기

훈련이 끝나면 성공한 시나리오의 개수보다 실패를 설명하는 기록을 남긴다. 어떤 입력이 어떤 영속 상태를 만들었는지, 응답을 잃었을 때 무엇으로 다시 찾는지, 누가 재시도를 소유하는지, 수동 대사가 필요한 경우는 무엇인지 적는다. 앞 장의 HTTP 지연, 결제 결과, Outbox 나이와 최종 원장 상태를 같은 시간대에 비교하면 지표가 제품의 실제 문제를 드러내는지도 평가할 수 있다.

이 원고 작성에서는 새 Redis·RabbitMQ 서버를 만들거나 실제 주문 DB에 장애를 주입하지 않았다. 위 코드의 모듈·전달 실험과 외부 인프라 실험은 구분된 재현 절차이며 실행 통과를 주장하지 않는다. 독자의 앱에서 소스 실험 파일을 옮긴 뒤 기존 Vitest 표준 데코레이터 설정으로 해당 파일을 실행하고, 실제 저장소 검증은 격리 환경에서 별도로 수행한다. 공개 패키지 회귀 테스트는 Fluo 계약의 근거이지 완성된 FluoShop 배포의 증거가 아니다.

완성은 장애가 전혀 없다는 선언이 아니다. 실패해도 재고와 돈의 상태가 설명 가능하고, 같은 요청을 다시 받아도 이미 한 일을 구별하며, 운영자가 복구의 다음 행동을 결정할 수 있다는 상태다. 블로그 독자는 같은 계정으로 글을 읽고 상품을 구매한다. 상점 때문에 블로그를 버리지 않았고, 필요한 배송 경계만 분리했다. 이것이 이 권에서 만들어 온 제품의 연속성이다.

다음 권은 다른 앱이나 새로운 패키지 목록으로 시작하지 않는다. 방금 만든 주문 요청 하나가 데코레이터 메타데이터, 모듈 컴파일, DI 해석, 런타임 dispatch와 종료 경계를 어떻게 통과하는지 실제 Fluo 소스로 따라간다. 우리가 방금 시험한 “handler가 끝나기 전에는 소비를 완료하지 않는다”는 약속이 어느 코드에서 성립하는지 묻는 순간부터 내부 구조를 읽는 이유가 생긴다.

## 근거와 더 읽을 소스

- [Testing 모듈·요청·override 계약](../../packages/testing/README.ko.md), [공개 export](../../packages/testing/src/index.ts), [공개 builder 타입](../../packages/testing/src/types.ts), [테스트 계층 계약](../../docs/contracts/testing-guide.ko.md)
- [Queue 재시도·직렬화·종료 계약](../../packages/queue/README.ko.md), [공개 export](../../packages/queue/src/index.ts), [옵션과 inspection 타입](../../packages/queue/src/types.ts), [worker 데코레이터](../../packages/queue/src/decorators.ts), [모듈 등록](../../packages/queue/src/module.ts)
- [Queue 수명주기·dispatch 회귀 테스트](../../packages/queue/src/module.test.ts), [dead-letter 정리 테스트](../../packages/queue/src/dead-letter-manager.test.ts), [inspection 수명주기 테스트](../../packages/queue/src/service.inspection-lifecycle.test.ts)
- [Microservices 완료·소유권 계약](../../packages/microservices/README.ko.md), [공개 export](../../packages/microservices/src/index.ts), [transport·facade 타입](../../packages/microservices/src/types.ts), [RabbitMQ 완료 경계](../../packages/microservices/src/transports/rabbitmq-transport.ts)
- [RabbitMQ 회귀 테스트](../../packages/microservices/src/transports/rabbitmq-transport.test.ts), [이벤트 실패 신호 테스트](../../packages/microservices/src/transports/event-failure-signal.test.ts), [provider 토큰별 handler 탐색](../../packages/microservices/src/handler-discovery-provider-token.test.ts)

[이전](./ch27-sale-observability.ko.md) · [목차](./toc.ko.md) · [다음 권](../03-internals/ch01-trace-an-order.ko.md)
