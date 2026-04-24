<!-- packages: @fluojs/cqrs, @fluojs/event-bus -->
<!-- project-state: FluoShop v1.9.0 -->

# Chapter 10. CQRS and Sagas

이 장에서는 FluoShop의 event-driven 흐름 위에 command, query, saga를 분리해 더 명시적인 write, read, orchestration 모델을 세웁니다. Chapter 9가 business fact에 대한 반응을 정리했다면, 여기서는 그 사실을 기준으로 long-running workflow와 read projection을 조직하는 방법으로 초점을 옮깁니다.

## Learning Objectives
- CQRS가 write, read, orchestration을 왜 분리하는지 이해합니다.
- command와 query가 각각 하나의 handler를 가져야 하는 이유를 설명합니다.
- FluoShop write side에 command bus와 query bus를 연결하는 방법을 익힙니다.
- saga가 event를 받아 다음 command를 dispatch하는 흐름을 분석합니다.
- in-process saga topology 제한이 queue나 scheduler 같은 다른 boundary 선택으로 이어지는 이유를 정리합니다.
- read model과 write model을 별도로 진화시키는 설계 원칙을 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9 완료.
- command, query, domain event 개념에 대한 기초 이해.
- 비동기 workflow와 projection 모델에 대한 기본 감각.

## 10.1 Why CQRS enters FluoShop now

Part 2는 event-driven architecture를 다룹니다. CQRS가 여기에 속하는 이유는 write, read, follow-up action이 왜 달라야 하는지를 형식화하기 때문입니다. 커머스 플랫폼에서는 이 경로들이 거의 항상 같은 요구사항을 갖지 않습니다. write side는 invariant를 보호하고, read side는 view shape와 속도를 최적화하며, orchestration layer는 사실을 듣고 다음 단계를 촉발합니다. 지금의 FluoShop에 필요한 분리가 이것입니다. 패키지 README도 핵심 동기를 분명하게 설명합니다. Command는 intent를 표현합니다. Query는 데이터를 조회합니다. Saga는 event에 의해 시작되는 multi-step flow를 orchestration합니다.

## 10.2 Command flow on the write side

Command는 요청된 상태 변화를 설명해야 합니다. 이들은 point-to-point입니다. 하나의 command는 정확히 하나의 handler를 가져야 합니다. 이 규칙이 write ownership을 명시적으로 만듭니다.

### 10.2.1 PlaceOrderCommand

v1.9.0에 이르면 FluoShop은 checkout write를 더 이상 막연한 service method로만 호출하지 않습니다.

대신 intent를 직접 모델링합니다.

```typescript
import { Inject } from '@fluojs/core';
import { CommandHandler, ICommandHandler } from '@fluojs/cqrs';

export class PlaceOrderCommand {
  constructor(
    public readonly customerId: string,
    public readonly cartId: string,
  ) {}
}

@Inject(CheckoutService)
@CommandHandler(PlaceOrderCommand)
export class PlaceOrderHandler implements ICommandHandler<PlaceOrderCommand, string> {
  constructor(private readonly checkout: CheckoutService) {}

  async execute(command: PlaceOrderCommand): Promise<string> {
    const order = await this.checkout.place(command.customerId, command.cartId);
    return order.id;
  }
}
```

command 이름이 의도를 바로 전달합니다. handler가 실행을 소유합니다. 그 intent가 어디에 도착하는지 애매함이 없습니다.

### 10.2.2 Why the single handler rule matters

같은 command를 두 handler가 처리할 수 있다면 write model은 비결정적이 됩니다. business invariant에는 허용하기 어려운 구조입니다. FluoShop은 command를 사용할 때 한 가지 질문에 명확히 답해야 합니다. 누가 이 상태 변화를 실제로 일으킬 책임을 지는가. CQRS는 하나의 handler로 답합니다.

## 10.3 Query flow on the read side

Query도 point-to-point입니다. 하지만 목적은 다릅니다. write invariant를 보호하지 않고 view의 필요를 충족합니다. 이 분리는 중요합니다. 가장 좋은 read model이 가장 좋은 write model인 경우는 드뭅니다.

### 10.3.1 GetOrderTimelineQuery

Customer support는 checkout, shipment, refund 상태를 합친 timeline view가 필요할 수 있습니다. 이 projection은 read concern입니다. 새로운 dashboard가 등장할 때마다 write aggregate의 형태를 다시 잡게 해서는 안 됩니다.

