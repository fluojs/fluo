import { Inject } from '@fluojs/core';
import type Redis from 'ioredis';
import type { OnApplicationShutdown, OnModuleInit } from '@fluojs/runtime';

import { createRedisPlatformStatusSnapshot } from './status.js';
import { REDIS_CLIENT } from './tokens.js';

const QUITTABLE_STATUSES = new Set(['connect', 'connecting', 'ready', 'reconnecting']);
const DISCONNECTABLE_STATUSES = new Set(['close', 'connect', 'connecting', 'ready', 'reconnecting', 'wait']);

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

/**
 * Manages Redis client startup and shutdown as part of the application lifecycle.
 */
@Inject(REDIS_CLIENT)
export class RedisLifecycleService implements OnModuleInit, OnApplicationShutdown {
  constructor(private readonly client: Redis) {}

  async onModuleInit(): Promise<void> {
    if (!this.shouldConnectOnInit()) {
      return;
    }

    await this.client.connect();
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
      await this.client.quit();
      return;
    } catch (error: unknown) {
      this.disconnectIfPossible(this.client.status);

      if (!isClosed(this.client.status)) {
        throw error;
      }
    }
  }
}
