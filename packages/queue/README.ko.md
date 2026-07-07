# @fluojs/queue

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 Redis 기반 분산 작업 처리 패키지입니다. 데코레이터 기반의 워커 탐색, JSON-safe 작업 직렬화, 그리고 수명 주기 관리 기능을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/queue @fluojs/redis
```

## 사용 시점

- 실행 시간이 길거나 리소스를 많이 사용하는 작업을 백그라운드에서 처리해야 할 때.
- 이메일 발송, 이미지 처리 등 비용이 큰 작업을 요청-응답 주기와 분리하고 싶을 때.
- 재시도 로직, 백오프(Backoff), 데드 레터(Dead-letter) 처리가 포함된 분산 큐가 필요할 때.

## 빠른 시작

### 1. 작업(Job) 및 워커(Worker) 정의

작업 클래스를 만들고, 이를 처리할 클래스에 `@QueueWorker` 데코레이터를 붙입니다.

```typescript
import { QueueWorker } from '@fluojs/queue';

export class ProcessOrderJob {
  constructor(public readonly orderId: string) {}
}

@QueueWorker(ProcessOrderJob, { attempts: 3, backoff: { type: 'fixed', delayMs: 5000 } })
export class OrderWorker {
  async handle(job: ProcessOrderJob) {
    console.log(`주문 처리 중: ${job.orderId}`);
    // 처리 로직 작성
  }
}
```

### 2. 모듈 등록 및 작업 추가

`QueueModule`을 등록하고 `QueueLifecycleService`를 주입받아 작업을 큐에 추가합니다.

`QueueModule.forRoot(...)`는 애플리케이션 수준 큐 등록을 위한 지원되는 루트 엔트리포인트입니다.

```typescript
import { Module, Inject } from '@fluojs/core';
import { QueueModule, QueueLifecycleService } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

@Inject(QueueLifecycleService)
export class OrderService {
  constructor(private readonly queue: QueueLifecycleService) {}

  async placeOrder(id: string) {
    await this.queue.enqueue(new ProcessOrderJob(id));
  }
}

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [OrderService, OrderWorker],
})
export class AppModule {}
```

## 일반적인 패턴

### 이름 있는 Redis 클라이언트

`clientName`을 생략하면 애플리케이션의 기본 `@fluojs/redis` 클라이언트를 계속 사용합니다. 큐가 기본 Redis 대신 다른 연결을 사용해야 한다면 `RedisModule.forRoot({ name, ... })`로 등록한 이름을 `clientName`에 지정하세요.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

`@fluojs/queue`는 애플리케이션 부트스트랩 중 해당 Redis 클라이언트를 조회한 뒤 BullMQ용으로 큐가 소유하는 duplicate 연결을 만듭니다. 공유 `@fluojs/redis` 클라이언트의 소유권은 `RedisModule`에 남아 있으며, Queue는 자신이 만든 BullMQ duplicate 연결만 닫습니다. 이 duplicate 연결은 BullMQ Worker가 요구하는 `maxRetriesPerRequest: null` 설정으로 구성되어 시작 동작이 BullMQ의 실제 런타임 제약과 일치합니다.

`QueueModule.forRoot({ global: false })`를 사용하면 각 queue 등록은 해당 `QueueModule.forRoot(...)` 호출을 가져온 동일한 module tree에서 도달할 수 있는 worker만 탐색합니다. 서로 다른 scoped queue feature module은 서로 분리된 상태를 유지하며, Redis client provider도 같은 module tree 안에서 도달 가능해야 합니다.

### 범위가 지정된 Queue 등록

애플리케이션이 non-global queue 등록을 둘 이상 가져오면 명시적인 `scope`를 사용하세요. Scope 이름은 trim되며, 비어 있으면 안 되고, 컴파일된 module graph 안에서 고유해야 합니다. `QueueModule.forRoot({ global: false })`를 두 번 가져오는 duplicate default scoped registration이나 `QueueModule.forRoot({ global: false, scope: 'jobs' })`를 두 번 가져오는 duplicate explicit scope는 bootstrap 중 결정적인 오류로 실패합니다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { getQueueLifecycleServiceToken, getQueueToken, QueueModule, type Queue } from '@fluojs/queue';

const EMAIL_QUEUE = getQueueToken('email');
const EMAIL_QUEUE_LIFECYCLE = getQueueLifecycleServiceToken('email');

@Inject(EMAIL_QUEUE)
export class EmailPublisher {
  constructor(private readonly queue: Queue) {}
}

@Module({
  imports: [QueueModule.forRoot({ global: false, scope: 'email' })],
  providers: [EmailPublisher, EmailWorker],
})
export class EmailQueueModule {}
```

