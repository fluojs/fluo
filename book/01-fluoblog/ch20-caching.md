# Serving Popular Posts Quickly

<!-- book:volume=01-fluoblog;chapter=20 -->

[Previous: Notifying Subscribers About New Posts](./ch19-subscriptions-and-email.md) | [Contents](./toc.md) | [Next: Building Scheduled Publishing and Recurring Jobs](./ch21-scheduled-publishing.md)

## The Notification Worked, and Readers Arrived at the Same Post

After a new-post notification goes out, FluoBlog's read traffic suddenly increases. Requests are not all failing authentication, and the SQL execution plan is not fundamentally wrong. The cost of reading the same published body thousands of times and building the same public response is simply repeated. Even the query improvements in Chapter 12 do not eliminate the cost of doing the same work on every request.

A cache temporarily reuses a computed value. Adding one with only performance in mind can easily create a different problem. The operator initially used the post ID as the key and stored query results from the editor as well. After confirming that their own draft displayed correctly, they opened the same ID in an anonymous browser and saw the draft body. Shortening the TTL does not make exposure during that interval any less real. The cause was adding a cache before defining what its keys and stored values meant.

This chapter optimizes only queries for published public content. We use the existing `Post.status`, `version`, and `publishedAt` without changing conditional updates for draft editing or file uploads. Published posts in Volume 1 are immutable. We do not assume a new feature for editing a published body or reverting it to a draft. Since lists gain new publications, we treat the immutability of a detail body and the freshness of a list as different problems.

## What Can Be Stale, and for How Long?

Before caching, write down the value being reused and the acceptable delay. Public content does not change after publication, so even long-lived reuse does not change what it contains. A list, however, changes when a new post appears. This chapter's list policy allows a new post to take up to 30 seconds to appear. The editor must show the version just saved, so it does not belong in a shared cache. Subscription consent, the email delivery ledger, and authentication results are not part of this body cache either.

A memory store can be effective at first. `CacheModule.forRoot({ store: 'memory' })` uses 300 seconds when TTL is omitted, and the built-in memory store evicts older keys first when the live entry count exceeds 1,000. Do not describe it as a full LRU that refreshes ordering on every read. Memory is fast and requires no connection management, but each app process has different state, and that state disappears on restart.

Choosing Redis lets multiple instances share values. In return, you pay for network round trips, serialization, and operating the server. Do not assume Redis is always faster than PostgreSQL; consider the public body's size, the cost of the source query, and the actual hit ratio together. Handling cache misses and transferring large JSON values may cost more than a basic key read. Do not infer multi-instance production performance from measurements in a single development process.

`CacheService.get()` returns `undefined` on a miss. `null`, `false`, `0`, and the empty string are all valid stored values. Testing for a miss with `if (!cached)` therefore discards valid cached results. There is also a difference from `RedisService.get()`, which returns `null` for an absent value. Using the same Redis does not make the two packages' codecs and sentinels identical.

## Building a Service That Stores Only the Read Model

```bash
pnpm add @fluojs/cache-manager
```

The following `src/posts/public-post-reader.ts` is a complete file. It reuses `PrismaPostsPageStore.readPublished` and `ReadingPost`, which Chapter 18 extended with asset metadata. On a cache miss, we do not issue a new body-only select that omits the cover and attachment list. A small query checks publication status and version on every request; the cache reduces only the work of reading and serializing the large body and asset list.

The `reading-v2-assets` in the cache key is the schema version of the response model containing asset metadata. `Post.version` is the post's data version, so the two serve different purposes. Using a new schema key when deploying a response-field change prevents new code from reading JSON with the old structure. The numeric portions of the string are positive integers already validated at the HTTP boundary. Do not append user-supplied search strings or raw JWTs to the key.

