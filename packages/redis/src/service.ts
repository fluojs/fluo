import { Inject } from '@fluojs/core';
import type Redis from 'ioredis';
import type { OnApplicationShutdown, OnModuleInit } from '@fluojs/runtime';

import { createRedisPlatformStatusSnapshot } from './status.js';
import { getRedisComponentId, REDIS_CLIENT } from './tokens.js';
import type { RedisLifecycleOptions } from './types.js';

const QUITTABLE_STATUSES = new Set(['connect', 'connecting', 'ready', 'reconnecting']);
const DISCONNECTABLE_STATUSES = new Set(['close', 'connect', 'connecting', 'ready', 'reconnecting', 'wait']);
const DEFAULT_REDIS_LIFECYCLE_TIMEOUT_MS = 10_000;

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

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
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

    await withLifecycleTimeout(
      this.client.connect(),
      normalizeTimeoutMs(this.lifecycleOptions.connectTimeoutMs),
      `Redis client ${this.describeClient()} connect timed out after ${String(normalizeTimeoutMs(this.lifecycleOptions.connectTimeoutMs))}ms.`,
    );
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
      this.disconnectIfPossible(this.client.status);

      if (!isClosed(this.client.status)) {
        throw error;
      }
    }
  }

  private describeClient(): string {
    return this.clientName ?? 'default';
  }
}
