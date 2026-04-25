<!-- packages: @fluojs/cron, @fluojs/redis -->
<!-- project-state: FluoShop v2.1.0 -->

# Chapter 12. Scheduling and Distributed Locks

이 장은 FluoShop에 시간 기반 작업을 도입하고, queue와 구분되는 scheduling boundary를 설계하는 방법을 설명합니다. Chapter 11에서 이미 발생한 일을 background job으로 넘겼다면, 이제는 정해진 시각과 주기에 맞춰 distributed lock까지 포함한 작업을 운영 안전하게 실행합니다.

## Learning Objectives
- scheduler가 event나 queue와 다른 시작 조건을 가진다는 점을 이해합니다.
- `CronModule.forRoot()`로 cron, interval, timeout 작업을 등록하는 방법을 익힙니다.
- multi-instance 환경에서 distributed locking이 왜 필요한지 설명합니다.
- lock TTL과 named Redis client가 운영 신뢰성에 미치는 영향을 정리합니다.
- runtime registry를 통해 dynamic scheduling을 다뤄야 하는 상황을 분석합니다.
- bounded shutdown이 장시간 실행 작업과 배포 안정성을 어떻게 함께 지키는지 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11 완료.
- Redis coordination과 time-based job 실행 개념에 대한 기초 이해.
- multi-instance deployment와 graceful shutdown 운영 감각.

## 12.1 Why FluoShop needs scheduling

v2.1.0 시점의 FluoShop은 이미 command, event, saga, queued job에 반응할 수 있습니다. 그래도 일부 작업은 request나 새 domain event에서 시작되지 않습니다. 시간 자체가 시작 조건입니다. 예시는 다음과 같습니다.

- 매분 unpaid reservation 만료 처리
- 매시간 marketplace settlement file 정산
- 매일 밤 abandoned upload artifact 정리
- startup 이후 delayed warm-up task 실행
- external fulfillment partner를 고정 interval로 polling

이 작업들은 scheduling concern입니다. 사용자가 보낸 one-time command로 자연스럽게 표현되지 않습니다. 애플리케이션이 여러 인스턴스로 실행될 때는 중복 실행을 막는 운영 안전장치도 필요합니다.

## 12.2 Cron module wiring

README는 `CronModule.forRoot(...)`를 registration entrypoint로 문서화합니다. fluo는 cron expression, fixed interval, one-time timeout을 지원합니다.

```typescript
import { Module } from '@fluojs/core';
import { CronModule } from '@fluojs/cron';

@Module({
  imports: [CronModule.forRoot()],
  providers: [ReservationExpiryService, SettlementService],
})
export class SchedulingModule {}
```

설계는 이전 장들과 일관됩니다. module boundary에서 패키지를 등록하고, provider 위의 decorator로 scheduled behavior를 표현합니다. lifecycle management는 손수 작성한 bootstrap glue가 아니라 framework package의 책임입니다.

## 12.3 Cron, interval, and timeout flows

패키지는 세 가지 주요 scheduling shape를 노출합니다. `@Cron`은 calendar-style schedule, `@Interval`은 fixed-rate 반복 작업, `@Timeout`은 startup 이후 한 번 실행되는 delayed work를 위한 도구입니다. FluoShop은 세 형태를 모두 사용합니다.

### 12.3.1 Reservation expiry cron

미결제 reservation은 정기적으로 만료되어야 합니다. 이는 자연스러운 cron task입니다. 사용자의 요청이 들어올 때마다 오래된 예약을 검사하면 응답 경로가 불필요하게 무거워지므로, 시간 기반 정리가 별도의 일정으로 분리되는 편이 더 명확합니다.

```typescript
import { Cron, CronExpression } from '@fluojs/cron';

export class ReservationExpiryService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'checkout.expire-reservations' })
  async expireStaleReservations() {
    await this.reservations.expireOlderThanMinutes(15);
  }
}
```

이는 비즈니스 규칙에 연결된 time-based maintenance입니다. schedule은 behavior contract의 일부입니다. 몇 분마다 실행되는지는 단순한 운영 설정이 아니라 재고가 얼마나 오래 묶일 수 있는지를 정하는 정책이기도 합니다.

### 12.3.2 Startup timeout and periodic polling