```ts
import { Inject } from '@fluojs/core';
import { CacheService } from '@fluojs/cache-manager';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { ReadingPost } from './post-pages.js';
import { PrismaPostsPageStore } from './prisma-posts-page-store.js';

export class CacheFallbacks {
  readFailures = 0;
  writeFailures = 0;

  record(operation: 'get' | 'set') {
    if (operation === 'get') this.readFailures += 1;
    else this.writeFailures += 1;
  }
}

@Inject(PrismaService, CacheService, CacheFallbacks)
export class PublicPostReader {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly cache: CacheService,
    private readonly fallbacks: CacheFallbacks,
  ) {}

  async readPublished(id: number): Promise<ReadingPost | null> {
    const head = await this.prisma.current().post.findFirst({
      where: { id, status: 'published' },
      select: { version: true, publishedAt: true },
    });
    if (!head || !head.publishedAt) return null;
    const key = `reading-v2-assets:post:${id}:version:${head.version}`;
    let cached: ReadingPost | undefined;
    try {
      cached = await this.cache.get<ReadingPost>(key);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.fallbacks.record('get');
    }
    if (cached !== undefined) return cached;

    const post = await new PrismaPostsPageStore(this.prisma).readPublished(id);
    if (!post) return null;
    try {
      await this.cache.set(key, post, 300);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.fallbacks.record('set');
    }
    return post;
  }
}
```

This implementation handles only `get` and `set` failures separately. If the cache fails, it reads the source, but it does not hide a PostgreSQL error as a "cache miss." The body query sits outside both catch blocks. If the cache write fails, it returns the body already obtained rather than querying it again. Instead of placing raw cache data or user identifiers in error logs, it observes fallback counts separately.

The type parameter in `get<ReadingPost>()` does not validate Redis JSON at runtime. We rely on an application contract that only the serializer above writes to this namespace, together with a schema-versioned key. If you need other systems to use the same namespace, the store becomes an external input boundary and requires schema validation when reading too. Do not silently broaden that assumption in the current code.

The existing query adapter converts `Date` to an ISO string. Assets include only Chapter 18's public metadata and URLs, not bytes, owners, or subscription addresses. RedisStore stores JSON, so it does not preserve class instances, functions, `bigint`, or circular references in their original form. Both misses and hits pass the same `ReadingPost` to React's `ReadingPage`, preventing a regression where the cover and attachment links disappear on a cache hit. Because assets also cannot change after publication, the cover for the same version cannot change between checking publication status and reading the DTO.

The following `src/posts/cached-posts-page-store.ts` is a complete file. It extends the existing query adapter, overriding only the public query and inheriting `readOwnedDraft`. Leave the parent implementation unchanged: changing the parent's `readPublished` itself to call the cache reader would create recursion as a miss reenters the cache. This port has no save method, and React saving continues to delegate to `PostEditingService.edit`. We create neither a new persistence wrapper nor a database client.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { PrismaPostsPageStore } from './prisma-posts-page-store.js';
import type { PublicPostReader } from './public-post-reader.js';

export class CachedPostsPageStore extends PrismaPostsPageStore {
  constructor(prisma: PrismaService<PrismaClient>, private readonly publicPosts: PublicPostReader) {
    super(prisma);
  }

  override readPublished(id: number) {
    return this.publicPosts.readPublished(id);
  }
}
```

Now have the page factory from Chapter 17 create this adapter instead of the default query adapter. The next section completes the actual boundary where DI supplies the new dependency.

## Composing the Named Redis Connection and Modules

The following `src/posts/reading-cache.module.ts` is a complete module factory. It registers cache configuration and the reader in the same graph and exports `PublicPostReader` and `CacheFallbacks`. `posts-cache` is a different connection name from Chapter 19's `mail-jobs`, but different names do not isolate Redis server failures. They may point to the same host and database. Explicit cache prefixes separate the actual stored keys.

```ts
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';
import { RedisModule } from '@fluojs/redis';
import {
  CacheFallbacks, PublicPostReader,
} from './public-post-reader.js';

