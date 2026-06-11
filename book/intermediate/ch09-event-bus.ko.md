<!-- packages: @fluojs/event-bus, @fluojs/redis -->
<!-- project-state: FluoShop v1.8.0 -->

# Chapter 9. Event Bus and Domain Events

이 장에서는 Part 1의 transport 선택 위에 domain reaction 모델을 세우기 위해 FluoShop에 이벤트 버스를 도입합니다. Chapter 8이 서비스 간 계약을 정리했다면, 여기서는 하나의 비즈니스 사실이 여러 후속 동작으로 퍼질 때도 write 경계를 단단하게 유지하는 방법으로 초점을 옮깁니다.

## Learning Objectives
- 이벤트 버스가 transport 다양성 이후에 왜 필요한지 이해합니다.
- domain event와 command의 역할 차이를 구분해 설명합니다.
- write boundary에서 event를 발행하고 side effect를 분리하는 흐름을 설계합니다.
- 하나의 business fact에 여러 handler가 독립적으로 반응하는 구조를 분석합니다.
- in-process delivery와 Redis fan-out 사이의 선택 기준을 정리합니다.
- FluoShop에서 stable event key와 idempotent handler 규칙이 왜 중요한지 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8 완료.
- 비즈니스 이벤트와 비동기 후속 처리에 대한 기초 이해.
- module boundary와 distributed fan-out 개념에 대한 기본 감각.

## 9.1 Why the event bus matters after Part 1

Transport diversity는 프로세스 간 통신을 해결했습니다. 하지만 한 프로세스 안의 coordination까지 해결하지는 않습니다. 이제 FluoShop에서는 checkout, inventory, notifications, analytics, compliance가 같은 비즈니스 사실에 관심을 가집니다. 주문은 한 번만 생성되지만 여러 컴포넌트가 반응해야 할 수 있습니다. 확인 이메일 전송, 대시보드 갱신, 감사 추적 기록은 서로 다른 반응입니다. 이 모든 것을 direct service call로 연결하면 write path가 쉽게 취약해집니다. `@fluojs/event-bus` 패키지는 FluoShop에 더 단순한 형태를 제공합니다. 한 컴포넌트가 domain event를 발행하고 여러 handler가 구독하며, 각 handler는 자기 관심사에만 집중합니다.

## 9.2 Domain events in FluoShop v1.8.0

v1.8.0의 FluoShop은 중요한 비즈니스 사실을 명시적인 event class로 다룹니다. 이 이벤트들은 임의의 로그 메시지가 아닙니다. 비즈니스가 실제로 중요하게 여기는 상태 변화를 표현합니다. 예시는 다음과 같습니다.

- `OrderPlacedEvent`
- `InventoryReservedEvent`
- `ShipmentDispatchedEvent`
- `RefundApprovedEvent`

이 이름 짓기는 중요합니다. Command는 intent를 표현합니다. Event는 이미 일어난 일을 표현합니다. 이 차이가 모델을 정직하게 유지합니다.

### 9.2.1 Event classes and stable keys

패키지 README는 channel name이 rename이나 minification 이후에도 유지되어야 할 때 stable event key를 권장합니다. FluoShop에는 실용적인 규칙입니다. 오래 운영되는 커머스 시스템은 event routing을 class name에만 의존해서는 안 됩니다.

```typescript
export class OrderPlacedEvent {
  static readonly eventKey = 'fluoshop.order.placed.v1';

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly totalAmount: number,
  ) {}
}
```

이 event key는 계약의 일부가 됩니다. 운영자와 downstream system에 안정적인 라벨을 제공하고, 향후 versioning을 더 의도적으로 다루게 합니다.

### 9.2.2 Module wiring with Redis fan-out

기본 event bus는 in-process입니다. 이것만으로 충분한 module boundary도 많습니다. 하지만 FluoShop은 수평 확장된 서비스 사이에서 optional cross-process fan-out도 필요로 합니다. 패키지 README는 이런 경우를 위해 Redis transport 지원을 문서화합니다.