```typescript
import { IQuery, IQueryHandler, QueryHandler } from '@fluojs/cqrs';
import { Inject } from '@fluojs/core';

export class GetOrderTimelineQuery implements IQuery<OrderTimelineView> {
  constructor(public readonly orderId: string) {}
}

@Inject(OrderTimelineStore)
@QueryHandler(GetOrderTimelineQuery)
export class GetOrderTimelineHandler
  implements IQueryHandler<GetOrderTimelineQuery, OrderTimelineView>
{
  constructor(private readonly timelineStore: OrderTimelineStore) {}

  async execute(query: GetOrderTimelineQuery): Promise<OrderTimelineView> {
    return await this.timelineStore.get(query.orderId);
  }
}
```

이렇게 하면 read side가 정직해집니다. view assembly를 위해 최적화할 수 있고, 자신이 authoritative write model인 척할 필요가 없습니다.

### 10.3.2 Projection is part of the design

Query가 명시적이 되면 projection도 논의하기 쉬워집니다. FluoShop은 support timeline table을 만들 수 있습니다. fulfillment dashboard table도 만들 수 있습니다. finance summary table도 만들 수 있습니다. 각 read model은 사용자나 운영자가 실제로 필요로 하기 때문에 존재합니다. 모든 consumer에게 write store를 직접 읽게 강요하는 것보다 나은 구조입니다.

## 10.4 CQRS wiring in fluo

패키지 README는 `CqrsModule.forRoot(...)`를 지원되는 root entrypoint로 문서화합니다.

이 module은 command, query, event bus를 등록하고 bootstrap 시 discovery를 수행합니다.

```typescript
import { Module } from '@fluojs/core';
import { CqrsModule } from '@fluojs/cqrs';

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [
    PlaceOrderHandler,
    GetOrderTimelineHandler,
    ReserveInventoryHandler,
    OrderFulfillmentSaga,
  ],
})
export class CommerceApplicationModule {}
```

이렇게 하면 entrypoint가 간결하게 유지됩니다.

이전 fluo 패키지들과 마찬가지로 lifecycle과 discovery는 각 feature에서 bus를 수동 조립하는 대신 module registration을 통해 이뤄집니다.

## 10.5 Event publishing from CQRS

개념 문서는 경계를 분명하게 설명합니다. `@fluojs/cqrs`는 orchestrator입니다. `@fluojs/event-bus`는 그 아래에서 event distribution을 맡는 engine입니다. 이 layering은 중요합니다. CQRS가 이벤트 버스를 대체하지 않습니다. 애플리케이션이 이벤트 버스를 사용하는 방식을 구조화합니다. FluoShop에서는 command handler가 write를 저장한 뒤 CQRS event bus service를 통해 domain event를 publish할 수 있습니다. 그 event는 일반 event handler나 saga로 이어질 수 있습니다. write side는 명시적으로 유지되고, reaction side는 decoupled된 상태를 유지합니다.

## 10.6 Saga flow for long-running fulfillment

Saga는 CQRS가 눈에 띄게 event-driven해지는 지점입니다. Saga는 하나의 event를 듣고 다음 command를 발행합니다. 즉, magical workflow engine이 아니라 process manager입니다.

### 10.6.1 OrderPlacedEvent to ReserveInventoryCommand

고객이 주문을 마친 뒤 FluoShop은 inventory를 예약해야 합니다.

이것은 자연스러운 saga step입니다.

```typescript
import { Inject } from '@fluojs/core';
import { CommandBusLifecycleService, ISaga, Saga } from '@fluojs/cqrs';

export class ReserveInventoryCommand {
  constructor(public readonly orderId: string) {}
}

@Inject(CommandBusLifecycleService)
@Saga(OrderPlacedEvent)
export class OrderFulfillmentSaga implements ISaga<OrderPlacedEvent> {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    await this.commandBus.execute(new ReserveInventoryCommand(event.orderId));
  }
}
```

이 예제가 작은 것은 의도적입니다. 좋은 saga step은 대개 단순합니다. 하나의 사실에 반응하고 다음 command를 선택합니다.

### 10.6.2 Reserve inventory, then dispatch shipment

Saga는 추가 event type을 통해 계속 이어질 수 있습니다. `InventoryReservedEvent`는 `DispatchShipmentCommand`를 유발할 수 있습니다. `ShipmentDispatchedEvent`는 `SendShipmentNotificationCommand`를 유발할 수 있습니다. 중요한 설계 포인트는 각 단계가 event boundary를 지난다는 점입니다. 그래서 FluoShop은 fulfillment flow 전체를 하나의 보이지 않는 블록으로 다루지 않고, 각 경계에서 observe, retry, reschedule할 수 있습니다.

## 10.7 Saga topology limits

