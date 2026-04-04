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
import { QueueModule, QUEUE, Queue, QueueWorker } from '@konekti/queue';
import { RedisModule } from '@konekti/redis';

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
    RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [SendWelcomeEmailWorker, UserService],
})
export class AppModule {}
```

## API

- `QueueModule.forRoot(options?)` - 글로벌 `QUEUE`와 lifecycle 기반 worker 처리를 등록합니다
- `createQueueProviders(options?)` - 수동 조합을 위한 raw provider 목록을 반환합니다
- `QUEUE` - queue enqueue를 위한 DI 토큰입니다
- `Queue` - `enqueue(job)`를 제공하는 인터페이스입니다
- `@QueueWorker(JobClass, options?)` - 특정 job type을 처리할 singleton worker 클래스를 표시합니다
- `createQueuePlatformStatusSnapshot(input)` - queue lifecycle/dependency/drain 신호를 공통 platform snapshot 필드로 매핑합니다

### 루트 배럴 공개 표면 거버넌스 (0.x)

- **supported**: `QueueModule.forRoot`, `createQueueProviders`, `QUEUE`, `Queue`, `@QueueWorker`, queue option/worker 공개 타입, status snapshot helper를 지원합니다.
- **compatibility-only**: 현재 루트 배럴에는 별도 항목이 없습니다. 향후 호환성 shim이 추가되면 릴리스 전에 이 섹션에 명시적으로 문서화되어야 합니다.
- **internal**: `QUEUE_OPTIONS`는 내부 항목으로 유지되며 루트 배럴 공개 계약에서 의도적으로 제외됩니다.

## 런타임 동작

- worker 탐색은 `onApplicationBootstrap()`에서 compiled module 전체를 대상으로 실행됩니다
- singleton provider/controller만 등록되고, non-singleton은 경고 후 제외됩니다
- job은 JSON payload로 직렬화된 뒤 `handle(job)` 호출 전에 원래 prototype으로 재구성됩니다
- worker 클래스는 반드시 `handle(job)` 메서드를 구현해야 합니다
- 각 job class마다 BullMQ queue/worker 쌍이 생성되며, queue 전용 duplicated Redis connection은 내부 구현 세부사항입니다
- 최종 실패한 job은 `konekti:queue:dead-letter:<jobName>` Redis list key에 기록됩니다
- shutdown은 idempotent하며 worker를 먼저 중지한 뒤 queue 전용 리소스를 정리합니다

## 요구 사항 및 경계

- `@konekti/queue`는 `@konekti/redis`가 필요하므로 `QueueModule.forRoot(...)`과 함께 `RedisModule.forRoot(...)`를 등록해야 합니다
- job payload는 DTO처럼 JSON 직렬화 가능한 형태여야 합니다
- queue worker는 singleton만 지원하며 `onApplicationBootstrap()` 단계에서 탐색됩니다
- BullMQ는 내부 구현 세부사항이며, 공개 API는 Konekti 표면만 노출합니다

## 플랫폼 상태 스냅샷 시맨틱

`createQueuePlatformStatusSnapshot(...)`(또는 `QueueLifecycleService#createPlatformStatusSnapshot()`)으로 queue 라이프사이클 상태를 공통 platform snapshot 형태로 노출할 수 있습니다.

- `ownership`: queue 리소스는 프레임워크 소유입니다 (`ownsResources: true`, `externallyManaged: false`).
- `readiness`: worker가 시작된 경우만 `ready`; startup은 `degraded`; shutdown/idle/stopped는 `not-ready`로 표시됩니다.
- `health`: 런타임/종료 중 dead-letter drain 대기는 `degraded`; 완전 중지는 `unhealthy`로 표시됩니다.
- `details`: 명시적 의존성 엣지(`redis.default`), worker 탐색/준비 카운트, pending dead-letter drain 카운트를 포함합니다.
