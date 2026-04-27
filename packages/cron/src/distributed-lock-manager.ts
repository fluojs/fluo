import { getRedisClientToken } from '@fluojs/redis';
import type { Container } from '@fluojs/di';
import type { ApplicationLogger } from '@fluojs/runtime';

import type { CronTaskDescriptor, NormalizedCronModuleOptions } from './types.js';

/** Minimal Redis command surface required for distributed cron locks. */
export interface RedisLockClient {
  eval(script: string, keysLength: number, ...keysAndArgs: string[]): Promise<unknown>;
  set(key: string, value: string, mode: 'PX', ttl: number, existence: 'NX'): Promise<'OK' | null | undefined>;
}

/** Tracks renewal state for one acquired distributed cron lock. */
export interface LockRenewalMonitor {
  getPostRunError(): Promise<Error | undefined>;
  stop(): void;
}

interface LockRenewalState {
  lockPostRunError: Error | undefined;
  nextRenewalDueAt: number;
  renewalChain: Promise<void>;
  renewalIntervalMs: number;
  stopped: boolean;
}

type LockRenewalOutcome = 'renewed' | 'ownership-lost' | 'renewal-failed';

const RELEASE_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';
const RENEW_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) else return 0 end';

/** Coordinates Redis lock acquisition, renewal, and release for scheduled cron tasks. */
export class CronDistributedLockManager {
  private readonly ownedLockKeys = new Set<string>();
  private redisClient: RedisLockClient | undefined;
  private lockOwnershipLosses = 0;
  private lockRenewalFailures = 0;

  constructor(
    private readonly options: NormalizedCronModuleOptions,
    private readonly runtimeContainer: Container,
    private readonly logger: ApplicationLogger,
  ) {}

  get resolvedClient(): RedisLockClient | undefined {
    return this.redisClient;
  }

  get ownedLocks(): number {
    return this.ownedLockKeys.size;
  }

  get ownershipLosses(): number {
    return this.lockOwnershipLosses;
  }

  get renewalFailures(): number {
    return this.lockRenewalFailures;
  }

  async resolveClient(): Promise<void> {
    if (!this.options.distributed.enabled) {
      return;
    }

    const redisToken = getRedisClientToken(this.options.distributed.clientName);

    if (!this.runtimeContainer.has(redisToken)) {
      throw new Error('Cron distributed mode requires the configured Redis client to be registered.');
    }

    const redisClient = await this.runtimeContainer.resolve(redisToken);

    if (!hasRedisLockClient(redisClient)) {
      throw new Error('Cron distributed mode requires the configured Redis client to implement set/eval lock operations.');
    }

    this.redisClient = redisClient;
  }

  reset(): void {
    this.redisClient = undefined;
  }

  async tryAcquireLock(descriptor: CronTaskDescriptor): Promise<boolean> {
    const redis = this.redisClient;

    if (!redis) {
      return true;
    }

    try {
      const result = await redis.set(
        descriptor.lockKey,
        this.options.distributed.ownerId,
        'PX',
        descriptor.lockTtlMs,
        'NX',
      );

      if (result === 'OK') {
        this.ownedLockKeys.add(descriptor.lockKey);
      }

      return result === 'OK';
    } catch (error) {
      this.logger.error(
        `Failed to acquire distributed cron lock for ${descriptor.taskName}.`,
        error,
        'CronLifecycleService',
      );
      return false;
    }
  }

  startLockRenewalMonitor(descriptor: CronTaskDescriptor): LockRenewalMonitor {
    const renewalState = this.createLockRenewalState(descriptor.lockTtlMs);
    const renewalTimer = setInterval(() => {
      if (renewalState.stopped) {
        return;
      }

      renewalState.nextRenewalDueAt += renewalState.renewalIntervalMs;
      renewalState.renewalChain = renewalState.renewalChain.then(async () => {
        await this.runLockRenewalAttempt(descriptor, renewalState);
      });
    }, renewalState.renewalIntervalMs);

    return {
      getPostRunError: async (): Promise<Error | undefined> => {
        this.queueDueLockRenewalAttempts(descriptor, renewalState);
        await renewalState.renewalChain;
        return renewalState.lockPostRunError;
      },
      stop: (): void => {
        if (renewalState.stopped) {
          return;
        }

        renewalState.stopped = true;
        clearInterval(renewalTimer);
      },
    };
  }