```typescript
import { Module } from '@fluojs/core';
import { EventBusModule } from '@fluojs/event-bus';
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';

@Module({
  imports: [
    EventBusModule.forRoot({
      transport: new RedisEventBusTransport({
        publishClient: redis,
        subscribeClient: redisSubscriber,
      }),
    }),
  ],
  providers: [
    OrderNotificationsHandler,
    OrderAnalyticsHandler,
    OrderAuditHandler,
  ],
})
export class OrderEventsModule {}
```

이 경계는 중요합니다. 이벤트 버스 API는 그대로 유지되고, 뒤에 있는 transport만 바뀝니다. 이 연속성은 앞선 장에서 본 fluo의 설계 철학과 맞닿아 있습니다.

## 9.3 Publish from the write boundary

이벤트에서 가장 흔한 실수는 어디서나 publish하는 것입니다. FluoShop은 그렇게 하지 않습니다. 성공적인 write completion에 가까운 곳에서 domain event를 publish합니다. 즉, 시스템이 상태 변화가 실제로 일어났다고 확신한 뒤에 발행합니다. 실제 구현에서는 transaction이 정리된 뒤 application service나 command handler가 publish하는 경우가 많습니다.

### 9.3.1 OrderPlacedEvent flow

checkout write path를 생각해 봅시다. 고객이 cart를 확정합니다. Checkout가 order를 저장합니다. 그 뒤에야 `OrderPlacedEvent`를 publish합니다.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';

@Inject(EventBusLifecycleService)
export class CheckoutService {
  constructor(private readonly eventBus: EventBusLifecycleService) {}

  async placeOrder(input: PlaceOrderInput) {
    const order = await this.orders.create(input);

    await this.eventBus.publish(
      new OrderPlacedEvent(order.id, order.customerId, order.totalAmount),
    );

    return order;
  }
}
```

이렇게 하면 write path가 명시적으로 유지됩니다. 서비스는 상태 변화를 계속 소유하고, side effect는 위임됩니다.

### 9.3.2 Why this is better than chained service calls

이벤트가 없다면 Checkout는 Notifications를 직접 호출할 수 있습니다. 그다음 Analytics를 호출하고, 다시 Audit를 호출할 수 있습니다. 새로운 관심사가 추가될 때마다 write path는 더 길어집니다. 각 의존성은 실패 처리와 테스트를 더 복잡하게 만듭니다. 이벤트를 쓰면 Checkout는 하나의 사실만 진술하고 나머지 시스템은 독립적으로 반응합니다. intent를 숨기지 않으면서 coupling을 낮추는 방식입니다.

## 9.4 Multiple handlers, one business fact

이벤트 버스는 의도적으로 one-to-many입니다. 이 점은 command routing과 정반대입니다. 하나의 event에 여러 handler가 붙을 수 있는 이유는 플랫폼의 여러 부분이 같은 사실에 정당하게 관심을 가질 수 있기 때문입니다.

### 9.4.1 Notification reaction

Notification Service는 `OrderPlacedEvent`를 듣고 영수증을 보냅니다. Checkout 흐름이 이메일 전송을 직접 기다리지 않아도 되기 때문에, 주문 기록과 고객 커뮤니케이션은 느슨하게 연결된 상태로 남습니다.

```typescript
import { OnEvent } from '@fluojs/event-bus';

