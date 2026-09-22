import { type Constructor, Inject, Module } from '@fluojs/core';
import { getRedisClientToken, getRedisServiceToken, RedisModule, RedisService } from '@fluojs/redis';

/**
 * Complete canonical session store from the Redis package guide
 * (apps/docs/content/docs/packages/redis.mdx), plus the named-client
 * fragment. The guide's fixtures run this app against a real Redis server
 * started by the repository's native fixture harness.
 */

export interface SessionRecord {
  userId: string;
  createdAt: string;
}

export function createSessionsApp(redisOptions: { host: string; port: number }): {
  SessionsModule: Constructor;
  SessionStore: Constructor<{
    save(sessionId: string, userId: string): ReturnType<RedisService['set']>;
    saveWithTtl(sessionId: string, userId: string, ttlSeconds?: number): ReturnType<RedisService['set']>;
    find(sessionId: string): Promise<SessionRecord | string | null>;
    destroy(sessionId: string): ReturnType<RedisService['del']>;
    rawClient(): ReturnType<RedisService['getRawClient']>;
  }>;
  AnalyticsStore: Constructor<{
    clientIdentity(): {
      defaultClient: ReturnType<RedisService['getRawClient']>;
      analyticsClient: unknown;
      analyticsFacadeIsDefault: boolean;
    };
  }>;
  ANALYTICS_REDIS_CLIENT: ReturnType<typeof getRedisClientToken>;
} {
  @Inject(RedisService)
  class SessionStore {
    constructor(private readonly redis: RedisService) {}

    save(sessionId: string, userId: string) {
      // JSON-serialized; integer TTL seconds use Redis EX.
      return this.redis.set(`session:${sessionId}`, { userId, createdAt: '2026-01-01T00:00:00.000Z' }, 3600);
    }

    saveWithTtl(sessionId: string, userId: string, ttlSeconds?: number) {
      return this.redis.set(`session:${sessionId}`, { userId, createdAt: '2026-01-01T00:00:00.000Z' }, ttlSeconds);
    }

    find(sessionId: string) {
      // Parsed JSON, or null when the key is missing or expired.
      return this.redis.get<SessionRecord>(`session:${sessionId}`);
    }

    destroy(sessionId: string) {
      return this.redis.del(`session:${sessionId}`);
    }

    rawClient() {
      return this.redis.getRawClient();
    }
  }

  const ANALYTICS_REDIS = getRedisServiceToken('analytics');
  const ANALYTICS_REDIS_CLIENT = getRedisClientToken('analytics');

  @Inject(RedisService, ANALYTICS_REDIS, ANALYTICS_REDIS_CLIENT)
  class AnalyticsStore {
    constructor(
      private readonly defaultRedis: RedisService,
      private readonly analyticsRedis: RedisService,
      private readonly analyticsClient: unknown,
    ) {}

    clientIdentity() {
      return {
        defaultClient: this.defaultRedis.getRawClient(),
        analyticsClient: this.analyticsClient,
        analyticsFacadeIsDefault: this.analyticsRedis === this.defaultRedis,
      };
    }
  }

  @Module({
    imports: [
      RedisModule.forRoot(redisOptions),
      RedisModule.forRoot({ ...redisOptions, name: 'analytics' }),
    ],
    providers: [SessionStore, AnalyticsStore],
  })
  class SessionsModule {}

  return { SessionsModule, SessionStore, AnalyticsStore, ANALYTICS_REDIS_CLIENT };
}

export function createDuplicateRegistrationsApp(redisOptions: { host: string; port: number }) {
  @Module({
    imports: [
      RedisModule.forRoot(redisOptions),
      RedisModule.forRoot({ ...redisOptions, port: redisOptions.port + 1 }),
    ],
  })
  class DuplicateRegistrationsModule {}

  return { DuplicateRegistrationsModule };
}
