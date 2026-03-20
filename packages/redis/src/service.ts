import { Inject } from '@konekti/core';
import type Redis from 'ioredis';
import type { OnApplicationShutdown, OnModuleInit } from '@konekti/runtime';

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

@Inject([REDIS_CLIENT])
export class RedisLifecycleService implements OnModuleInit, OnApplicationShutdown {
  constructor(private readonly client: Redis) {}

  async onModuleInit(): Promise<void> {
    if (!isConnectable(this.client.status)) {
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
      if (isDisconnectable(status)) {
        this.client.disconnect();
      }

      return;
    }

    try {
      await this.client.quit();
    } catch (error: unknown) {
      if (isDisconnectable(this.client.status)) {
        this.client.disconnect();
      }

      if (!isClosed(this.client.status)) {
        throw error;
      }
    }
  }
}
