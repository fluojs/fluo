<!-- packages: @fluojs/queue, @fluojs/redis -->
<!-- project-state: FluoShop v2.0.0 -->

# 11. Background Jobs and Queues

CQRS와 saga는 FluoShop을 더 명시적으로 만들었습니다. 하지만 모든 단계를 빠르게 만들지는 못했습니다. 어떤 작업은 본질적으로 customer-facing request path 안에서 처리하면 안 됩니다. 바로 여기서 queue가 등장합니다. `@fluojs/queue` 패키지는 FluoShop에 retries, backoff, dead-letter handling을 갖춘 distributed background job processing을 제공합니다. 이 장은 느리거나 실패 가능성이 높은 작업을 더 명확한 운영 경계 뒤로 옮기는 이야기입니다. 그 경계는 성능만을 위한 것이 아닙니다. 제어를 위한 것이기도 합니다. Queued work는 retry할 수 있고, rate-limit할 수 있으며, 반복 실패 시 inspect할 수 있습니다. 이것은 같은 로직을 API request 안에 묻어 두는 것과 매우 다릅니다.

## 11.1 Why FluoShop needs queues

v2.0.0이 되면 FluoShop은 이미 domain event를 publish하고 multi-step workflow를 coordination합니다. 하지만 그 후속 동작 중 일부는 여전히 immediate in-process handling에 적합하지 않습니다.

예시는 다음과 같습니다.

- 대량 이메일 batch 전송
- invoice PDF 생성
- marketplace catalog sync 전송
- warehouse label printing retry
- expensive read projection 재구축

이 작업들은 느릴 수 있습니다. 불안정한 원격 시스템에 의존할 수 있습니다. 여러 번의 retry attempt가 필요할 수 있습니다. 원래의 web request보다 몇 분 더 오래 지속될 수도 있습니다. Queue는 이 작업에 적절한 집을 제공합니다.

## 11.2 Queue wiring in fluo

README는 `QueueModule.forRoot(...)`를 지원되는 root entrypoint로 문서화합니다.

Queue 패키지는 persistence와 coordination을 위해 Redis에 의존합니다.

즉, FluoShop은 먼저 `@fluojs/redis`를 연결하고 그다음 queue support를 등록합니다.

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

이 계약은 익숙한 형태를 유지합니다. Module이 패키지를 등록합니다. Worker는 decorator를 통해 discovery됩니다. 애플리케이션은 injected lifecycle service를 통해 job을 enqueue합니다.

## 11.3 Jobs and workers

Job은 직렬화된 작업 단위입니다. Worker는 그 job을 어떻게 처리할지 소유합니다. 이 분리는 단순하지만 중요합니다. job payload는 durable handoff입니다. worker 구현은 그 경계 뒤에서 진화할 수 있습니다.

### 11.3.1 Invoice generation job

Invoice PDF 생성은 전형적인 queue task입니다.

checkout confirmation path 안에서 처리하기에는 너무 느립니다.

file storage나 rendering outage처럼 일시적인 이유로 실패할 수도 있습니다.

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

worker option은 설계의 일부입니다. retry와 backoff는 사후 보정이 아닙니다. 비즈니스가 transient failure를 얼마나 견뎌야 하는지를 표현합니다.

### 11.3.2 Enqueue after a business event

FluoShop은 domain event나 saga step 뒤에서 job을 enqueue하는 경우가 많습니다.

이렇게 하면 비즈니스 액션을 잃지 않으면서 request path를 짧게 유지할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { QueueLifecycleService } from '@fluojs/queue';

export class BillingProjectionHandler {
  @Inject(QueueLifecycleService)
  private readonly queue: QueueLifecycleService;

