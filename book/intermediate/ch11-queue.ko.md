<!-- packages: @fluojs/queue, @fluojs/redis -->
<!-- project-state: FluoShop v2.0.0 -->

# Chapter 11. Background Jobs and Queues

이 장은 FluoShop의 event-driven 흐름 위에 queue boundary를 두고, 느리거나 실패 가능성이 높은 작업을 request path 밖으로 분리하는 방법을 설명합니다. Chapter 10에서 long-running workflow를 orchestration했다면, 이제 후속 작업을 retry, backoff, dead-letter policy와 함께 운영 가능한 단위로 다룹니다.

## Learning Objectives
- queue가 request path 밖으로 느린 작업을 분리해야 하는 이유를 이해합니다.
- `QueueModule.forRoot()`와 Redis 연결을 함께 구성하는 방법을 익힙니다.
- job payload와 worker 구현이 서로 다른 책임을 가진다는 점을 설명합니다.
- retry와 backoff 정책을 workload 특성에 맞게 고르는 기준을 정리합니다.
- dead-letter handling이 반복 실패 job을 운영적으로 추적하는 방식을 분석합니다.
- event handler, saga, queue 중 어떤 boundary를 선택해야 하는지 비교해 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10 완료.
- Redis 기반 transport와 background processing 개념에 대한 기초 이해.
- retry 가능한 비동기 작업과 운영 실패 대응에 대한 기본 감각.

## 11.1 Why FluoShop needs queues

v2.0.0 시점의 FluoShop은 이미 domain event를 publish하고 multi-step workflow를 coordination합니다. 하지만 모든 후속 동작이 즉시 in-process로 처리되기에 적합한 것은 아닙니다. 예시는 다음과 같습니다.

- 대량 이메일 batch 전송
- invoice PDF 생성
- marketplace catalog sync 전송
- warehouse label printing retry
- expensive read projection 재구축

이 작업들은 느릴 수 있고, 불안정한 원격 시스템에 의존할 수 있으며, 여러 번의 retry attempt를 필요로 할 수 있습니다. 원래의 web request보다 몇 분 더 오래 지속되는 경우도 있습니다. Queue는 이런 작업을 명시적인 운영 경계 안에 배치합니다.

## 11.2 Queue wiring in fluo

README는 `QueueModule.forRoot(...)`를 지원되는 root entrypoint로 문서화합니다. Queue 패키지는 persistence와 coordination을 위해 Redis에 의존합니다. 따라서 FluoShop은 먼저 `@fluojs/redis`를 연결하고, 그 다음 queue support를 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { RedisModule } from '@fluojs/redis';
import { QueueModule } from '@fluojs/queue';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [InvoiceWorker, EmailWorker, CatalogSyncWorker],
})
export class BackgroundJobsModule {}
```

이 계약은 기존 fluo 구조와 같은 형태를 유지합니다. Module이 패키지를 등록하고, Worker는 decorator를 통해 discovery되며, 애플리케이션은 injected lifecycle service로 job을 enqueue합니다.

## 11.3 Jobs and workers

Job은 직렬화된 작업 단위입니다. Worker는 그 job을 처리하는 방식을 소유합니다. 이 분리는 단순하지만 중요합니다. job payload는 durable handoff이고, worker 구현은 그 경계 뒤에서 독립적으로 바뀔 수 있습니다.

### 11.3.1 Invoice generation job

Invoice PDF 생성은 전형적인 queue task입니다. checkout confirmation path 안에서 처리하기에는 오래 걸립니다. file storage나 rendering outage 같은 일시적인 원인으로 실패할 수도 있습니다.

```typescript
import { QueueWorker } from '@fluojs/queue';

export class GenerateInvoiceJob {
  constructor(public readonly orderId: string) {}
}

