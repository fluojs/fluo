# @konekti/queue

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti를 위한 Redis 기반 분산 작업 처리 패키지입니다. 데코레이터 기반의 워커 탐색, 자동 작업 직렬화, 그리고 수명 주기 관리 기능을 제공합니다.

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
npm install @konekti/queue @konekti/redis
```

## 사용 시점

- 실행 시간이 길거나 리소스를 많이 사용하는 작업을 백그라운드에서 처리해야 할 때.
- 이메일 발송, 이미지 처리 등 비용이 큰 작업을 요청-응답 주기와 분리하고 싶을 때.
- 재시도 로직, 백오프(Backoff), 데드 레터(Dead-letter) 처리가 포함된 분산 큐가 필요할 때.

## 빠른 시작

### 1. 작업(Job) 및 워커(Worker) 정의

작업 클래스를 만들고, 이를 처리할 클래스에 `@QueueWorker` 데코레이터를 붙입니다.

```typescript
import { QueueWorker } from '@konekti/queue';

export class ProcessOrderJob {
  constructor(public readonly orderId: string) {}
}

@QueueWorker(ProcessOrderJob, { attempts: 3, backoff: 5000 })
export class OrderWorker {
  async handle(job: ProcessOrderJob) {
    console.log(`주문 처리 중: ${job.orderId}`);
    // 처리 로직 작성
  }
}
```

### 2. 모듈 등록 및 작업 추가

`QueueModule`을 등록하고 `QueueLifecycleService`를 주입받아 작업을 큐에 추가합니다.

```typescript
import { Module, Inject } from '@konekti/core';
import { QueueModule, QueueLifecycleService } from '@konekti/queue';
import { RedisModule } from '@konekti/redis';

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

### 분산 재시도 (Distributed Retries)

워커 설정에서 최대 시도 횟수와 백오프 전략을 지정하여 일시적인 실패를 자동으로 처리할 수 있습니다.

```typescript
@QueueWorker(MyJob, { 
  attempts: 5, 
  backoff: { type: 'exponential', delay: 1000 } 
})
```

### 데드 레터 처리 (Dead-Letter Handling)

모든 재시도에 실패한 작업은 Redis의 데드 레터 리스트(`konekti:queue:dead-letter:<jobName>`)로 자동 이동되어, 나중에 수동으로 확인하거나 복구할 수 있습니다.

## 공개 API 개요

### 핵심 구성 요소
- `QueueModule`: 큐 기능을 위한 기본 모듈입니다.
- `QueueLifecycleService`: 작업을 큐에 추가(`enqueue(job)`)하기 위한 기본 서비스입니다.
- `@QueueWorker(JobClass, options?)`: 특정 작업을 처리할 핸들러를 지정하는 데코레이터입니다.

### 타입
- `QueueOptions`: 전역 큐 설정(동시성, 전송률 제한 등)을 위한 타입입니다.
- `WorkerOptions`: 개별 작업 설정(시도 횟수, 백오프, 우선순위 등)을 위한 타입입니다.

## 관련 패키지

- `@konekti/redis`: 작업 데이터 저장을 위한 필수 백엔드 패키지입니다.
- `@konekti/cron`: 정해진 시간에 반복 실행되어야 하는 백그라운드 작업을 위한 패키지입니다.

## 예제 소스

- `packages/queue/src/module.test.ts`: 워커 탐색 및 작업 추가 테스트 예제.
- `packages/queue/src/public-surface.test.ts`: 공개 API 계약 검증 예제.