  async onShipmentDispatched(orderId: string) {
    await this.queue.enqueue(new GenerateInvoiceJob(orderId));
  }
}
```

domain flow는 명시적으로 유지됩니다. 느린 작업은 out of band로 이동합니다.

## 11.4 Retry and backoff strategy

queue README는 distributed retry와 backoff를 first-class feature로 강조합니다. 이것은 실제 운영 요구와 맞닿아 있습니다. FluoShop은 모든 원격 의존성이 안정적이라고 가정할 수 없습니다. 이메일 제공자는 일시적으로 실패합니다. 스토리지 시스템은 짧은 outage를 겪습니다. Marketplace API는 예고 없이 throttle할 수 있습니다. retry는 이런 조건 중 많은 부분에서 시스템이 자동으로 회복하게 해 줍니다. backoff는 outage가 즉시 retry storm으로 변하는 것을 막아 줍니다.

### 11.4.1 Fixed versus exponential backoff

fixed backoff는 예측하기 쉽습니다. exponential backoff는 고통받는 dependency에 더 친절한 경우가 많습니다. FluoShop은 remote system에 따라 선택해야 합니다. warehouse printer reconnect는 짧은 fixed delay를 견딜 수 있습니다. marketplace catalog push는 exponential backoff가 더 적합할 수 있습니다. 핵심은 retry policy를 모든 job에 무비판적으로 복사한 기본값으로 취급하지 않는 것입니다.

## 11.5 Dead-letter handling

모든 retry attempt 뒤에도 실패하는 job이 있습니다. 그렇다고 조용히 사라지게 해서는 안 됩니다. Queue 패키지는 이런 job을 `fluo:queue:dead-letter:<jobName>` 아래의 Redis dead-letter list로 옮깁니다. 덕분에 운영자는 무엇이 잘못됐는지 확인할 수 있는 durable place를 얻습니다. README는 기본 retention policy도 언급합니다. 별도 설정이 없으면 `QueueModule.forRoot()`는 job당 가장 최근 `1_000`개의 dead-letter entry를 유지합니다. 이것은 운영상 중요한 기본값입니다. 무한 성장을 막으면서도 최근 실패 증거를 보존합니다.

### 11.5.1 What FluoShop stores in dead letters

v2.0.0에서 dead letter는 integration-heavy work에서 특히 중요합니다. 예를 들어 failed invoice render, failed marketplace sync, failed bulk notification export가 여기에 해당합니다. 운영자는 실패를 안전하게 진단할 만큼 충분한 job payload context를 확보해야 합니다. 하지만 job body 안에 secret이나 불필요한 personal data를 채워 넣어서는 안 됩니다. Dead letter는 operational evidence입니다. 유용하면서도 bounded해야 합니다.

## 11.6 Named Redis clients and workload isolation

README는 non-default Redis registration을 위한 `clientName` 지원을 설명합니다. 이것은 queue traffic이 다른 Redis 기반 기능과 경쟁하면 안 될 때 유용합니다. FluoShop은 cache와 가벼운 coordination을 위해 기본 Redis client를 유지할 수 있습니다. background job에는 별도의 named Redis client를 전용으로 둘 수 있습니다.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

이것은 code-style trick이 아니라 deployment decision입니다. workload isolation은 noisy-neighbor effect를 줄일 수 있습니다. capacity planning도 더 쉽게 만들 수 있습니다.

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

이 경계는 PDF generation을 inline으로 수행하는 것보다 훨씬 낫습니다. 고객은 시의적절한 API 응답을 받습니다. 운영자는 통제된 failure model을 얻습니다. 시스템은 회복할 여지를 확보합니다.

## 11.8 Queue workers are not a second hidden application

팀은 때때로 불분명한 로직을 worker로 옮기고 그것을 아키텍처라고 부르는 실수를 합니다. FluoShop은 그 함정을 피해야 합니다. Worker는 hidden business ownership이 아니라 background execution을 소유해야 합니다. command side는 여전히 어떤 business step이 필요한지 결정해야 합니다. event side는 후속 동작이 왜 존재하는지 표현해야 합니다. Queue는 다른 질문에 답할 뿐입니다. 언제, 그리고 어떻게 느린 작업을 신뢰성 있게 처리할 것인가. 이 분리가 플랫폼을 이해 가능하게 유지합니다.

## 11.9 When to choose event handlers, sagas, or queues

이 시점에서 FluoShop은 셋 다 갖추고 있습니다. 따라서 선택 규칙이 중요합니다. reaction이 빠르고 로컬이면 ordinary event handler를 사용합니다. event가 비즈니스 워크플로의 다음 explicit command를 촉발해야 하면 saga를 사용합니다. 작업이 느리고, failure-prone하며, retryable하고, initiating request와 운영적으로 분리되어야 하면 queue를 사용합니다. 이 도구들은 서로 보완적입니다. 경쟁 관계가 아닙니다. 대부분의 성숙한 시스템은 셋 다 필요로 합니다.

## 11.10 FluoShop v2.0.0 progression

v2.0.0으로 넘어가는 것은 FluoShop에 의미 있는 단계입니다. 플랫폼은 더 이상 event-aware에만 머무르지 않습니다. 이제 background work를 first-class concern으로 운영적으로도 인식합니다. 그래서 downstream work가 안전하게 이어지는 동안 fulfillment는 responsive하게 유지될 수 있습니다. 실패는 즉시 support ticket가 되는 대신 retry될 수 있습니다. 운영자는 로그에서 잃어버린 상태를 재구성하는 대신 durable dead letter를 inspect할 수 있습니다. 이것이 queue가 event-driven architecture에 추가하는 것입니다. 지연된 작업을 명시적으로 관리되는 subsystem으로 바꿉니다.

## 11.11 Summary

- `@fluojs/queue`는 FluoShop에 worker discovery와 lifecycle-managed enqueueing을 갖춘 Redis-backed background job processing을 제공합니다.
- job은 invoice generation, email batch, catalog sync처럼 느리거나 failure-prone한 작업을 위한 durable handoff입니다.
- retry attempt와 backoff strategy는 무비판적으로 복사하지 말고 workload별로 선택해야 합니다.
- dead-letter list는 bounded retention policy 아래에서 반복 실패 job을 보존하므로 운영자가 inspect할 수 있습니다.
- FluoShop v2.0.0은 이제 post-order의 expensive work를 customer request path를 늘리는 대신 queue boundary 뒤로 이동시킵니다.

실용적인 교훈은 단순합니다. 작업이 느리고, retry 가능하며, 운영적으로 구별된다면, 메인 플로의 또 다른 synchronous callback보다 queue가 더 어울릴 가능성이 큽니다.