애플리케이션에 기본 queue 등록이 하나뿐이고 compatibility `QUEUE` 토큰이나 `QueueLifecycleService` 클래스를 직접 주입할 때만 `scope`를 생략하세요. Scoped registration에서는 각 feature module이 기본 compatibility token 대신 자신의 queue instance를 resolve하도록 `getQueueToken(scope)` 또는 `getQueueLifecycleServiceToken(scope)`를 주입하세요.

### 부트스트랩 및 종료 수명 주기

Queue는 애플리케이션 부트스트랩 중 worker를 탐색하고 Queue가 소유하는 BullMQ 리소스를 만들지만, BullMQ worker processor는 runtime이 전체 애플리케이션 bootstrap/readiness sequence 완료를 표시한 뒤에만 시작합니다. 다른 `onApplicationBootstrap()` hook에서 enqueue한 job은 Queue 서비스가 초기화된 뒤에는 받을 수 있으며, processor는 뒤에 실행되는 async bootstrap hook이나 애플리케이션 readiness보다 앞서 실행되지 않고 bootstrap-ready handoff 이후 실행됩니다. Queue status는 해당 BullMQ processor가 실제로 시작될 때까지 degraded readiness를 보고합니다. Processor 시작에 실패하면 lifecycle이 `failed`로 이동하고, status snapshot은 worker를 ready로 숨기지 않고 실패를 노출합니다.

애플리케이션 종료가 시작되면 Queue는 상태를 `stopping`으로 바꾸고 새 enqueue를 거부한 다음 Queue 소유 worker/queue/connection을 닫고 pending dead-letter write를 drain합니다. Worker 종료는 `workerShutdownTimeoutMs`로 bounded wait를 적용하므로 끝나지 않는 active processor가 애플리케이션 종료를 무기한 막을 수 없습니다. Timeout이 지나면 Queue는 로그를 남기고 BullMQ worker에 force-close를 요청한 뒤 나머지 리소스 정리를 계속합니다.

### 분산 재시도 (Distributed Retries)

워커 설정에서 최대 시도 횟수와 백오프 전략을 지정하여 일시적인 실패를 자동으로 처리할 수 있습니다.

```typescript
@QueueWorker(MyJob, { 
  attempts: 5, 
  backoff: { type: 'exponential', delayMs: 1000 } 
})
```

### 데드 레터 처리 (Dead-Letter Handling)

워커가 모든 재시도를 소진하면 Queue는 Redis의 데드 레터 리스트(`fluo:queue:dead-letter:<jobName>`)에 레코드를 append하여, 나중에 수동으로 확인하거나 복구할 수 있게 합니다. BullMQ job 자체를 이동시키는 것은 아닙니다.

`QueueModule.forRoot()`는 기본적으로 작업별 최근 데드 레터 엔트리 `1_000`개만 유지합니다. 무제한 보관이 꼭 필요하면 `defaultDeadLetterMaxEntries: false`로 opt-out 하고, 더 엄격한 운영 예산이 필요하면 더 작은 양의 정수를 지정하세요.

Job은 JSON으로 직렬화 가능한 plain object여야 합니다. Queue는 enqueue 전에 job payload를 직렬화하고, worker 측에서 job prototype을 다시 입힙니다.

저수준 provider 조합을 루트 barrel API의 일부가 아니라 내부 구현 세부사항으로 취급해야 합니다. 저수준 provider helper는 문서화된 루트 barrel 계약에 포함되지 않습니다.

## 공개 API 개요

### 핵심 구성 요소
- `QueueModule`: 큐 기능을 위한 기본 모듈입니다.
- `QueueModule.forRoot(options)`: 애플리케이션 수준 큐 등록을 구성합니다.
- `QueueLifecycleService`: 작업을 큐에 추가하고 lifecycle/status snapshot을 생성(`enqueue(job)`, `createPlatformStatusSnapshot()`)하기 위한 기본 서비스입니다.
- `@QueueWorker(JobClass, options?)`: 특정 작업을 처리할 핸들러를 지정하는 데코레이터입니다.
- `QUEUE`: queue facade를 위한 호환성 주입 토큰입니다.
- `getQueueToken(scope?)`: Queue facade token helper입니다. `scope`를 생략하면 기본 `QUEUE` token을 반환하고, 비어 있지 않은 scope는 해당 scoped registration의 facade token을 반환합니다.
- `getQueueLifecycleServiceToken(scope?)`: Scoped queue registration을 위한 lifecycle service token helper입니다.
- `createQueuePlatformStatusSnapshot(...)`: lifecycle/readiness diagnostics를 위한 status snapshot helper입니다.