어떤 작업은 boot 직후 일정 시간이 지난 뒤 실행되어야 합니다. 예를 들어 FluoShop은 startup 5초 뒤에 초기 cache warm-up이나 configuration sync를 수행할 수 있습니다. 다른 작업은 15초마다 partner API를 polling할 수 있습니다. 이런 흐름은 자연스럽게 `@Timeout`과 `@Interval`에 매핑됩니다. 중요한 점은 fluo가 이를 bootstrap code 곳곳에 흩어진 즉흥적인 `setTimeout`, `setInterval` 호출이 아니라 first-class scheduling concept로 취급한다는 점입니다.

## 12.4 Distributed locking across multiple instances

README는 distributed mode를 핵심 production feature로 강조합니다. 여러 애플리케이션 인스턴스가 같은 scheduled task를 실행할 때, FluoShop은 대개 한 인스턴스만 해당 주기의 작업을 수행하길 원합니다. 이 책임을 Redis-backed distributed locking이 맡습니다.

```typescript
import { Module } from '@fluojs/core';
import { CronModule } from '@fluojs/cron';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    CronModule.forRoot({
      distributed: {
        enabled: true,
        keyPrefix: 'fluo:cron:lock',
        lockTtlMs: 30_000,
      },
    }),
  ],
})
export class DistributedSchedulingModule {}
```

이는 serious deployment에서 선택적 세부사항이 아닙니다. distributed locking이 없으면 모든 인스턴스가 같은 reservation을 만료시키고, 같은 reconciliation을 실행하고, 같은 downstream job을 enqueue할 수 있습니다. 이는 데이터 정확성 문제이자 인프라 비용 문제로 이어질 수 있습니다.

### 12.4.1 The lock flow in FluoShop

v2.1.0에서 distributed cron flow는 다음과 같습니다.

1. 여러 FluoShop 인스턴스가 같은 schedule boundary에 도달합니다.
2. 각 인스턴스가 named job에 대한 Redis lock을 획득하려고 시도합니다.
3. 한 인스턴스가 승리하고 task를 실행합니다.
4. 나머지는 그 주기의 실행을 건너뜁니다.
5. 승리한 인스턴스는 task가 아직 active한 동안 lock을 갱신합니다.
6. 실행이 끝나면 lock이 만료되거나 해제됩니다.

이 패턴은 설명하기 쉽습니다. 이는 좋은 신호입니다. 분산 coordination은 incident 상황에서도 운영자가 추론할 수 있을 만큼 명시적이어야 합니다.

## 12.5 Lock TTL and named Redis clients

README는 중요한 경계를 설정합니다. `distributed.lockTtlMs`는 `1_000ms` 이상이어야 합니다. fluo는 최소 경계를 검증하고, TTL이 만료되기 전에 lock을 갱신합니다. 이 조건은 FluoShop 팀에 두 가지를 알려 줍니다. 첫째, lock duration은 실제 운영 파라미터입니다. 둘째, 지나치게 작은 값은 영리한 최적화가 아니라 신뢰성 위험입니다. 패키지는 non-default Redis connection을 위한 `distributed.clientName`도 지원합니다. lock traffic을 cache나 queue traffic과 분리해야 할 때 필요한 옵션입니다.

## 12.6 Dynamic scheduling at runtime

README는 runtime management를 위한 `SCHEDULING_REGISTRY`도 문서화합니다. 따라서 FluoShop은 compile-time schedule에만 묶이지 않습니다. 일부 job은 runtime에 생성, 교체, 제거될 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@fluojs/cron';

@Inject(SCHEDULING_REGISTRY)
export class CampaignWindowService {
  constructor(private readonly registry: SchedulingRegistry) {}

