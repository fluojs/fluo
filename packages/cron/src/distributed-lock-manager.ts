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
type RedisPeerModule = typeof import('@fluojs/redis');

const RELEASE_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';
const RENEW_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) else return 0 end';
const REDIS_PEER_MODULE_SPECIFIER = '@fluojs/redis';

const loadRedisPeerModule = async (): Promise<RedisPeerModule> => import(REDIS_PEER_MODULE_SPECIFIER);

function isMissingRedisPeer(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;

  return code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(REDIS_PEER_MODULE_SPECIFIER);
}

function createRedisBootstrapError(): Error {
  return new Error(
    [
      'Cron distributed mode requires @fluojs/redis to be installed and registered.',
      'Install and import @fluojs/redis, or disable distributed locking with distributed.enabled: false.',
    ].join(' '),
  );
}

function createLockReleaseTimeoutError(timeoutMs: number): Error {
  return new Error(`Distributed cron lock release timed out after ${String(timeoutMs)}ms.`);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) {
    return await operation;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createLockReleaseTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function resolveRedisPeerModule(): Promise<RedisPeerModule> {
  try {
    return await loadRedisPeerModule();
  } catch (error) {
    if (isMissingRedisPeer(error)) {
      throw createRedisBootstrapError();
    }

    throw error;
  }
}

/** Coordinates Redis lock acquisition, renewal, and release for scheduled cron tasks. */
export class CronDistributedLockManager {
  private readonly ownedLockKeys = new Set<string>();
  private lockIoError: Error | undefined;
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

  get lockIoAvailable(): boolean {
    if (!this.options.distributed.enabled) {
      return true;
    }

    return this.redisClient !== undefined && this.lockIoError === undefined;
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

    const { getRedisClientToken } = await resolveRedisPeerModule();
    const redisToken = getRedisClientToken(this.options.distributed.clientName);

    if (!this.runtimeContainer.has(redisToken)) {
      throw new Error('Cron distributed mode requires the configured Redis client to be registered.');
    }

    const redisClient = await this.runtimeContainer.resolve(redisToken);

    if (!hasRedisLockClient(redisClient)) {
      throw new Error('Cron distributed mode requires the configured Redis client to implement set/eval lock operations.');
    }

    this.redisClient = redisClient;
    await this.verifyLockIoAvailability();
  }

  reset(): void {
    this.lockIoError = undefined;
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

      this.markLockIoAvailable();

      if (result === 'OK') {
        this.ownedLockKeys.add(descriptor.lockKey);
      }

      return result === 'OK';
    } catch (error) {
      this.markLockIoUnavailable(error);
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

  async releaseLock(descriptor: CronTaskDescriptor): Promise<boolean> {
    return await this.releaseLockKey(descriptor.lockKey, descriptor.taskName);
  }

  async releaseOwnedLocks(excludedLockKeys: ReadonlySet<string> = new Set(), timeoutMs?: number): Promise<void> {
    if (!this.redisClient || this.ownedLockKeys.size === 0) {
      return;
    }

    const lockKeys = Array.from(this.ownedLockKeys).filter((lockKey) => !excludedLockKeys.has(lockKey));

    if (lockKeys.length === 0) {
      return;
    }

    await Promise.all(
      lockKeys.map(async (lockKey) => {
        await this.releaseLockKey(lockKey, lockKey, timeoutMs);
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
        this.markLockIoAvailable();
        this.logger.warn(
          `Distributed cron lock ownership was lost for ${descriptor.taskName}.`,
          'CronLifecycleService',
        );
        return 'ownership-lost';
      }

      this.markLockIoAvailable();
      this.logger.log(
        `Renewed distributed cron lock for ${descriptor.taskName}.`,
        'CronLifecycleService',
      );

      return 'renewed';
    } catch (error) {
      this.markLockIoUnavailable(error);
      this.logger.error(
        `Failed to renew distributed cron lock for ${descriptor.taskName}.`,
        error,
        'CronLifecycleService',
      );
      return 'renewal-failed';
    }
  }

  private async releaseLockKey(lockKey: string, taskName: string, timeoutMs?: number): Promise<boolean> {
    const redis = this.redisClient;

    if (!redis) {
      return true;
    }

    try {
      const result = await withTimeout(
        redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, this.options.distributed.ownerId),
        timeoutMs,
      );

      if (typeof result === 'number' && result <= 0) {
        this.markLockIoAvailable();
        this.logger.warn(
          `Distributed cron lock for ${taskName} was already released or owned by another node.`,
          'CronLifecycleService',
        );
        this.ownedLockKeys.delete(lockKey);
        return true;
      }

      this.markLockIoAvailable();
      this.logger.log(
        `Released distributed cron lock for ${taskName}.`,
        'CronLifecycleService',
      );
      this.ownedLockKeys.delete(lockKey);
      return true;
    } catch (error) {
      this.markLockIoUnavailable(error);
      this.logger.error(
        `Failed to release distributed cron lock for ${taskName}.`,
        error,
        'CronLifecycleService',
      );
      return false;
    }
  }

  private async verifyLockIoAvailability(): Promise<void> {
    const redis = this.redisClient;

    if (!redis) {
      return;
    }

    const probeKey = `${this.options.distributed.keyPrefix}:__probe:${this.options.distributed.ownerId}`;

    try {
      await redis.set(probeKey, this.options.distributed.ownerId, 'PX', 1_000, 'NX');
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, probeKey, this.options.distributed.ownerId);
      this.markLockIoAvailable();
    } catch (error) {
      this.markLockIoUnavailable(error);
      throw new Error('Cron distributed mode requires Redis lock I/O to be available.');
    }
  }

  private markLockIoAvailable(): void {
    this.lockIoError = undefined;
  }

  private markLockIoUnavailable(error: unknown): void {
    this.lockIoError = error instanceof Error ? error : new Error('Redis lock I/O failed.');
  }
}

function hasRedisLockClient(value: unknown): value is RedisLockClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const client = value as { eval?: unknown; set?: unknown };

  return typeof client.set === 'function' && typeof client.eval === 'function';
}