### 타입
- `Queue`: 애플리케이션 코드와 `QUEUE` 토큰에서 사용하는 `enqueue(job)` 호환성 facade입니다.
- `QueueJobType`: job payload class를 식별하고 rehydrate하는 데 사용하는 constructor 타입입니다.
- `QueueModuleOptions`: 전역 큐 설정(`global`, clientName, 기본 시도 횟수, `defaultBackoff`, 동시성, 전송률 제한, dead-letter retention 등)을 위한 타입입니다.
- `QueueWorkerOptions`: 개별 작업 설정(시도 횟수, 백오프, 동시성, jobName, 전송률 제한 등)을 위한 타입입니다.
- `QueueBackoffType`: 지원되는 retry backoff strategy 이름(`fixed`, `exponential`)입니다.
- `QueueBackoffOptions`: 재시도 백오프 설정(`type`, `delayMs`)을 위한 타입입니다.
- `QueueRateLimiterOptions`: worker 수준 distributed rate limiter 설정(`max`, `duration`)을 위한 타입입니다.
- `QueueLifecycleState`: Queue status adapter가 보고하는 lifecycle state(`idle`, `starting`, `started`, `stopping`, `stopped`, `failed`)입니다.
- `QueueStatusAdapterInput`: `createQueuePlatformStatusSnapshot(...)`에 전달하는 normalized queue metrics와 worker-start diagnostics 타입입니다.
- `QueuePlatformStatusSnapshot`: status helper와 `QueueLifecycleService.createPlatformStatusSnapshot()`이 반환하는 Queue 전용 readiness, health, ownership, detail snapshot 타입입니다.

`QueueModuleOptions`에는 `workerShutdownTimeoutMs`, `defaultDeadLetterMaxEntries` 같은 lifecycle 및 dead-letter retention 설정도 포함됩니다.

`QueueModuleOptions` 수명 주기/status 설정:

- `global`: queue module 등록을 global로 만들지 여부입니다. 기본값은 `true`이며, queue provider를 importing module graph 안에만 scope하고 싶으면 `false`를 지정합니다.
- `scope`: 고유한 non-empty queue registration scope입니다. 하나의 앱에 non-global queue registration이 여러 개 있으면 필요합니다.
- `workerShutdownTimeoutMs`: 종료 중 active worker processor를 기다리는 최대 시간입니다. 시간이 지나면 BullMQ worker를 force-close합니다. 기본값은 `30_000`입니다.
- `defaultDeadLetterMaxEntries`: job별로 유지할 dead-letter record의 최대 개수이며, trimming을 끄려면 `false`를 지정합니다. 기본값은 `1_000`입니다.

`QueueLifecycleService.createPlatformStatusSnapshot()`은 `createQueuePlatformStatusSnapshot(...)`과 같은 공개 snapshot 계약을 사용합니다. Queue가 `started`에 도달하고 탐색된 모든 BullMQ worker processor가 시작된 뒤에만 readiness를 `ready`로 보고합니다. Processor가 아직 pending인 `started` resource와 `starting`은 degraded readiness, `stopping`/`stopped`는 not-ready, worker-start failure는 `workerStartFailures`와 `lastWorkerStartFailure` details를 포함해 not-ready/unhealthy로 보고합니다. Snapshot details에는 Redis dependency id, lifecycle state, ready/discovered worker 수, pending dead-letter write 수, dead-letter drain timeout, `workerShutdownTimeoutMs`가 포함됩니다.

singleton `@QueueWorker()` provider/controller만 등록됩니다. request/transient worker는 discovery 중 건너뜁니다.

## 관련 패키지

- `@fluojs/redis`: 작업 데이터 저장을 위한 필수 백엔드 패키지입니다.
- `@fluojs/cron`: 정해진 시간에 반복 실행되어야 하는 백그라운드 작업을 위한 패키지입니다.

## 예제 소스

- `packages/queue/src/module.test.ts`: 워커 탐색 및 작업 추가 테스트 예제.
- `packages/queue/src/public-surface.test.ts`: 공개 API 계약 검증 예제.
- `packages/queue/src/status.test.ts`: Queue lifecycle status snapshot 테스트 예제.
