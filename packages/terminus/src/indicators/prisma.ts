import type { Token } from '@fluojs/core';
import { optional, type Provider } from '@fluojs/di';

import { createDownResult, createUpResult, resolveIndicatorKey, resolveIndicatorTimeoutMs, throwHealthCheckError, withIndicatorTimeout } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

const PRISMA_CLIENT = Symbol.for('fluo.prisma.client');
const PRISMA_SERVICE = Symbol.for('fluo.prisma.service');

interface PrismaClientLike {
  $executeRaw?: (...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe?: (query: string) => Promise<unknown>;
  $queryRaw?: (...args: unknown[]) => Promise<unknown>;
  $queryRawUnsafe?: (query: string) => Promise<unknown>;
}

interface PrismaLifecycleSnapshotLike {
  details?: Record<string, unknown>;
  health: {
    reason?: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
  };
  readiness: {
    reason?: string;
    status: 'ready' | 'not-ready';
  };
}

interface PrismaServiceLike {
  createPlatformStatusSnapshot?: () => PrismaLifecycleSnapshotLike;
  current?: () => PrismaClientLike | unknown;
}

/** Options for probing Prisma-backed database connectivity. */
export interface PrismaHealthIndicatorOptions {
  /** Raw Prisma client to probe when no lifecycle-aware service facade is supplied. */
  client?: PrismaClientLike;
  /** Explicit raw-client token to resolve when using `createPrismaHealthIndicatorProvider(...)`. */
  clientToken?: Token;
  /** Indicator result key override. Defaults to the key passed to `check(...)`, then `prisma`. */
  key?: string;
  /** Named Prisma registration to resolve when using `createPrismaHealthIndicatorProvider(...)`. */
  name?: string;
  /** Custom ping callback for manual probes or tests. Lifecycle state is only mapped when `service` is available. */
  ping?: () => Promise<unknown> | unknown;
  /** Lifecycle-aware Prisma service/facade handle, usually resolved from `getPrismaServiceToken(name)`. */
  service?: PrismaServiceLike;
  /** Explicit Prisma service token to resolve when using `createPrismaHealthIndicatorProvider(...)`. */
  serviceToken?: Token;
  /** Maximum time to wait for the ping operation. Defaults to `2_000` ms. */
  timeoutMs?: number;
}

const DEFAULT_PRISMA_TIMEOUT_MS = 2_000;

async function runPrismaPing(options: PrismaHealthIndicatorOptions): Promise<void> {
  if (options.ping) {
    await options.ping();
    return;
  }

  const client = resolveCurrentPrismaClient(options.service) ?? options.client;

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

function normalizePrismaRegistrationName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new Error('Prisma health indicator registration name must be a non-empty string when provided.');
  }

  return normalizedName;
}

function getPrismaClientToken(name?: string): Token {
  const normalizedName = normalizePrismaRegistrationName(name);

  return normalizedName === undefined
    ? PRISMA_CLIENT
    : Symbol.for(`fluo.prisma.client:${normalizedName}`);
}

function getPrismaServiceToken(name?: string): Token {
  const normalizedName = normalizePrismaRegistrationName(name);

  return normalizedName === undefined
    ? PRISMA_SERVICE
    : Symbol.for(`fluo.prisma.service:${normalizedName}`);
}

function resolveCurrentPrismaClient(service: PrismaServiceLike | undefined): PrismaClientLike | undefined {
  if (!service || typeof service.current !== 'function') {
    return undefined;
  }

  return service.current() as PrismaClientLike;
}

function createPrismaLifecycleSnapshot(
  service: PrismaServiceLike | undefined,
): PrismaLifecycleSnapshotLike | undefined {
  if (!service || typeof service.createPlatformStatusSnapshot !== 'function') {
    return undefined;
  }

  return service.createPlatformStatusSnapshot();
}

function createPrismaLifecycleDownResult(
  indicatorKey: string,
  snapshot: PrismaLifecycleSnapshotLike,
): HealthIndicatorResult | undefined {
  const healthStatus = snapshot.health.status;
  const readinessStatus = snapshot.readiness.status;

  if (healthStatus === 'healthy' && readinessStatus === 'ready') {
    return undefined;
  }

  const message = snapshot.readiness.reason
    ?? snapshot.health.reason
    ?? `Prisma lifecycle reported health=${healthStatus} readiness=${readinessStatus}.`;

  return createDownResult(indicatorKey, message, {
    details: snapshot.details,
    healthStatus,
    readinessStatus,
  });
}

