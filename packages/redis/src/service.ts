import { Inject } from '@konekti/core';
import type Redis from 'ioredis';
import type { OnApplicationShutdown, OnModuleInit } from '@konekti/runtime';

import { REDIS_CLIENT } from './tokens.js';

function isClosed(status: string): boolean {
  return status === 'end';
}

@Inject([REDIS_CLIENT])
export class RedisLifecycleService implements OnModuleInit, OnApplicationShutdown {
  constructor(private readonly client: Redis) {}

  async onModuleInit(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (isClosed(this.client.status)) {
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.client.disconnect();

      if (!isClosed(this.client.status)) {
        throw error;
      }
    }
  }
}
