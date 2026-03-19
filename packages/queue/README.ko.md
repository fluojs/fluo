# @konekti/queue

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 Redis 기반 백그라운드 작업 처리 패키지입니다. 데코레이터 기반으로 worker를 찾아서 lifecycle에 맞춰 시작하고 종료합니다.

## 설치

```bash
npm install @konekti/queue @konekti/redis
```

## 빠른 시작

```typescript
import { Inject, Module } from '@konekti/core';
import { createQueueModule, QUEUE, Queue, QueueWorker } from '@konekti/queue';
import { createRedisModule } from '@konekti/redis';

class SendWelcomeEmailJob {
  constructor(public readonly userId: string) {}
}

@QueueWorker(SendWelcomeEmailJob, { attempts: 3, concurrency: 5 })
class SendWelcomeEmailWorker {
  async handle(job: SendWelcomeEmailJob) {
    // 작업 처리
  }
}

@Inject([QUEUE])
class UserService {
  constructor(private readonly queue: Queue) {}

  async registerUser(userId: string) {
    await this.queue.enqueue(new SendWelcomeEmailJob(userId));
  }
}

@Module({
  imports: [
    createRedisModule({ host: '127.0.0.1', port: 6379 }),
    createQueueModule(),
  ],
  providers: [SendWelcomeEmailWorker, UserService],
})
export class AppModule {}
```

## API

- `createQueueModule(options?)` - 글로벌 `QUEUE`와 lifecycle 기반 worker 처리를 등록합니다
- `createQueueProviders(options?)` - 수동 조합을 위한 raw provider 목록을 반환합니다
- `QUEUE` - queue enqueue를 위한 DI 토큰입니다
- `Queue` - `enqueue(job)`를 제공하는 인터페이스입니다
- `@QueueWorker(JobClass, options?)` - 특정 job type을 처리할 singleton worker 클래스를 표시합니다

## 런타임 동작

- worker 탐색은 `onApplicationBootstrap()`에서 compiled module 전체를 대상으로 실행됩니다
- singleton provider/controller만 등록되고, non-singleton은 경고 후 제외됩니다
- job은 JSON payload로 직렬화된 뒤 `handle(job)` 호출 전에 원래 prototype으로 재구성됩니다
- worker 클래스는 반드시 `handle(job)` 메서드를 구현해야 합니다
- 각 job class마다 BullMQ queue/worker 쌍이 생성되며, queue 전용 duplicated Redis connection은 내부 구현 세부사항입니다
- 최종 실패한 job은 `konekti:queue:dead-letter:<jobName>` Redis list key에 기록됩니다
- shutdown은 idempotent하며 worker를 먼저 중지한 뒤 queue 전용 리소스를 정리합니다

## 요구 사항 및 경계

- `@konekti/queue`는 `@konekti/redis`가 필요하므로 `createQueueModule(...)`과 함께 `createRedisModule(...)`을 등록해야 합니다
- job payload는 DTO처럼 JSON 직렬화 가능한 형태여야 합니다
- queue worker는 singleton만 지원하며 `onApplicationBootstrap()` 단계에서 탐색됩니다
- BullMQ는 내부 구현 세부사항이며, 공개 API는 Konekti 표면만 노출합니다