function createPrismaLifecycleUpDetails(
  snapshot: PrismaLifecycleSnapshotLike | undefined,
): Record<string, unknown> {
  if (!snapshot) {
    return {};
  }

  return {
    details: snapshot.details,
    healthStatus: snapshot.health.status,
    readinessStatus: snapshot.readiness.status,
  };
}

function toPrismaService(value: unknown): PrismaServiceLike | undefined {
  return typeof value === 'object' && value !== null ? value as PrismaServiceLike : undefined;
}

/**
 * Create a Prisma health indicator.
 *
 * @param options Optional lifecycle-aware service facade, Prisma client, ping callback, timeout, and key override.
 * @returns A health indicator that checks Prisma lifecycle state before executing a lightweight round trip.
 */
export function createPrismaHealthIndicator(options: PrismaHealthIndicatorOptions = {}): HealthIndicator {
  return new PrismaHealthIndicator(options);
}

/**
 * Create a Terminus indicator provider collection entry that resolves Prisma from DI.
 *
 * The provider prefers `getPrismaServiceToken(options.name)` so `@fluojs/prisma`
 * lifecycle snapshots participate in health/readiness diagnostics. It falls back
 * to the matching raw client token for compatibility with manual provider graphs.
 * Explicit `serviceToken` and `clientToken` values override the name-derived tokens.
 *
 * @param options Optional name hint, explicit tokens, timeout, key override, or custom ping callback.
 * @returns A factory provider with a unique internal DI token for `TerminusModule` indicatorProviders.
 */
export function createPrismaHealthIndicatorProvider(
  options: Omit<PrismaHealthIndicatorOptions, 'client' | 'service'> = {},
): Provider {
  const indicatorProviderToken = Symbol('fluo.terminus.prisma-health-indicator');
  const hasExplicitServiceToken = options.serviceToken !== undefined;
  const hasExplicitClientToken = options.clientToken !== undefined;
  const serviceToken = hasExplicitServiceToken || !hasExplicitClientToken
    ? options.serviceToken ?? getPrismaServiceToken(options.name)
    : undefined;
  const clientToken = hasExplicitClientToken || !hasExplicitServiceToken
    ? options.clientToken ?? getPrismaClientToken(options.name)
    : undefined;
  const inject = [
    ...(serviceToken === undefined ? [] : [optional(serviceToken)]),
    ...(clientToken === undefined ? [] : [optional(clientToken)]),
  ];

  return {
    inject,
    provide: indicatorProviderToken,
    useFactory: (...resolvedDependencies: unknown[]) => {
      const resolvedService = serviceToken === undefined ? undefined : resolvedDependencies[0];
      const resolvedClientIndex = serviceToken === undefined ? 0 : 1;
      const resolvedClient = clientToken === undefined ? undefined : resolvedDependencies[resolvedClientIndex];

      return new PrismaHealthIndicator({
        ...options,
        client: resolvedClient as PrismaClientLike | undefined,
        service: toPrismaService(resolvedService),
      });
    },
  };
}

/** Health indicator that maps Prisma lifecycle status and probes connectivity with a trivial query. */
export class PrismaHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: PrismaHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('prisma', this.options.key ?? key);

    try {
      const timeoutMs = resolveIndicatorTimeoutMs(this.options.timeoutMs, DEFAULT_PRISMA_TIMEOUT_MS, indicatorKey);
      const snapshot = createPrismaLifecycleSnapshot(this.options.service);
      const lifecycleDownResult = snapshot
        ? createPrismaLifecycleDownResult(indicatorKey, snapshot)
        : undefined;

      if (lifecycleDownResult) {
        throwHealthCheckError('Prisma health check failed.', lifecycleDownResult);
      }

      await withIndicatorTimeout(runPrismaPing(this.options), timeoutMs, indicatorKey);
      return createUpResult(indicatorKey, createPrismaLifecycleUpDetails(snapshot));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'HealthCheckError') {
        throw error;
      }

      throwHealthCheckError('Prisma health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : 'Prisma health check failed.',
      ));
    }
  }
}
