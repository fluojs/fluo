# Caching

<p><strong><kbd>English</kbd></strong> <a href="./caching.ko.md"><kbd>한국어</kbd></a></p>

Performance is a first-class citizen in Konekti. The caching system provides a unified interface for both **transparent HTTP response caching** and **programmatic application-level caching**, supporting in-memory and distributed Redis backends.

## Why Caching in Konekti?

- **Transparent Performance**: Improve response times for expensive `GET` requests with a single interceptor.
- **Identity-Aware Caching**: Automatically isolate cached responses by authenticated user (`principal.subject`) to prevent cross-user data leakage.
- **Smart Invalidation**: Use `@CacheEvict()` to clear specific keys automatically when data changes (POST/PUT/DELETE), keeping your cache fresh without manual boilerplate.
- **The "Remember" Pattern**: A built-in `cache.remember()` API that simplifies the "fetch-if-missing, then cache" workflow into a single line.

## Responsibility Split

- **`@konekti/cache-manager` (The Facade)**: Defines the `CacheService` for manual operations and the `CacheInterceptor` for HTTP. It manages the pluggable store architecture.
- **`@konekti/http` (The Hook)**: Provides the lifecycle hooks required for the interceptor to read from and write to the cache during request processing.
- **`@konekti/redis` (The Distributed Store)**: An optional package that allows your cache to persist across multiple application instances via Redis.

## Typical Workflows

### 1. Transparent HTTP Caching
For high-traffic endpoints like product catalogs or public profiles, you can enable caching with zero impact on your business logic.

```typescript
@Get('/')
@UseInterceptors(CacheInterceptor)
@CacheTTL(600) // Cache for 10 minutes
async getProducts() {
  return this.service.findAll(); // Only executes on cache miss
}
```

### 2. Manual Application Caching
For complex computations or external API calls, use the `CacheService` directly within your services.

```typescript
async getExchangeRates() {
  return this.cache.remember('rates:usd', async () => {
    return this.externalApi.fetchRates();
  }, 3600); // Cache for 1 hour
}
```

### 3. Identity-Bound Keys
Konekti's default key strategy is security-first. If a `RequestContext.principal` is present, the cache key automatically includes the user's subject:
- **Default Key**: `route_path + query_params (if enabled) + principal_subject`
- **Result**: User A and User B will never see each other's cached responses, even for the same URL.

## Core Boundaries

- **Lazy Expiry**: To maximize performance, TTL (Time-To-Live) expiry is enforced at the time of access rather than via background timers (in the memory store).
- **Cluster Safety**: For multi-instance deployments, you **must** use the Redis store. The memory store is local to each process and does not synchronize.
- **GET-Only by Default**: The `CacheInterceptor` only caches `GET` requests to ensure safe, idempotent behavior.

## Next Steps

- **Implementation Details**: Deep dive into the [Cache Manager Package](../../packages/cache-manager/README.md).
- **Scalability**: Configure distributed caching with the [Redis Package](../../packages/redis/README.md).