패키지 README는 운영상 중요한 규칙을 포함합니다. in-process publish chain이 같은 saga route를 순환적으로 다시 진입하거나 32개의 nested saga hop을 넘으면 `SagaTopologyError`와 함께 saga execution이 즉시 실패합니다. 이것은 구현 세부사항이 아니라 아키텍처 가이드입니다. FluoShop은 in-process saga graph를 acyclic하게 유지해야 합니다. 워크플로가 의도적으로 cyclic하거나 너무 long-running해지면 다른 boundary 뒤로 보내야 합니다. 그 boundary는 external transport일 수도 있습니다. queue일 수도 있습니다. scheduler일 수도 있습니다. 하지만 끝없이 재진입하는 in-process saga chain으로 남겨두면 안 됩니다.

### 10.7.1 What this means for FluoShop

예를 들어 payment review가 fraud analysis와 manual approval 사이를 여러 번 오갈 수 있다고 해봅시다. 이것을 촘촘한 in-process saga loop로 모델링해서는 안 됩니다. 대신 시스템은 event를 방출하고 다음 단계를 queue worker나 scheduled retry path에 넘겨야 합니다. 그래야 saga topology가 읽기 쉬워지고, 문서화된 fluo contract도 지킬 수 있습니다.

## 10.8 A full CQRS and saga flow in FluoShop

v1.9.0에서 order path는 이제 다음과 같이 보입니다.

1. API가 `PlaceOrderCommand`를 dispatch합니다.
2. `PlaceOrderHandler`가 order를 검증하고 저장합니다.
3. write side가 `OrderPlacedEvent`를 publish합니다.
4. `OrderFulfillmentSaga`가 event를 받습니다.
5. saga가 `ReserveInventoryCommand`를 dispatch합니다.
6. Inventory가 reservation을 저장하고 `InventoryReservedEvent`를 publish합니다.
7. 다른 saga step이 `DispatchShipmentCommand`를 dispatch합니다.
8. Shipment가 `ShipmentDispatchedEvent`를 publish합니다.
9. Notification과 read-model handler가 반응합니다.

이것이 하나의 뷰에서 본 CQRS와 saga 흐름입니다. Write는 명시적입니다. Read는 명시적입니다. Cross-domain orchestration도 명시적입니다. 패턴 이름보다 이 명확성이 더 중요합니다.

## 10.9 Read and write models should evolve separately

CQRS가 separate database를 반드시 요구하는 것은 아닙니다. 하지만 separate thinking은 요구합니다. write model은 correctness를 보호해야 합니다. read model은 consumer need를 충족해야 합니다. FluoShop에서 support agent는 하나의 denormalized view가 필요할 수 있습니다. Finance는 다른 view가 필요할 수 있습니다. Operations는 세 번째 view가 필요할 수 있습니다. 하나의 aggregate shape로 이 모두를 만족시키려 하면 대개 accidental complexity가 생깁니다. CQRS는 그렇게 하지 말라고 팀에 허락을 줍니다.

## 10.10 FluoShop v1.9.0 progression

이 단계에서 FluoShop은 write 뒤에 domain event를 publish하는 수준을 넘었습니다. 이제 command, query, long-running orchestration을 위한 공식 모델을 갖습니다. 이는 의미 있는 성숙도 상승입니다. 플랫폼은 business intent를 더 정밀하게 표현할 수 있습니다. 사용자 요구에 맞는 read model을 노출할 수 있습니다. 모든 것이 하나의 transaction에 속한다고 가장하지 않고도 fulfillment step을 연결할 수 있습니다. 이것이 다음 두 장을 준비시킵니다. Queue는 느린 작업을 즉시 흐름 밖으로 꺼낼 것입니다. Scheduler는 주기적이고 지연된 반응을 명확한 운영 경계 안에서 관리할 것입니다.

## 10.11 Summary

- `@fluojs/cqrs`는 write, read, orchestration을 명시적인 bus와 handler로 분리합니다.
- command와 query는 point-to-point이며 정확히 하나의 handler를 가져야 합니다.
- saga는 event를 듣고 long-running workflow의 다음 command를 dispatch합니다.
- `CqrsEventBusService`는 `@fluojs/event-bus`를 통해 event distribution을 위임하므로, CQRS는 이벤트 버스를 대체하는 대신 그 위에 구축됩니다.
- `SagaTopologyError`는 cyclic하거나 지나치게 깊은 in-process saga graph가 queue나 scheduler 같은 다른 boundary를 필요로 한다는 설계 경고입니다.

핵심 교훈은 실용적입니다. CQRS가 FluoShop에서 유용한 이유는 acronym이 유행해서가 아닙니다. 플랫폼이 이제 write의 명시적 ownership, read의 명시적 shaping, 그리고 둘 사이의 명시적 orchestration을 필요로 하기 때문입니다.
