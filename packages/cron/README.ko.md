# @konekti/cron

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 데코레이터 기반 스케줄링 패키지입니다. 앱 라이프사이클에 맞춰 시작/종료를 관리하고, 필요하면 Redis 기반 분산 락으로 단일 실행을 보장할 수 있습니다.

## 설치

```bash
npm install @konekti/cron croner
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { createCronModule, Cron, CronExpression, Interval, Timeout } from '@konekti/cron';

class BillingService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices() {
    // 주기 작업 실행
  }

  @Interval(15_000, { name: 'billing.poll' })
  pollBillingProvider() {
    // 15초마다 실행
  }

  @Timeout(30_000, { name: 'billing.initial-sync' })
  runInitialSync() {
    // 부트스트랩 30초 후 1회 실행
  }
}

@Module({
  imports: [createCronModule()],
  providers: [BillingService],
})
export class AppModule {}
```

## 분산 락(선택)

```typescript
import { Module } from '@konekti/core';
import { createRedisModule } from '@konekti/redis';
import { createCronModule } from '@konekti/cron';

@Module({
  imports: [
    createRedisModule({ host: '127.0.0.1', port: 6379 }),
    createCronModule({
      distributed: {
        enabled: true,
        keyPrefix: 'konekti:cron:lock',
        lockTtlMs: 30_000,
      },
    }),
  ],
})
export class AppModule {}
```

분산 모드를 실제로 사용하려면 `createRedisModule(...)`로 `REDIS_CLIENT`를 함께 등록해야 합니다. 이때만 락을 획득한 인스턴스가 tick 작업을 실행하며, 실행 중에는 락 갱신을 시도합니다. `REDIS_CLIENT`가 없거나 필요한 `set`/`eval` 락 연산을 구현하지 않으면, 런타임은 인프로세스 스케줄링으로 조용히 fallback하지 않고 애플리케이션 부트스트랩을 실패시킵니다.

## API

- `@Cron(expression, options?)`
- `@Interval(ms, options?)`
- `@Timeout(ms, options?)`
- `CronExpression`
- `createCronModule(options?)`
- `createCronProviders(options?)`
- `SCHEDULING_REGISTRY`
- `SchedulingRegistry`

## 런타임 레지스트리(동적 스케줄링)

`createCronModule()`은 라이프사이클 서비스 기반의 주입 가능한 런타임 레지스트리 토큰을 제공합니다.

```typescript
import { Inject } from '@konekti/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@konekti/cron';

@Inject([SCHEDULING_REGISTRY])
class TaskRegistrar {
  constructor(private readonly scheduling: SchedulingRegistry) {}

  register() {
    this.scheduling.addCron('sync.cron', '*/5 * * * * *', async () => {});
    this.scheduling.addInterval('sync.interval', 5_000, async () => {});
    this.scheduling.addTimeout('sync.timeout', 30_000, async () => {});
  }
}
```

- `addCron(name, expression, callback, options?)`
- `addInterval(name, ms, callback, options?)`
- `addTimeout(name, ms, callback, options?)`
- `remove(name)`
- `enable(name)` / `disable(name)`
- `get(name)` / `getAll()`
- `updateCronExpression(name, expression)` (cron 작업 전용)

작업 이름은 cron/interval/timeout 전체에서 전역적으로 유일해야 하며, 중복 시 즉시 실패합니다.

동적 task도 decorator 기반 task와 같은 옵션을 받습니다. 모듈 레벨에서 distributed mode가 활성화되어 있고 런타임 task가 `distributed: true`(기본값)를 유지하면, registry로 등록한 cron/interval/timeout 역시 decorator 기반 task와 동일한 Redis 락 획득·갱신·해제·shutdown 정리 경로를 사용합니다. 프로세스 비정상 종료 후 정리는 별도 heartbeat가 아니라 lock TTL 만료를 기준으로 합니다.

Timeout은 1회 실행 후 레지스트리에 정의를 유지한 채 비활성화 상태가 됩니다. `enable(name)` 호출 시 전체 지연 시간을 다시 적용해 재스케줄링합니다.

## non-goals and intentional limitations

- distributed mode가 켜졌는데 `REDIS_CLIENT`가 없거나 호환되지 않으면 조용히 인프로세스로 fallback하지 않고 부트스트랩을 명시적으로 실패시킵니다.
- sub-second scheduling은 지원하지 않습니다. cron 표현식은 `croner` 기반이며 최소 해상도는 1초입니다.
- 내장 job queue/persistence는 제공하지 않습니다. durable job 처리는 `@konekti/queue`를 사용하세요.
- private method에는 `@Cron`, `@Interval`, `@Timeout`을 사용할 수 없습니다.