  async releaseLock(descriptor: CronTaskDescriptor): Promise<void> {
    await this.releaseLockKey(descriptor.lockKey, descriptor.taskName);
  }

  async releaseOwnedLocks(excludedLockKeys: ReadonlySet<string> = new Set()): Promise<void> {
    if (!this.redisClient || this.ownedLockKeys.size === 0) {
      return;
    }

    const lockKeys = Array.from(this.ownedLockKeys).filter((lockKey) => !excludedLockKeys.has(lockKey));

    if (lockKeys.length === 0) {
      return;
    }

    await Promise.all(
      lockKeys.map(async (lockKey) => {
        await this.releaseLockKey(lockKey, lockKey);
      }),
    );
  }

  private createLockRenewalState(lockTtlMs: number): LockRenewalState {
    const renewalIntervalMs = Math.max(250, Math.floor(lockTtlMs / 2));

    return {
      lockPostRunError: undefined,
      nextRenewalDueAt: Date.now() + renewalIntervalMs,
      renewalChain: Promise.resolve(),
      renewalIntervalMs,
      stopped: false,
    };
  }

  private queueDueLockRenewalAttempts(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): void {
    const now = Date.now();

    while (now >= renewalState.nextRenewalDueAt) {
      renewalState.nextRenewalDueAt += renewalState.renewalIntervalMs;
      renewalState.renewalChain = renewalState.renewalChain.then(async () => {
        await this.runLockRenewalAttempt(descriptor, renewalState);
      });
    }
  }

  private async runLockRenewalAttempt(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): Promise<void> {
    const outcome = await this.renewLock(descriptor);

    if (outcome === 'ownership-lost') {
      this.lockOwnershipLosses += 1;
    }

    if (outcome === 'renewal-failed') {
      this.lockRenewalFailures += 1;
    }

    if (renewalState.lockPostRunError) {
      return;
    }

    renewalState.lockPostRunError = this.toLockPostRunError(outcome, descriptor.taskName);
  }

  private toLockPostRunError(outcome: LockRenewalOutcome, taskName: string): Error | undefined {
    if (outcome === 'ownership-lost') {
      return new Error(`Distributed cron lock ownership lost for ${taskName}.`);
    }

    if (outcome === 'renewal-failed') {
      return new Error(`Distributed cron lock renewal failed for ${taskName}.`);
    }

    return undefined;
  }

  private async renewLock(descriptor: CronTaskDescriptor): Promise<LockRenewalOutcome> {
    const redis = this.redisClient;

    if (!redis) {
      return 'renewed';
    }

    try {
      const result = await redis.eval(
        RENEW_LOCK_SCRIPT,
        1,
        descriptor.lockKey,
        this.options.distributed.ownerId,
        String(descriptor.lockTtlMs),
      );

      if (typeof result === 'number' && result <= 0) {
        this.logger.warn(
          `Distributed cron lock ownership was lost for ${descriptor.taskName}.`,
          'CronLifecycleService',
        );
        return 'ownership-lost';
      }

      this.logger.log(
        `Renewed distributed cron lock for ${descriptor.taskName}.`,
        'CronLifecycleService',
      );

      return 'renewed';
    } catch (error) {
      this.logger.error(
        `Failed to renew distributed cron lock for ${descriptor.taskName}.`,
        error,
        'CronLifecycleService',
      );
      return 'renewal-failed';
    }
  }

  private async releaseLockKey(lockKey: string, taskName: string): Promise<void> {
    const redis = this.redisClient;

    if (!redis) {
      return;
    }

    try {
      const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, this.options.distributed.ownerId);

      if (typeof result === 'number' && result <= 0) {
        this.logger.warn(
          `Distributed cron lock for ${taskName} was already released or owned by another node.`,
          'CronLifecycleService',
        );
        return;
      }

      this.logger.log(
        `Released distributed cron lock for ${taskName}.`,
        'CronLifecycleService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to release distributed cron lock for ${taskName}.`,
        error,
        'CronLifecycleService',
      );
    } finally {
      this.ownedLockKeys.delete(lockKey);
    }
  }
}

function hasRedisLockClient(value: unknown): value is RedisLockClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const client = value as { eval?: unknown; set?: unknown };

  return typeof client.set === 'function' && typeof client.eval === 'function';
}
