import { Inject } from '@fluojs/core';
import type Redis from 'ioredis';
import type { OnApplicationShutdown, OnModuleInit } from '@fluojs/core';

import { createRedisPlatformStatusSnapshot } from './status.js';
import { getRedisComponentId, REDIS_CLIENT } from './tokens.js';
import type { RedisLifecycleOptions } from './types.js';

const QUITTABLE_STATUSES = new Set(['connect', 'connecting', 'ready', 'reconnecting']);
const DISCONNECTABLE_STATUSES = new Set(['close', 'connect', 'connecting', 'monitoring', 'ready', 'reconnecting', 'wait']);
const DEFAULT_REDIS_LIFECYCLE_TIMEOUT_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isClosed(status: string): boolean {
  return status === 'end';
}

function isConnectable(status: string): boolean {
  return status === 'wait';
}

function isQuittable(status: string): boolean {
  return QUITTABLE_STATUSES.has(status);
}

function isDisconnectable(status: string): boolean {
  return DISCONNECTABLE_STATUSES.has(status);
}

function normalizeTimeoutMs(value: number | undefined): number {
  return value === undefined ? DEFAULT_REDIS_LIFECYCLE_TIMEOUT_MS : value;
}

async function withLifecycleTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) {
    return await operation;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const startedAt = performance.now();

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        const scheduleTimeout = () => {
          const remainingMs = timeoutMs - (performance.now() - startedAt);
          if (remainingMs <= 0) {
            reject(new Error(message));
            return;
          }
          timeoutHandle = setTimeout(scheduleTimeout, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
        };
        scheduleTimeout();
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Manages Redis client startup and shutdown as part of the application lifecycle.
 */
@Inject(REDIS_CLIENT)
export class RedisLifecycleService implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly client: Redis,
    private readonly clientName?: string,
    private readonly lifecycleOptions: RedisLifecycleOptions = {},
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.shouldConnectOnInit()) {
      return;
    }

    await this.connectWithDisconnectFallback();
  }

  async onApplicationShutdown(): Promise<void> {
    const status = this.client.status;

    if (isClosed(status)) {
      return;
    }

    if (!isQuittable(status)) {
      this.disconnectIfPossible(status);

      return;
    }

    await this.quitWithDisconnectFallback();
  }

  createPlatformStatusSnapshot() {
    return createRedisPlatformStatusSnapshot({
      componentId: getRedisComponentId(this.clientName),
      status: this.client.status,
    });
  }

  private shouldConnectOnInit(): boolean {
    return isConnectable(this.client.status);
  }

  private disconnectIfPossible(status: string): void {
    if (isDisconnectable(status)) {
      this.client.disconnect();
    }
  }

  private async quitWithDisconnectFallback(): Promise<void> {
    try {
      await withLifecycleTimeout(
        this.client.quit(),
        normalizeTimeoutMs(this.lifecycleOptions.quitTimeoutMs),
        `Redis client ${this.describeClient()} quit timed out after ${String(normalizeTimeoutMs(this.lifecycleOptions.quitTimeoutMs))}ms.`,
      );
      return;
    } catch (error: unknown) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let onClosed: (() => void) | undefined;

      try {
        await new Promise<void>((resolve, reject) => {
          onClosed = () => {
            if (isClosed(this.client.status)) {
              resolve();
            }
          };
          // ioredis disconnect() starts socket teardown; close may precede the terminal end state.
          this.client.on('close', onClosed);
          this.client.on('end', onClosed);
          timeoutHandle = setTimeout(() => reject(error), DEFAULT_REDIS_LIFECYCLE_TIMEOUT_MS);
          this.disconnectIfPossible(this.client.status);
          onClosed();
        });
      } catch {
        throw error;
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
        if (onClosed !== undefined) {
          this.client.off('close', onClosed);
          this.client.off('end', onClosed);
        }
      }
    }
  }

  private async connectWithDisconnectFallback(): Promise<void> {
    const connectPromise = this.client.connect();

    try {
      await withLifecycleTimeout(
        connectPromise,
        normalizeTimeoutMs(this.lifecycleOptions.connectTimeoutMs),
        `Redis client ${this.describeClient()} connect timed out after ${String(normalizeTimeoutMs(this.lifecycleOptions.connectTimeoutMs))}ms.`,
      );
    } catch (error: unknown) {
      this.disconnectIfPossible(this.client.status);
      void connectPromise.then(
        () => {
          this.disconnectIfPossible(this.client.status);
        },
        () => undefined,
      );

      throw error;
    }
  }

  private describeClient(): string {
    return this.clientName ?? 'default';
  }
}
