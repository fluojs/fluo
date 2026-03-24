import type { Provider } from '@konekti/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError, withIndicatorTimeout } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

const PRISMA_CLIENT = Symbol.for('konekti.prisma.client');

interface PrismaClientLike {
  $executeRaw?: (...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe?: (query: string) => Promise<unknown>;
  $queryRaw?: (...args: unknown[]) => Promise<unknown>;
  $queryRawUnsafe?: (query: string) => Promise<unknown>;
}

export interface PrismaHealthIndicatorOptions {
  client?: PrismaClientLike;
  key?: string;
  ping?: () => Promise<unknown> | unknown;
  timeoutMs?: number;
}

const DEFAULT_PRISMA_TIMEOUT_MS = 2_000;

async function runPrismaPing(options: PrismaHealthIndicatorOptions): Promise<void> {
  if (options.ping) {
    await options.ping();
    return;
  }

  const client = options.client;

  if (!client) {
    throw new Error('Prisma indicator requires either a client or ping callback.');
  }

  if (typeof client.$queryRawUnsafe === 'function') {
    await client.$queryRawUnsafe('SELECT 1');
    return;
  }

  if (typeof client.$executeRawUnsafe === 'function') {
    await client.$executeRawUnsafe('SELECT 1');
    return;
  }

  if (typeof client.$queryRaw === 'function') {
    await client.$queryRaw('SELECT 1');
    return;
  }

  if (typeof client.$executeRaw === 'function') {
    await client.$executeRaw('SELECT 1');
    return;
  }

  throw new Error('Prisma indicator requires a client with query/execute capabilities or a ping callback.');
}

export function createPrismaHealthIndicator(options: PrismaHealthIndicatorOptions = {}): HealthIndicator {
  return new PrismaHealthIndicator(options);
}

export function createPrismaHealthIndicatorProvider(options: Omit<PrismaHealthIndicatorOptions, 'client'> = {}): Provider {
  return {
    inject: [PRISMA_CLIENT],
    provide: PrismaHealthIndicator,
    useFactory: (client: unknown) => new PrismaHealthIndicator({ ...options, client: client as PrismaClientLike }),
  };
}

export class PrismaHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: PrismaHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('prisma', this.options.key ?? key);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_PRISMA_TIMEOUT_MS;

    try {
      await withIndicatorTimeout(runPrismaPing(this.options), timeoutMs, indicatorKey);
      return createUpResult(indicatorKey);
    } catch (error: unknown) {
      throwHealthCheckError('Prisma health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : 'Prisma health check failed.',
      ));
    }
  }
}