@QueueWorker(GenerateInvoiceJob, {
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 },
})
export class InvoiceWorker {
  async handle(job: GenerateInvoiceJob) {
    await this.invoices.renderAndStore(job.orderId);
  }
}
```

worker option은 설계의 일부입니다. retry와 backoff는 사후 보정이 아니라, 비즈니스가 transient failure를 어느 수준까지 흡수할지 표현하는 계약입니다.

### 11.3.2 Enqueue after a business event

FluoShop은 domain event나 saga step 뒤에서 job을 enqueue하는 경우가 많습니다. 이 방식은 비즈니스 액션을 잃지 않으면서 request path를 짧게 유지합니다.

```typescript
import { Inject } from '@fluojs/core';
import { QueueLifecycleService } from '@fluojs/queue';

@Inject(QueueLifecycleService)
export class BillingProjectionHandler {
  constructor(private readonly queue: QueueLifecycleService) {}

  async onShipmentDispatched(orderId: string) {
    await this.queue.enqueue(new GenerateInvoiceJob(orderId));
  }
}
```

domain flow는 명시적으로 남고, 느린 작업만 out of band로 이동합니다.

## 11.4 Retry and backoff strategy

queue README는 distributed retry와 backoff를 first-class feature로 강조합니다. 이는 실제 운영 요구와 직접 맞닿아 있습니다. FluoShop은 모든 원격 의존성이 안정적이라고 가정할 수 없습니다. 이메일 제공자는 일시적으로 실패하고, 스토리지 시스템은 짧은 outage를 겪으며, Marketplace API는 예고 없이 throttle할 수 있습니다. retry는 이런 조건에서 시스템이 자동으로 회복할 여지를 만들고, backoff는 outage가 즉시 retry storm으로 번지는 것을 막습니다.

### 11.4.1 Fixed versus exponential backoff

fixed backoff는 예측하기 쉽습니다. exponential backoff는 부하를 받는 dependency에 더 안전한 선택인 경우가 많습니다. FluoShop은 remote system의 특성에 따라 선택해야 합니다. warehouse printer reconnect는 짧은 fixed delay를 감당할 수 있지만, marketplace catalog push는 exponential backoff가 더 적합할 수 있습니다. 핵심은 retry policy를 모든 job에 복사하는 기본값으로 취급하지 않는 것입니다.

## 11.5 Dead-letter handling

모든 retry attempt 이후에도 실패하는 job이 있습니다. 그런 job이 조용히 사라지면 안 됩니다. Queue 패키지는 해당 job을 `fluo:queue:dead-letter:<jobName>` 아래의 Redis dead-letter list로 옮깁니다. 운영자는 이 목록을 통해 무엇이 실패했는지 확인할 수 있는 durable place를 얻습니다. README는 기본 retention policy도 명시합니다. 별도 설정이 없으면 `QueueModule.forRoot()`는 job당 가장 최근 `1_000`개의 dead-letter entry를 유지합니다. 이는 운영상 중요한 기본값입니다. 무한 성장을 막으면서도 최근 실패 증거를 보존하기 때문입니다.

### 11.5.1 What FluoShop stores in dead letters

v2.0.0에서 dead letter는 integration-heavy work에서 특히 중요합니다. failed invoice render, failed marketplace sync, failed bulk notification export가 대표적인 예입니다. 운영자는 실패를 안전하게 진단할 만큼의 job payload context를 확보해야 합니다. 동시에 job body에 secret이나 불필요한 personal data를 넣어서는 안 됩니다. Dead letter는 operational evidence입니다. 유용해야 하지만, 범위는 제한되어야 합니다.

## 11.6 Named Redis clients and workload isolation

README는 non-default Redis registration을 위한 `clientName` 지원을 설명합니다. queue traffic이 다른 Redis 기반 기능과 경쟁하면 안 되는 배포에서 필요한 옵션입니다. FluoShop은 cache와 가벼운 coordination을 위해 기본 Redis client를 유지하고, background job에는 별도의 named Redis client를 전용으로 둘 수 있습니다.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

이것은 code-style trick이 아니라 deployment decision입니다. workload isolation은 noisy-neighbor effect를 줄이고 capacity planning을 더 명확하게 만듭니다.

## 11.7 Queue flow in FluoShop

v2.0.0에서 대표적인 background flow는 다음과 같습니다.

1. Checkout가 order를 저장합니다.
2. write side가 `OrderPlacedEvent`를 publish합니다.
3. saga가 fulfillment command를 진행합니다.
4. `ShipmentDispatchedEvent`가 publish됩니다.
5. Billing이 반응하여 `GenerateInvoiceJob`을 enqueue합니다.
6. `InvoiceWorker`가 background에서 job을 처리합니다.
7. rendering이 일시적으로 실패하면 retry와 backoff가 적용됩니다.
8. 그래도 실패하면 job은 dead-letter list에 남습니다.

이 경계는 PDF generation을 inline으로 수행하는 방식보다 운영적으로 낫습니다. 고객은 시의적절한 API 응답을 받고, 운영자는 통제된 failure model을 얻으며, 시스템은 회복할 여지를 확보합니다.

## 11.8 Queue workers are not a second hidden application

팀은 때때로 불분명한 로직을 worker로 옮기고 그것을 아키텍처라고 부르는 실수를 합니다. FluoShop은 그 함정을 피해야 합니다. Worker는 hidden business ownership이 아니라 background execution을 소유해야 합니다. command side는 여전히 어떤 business step이 필요한지 결정해야 하고, event side는 후속 동작이 왜 존재하는지 표현해야 합니다. Queue는 다른 질문에 답합니다. 느린 작업을 언제, 어떤 방식으로 신뢰성 있게 처리할 것인가. 이 분리가 플랫폼을 이해 가능한 상태로 유지합니다.

## 11.9 When to choose event handlers, sagas, or queues

이 시점에서 FluoShop은 셋 다 갖추고 있습니다. 따라서 선택 규칙이 중요합니다. reaction이 빠르고 로컬이면 ordinary event handler를 사용합니다. event가 비즈니스 워크플로의 다음 explicit command를 촉발해야 하면 saga를 사용합니다. 작업이 느리고, failure-prone하며, retryable하고, initiating request와 운영적으로 분리되어야 하면 queue를 사용합니다. 이 도구들은 서로 보완적이며 경쟁 관계가 아닙니다. 성숙한 시스템은 대부분 셋 모두를 필요로 합니다.

## 11.10 FluoShop v2.0.0 progression

v2.0.0으로 넘어가면서 FluoShop은 더 이상 event-aware 수준에 머무르지 않습니다. background work를 first-class concern으로 운영적으로 인식합니다. 그 결과 downstream work가 안전하게 이어지는 동안 fulfillment는 responsive하게 유지될 수 있습니다. 실패는 즉시 support ticket가 되는 대신 retry될 수 있고, 운영자는 로그에서 잃어버린 상태를 재구성하는 대신 durable dead letter를 inspect할 수 있습니다. 이것이 queue가 event-driven architecture에 추가하는 가치입니다. 지연된 작업을 명시적으로 관리되는 subsystem으로 바꿉니다.

## 11.11 Summary

- `@fluojs/queue`는 FluoShop에 worker discovery와 lifecycle-managed enqueueing을 갖춘 Redis-backed background job processing을 제공합니다.
- job은 invoice generation, email batch, catalog sync처럼 느리거나 failure-prone한 작업을 위한 durable handoff입니다.
- retry attempt와 backoff strategy는 무비판적으로 복사하지 말고 workload별로 선택해야 합니다.
- dead-letter list는 bounded retention policy 아래에서 반복 실패 job을 보존하므로 운영자가 inspect할 수 있습니다.
- FluoShop v2.0.0은 이제 post-order의 expensive work를 customer request path를 늘리는 대신 queue boundary 뒤로 이동시킵니다.

실무적 기준은 분명합니다. 작업이 느리고, retry 가능하며, 운영적으로 구별되어야 한다면, 메인 플로의 또 다른 synchronous callback보다 queue가 더 적합할 가능성이 큽니다.
