import type { RedisOptions } from 'ioredis';

type RedisConnectionOptions = Omit<RedisOptions, 'lazyConnect'>;

/** Lifecycle timeout controls for Redis connections owned by Fluo. */
export interface RedisLifecycleOptions {
  /** Maximum time to wait for bootstrap `connect()` before failing startup. Defaults to `10_000`. */
  connectTimeoutMs?: number;
  /** Maximum time to wait for graceful shutdown `quit()` before forcing `disconnect()`. Defaults to `10_000`. */
  quitTimeoutMs?: number;
}

/** Options accepted by the default unnamed Redis registration. */
export type DefaultRedisModuleOptions = RedisConnectionOptions & {
  /** Whether the default Redis aliases should be visible globally. Defaults to `true`. */
  global?: boolean;
  /** Timeout controls for lifecycle-owned `connect()` and `quit()` calls. */
  lifecycle?: RedisLifecycleOptions;
  name?: undefined;
};

/** Options accepted by an additional named Redis registration. */
export type NamedRedisModuleOptions = RedisConnectionOptions & {
  /** Timeout controls for lifecycle-owned `connect()` and `quit()` calls. */
  lifecycle?: RedisLifecycleOptions;
  /** Registration name used to derive named raw-client and facade tokens. */
  name: string;
  /** Named Redis registrations remain scoped to their importing module. */
  global?: false;
};

/**
 * Options accepted by {@link RedisModule.forRoot}.
 *
 * Fluo always enables `lazyConnect` internally so the client connects during
 * application bootstrap instead of import time.
 */
export type RedisModuleOptions = DefaultRedisModuleOptions | NamedRedisModuleOptions;

/** Redis constructor options after Fluo module-only fields are removed. */
export type RedisClientOptions = RedisConnectionOptions;