export function createReadingCacheModule(
  redis: { readonly host: string; readonly port: number },
) {
  @Module({
    imports: [
      RedisModule.forRoot({
        name: 'posts-cache', ...redis,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
      }),
      CacheModule.forRoot({
        global: true,
        store: 'redis',
        redis: { clientName: 'posts-cache' },
        keyPrefix: 'fluo-blog:local:public-cache:',
        ttl: 300,
        httpKeyStrategy: 'route+query',
        ttlJitter: { ratio: 0.1, mode: 'shorten' },
      }),
    ],
    providers: [
      CacheFallbacks,
      PublicPostReader,
    ],
    exports: [PublicPostReader, CacheFallbacks],
  })
  class ReadingCacheModule {}
  return ReadingCacheModule;
}

export const ReadingCacheModule = createReadingCacheModule({
  host: '127.0.0.1', port: 6379,
});
```

This file creates the cache registration identity once. `global: true` lets the JSON `PostsController` resolve the actual `CacheService` and `CacheInterceptor` as well. `PublicPostReader` is exposed to pages through the module export. Named Redis connections are scoped, so do not put `global: true` in the Redis options. The local Redis address can point to the same server as the subscription queue. In deployment, replace the arguments to this one call with validated cache connection options. Do not add new database configuration.

If a socket error waits forever, merely having a catch does not provide a fast fallback. This connection is for an optional cache, so we disable the offline queue and set a command time budget. This choice determines both how long to wait when the server is down and the load the database must handle afterward. This fail-soft behavior applies to requests in an app that has already started. It does not ignore Redis module bootstrap connection failures; deployments that must start without Redis must explicitly choose a memory configuration. Do not copy these options unchanged to the queue worker connection. Queue has BullMQ's required connection constraints and its own ownership rules.

The Redis module creates the client and owns connection and shutdown. CacheService does not close the shared client. You can also pass an external client directly through `CacheModule.forRoot({ redis: { client } })`, but then the application is responsible for the connection lifecycle. Do not duplicate default and named connection registrations, cause a startup conflict, and then work around it by manually opening a socket.

The following is the **complete replacement for `createPostsPagesModule`** in `src/posts/posts-pages.module.ts`. Retain the existing `PostsPages`, `Document`, `PostsModule`, `FormsAuthModule`, `POSTS_PAGE_STORE`, `PrismaService`, and all routes and guards. Remove only the `PrismaPostsPageStore` import and add the three imports below. Do not import symbols already in this file a second time.

```ts
import { CachedPostsPageStore } from './cached-posts-page-store.js';
import { PublicPostReader } from './public-post-reader.js';
import { ReadingCacheModule } from './reading-cache.module.js';

