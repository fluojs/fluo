# @fluojs/queue

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 Redis 기반 분산 작업 처리 패키지입니다. 데코레이터 기반의 워커 탐색, 자동 작업 직렬화, 그리고 수명 주기 관리 기능을 제공합니다.

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

`QueueModule.forRoot(...)`는 큐 등록을 위한 지원되는 루트 엔트리포인트입니다.

큐 등록은 `QueueModule.forRoot(...)`로 구성합니다.

```typescript
import { Module, Inject } from '@fluojs/core';
import { QueueModule, QueueLifecycleService } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [OrderWorker],
})
export class AppModule {}

export class OrderService {
  @Inject(QueueLifecycleService)
  private readonly queue: QueueLifecycleService;

  async placeOrder(id: string) {
    await this.queue.enqueue(new ProcessOrderJob(id));
  }
}
```

## 일반적인 패턴

### 이름 있는 Redis 클라이언트

`clientName`을 생략하면 애플리케이션의 기본 `@fluojs/redis` 클라이언트를 계속 사용합니다. 큐가 기본 Redis 대신 다른 연결을 사용해야 한다면 `RedisModule.forRootNamed(...)`로 등록한 이름을 `clientName`에 지정하세요.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

### 분산 재시도 (Distributed Retries)

워커 설정에서 최대 시도 횟수와 백오프 전략을 지정하여 일시적인 실패를 자동으로 처리할 수 있습니다.

```typescript
@QueueWorker(MyJob, { 
  attempts: 5, 
  backoff: { type: 'exponential', delayMs: 1000 } 
})
```

### 데드 레터 처리 (Dead-Letter Handling)

모든 재시도에 실패한 작업은 Redis의 데드 레터 리스트(`fluo:queue:dead-letter:<jobName>`)로 자동 이동되어, 나중에 수동으로 확인하거나 복구할 수 있습니다.

`QueueModule.forRoot()`는 기본적으로 작업별 최근 데드 레터 엔트리 `1_000`개만 유지합니다. 무제한 보관이 꼭 필요하면 `defaultDeadLetterMaxEntries: false`로 opt-out 하고, 더 엄격한 운영 예산이 필요하면 더 작은 양의 정수를 지정하세요.

저수준 provider 조합을 루트 barrel API의 일부가 아니라 내부 구현 세부사항으로 취급해야 합니다. 저수준 provider helper는 문서화된 루트 barrel 계약에 포함되지 않습니다.

## 공개 API 개요

### 핵심 구성 요소
- `QueueModule`: 큐 기능을 위한 기본 모듈입니다.
- `QueueModule.forRoot(options)`: 애플리케이션 수준 큐 등록을 구성합니다.
- `QueueLifecycleService`: 작업을 큐에 추가(`enqueue(job)`)하기 위한 기본 서비스입니다.
- `@QueueWorker(JobClass, options?)`: 특정 작업을 처리할 핸들러를 지정하는 데코레이터입니다.


### 타입
- `QueueModuleOptions`: 전역 큐 설정(clientName, 기본 시도 횟수, 동시성, 전송률 제한 등)을 위한 타입입니다.
- `QueueWorkerOptions`: 개별 작업 설정(시도 횟수, 백오프, 동시성, jobName, 전송률 제한 등)을 위한 타입입니다.
- `QueueBackoffOptions`: 재시도 백오프 설정(`type`, `delayMs`)을 위한 타입입니다.

## 관련 패키지

- `@fluojs/redis`: 작업 데이터 저장을 위한 필수 백엔드 패키지입니다.
- `@fluojs/cron`: 정해진 시간에 반복 실행되어야 하는 백그라운드 작업을 위한 패키지입니다.

## 예제 소스

- `packages/queue/src/module.test.ts`: 워커 탐색 및 작업 추가 테스트 예제.
- `packages/queue/src/public-surface.test.ts`: 공개 API 계약 검증 예제.
