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

분산 모드를 활성화하면 `REDIS_CLIENT`를 통해 락을 획득한 인스턴스만 락이 유지되는 동안 해당 tick의 작업을 실행합니다. 이 보장은 `lockTtlMs` 범위 안에서만 유효하므로, 오래 걸리는 작업은 예상 실행 시간보다 더 긴 TTL을 설정해야 합니다.

```typescript
createCronModule({
  distributed: {
    enabled: true,
    keyPrefix: 'konekti:cron:lock',
    lockTtlMs: 30_000,
  },
});
```

## API

- `@Cron(expression, options?)`
- `CronExpression`
- `createCronModule(options?)`
- `createCronProviders(options?)`
