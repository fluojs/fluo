# @konekti/cache-manager

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

General-purpose cache manager for Konekti with pluggable memory and Redis stores. Provides both decorator-driven HTTP response caching and a standalone cache API for application-level caching.

## Installation

```bash
npm install @konekti/cache-manager
```

For Redis-backed caching:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
```

## Quick Start — HTTP Response Caching

```ts
import { Module } from '@konekti/core';
import { Controller, Get, Post, UseInterceptors } from '@konekti/http';
import { CacheEvict, CacheInterceptor, CacheTTL, createCacheModule } from '@konekti/cache-manager';

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30)
  list() {
    return { ok: true };
  }

  @Post('/refresh')
  @UseInterceptors(CacheInterceptor)
  @CacheEvict('/products')
  refresh() {
    return { refreshed: true };
  }
}

@Module({
  imports: [createCacheModule({ store: 'memory' })],
  controllers: [ProductController],
})
class AppModule {}
```

## Quick Start — Application-Level Caching

Use `CacheService` directly for non-HTTP caching needs such as external API responses, computed results, or session data.

```ts
import { Inject } from '@konekti/core';
import { Module } from '@konekti/runtime';
import { CACHE_MANAGER, createCacheModule, type CacheService } from '@konekti/cache-manager';

const EXTERNAL_API = Symbol.for('EXTERNAL_API');

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

@Inject([CACHE_MANAGER])
class UserService {
  constructor(private readonly cache: CacheService) {}

  async getUserProfile(userId: string): Promise<UserProfile> {
    const cacheKey = `user:profile:${userId}`;

    return this.cache.remember(cacheKey, async () => {
      const response = await fetch(`https://api.example.com/users/${userId}`);
      return response.json() as Promise<UserProfile>;
    }, 300); // 5-minute TTL
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(`user:profile:${userId}`);
  }

  async clearAllCache(): Promise<void> {
    await this.cache.reset();
  }
}

