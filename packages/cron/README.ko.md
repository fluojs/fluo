# @fluojs/cron

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 데코레이터 기반 스케줄링 패키지입니다. 앱 라이프사이클에 맞춰 시작/종료를 관리하고, Redis 기반 분산 락(Distributed Locking) 기능을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [분산 락 사용하기](#분산-락-사용하기)
  - [동적 스케줄링](#동적-스케줄링)
  - [제한된 종료](#제한된-종료)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/cron croner
```

## 사용 시점

- 정기적인 백그라운드 작업(예: 데이터베이스 정리, 리포트 생성)이 필요할 때 사용합니다.
- 표준 Cron 표현식을 사용하여 작업을 예약하고 싶을 때 적합합니다.
- 다중 인스턴스 환경에서 특정 작업이 한 번에 하나의 인스턴스에서만 실행되도록 보장해야 할 때(분산 락) 사용합니다.
- 일회성 지연 작업(Timeout)이나 고정된 주기의 반복 작업(Interval)이 필요할 때 사용합니다.

## 빠른 시작

`CronModule`을 등록하고 데코레이터를 사용하여 메서드를 스케줄링합니다.

애플리케이션 모듈의 스케줄링 등록은 `CronModule.forRoot(...)`로 구성합니다.
Cron 표현식은 다섯 필드(`minute hour day month weekday`) 또는 여섯 필드(`second minute hour day month weekday`)를 사용할 수 있습니다. 내장 `CronExpression` preset은 sub-minute 정밀도가 필요할 때 여섯 필드 표현식을 사용합니다. Cron task는 application bootstrap 이후에만 시작되고, 이미 시작된 registry에 동적으로 등록한 cron task는 등록 시점에 시작되며, fluo는 `timezone`과 no-overlap 보호를 scheduler에 전달해 같은 task instance가 자기 자신과 겹쳐 실행되지 않게 합니다.

```typescript
import { Module } from '@fluojs/core';
import { CronModule, Cron, CronExpression, Interval, Timeout } from '@fluojs/cron';

class BillingService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices() {
    console.log('송장 정리 중...');
  }

  @Interval(15_000) // 15초마다
  async pollStatus() {
    console.log('상태 폴링 중...');
  }

  @Timeout(5_000) // 시작 5초 후 1회 실행
  async initialSync() {
    console.log('초기 동기화 실행 중...');
  }
}

@Module({
  imports: [CronModule.forRoot()],
  providers: [BillingService],
})
class AppModule {}
```

## 공통 패턴

### 분산 락 사용하기

여러 서버 인스턴스에서 스케줄링된 작업이 동시에 실행되는 것을 방지하려면 분산 모드를 활성화하세요. 이 기능은 `@fluojs/redis`가 필요합니다.

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
class AppModule {}
```

`distributed.clientName`을 생략하면 위의 기본 Redis 등록을 계속 사용합니다. 분산 락에 기본 Redis가 아닌 다른 연결을 쓰려면 `RedisModule.forRoot({ name, ... })`로 등록한 이름을 `distributed.clientName`에 지정하세요.

`distributed.lockTtlMs`는 `1_000ms` 이상이어야 합니다. fluo는 최소 지원 경계인 `1_000ms`를 포함해 TTL이 만료되기 전에 Redis 락을 갱신합니다.

각 scheduler instance는 platform-neutral 기본 `distributed.ownerId`를 사용합니다. 배포 환경에 더 강한 stable-owner 규칙이 있을 때만 `distributed.ownerId`를 명시적으로 지정하세요. Lock release는 task 실행 뒤 `finally` 경로에서 수행됩니다. Redis release가 실패하면 fluo는 status snapshot의 local ownership을 유지하고 shutdown 중 다시 release를 시도합니다. Redis가 다른 owner의 key라고 응답하면 fencing이 이미 다른 곳으로 이동한 것이므로 local ownership을 정리합니다. Redis TTL과 renewal timing은 drift 영향을 받는 coordination primitive이지 강한 fencing token 자체는 아니므로, stale work가 위험한 long-running job은 idempotent하게 작성하고 application-level fencing을 함께 사용해야 합니다.

```typescript
@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRoot({ name: 'locks', host: 'localhost', port: 6380 }),
    CronModule.forRoot({
      distributed: {
        clientName: 'locks',
        enabled: true,
        keyPrefix: 'fluo:cron:lock',
        lockTtlMs: 30_000,
      },
    }),
  ],
})
class MultiRedisCronModule {}
```

### 동적 스케줄링

`SCHEDULING_REGISTRY`를 사용하여 런타임에 작업을 관리할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@fluojs/cron';

@Inject(SCHEDULING_REGISTRY)
class TaskManager {
  constructor(private readonly registry: SchedulingRegistry) {}

  addNewTask() {
    this.registry.addCron('dynamic-job', '0 * * * *', () => {
      console.log('동적 작업 실행 중!');
    });
  }

  stopTask() {
    this.registry.remove('dynamic-job');
  }
}
```

Registry는 `addCron`, `addInterval`, `addTimeout`, `remove`, `enable`, `disable`, `get`, `getAll`, `updateCronExpression`을 제공합니다. Timeout task는 한 번 실행된 뒤 비활성화되지만 registry에는 남아 있어 의도적으로 다시 활성화할 수 있습니다.

### 제한된 종료

`CronModule`은 애플리케이션 종료 시 실행 중인 작업을 제한된 타임아웃 안에서 drain합니다. 따라서 하나의 hung task 때문에 프로세스 종료가 영원히 막히지 않습니다.

기본적으로 shutdown drain은 최대 `10_000ms` 동안 기다립니다. 이 시간이 지나면 스케줄러는 경고 로그를 남기고 hung task가 끝나기를 더 기다리지 않은 채 종료를 계속합니다. 분산 락을 사용하는 경우 아직 실행 중인 작업이 보유한 락은 timeout 시점에 즉시 해제하지 않습니다. 해당 작업이 정상적으로 끝날 때까지 락 소유권을 유지하거나, 프로세스가 종료된 뒤 Redis TTL로 만료되게 두어 원래 작업이 아직 실행 중인데 다른 노드가 같은 작업을 시작하지 않도록 합니다.

```typescript
@Module({
  imports: [
    CronModule.forRoot({
      shutdown: {
        timeoutMs: 5_000,
      },
    }),
  ],
})
class AppModule {}
```

singleton provider/controller만 스케줄링됩니다. Request-scoped 및 transient scheduled class는 경고와 함께 건너뜁니다.

## 공개 API 개요

### 모듈
- `CronModule.forRoot(options)`: 스케줄러를 설정하고 필요한 경우 분산 락을 활성화합니다.

### 데코레이터
- `@Cron(expression, options?)`: Cron 표현식을 사용하여 메서드를 예약합니다.
- `@Interval(ms, options?)`: 고정된 주기로 메서드를 실행합니다.
- `@Timeout(ms, options?)`: 일정 시간 지연 후 메서드를 한 번 실행합니다.

### 상수 및 토큰
- `CronExpression`: `EVERY_SECOND`, `EVERY_5_SECONDS`, `EVERY_30_SECONDS` 같은 sub-minute preset을 포함한 공통 Cron 패턴 객체입니다.
- `SCHEDULING_REGISTRY`: `SchedulingRegistry` 서비스를 위한 주입 토큰입니다.
- `normalizeCronModuleOptions(...)`: module option과 기본값을 정규화합니다.
- `createCronPlatformStatusSnapshot(...)`: health/readiness 통합을 위한 status snapshot을 생성합니다.
- 메타데이터 헬퍼와 심볼: `defineSchedulingTaskMetadata`, `defineCronTaskMetadata`, `getSchedulingTaskMetadata`, `getCronTaskMetadata`, `getSchedulingTaskMetadataEntries`, `getCronTaskMetadataEntries`, `schedulingMetadataSymbol`, `cronMetadataSymbol`.


## 관련 패키지

- `@fluojs/redis`: 분산 락 기능을 위해 필요합니다.
- `@fluojs/core`: DI 및 모듈 관리를 위해 필요합니다.
- `croner`: 내부 스케줄링 엔진입니다.

## 예제 소스

- `packages/cron/src/module.test.ts`: 데코레이터 및 모듈 라이프사이클에 대한 종합 테스트.
- `packages/cron/src/service.ts`: 런타임 스케줄링, registry, shutdown 동작.
- `packages/cron/src/status.test.ts`: status snapshot 동작.
- `packages/cron/src/distributed-lock-manager.ts`: Redis distributed lock 동작.