export function createPostsPagesModule() {
  return ReactModule.forRoot({
    imports: [PostsModule, FormsAuthModule, ReadingCacheModule],
    controllers: [PostsPages],
    providers: [
      {
        provide: POSTS_PAGE_STORE,
        inject: [PrismaService, PublicPostReader],
        useFactory: (prisma: unknown, reader: unknown) => {
          if (!(prisma instanceof PrismaService) || !(reader instanceof PublicPostReader)) {
            throw new Error('Expected PrismaService and PublicPostReader.');
          }
          return new CachedPostsPageStore(prisma, reader);
        },
      },
    ],
    renderPage: (page) => createReactServerEntry(
      createElement(Document, null, page),
    ),
  });
}
```

The existing `createPostsPagesModule()` call in the root `src/app.ts` remains unchanged. In `src/posts/posts.module.ts`, also import **the same `ReadingCacheModule` identity** as shown below. Retain the remaining `AuthModule`, provider, controller, and exports arrays. Because the two locations do not call the factory again, the named Redis registration is not duplicated.

```diff
+import { ReadingCacheModule } from './reading-cache.module.js';
@@
-  imports: [AuthModule],
+  imports: [AuthModule, ReadingCacheModule],
```

If configuration must be resolved asynchronously, `CacheModule.forRootAsync({ inject, useFactory, global: true })` is a supported API. Even then, configuration tokens must be runtime providers or global exports visible to that module. `global` is determined by the registration options, not the factory's return value.

## TTL and Invalidation Are Not the Same Thing

CacheService measures TTL in seconds. `set(key, value, 300)` does not mean 300 milliseconds. Adding jitter to positive values can reduce the tendency of keys populated at the same time to all expire at once. The `shorten` setting above keeps 300 seconds as the maximum while reducing the TTL to roughly 270 to 300 seconds. We choose the shortening direction so the allowed delay is not exceeded.

`ttl: 0` means no expiration. `set` / `remember` writes skip negative or non-finite TTLs. Mistaking 0 for "disable the cache" creates long-lived keys. RedisService's direct `set()` has a different contract: a nonpositive or non-finite TTL means persistent storage. Be sure to check this difference when switching facades. Do not mix a service that handles plain Redis values with cache-manager's storage envelope.

Ordinary RedisStore `set` allows positive fractional TTLs. It passes an expiration rounded up to integer seconds to Redis while also recording an internal timestamp. A Redis key still existing therefore does not mean CacheService considers it a hit. In tests, check the actual `CacheService.get()` result, not only Redis's `TTL` value. Atomic updates below use absolute millisecond `PXAT` to preserve fixed expiry.

Deleting the cache before the database commit to make the list fresh immediately after publication is risky. Another request can read the still-uncommitted list and refill it. Even deleting after commit cannot prevent a loader already running in another process from storing an older result afterward. For this chapter's list, we apply a short TTL and accept the maximum visibility delay. This is not a guarantee of immediate freshness. A writer's confirmation screen that must show the new post immediately should query the source.

`CacheService.del()` and `reset()` contain logic to prevent an in-flight `remember()` loader in the same service instance from refilling the cache. That logic is not a distributed barrier aware of in-flight work in every process using Redis. Keeping published posts themselves immutable greatly simplifies the detail cache. If the product later introduces revisions, it will need keys for new revisions and an authoritative query to select the current revision.

## Experimenting With Concurrent Misses Through the Source Contract

The fail-soft reader above deliberately exposes `get -> DB -> set`. Its drawback is that simultaneous requests to a cold key can perform duplicate body queries. Within the same service instance, `CacheService.remember()` combines concurrent misses for the same key into one loader. Choosing it shortens the code, but store failures are also observed as rejections from the direct API, so you must design the policy for distinguishing source failures from cache failures at the same time.

The following `src/posts/cache-contract.test.ts` is a complete Vitest test using the actual public `CacheService` and `MemoryStore`. It is not an application HTTP test or real Redis verification. `Promise.withResolvers()` is available in Node24, and waiting for the loader-start signal avoids depending on accidental microtask ordering or sleeps. The test timeout is an upper bound that turns a missing signal into a failure.

```ts
import { describe, expect, it } from 'vitest';
import {
  CacheService, MemoryStore, type NormalizedCacheModuleOptions,
} from '@fluojs/cache-manager';

const options: NormalizedCacheModuleOptions = {
  store: 'memory', ttl: 300, global: false,
  keyPrefix: 'book-test:', httpKeyStrategy: 'route',
  principalScopeResolver: undefined,
};