export class OrderNotificationsHandler {
  @OnEvent(OrderPlacedEvent)
  async sendReceipt(event: OrderPlacedEvent) {
    await this.email.sendOrderReceipt(event.orderId, event.customerId);
  }
}
```

### 9.4.2 Analytics reaction

Analytics도 같은 event를 구독합니다. 전환 카운터와 revenue dashboard를 갱신하며, 이 반응은 주문 저장 책임과 분리된 read-side projection으로 남습니다.

```typescript
export class OrderAnalyticsHandler {
  @OnEvent(OrderPlacedEvent)
  async projectRevenue(event: OrderPlacedEvent) {
    await this.metrics.recordOrder(event.orderId, event.totalAmount);
  }
}
```

### 9.4.3 Audit reaction

Compliance는 같은 사실을 traceability 용도로 필요로 할 수 있습니다. 이 handler는 고객 경험을 바꾸지 않지만, 나중에 주문 흐름을 설명해야 할 때 필요한 증거를 조용히 남깁니다.

```typescript
export class OrderAuditHandler {
  @OnEvent(OrderPlacedEvent)
  async recordAudit(event: OrderPlacedEvent) {
    await this.audit.append('order.placed', event);
  }
}
```

이 handler들은 서로를 알 필요가 없습니다. 그 독립성이 핵심입니다.

## 9.5 In-process first, distributed when needed

패키지 README는 기본 모델을 in-process로 설명하고, 필요할 때 외부 transport adapter를 덧붙일 수 있다고 말합니다. 이는 건강한 기본값입니다. FluoShop은 단지 옵션이 있다는 이유만으로 distributed event fan-out을 선택하지 않아야 합니다. 로컬 전달은 더 단순하고 이해하기 쉬우며 움직이는 부품도 적습니다. 관련 module이 한 application instance에 함께 있을 때는 in-process delivery만으로 충분한 경우가 많습니다. Distributed transport는 반응이 process boundary를 넘어가야 할 때 유용해집니다. 예를 들어 Checkout와 Notifications가 별도 프로세스로 실행될 수 있습니다. 또는 analytics projector가 독립적으로 scale될 수 있습니다. Redis fan-out은 같은 event model을 그 배포 topology 위로 확장합니다. Published event class가 더 넓은 domain event를 상속하면 transport fan-out은 구체 subclass channel과 inherited event channel을 함께 포함하므로, publisher process가 matching local handler를 등록하지 않아도 remote handler가 자신이 소유한 specificity level에서 구독할 수 있습니다.

## 9.6 Event bus flow in FluoShop

v1.8.0에서 가장 단순한 mental model은 다음과 같습니다.

1. Checkout가 성공적인 order write를 받아들입니다.
2. Checkout가 `OrderPlacedEvent`를 publish합니다.
3. 로컬 및 distributed handler가 반응합니다.
4. Notifications가 고객 메시지를 보냅니다.
5. Analytics가 read-side counter를 projection합니다.
6. Audit가 compliance evidence를 저장합니다.

이 흐름은 의도적으로 비대칭입니다. 하나의 write가 여러 reaction으로 확장됩니다. 이것은 우발적 복잡성이 아닙니다. 실제 커머스 플랫폼의 형태가 이렇습니다.

## 9.7 Operational rules for domain events

Domain event에는 규율이 필요합니다. FluoShop은 몇 가지 실용적인 규칙을 따릅니다. 첫째, event name은 완료된 사실을 설명해야 합니다. 둘째, payload는 downstream handler가 동작할 만큼 충분한 문맥을 담되 기본적으로 aggregate 전체를 누출하지 않아야 합니다. 셋째, versioned event key는 계약이 깨질 때만 의도적으로 바뀌어야 합니다. 넷째, duplicate distributed delivery가 가능하면 handler는 idempotent해야 합니다. 다섯째, event가 숨겨진 synchronous dependency의 뒷문이 되어서는 안 됩니다. 느리거나 retry가 필요한 작업은 Chapter 11의 queue boundary로 handoff하고, event handler는 그 handoff를 한 번 기록하며 duplicate delivery를 견뎌야 합니다. 이 규칙들이 이벤트 버스를 모호한 장치가 아니라 운영 가능한 도구로 유지합니다.

### 9.7.1 Redis fan-out에서 idempotent handler 유지하기

Redis fan-out은 단순히 “이벤트를 다른 곳으로 보낸다”는 뜻을 넘습니다. 구독 중인 각 프로세스가 같은 business fact를 받을 수 있고, 재연결 중이거나 retry된 publisher 때문에 application boundary에서 duplicate delivery가 가능해질 수 있습니다. FluoShop은 handler idempotency를 event contract의 일부로 다룹니다. Receipt를 보내거나, audit row를 쓰거나, projection을 갱신하는 handler는 stable event id 또는 business key를 사용하고, 이미 적용한 reaction을 기록하며, 반복 전달이 같은 상태로 수렴하도록 만들어야 합니다.

예를 들어 order receipt handler는 business key인 `OrderPlacedEvent.orderId`와 reaction name `receipt-email`을 함께 key로 사용할 수 있습니다. Marker가 이미 있으면 handler는 반환합니다. 없으면 marker를 기록하고 side effect를 수행합니다. 정확한 저장소 선택은 애플리케이션에 속하지만, 이 규칙은 domain-event 설계에 속합니다.

### 9.7.2 느린 reaction은 Queue로 넘기기

Event handler가 숨겨진 worker가 되어서는 안 됩니다. 빠른 local reaction은 `@OnEvent(...)` 안에서 처리해도 괜찮지만, 느리거나 retry 가능한 작업에는 더 강한 운영 경계가 필요합니다. FluoShop은 invoice generation, marketplace catalog sync, 기타 failure-prone follow-up task를 event reaction에서 `@fluojs/queue`로 넘깁니다. Event는 여전히 그 작업이 왜 필요한지 설명하고, queue는 retry, backoff, workload isolation, dead-letter evidence를 소유합니다. 이 handoff는 애플리케이션이 소유한 unique claim을 사용하고, Queue가 job을 받은 뒤에만 해당 claim을 enqueued로 표시하며, enqueue가 실패하면 claim을 해제해 다음 duplicate delivery가 다시 시도할 수 있게 합니다.

```typescript
import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { QueueLifecycleService } from '@fluojs/queue';

