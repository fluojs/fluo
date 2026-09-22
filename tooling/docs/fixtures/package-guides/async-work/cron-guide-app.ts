import { Inject, Module } from '@fluojs/core';
import { Cron, CronExpression, CronModule, Timeout } from '@fluojs/cron';
import { REDIS_CLIENT, RedisModule } from '@fluojs/redis';

/**
 * Complete canonical cron application from the Cron guide
 * (apps/docs/content/docs/packages/cron.mdx). The decorator tasks are
 * discovered at bootstrap and observable through the scheduling registry;
 * the distributed-lock fixture adds a dynamic interval task against a real
 * Redis server and observes the lease through the raw client.
 */

export class BillingTasks {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices(): Promise<void> {
    // Scheduled every minute; ticks overlapping a running invocation are
    // skipped by the no-overlap guard.
  }

  @Timeout(5_000)
  async initialSync(): Promise<void> {
    // Runs once, 5 seconds after startup, then disables itself.
  }
}

/** Structural view of the raw ioredis client the fixture needs. */
export interface RawRedisClient {
  get(key: string): Promise<string | null>;
}

@Inject(REDIS_CLIENT)
export class LockProbe {
  constructor(private readonly redis: RawRedisClient) {}

  async readLock(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
}

export function createCronGuideApp() {
  @Module({
    imports: [CronModule.forRoot()],
    providers: [BillingTasks],
  })
  class CronGuideAppModule {}

  return { AppModule: CronGuideAppModule, BillingTasks };
}

export function createDistributedCronGuideApp(redisOptions: { host: string; port: number }) {
  @Module({
    imports: [
      RedisModule.forRoot(redisOptions),
      CronModule.forRoot({
        distributed: {
          enabled: true,
          keyPrefix: 'fluo:cron:guide',
          lockTtlMs: 1_000,
        },
      }),
    ],
    providers: [LockProbe],
  })
  class DistributedCronGuideAppModule {}

  return { AppModule: DistributedCronGuideAppModule, LockProbe };
}