describe('cache invalidation boundaries', () => {
  it('does not refill after deletion in the same service', async () => {
    const cache = new CacheService(new MemoryStore(), options);
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<string>();
    const pending = cache.remember('latest-posts', async () => {
      started.resolve();
      return released.promise;
    });
    try {
      await started.promise;
      await cache.del('latest-posts');
      released.resolve('old-list');
      expect(await pending).toBe('old-list');
      expect(await cache.get('latest-posts')).toBeUndefined();
    } finally {
      released.resolve('old-list');
      await pending;
      await cache.close();
    }
  }, 2000);

  it('does not coordinate in-flight loaders across service instances', async () => {
    const store = new MemoryStore();
    const first = new CacheService(store, options);
    const second = new CacheService(store, options);
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<string>();
    const pending = first.remember('latest-posts', async () => {
      started.resolve();
      return released.promise;
    });
    try {
      await started.promise;
      await second.del('latest-posts');
      released.resolve('old-list');
      await pending;
      expect(await second.get('latest-posts')).toBe('old-list');
    } finally {
      released.resolve('old-list');
      await pending;
      await first.close();
      await second.close();
    }
  }, 2000);
});
```

In the first experiment, the caller that already started may receive `old-list`. Invalidation prevents cache refilling; it is not cancellation that changes a past call's return value. The second experiment intentionally expects `old-list` to be stored again. It is a counterexample showing that a shared store alone does not coordinate distributed loaders. Running the same scenario over two actual Redis connections would also verify the network boundary, but the test above itself uses only two service instances in memory.

The following command is what you run after creating the file in your app. It is not output claiming that we ran this application test while writing the manuscript.

```bash
pnpm exec vitest run src/posts/cache-contract.test.ts
```

Jitter spreads expiration across different keys; it does not combine concurrent misses for one popular key. Coalescing in `remember()` is also per process, so ten app instances reading a cold key simultaneously can still produce multiple source queries. You can decide whether to prewarm popular published posts after deployment or limit the source's concurrency budget. Do not rush to add a distributed lock requiring correctness guarantees merely for one cache optimization.

## Updating One Cache Value Without a Key Queue

If two requests read the same number, each adds 1, and each calls `set()`, one increment can be lost. Instead of wrapping this in an application per-key promise queue, use [the cache-manager README's atomic update contract](../../packages/cache-manager/README.md#atomic-updates). This experiment shows cache arithmetic only. It adds no view-count persistence, authentication failure count, lockout duration, or inventory policy, and does not change the immutable body reader above.

The following is a standalone file that can be placed at `src/posts/cache-update.experiment.ts`. It does not replace the existing app module. It goes through module registration and public DI, with no application pending map or key queue.

```ts
import { Inject } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { CacheModule, CacheService } from '@fluojs/cache-manager';

@Inject(CacheService)
class Counters {
  constructor(private readonly cache: CacheService) {}