@Inject(QueueLifecycleService)
export class BillingEventsHandler {
  constructor(private readonly queue: QueueLifecycleService) {}

  @OnEvent(OrderPlacedEvent)
  async enqueueInvoice(event: OrderPlacedEvent) {
    const handoffKey = `${event.orderId}:invoice`;

    if (!(await this.reactions.claimPending(handoffKey))) {
      return;
    }

    try {
      await this.queue.enqueue(new GenerateInvoiceJob(event.orderId));
      await this.reactions.markEnqueued(handoffKey);
    } catch (error) {
      await this.reactions.releasePending(handoffKey);
      throw error;
    }
  }
}
```

이렇게 하면 domain event는 명시적으로 유지하면서 publish path가 long-running background processor로 늘어나지 않습니다. Chapter 11은 이 boundary의 queue 쪽으로 돌아가 retry, backoff, dead-letter handling을 더 자세히 설명합니다.

## 9.8 FluoShop v1.8.0 progression

Part 1은 FluoShop이 boundary를 넘어 통신하는 방법을 정리했습니다. 이 장은 bounded context 안팎에서 반응을 조직하는 방법을 다룹니다. 이것이 event-driven architecture로 들어가는 다리입니다. 시스템은 더 이상 request path만으로 정의되지 않습니다. 점점 더, 시스템이 방출하는 사실과 그 사실이 유발하는 reaction으로 정의됩니다. 그래서 다음 패턴들이 가능해집니다. CQRS가 이 위에 세워집니다. Queue도 이 위에 세워집니다. Scheduled background orchestration도 이 위에 세워집니다.

## 9.9 Summary

- `@fluojs/event-bus`는 FluoShop에 domain event를 위한 명확한 one-to-many reaction model을 제공합니다.
- event class는 미래의 intent가 아니라 완료된 business fact를 나타내야 합니다.
- stable `eventKey` 값은 refactor를 넘어 routing contract를 유지하는 데 도움이 됩니다.
- in-process publish and subscribe가 기본이며, Redis transport는 같은 모델을 process boundary 너머로 확장합니다.
- Redis fan-out에는 idempotent handler가 필요하며, 느리거나 retry 가능한 reaction은 durable work를 Queue로 넘겨야 합니다.
- FluoShop v1.8.0은 이제 여러 module이 독립적으로 반응할 수 있는 order 및 fulfillment fact를 publish합니다.

더 깊은 교훈은 아키텍처에 있습니다. 하나의 write가 여러 정당한 후속 액션을 만들 때, 적절한 설계는 대개 더 긴 service chain이 아닙니다. 명시적인 subscriber를 가진 명시적인 event입니다.
