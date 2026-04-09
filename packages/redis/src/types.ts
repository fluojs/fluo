import type { RedisOptions } from 'ioredis';

/**
 * Options accepted by {@link RedisModule.forRoot}.
 *
 * Konekti always enables `lazyConnect` internally so the client connects during
 * application bootstrap instead of import time.
 */
export type RedisModuleOptions = Omit<RedisOptions, 'lazyConnect'>;
