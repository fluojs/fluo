# @konekti/cron

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 데코레이터 기반 크론 스케줄링 패키지입니다. 앱 라이프사이클에 맞춰 시작/종료를 관리하고, 필요하면 Redis 기반 분산 락으로 단일 실행을 보장할 수 있습니다.

## 설치

```bash
npm install @konekti/cron croner
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { createCronModule, Cron, CronExpression } from '@konekti/cron';

class BillingService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices() {
    // 주기 작업 실행
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
- `CronExpression`
- `createCronModule(options?)`
- `createCronProviders(options?)`