  increment(key: string) {
    return this.cache.update<number>(key, (value) => ({
      action: 'set',
      value: (value ?? 0) + 1,
    }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
  providers: [Counters],
});

const app = await FluoFactory.createApplicationContext(AppModule);
try {
  const counters = await app.get(Counters);
  console.log(await Promise.all([
    counters.increment('example:counter'),
    counters.increment('example:counter'),
  ])); // [1, 2]
} finally {
  await app.close();
}
```

Both calls follow the same-key FIFO of one store; other keys proceed independently. Memory's `local-process` scope includes facades sharing that `MemoryStore`, not separate store instances. The reducer receives `undefined` for a missing/expired entry and returns an explicit set/delete decision. Omitting TTL uses the configured 60 seconds on creation without extending the absolute expiry on the next increment. Explicit `0` means persistent, invalid TTL rejects with `RangeError`, and update has no jitter. The result is the committed value or `undefined` after explicit deletion.

Ordinary write conflicts can rerun the reducer, so do not call the database, email, or payment systems inside it. The attempt in `{ attempt, signal }` starts at 1, with a default total attempt limit of 16. Nesting a same-key update or awaiting reset/close inside a reducer creates a self-drain deadlock. `del`/`reset`/`close` cancel late reducers; reset/close wait for queued updates, reducers, and isolated connection cleanup. They do not forcibly terminate a reducer that ignores its signal and never settles. A call during reset can reject as `invalidated`; await reset before starting new work. The README owns error categories and propagation of original failures.

Across processes, keep the named RedisModule DI above and apply `redis: { clientName: 'posts-cache', atomicUpdates: true }` to **every participating cache registration**. This requires Redis >=6.2 standalone/single-primary and a nonempty application-specific prefix; Cluster support is not claimed. WATCH checks data and namespace/key invalidation identities, and each operation closes only its isolated duplicate. Ownership of the shared Redis client stays the same. Cancellation before EXEC dispatch prevents commit; cancellation afterward does not undo an already committed result.

This opt-in does not turn `remember()` into a distributed loader. The namespace retains one epoch after reset and a marker for each distinct deleted key until reset. Follow the README's reserved keys and metadata budget; do not externally edit or evict metadata. Reset still uses SCAN and promises neither a snapshot globally fencing new updates after a remote reset begins nor failover durability.

The commands below exercise the same public consumer boundary from an already installed repository workspace. First build the package and its dependency closure to emit the required modules, then run the focused files. The final command uses an isolated Docker `redis:7.4-alpine` container and ephemeral port, failing rather than skipping when the environment is unavailable.

```bash
pnpm --filter '@fluojs/cache-manager...' build
pnpm --dir packages/cache-manager exec vitest run -c vitest.config.ts src/cache-update.test.ts src/cache-update.consumer.test.ts
pnpm --filter @fluojs/cache-manager test:redis
```

## How the Questions Change With HTTP Caching

Apply caching to the public JSON list as well. Add the import below to `src/posts/posts.controller.ts`, and **be sure to apply the following change fragment to the existing GET list method**. Retain Chapter 12's `ListPostsDto -> PostFeed.list(input)` and `{ items, nextCursor }` response, along with Chapter 15's separation of the public controller. `Get` and `UseInterceptors` are already imported, so do not declare them again. `PostsModule` imports `ReadingCacheModule` from the previous section, and its global cache registration supplies the actual interceptor token.

```ts
import { CacheInterceptor, CacheTTL } from '@fluojs/cache-manager';
```

```ts
@Get()
@UseInterceptors(CacheInterceptor)
@CacheTTL(30)
@RequestDto(ListPostsDto)
@ApiOperation({ summary: 'List published posts' })
@ApiResponse(200, { schema: postPageSchema })
list(input: ListPostsDto) {
  return this.feed.list({ limit: input.limit, cursor: input.cursor });
}
```

This list is already cursor-based, so the registration above **must set `httpKeyStrategy: 'route+query'`**. The default `'route'` ignores the query and cannot be used here. `/posts?limit=1` and `/posts?limit=2` have different keys, as do the first page and `/posts?cursor=<nextCursor>&limit=1`. `limit=1&cursor=C` and `cursor=C&limit=1`, which differ only in parameter order, have the same key. C is explanatory notation here; actual requests must use a verifiable cursor returned by `PostFeed`. The key also includes the concrete request path, not the route template.

The query-aware strategy sorts repeated values too. Chapter 12's `PostFeed` rejects repeated limit/cursor values arriving as arrays, so it does not interpret them as ordered inputs. Preserve the existing 400 for an invalid cursor rather than turning it into the first page. Adding a constant key such as `@CacheKey('posts')` overrides the configured strategy, so do not use one on this route. If an authentication principal is present, its principal scope is also added to the key, but this GET still queries only public posts.

Authenticated requests receive a resolvable principal scope, but that alone does not justify caching every user-specific response. You must also consider personal settings, permission changes, cookies, and response-header semantics. The editor in this book remains `private, no-store` and is excluded from server caching too. Browser `Cache-Control` and server CacheService operate at different layers; do not assume that one HTTP header automatically prevents server-side storage.

The interceptor stores only reusable, successful GET handler results. It skips already committed responses, `undefined`, SSE, and non-2xx results. Do not attach it to React's streamed HTML as though that were an ordinary JSON list. That is why we cache only the public DTO beneath the rendering boundary from Chapter 17. `CacheInterceptor` softens store failures and proceeds with the original handler, but direct `CacheService` calls have a different failure contract.

## Evaluating the Cache During Failures and Operation

Compare the same request set with and without caching. The first request is cold, and subsequent requests for the same published post are warm. HTTP status and response DTO should be identical, while warm requests should make fewer SQL calls for the large body. The small publication-status query still runs, so do not expect the total SQL count to reach zero. Recording p95, body-query counts, and cache-error counts alongside average latency lets you verify the claim that it became "faster."

The authorization regression scenario is to prepopulate a public key for a draft ID. Anonymous `/posts/:id/read` must return 404 because it checks publication status before using a cache hit. Reading another user's draft or exposing the editing version and authorId on a cache hit is a failure. This reader does not cache `null` for nonexistent posts, so it also avoids hiding a newly published post behind an earlier negative cache entry.

Run the Redis-outage experiment only in a dedicated development environment. If cache get fails during a request, `CacheFallbacks.readFailures` should increase, and the read result should remain correct as long as PostgreSQL works. A cache set failure must not fail the response either. In contrast, causing a source database failure must not produce a successful response with an empty post or a cache miss. Separately measure the load when all traffic shifts to the database the moment Redis disappears. Fail-soft does not mean unlimited capacity.

`CacheModule`'s `observer.onCacheOperation` provides `operation`, `outcome`, and `durationMs`. It omits keys, values, and error objects to reduce exposure of personal data during collection. A `remember()` call joining the same in-flight loader is also recorded as a `miss` because it did not read an already stored value. Do not equate miss counts with database-call counts. This distinction becomes important when we add metrics in Chapter 22.

Finally, do not turn `reset()` into a universal operational recovery button. RedisStore reset targets cache keys under the configured `keyPrefix`; do not share that prefix with Chapter 19's queue or subscription ledger. With an empty prefix, there is also a limitation: it tracks only keys written by the current store instance. Use a clear namespace for each environment, and prefer deleting the exact key for a problem with one post. A bulk reset cannot replace a correctness fix and can create a sudden cold load across many keys.

FluoBlog now reuses immutable public content and refreshes a dynamically growing list with the permitted delay. Even when email notifications bring a surge of readers, we can explain which costs we reduced. In the next chapter, drafts are published at a chosen time even when the writer is away. Scheduled jobs must also call the existing publishing transaction and delivery ledger; meeting a time requirement is no reason to invent new state transitions or cache-update rules.

## Implementation References

- [Atomic Update API Owner](../../packages/cache-manager/README.md#atomic-updates), [Pure Reducer and TTL](../../packages/cache-manager/src/atomic-update.ts)
- [Atomic Update Regressions](../../packages/cache-manager/src/cache-update.test.ts), [Queue-free Application Consumer](../../packages/cache-manager/src/cache-update.consumer.test.ts), [Real Redis Fixture](../../packages/cache-manager/test/redis-update.native.test.ts)
- `update` emits no existing `CacheObservation` events. Do not interpret the observer evidence below as update instrumentation.
- [Cache-manager README: TTL, Keys, Failures, and Observers](../../packages/cache-manager/README.md), [Public Exports](../../packages/cache-manager/src/index.ts)
- [CacheService remember, del, and reset](../../packages/cache-manager/src/service.ts), [Memory Retention and Expiration Implementation](../../packages/cache-manager/src/stores/memory-store.ts)
- [Cache Contract Tests](../../packages/cache-manager/src/cache-service.test.ts), [Independent-Key Concurrency Tests](../../packages/cache-manager/src/cache-service.concurrency.test.ts)
- [Module Configuration and Client Resolution](../../packages/cache-manager/src/module.ts), [HTTP Interceptor Regression Tests](../../packages/cache-manager/src/interceptor.contract-regression.test.ts)
- [Redis README: TTL Codecs and Connection Lifecycle](../../packages/redis/README.md), [Redis Public Exports](../../packages/redis/src/index.ts)