@Module({
  imports: [createCacheModule({ store: 'memory', ttl: 60 })],
  providers: [UserService],
})
class AppModule {}
```

## API

### Core Cache Contract

- `CacheStore` — low-level store interface with `get`, `set`, `del`, `reset`.
- `CacheService` — application-level cache API wrapping a store:
  - `get<T>(key)` — retrieve a cached value.
  - `set<T>(key, value, ttlSeconds?)` — store a value with optional TTL override.
  - `remember<T>(key, loader, ttlSeconds?)` — read-through cache: returns cached value or loads, caches, and returns.
  - `del(key)` — remove a single cache entry.
  - `reset()` — clear all entries managed by the store.
- `MemoryStore` — in-process cache with lazy TTL expiration.
- `RedisStore` — Redis-backed cache with JSON codec and scoped `SCAN` + `DEL` reset.

### HTTP Interceptor API

- `CacheInterceptor` — HTTP interceptor for GET response caching with decorator-driven configuration.
- `@CacheKey(value)` — custom cache key (string or resolver function).
- `@CacheTTL(seconds)` — method-level TTL override.
- `@CacheEvict(value)` — evict key(s) after successful non-GET handlers.

### Module Setup

- `createCacheModule(options)` — registers cache providers (default `isGlobal: false`).
- `createCacheProviders(options)` — returns providers for manual composition.
- `createCacheManagerPlatformStatusSnapshot(input)` — maps cache store kind/ownership/readiness into shared platform snapshot shape.
- `createCacheManagerPlatformDiagnosticIssues(input)` — emits shared `PlatformDiagnosticIssue` entries for cache store readiness failures.
- `CACHE_MANAGER` — DI token for `CacheService`.
- `CACHE_OPTIONS` — DI token for normalized module options.

`CacheModuleOptions` primary fields are `store`, `ttl`, `isGlobal`, `httpKeyStrategy`, and `principalScopeResolver`.

## Behavior

### HTTP Interceptor Behavior (CacheInterceptor)

- Cache reads are **GET-only** by default.
- Default cache key depends on `httpKeyStrategy`:
  - `'route'` (default) — matched route path only for unauthenticated requests; authenticated requests append `principal.issuer` + `principal.subject`.
  - `'route+query'` — route path + sorted query string, plus authenticated principal scope when present.
  - `'full'` — route path + sorted query string, plus authenticated principal scope when present; currently equivalent to `'route+query'`.
  - `function` — custom resolver `(context) => string`.
- `principalScopeResolver` — optional function `(context) => string | undefined` that overrides the default `issuer:subject` principal scope segment. When provided, the returned string is appended verbatim as `|principal:<scope>`. Returning `undefined` skips the principal scope entirely for that request.
- `@CacheKey(...)` decorator overrides the module-level strategy for individual handlers.
- `@CacheEvict(...)` runs after the response write of successful non-GET handlers.

> Built-in string strategies are principal-aware by default. If you override the key with `@CacheKey(...)` or a custom function, you are responsible for including any auth, tenant, locale, or header variance required by the route.

#### Query-Sensitive Caching Example

For endpoints where query parameters change the response, use `httpKeyStrategy: 'route+query'`:

```ts
@Module({
  imports: [
    createCacheModule({
      store: 'memory',
      ttl: 30,
      httpKeyStrategy: 'route+query', // cache key includes sorted query params
    }),
  ],
  controllers: [ProductController],
})
class AppModule {}

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60)
  list() {
    // GET /products?page=1  => cache key: '/products?page=1'
    // GET /products?page=2  => cache key: '/products?page=2'
    // GET /products?page=1&sort=asc  => cache key: '/products?page=1&sort=asc'
    return { ok: true };
  }
}
```

#### Migration Note

The default `httpKeyStrategy` is `'route'`. This means:
- Existing applications continue to work without changes.
- Query parameters are ignored in cache keys by default.
- Authenticated requests are isolated by `principal.issuer` + `principal.subject` when `RequestContext.principal` is present.
- For new projects or query-sensitive endpoints, set `httpKeyStrategy: 'route+query'`.

To opt in to query-aware caching globally:

```ts
createCacheModule({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

To opt in per-handler while keeping the default globally:

```ts
@CacheKey((context) => {
  const path = context.handler.metadata.effectivePath;
  const query = new URLSearchParams(
    Object.entries(context.requestContext.request.query)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  ).toString();
  return query ? `${path}?${query}` : path;
})
```

#### Multi-Tenant and Role-Varied Caching

When responses differ by tenant ID, subscription plan, or any other dimension beyond `issuer:subject`, use `principalScopeResolver` to control exactly what gets appended to the cache key.

Scope responses by tenant only (ignores individual user):

```ts
createCacheModule({
  store: 'redis',
  ttl: 60,
  principalScopeResolver: (context) => {
    // context.requestContext.principal is available when the request is authenticated
    const tenantId = context.requestContext.metadata['tenantId'] as string | undefined;
    return tenantId; // undefined = skip principal scope entirely for anonymous requests
  },
})
```

Scope responses by subscription plan:

```ts
createCacheModule({
  store: 'memory',
  ttl: 120,
  principalScopeResolver: (context) => {
    const plan = context.requestContext.metadata['subscriptionPlan'] as string | undefined;
    return plan ?? 'free';
  },
})
```

When `principalScopeResolver` returns `undefined`, no `|principal:…` segment is appended. When it returns a string, the cache key becomes `<base-key>|principal:<scope>`.

> `principalScopeResolver` affects only the default key built by built-in string strategies (`'route'`, `'route+query'`, `'full'`). Handlers that use `@CacheKey(...)` or a custom `httpKeyStrategy` function are unaffected — those handlers own their own key construction and must include scope information themselves.

### General Cache Behavior (CacheService / CacheStore)

- `CacheService` is independent of HTTP context — use it anywhere via DI.
- TTL semantics are consistent across stores: `0` or omitted means no expiry; positive values set expiration.
- `MemoryStore` uses lazy TTL expiration (expired entries cleaned on next read or sweep).
- `RedisStore` stores JSON-encoded entries with application-level expiry tracking.
- `remember()` provides read-through caching pattern for computed or fetched values.
- Store implementations are interchangeable — both `MemoryStore` and `RedisStore` satisfy the `CacheStore` contract.
- Default module TTL is `0` (no expiry).

## Redis bootstrap behavior

- `createCacheModule({ store: 'memory' })` works without `@konekti/redis`/`ioredis` installed.
- `createCacheModule({ store: 'redis' })` requires either:
  - `createRedisModule(...)` imported in the app (providing `REDIS_CLIENT`), or
  - `options.redis.client` with a raw ioredis-style client.

If Redis mode is selected and no client is available, bootstrap fails with an explicit error.

## Platform status snapshot semantics

Use `createCacheManagerPlatformStatusSnapshot(...)` to export cache ownership/readiness/health details aligned with the shared platform contract.

- `storeKind` exposes `memory` / `redis` / `custom` operation.
- `storeOwnershipMode` controls snapshot ownership mapping (`framework` vs `external`).
- `cacheCriticalPath` controls readiness behavior when backing store is unavailable:
  - `false` (default): readiness is `degraded` because request handling can continue with cache misses.
  - `true`: readiness is `not-ready` because cache is declared part of the critical path.
- `details.telemetry.labels` follows shared label keys (`component_id`, `component_kind`, `operation`, `result`).

Use `createCacheManagerPlatformDiagnosticIssues(...)` to emit package-prefixed diagnostics (`CACHE_MANAGER_*`) with actionable `fixHint` text and dependency links.

## Cross-store consistency

Both `MemoryStore` and `RedisStore` implement the `CacheStore` interface with identical semantics:

- `get(key)` returns `undefined` for missing or expired entries.
- `set(key, value, ttl?)` stores the value; `ttl=0` means no expiry.
- `del(key)` removes a single entry.
- `reset()` clears all managed entries.

This allows swapping stores without changing application code — use `MemoryStore` for development/testing and `RedisStore` for production.

## Related packages

- `@konekti/http` — interceptor contracts and route execution
- `@konekti/runtime` — module bootstrap
- `@konekti/redis` — optional Redis client module for DI wiring
