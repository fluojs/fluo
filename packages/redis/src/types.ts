import type { RedisOptions } from 'ioredis';

export type RedisModuleOptions = Omit<RedisOptions, 'lazyConnect'>;