  scheduleFlashSaleWindow() {
    this.registry.addCron('campaign.flash-sale.close', '0 23 * * *', async () => {
      await this.campaigns.closeFlashSale();
    });
  }
}
```

이 기능은 강력한 만큼 신중하게 써야 합니다. Dynamic schedule은 비즈니스 타이밍이 실제로 runtime에 바뀔 때 가장 적합합니다. 평범한 static maintenance task를 registry call 뒤에 숨기라는 뜻은 아닙니다.

## 12.7 Bounded shutdown

README에서 가장 실용적인 내용 중 하나는 shutdown에 관한 부분입니다. `CronModule`은 애플리케이션 shutdown 중 active task execution을 drain하지만, bounded timeout까지만 기다립니다. 문서화된 기본값은 `10_000ms`입니다. 그 이후에는 fluo가 warning을 남기고 shutdown을 계속 진행합니다. 이는 운영적으로 성숙한 선택입니다. 하나의 hung scheduler task가 process termination을 영원히 막아서는 안 되기 때문입니다.

### 12.7.1 Why this matters in FluoShop

rolling deploy 도중 nightly settlement reconciliation이 느린 partner API와 통신하고 있다고 가정해 봅니다. bounded shutdown이 없다면 하나의 stuck task가 instance turnover를 무기한 지연시킬 수 있습니다. bounded shutdown이 있으면 운영자는 통제권을 유지합니다. 해당 task에는 recovery logic이 필요할 수 있지만, 플랫폼 자체가 redeploy 불가능한 상태가 되지는 않습니다.

## 12.8 Cron and queue together

Scheduling과 queue는 함께 사용할 때 가장 좋은 경우가 많습니다. Cron task는 보통 작업이 시작되어야 한다는 판단만 맡는 편이 좋습니다. Queue는 무거운 실행을 소유하는 데 적합합니다. 예를 들어 nightly cron은 오래된 marketplace export를 찾고 seller마다 repair job 하나씩 enqueue할 수 있습니다. 그러면 scheduler는 작게 유지되고 background throughput은 통제 가능해집니다. retry를 위한 더 안전한 경계도 생깁니다. Cron은 언제 시작할지를 답하고, Queue는 어떻게 대규모로 처리할지를 답합니다. 이 조합은 FluoShop에서 가장 유용한 운영 패턴 중 하나입니다.

## 12.9 A full cron and distributed-lock flow in FluoShop

v2.1.0에서 reservation expiry path는 이제 다음과 같습니다.

1. 매분 모든 애플리케이션 인스턴스가 `checkout.expire-reservations`에 도달합니다.
2. distributed locking이 오직 한 인스턴스만 expiration run을 수행하도록 보장합니다.
3. task가 overdue reservation을 찾고 만료시킵니다.
4. 비용이 큰 cleanup이 있으면 후속 job을 enqueue합니다.
5. resulting event로부터 read model이 업데이트됩니다.
6. 앱이 shutdown 중이면 scheduler는 설정된 timeout 안에서만 active work를 drain합니다.

이 흐름은 Part 2의 설계가 쌓아 온 목표와 맞닿아 있습니다. Event-driven architecture는 사용자 액션에 반응하는 것만을 뜻하지 않습니다. 분산 배포에서 신뢰할 수 있는 time-driven coordination도 포함합니다.

## 12.10 FluoShop v2.1.0 progression

이 장의 끝에서 FluoShop은 비즈니스 사실과 시간 자체에 모두 반응할 수 있습니다. 이는 중요한 아키텍처 이정표입니다. 플랫폼은 이제 event를 통한 immediate reaction, saga를 통한 orchestrated reaction, queue를 통한 deferred reaction, scheduling을 통한 periodic 또는 delayed reaction을 모두 모델링할 수 있습니다. Distributed lock는 multi-instance execution을 예측 가능하게 유지합니다. Bounded shutdown은 operations를 통제 가능한 상태로 유지합니다. 둘을 합치면 실제 production 조건에서 시스템 신뢰성이 높아집니다.

## 12.11 Summary

- `@fluojs/cron`은 decorator-based scheduling을 통해 FluoShop에 cron expression, interval, timeout을 제공합니다.
- Redis-backed distributed locking은 multi-instance deployment에서 scheduled task를 한 인스턴스만 실행하도록 보장합니다.
- `distributed.lockTtlMs`와 optional named Redis client는 신뢰성을 좌우하는 운영 설정입니다.
- `SCHEDULING_REGISTRY`를 통한 dynamic scheduling은 비즈니스가 실제로 runtime-created task를 필요로 할 때 지원됩니다.
- bounded shutdown은 hung scheduled task 하나가 process termination을 영원히 막지 못하게 합니다.

실무적 교훈은 scheduling이 시작하기는 쉽지만 잘 운영하기는 어렵다는 점입니다. fluo는 developer-friendly decorator에 명시적인 distributed-lock 및 shutdown behavior를 결합해 production에서도 다룰 수 있는 형태로 만듭니다.
