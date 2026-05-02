# Caching Contract

<p><strong><kbd>English</kbd></strong> <a href="./caching.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current cache contract across `@fluojs/cache-manager`, `@fluojs/http`, and the optional Redis store path.

## Module and Store Model

| Surface | Current contract | Source anchor |
| --- | --- | --- |
| Module entrypoint | Applications register cache support through `CacheModule.forRoot(...)`. Public options include `store`, `ttl`, `httpKeyStrategy`, `principalScopeResolver`, `redis`, and `isGlobal`. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/module.ts` |
| Cache service | `CacheService` is the direct application cache facade with `get`, `set`, `remember`, `del`, and `reset`. | `packages/cache-manager/src/service.ts` |
| HTTP integration | `CacheInterceptor` performs GET read-through caching and post-write eviction. | `packages/cache-manager/src/interceptor.ts` |
| Memory store | `MemoryStore` keeps cache entries in-process, sweeps expirations lazily on access, and caps live entries at `1,000` by evicting the oldest keys. | `packages/cache-manager/src/stores/memory-store.ts` |
| Redis store | `RedisStore` stores JSON-serialized entries under a prefixed key space, uses `EX` for positive TTL values, and resets by scanning the configured prefix. | `packages/cache-manager/src/stores/redis-store.ts` |

## Cache Key Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Default key source | When `@CacheKey(...)` is absent, `CacheInterceptor` derives the key from `httpKeyStrategy`. | `packages/cache-manager/src/interceptor.ts`, `packages/cache-manager/src/types.ts` |
| Built-in strategies | Supported strategy values are `'route'`, `'route+query'`, `'full'`, or a custom function. The interceptor code handles `'route'` as path-only and treats non-`'route'` built-ins as path plus sorted query string. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/interceptor.ts` |
| Query normalization | For query-sensitive keys, query entries are sorted by key and repeated values are sorted before serialization so reordered query strings map to the same key. | `packages/cache-manager/src/interceptor.ts` |
| Principal isolation | Built-in key strategies append `|principal:<scope>` when `principalScopeResolver` returns a value. Without a custom resolver, authenticated requests append `issuer` and `subject` from `requestContext.principal`. | `packages/cache-manager/src/interceptor.ts` |
| Explicit override | `@CacheKey(...)` may store a static string or a resolver function and overrides the computed GET key for that handler. | `packages/cache-manager/src/decorators.ts` |

## TTL and Write Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Default TTL resolution | `CacheService.set(...)` resolves TTL as `ttlSeconds ?? options.ttl`. | `packages/cache-manager/src/service.ts` |
| Disabled writes | Non-finite TTL values or TTL values below `0` are ignored and produce no cache write. | `packages/cache-manager/src/service.ts` |
| No-expiry entries | `ttl: 0` means no expiration. The memory store omits `expiresAt` for such entries, and the Redis store writes without `EX`. | `packages/cache-manager/src/service.ts`, `packages/cache-manager/src/stores/memory-store.ts`, `packages/cache-manager/src/stores/redis-store.ts` |
| GET-only response caching | `CacheInterceptor` only performs read-through caching for `GET` requests. Non-GET requests skip cache reads and writes. | `packages/cache-manager/src/interceptor.ts` |
| Cacheable response shape | The interceptor skips caching when the handler returns `undefined`, an `SseResponse`, or a response that is already committed. | `packages/cache-manager/src/interceptor.ts` |
| Read-through deduplication | `CacheService.remember(...)` deduplicates concurrent misses per key through an in-flight promise map. | `packages/cache-manager/src/service.ts` |

## Invalidation Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Decorator path | `@CacheEvict(...)` stores one key, a key list, or a resolver function for post-write eviction. | `packages/cache-manager/src/decorators.ts` |
| Eviction timing | For non-GET handlers, eviction runs only after the downstream handler succeeds. If the HTTP response is not yet committed, eviction is deferred until `response.send(...)` or a fallback timer fires. | `packages/cache-manager/src/interceptor.ts` |
| Failure containment | `safeGet`, `safeSet`, and `safeDel` swallow store errors. Cache failures do not fail otherwise successful handlers. | `packages/cache-manager/src/interceptor.ts` |
| In-flight invalidation | `CacheService.del(...)` marks keys that are still loading so `remember(...)` does not repopulate a key that was invalidated during the same load cycle. | `packages/cache-manager/src/service.ts` |
| Full reset | `CacheService.reset()` increments an internal reset version, clears in-flight and pending load bookkeeping, clears in-flight invalidation markers, and resets the underlying store. | `packages/cache-manager/src/service.ts` |
| Store teardown | During application shutdown, `CacheService` calls a custom store `close()` hook, or `dispose()` when `close()` is absent, so resource-owning stores can release sockets, pools, timers, or other external handles. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/service.ts` |

## Constraints

- The built-in memory store is process-local and not cluster-safe. Multi-instance deployments require the Redis store or another shared custom store.
- Redis-backed values must be JSON-compatible because `RedisStore` persists entries with `JSON.stringify(...)` and reconstructs them with `JSON.parse(...)`.
- Cache invalidation is key-based only. The built-in contract does not provide tag-based or wildcard invalidation at the interceptor layer.
- Cache TTL enforcement in the memory store is lazy and access-driven, not timer-driven.
- The cache package defines extensibility through the `CacheStore` interface. Custom stores must implement `get`, `set`, `del`, and `reset`; resource-owning stores should also implement optional `close()` or `dispose()` teardown.
