# Protecting Legitimate Users and the Service

<!-- book:volume=01-fluoblog;chapter=16 -->

[Previous: Who Can Edit This Post?](./ch15-authorization.md) | [Volume 1 Contents](./toc.md) | [Next: Building Pages for Readers and Screens for Authors](./ch17-react-reading-and-writing.md)

## Even Correctly Rejected Requests Can Slow the Service

FluoBlog's login error rate suddenly rises. The operator rechecks the previous chapter's tests. Incorrect passwords produce 401, attempts to edit another person's post produce 403, and the data remains unchanged. Yet legitimate contributors wait a long time at the login screen, and saving posts is slow too. The same client has been sending request after request with different candidate passwords. Every failed request looks up an account and computes an expensive password hash; repeating correct rejections alone consumes resources.

Authorization and rate limiting answer different questions. Authorization asks, "May this person perform this operation?" Rate limiting asks, "May we spend resources on this request now?" A legitimate account can repeatedly click Save, and an anonymous user needs limits before logging in. Solving this problem by lowering Chapter 13's hashing cost would also make leaked hashes easier to guess. Put an allowance ahead of expensive work, and tell rejected legitimate users when they can try again.

This chapter begins with limits that explicitly operate within a single Node.js 24 process. `@fluojs/throttler` enforces per-route policies at the guard stage, while `@fluojs/http` connects guard execution to 429 responses. Later, we explain how the storage contract changes with multiple instances, but we are not installing Redis or changing production infrastructure now. The goal is to protect the same blog's authentication and post modules, not to build a separate security service.

## Decide What the Limit Applies To First

Allow one client five login attempts in a 60-second window, three registrations in a 300-second window, and 20 post edits in a 60-second window. These values are starting policies for an early product with no operational data. Five login attempts do not reset together at the start of each calendar minute: they belong to a fixed window that begins with the first request. Continuing requests do not push the expiration time back.

The current default client identifier is a trusted connection address. Limiting login attempts only by account name would let an attacker repeatedly submit a victim's email and block that account from logging in at all. Limiting only by IP, on the other hand, makes people behind a school or company's NAT share an allowance. No key perfectly represents a person. We therefore separate low login and registration limits from the higher editing limit, and observe false positives together with request costs in operation.

The counter also includes the route identifier. Spending the `/auth/login` budget does not reduce the `/auth/register` budget by the same amount. Likewise, `PUT /posts/:id` shares a handler budget instead of giving every post ID its own budget. Do not use the number in the actual request path as a key that lets an attacker create fresh buckets by changing post IDs. One counter for the entire API and separate limits for individual routes are different choices too.

Fluo's current `Throttle` policy is a single `{ ttl, limit }`. `ttl` is measured in seconds and must be a positive, finite integer. Copying a millisecond value from another framework as `ttl: 60_000` gives 60,000 seconds, not one minute. There is no named multi-window API for simultaneously declaring a short burst limit and a long-term total limit. If needed, explicitly combine distinct limiting layers; do not assume repeating a decorator on the same method creates two windows.

## Distinguish Module Registration from Actual Execution

The following is the **complete file `src/protection/protection.module.ts`**. If no store is specified, the guard instance owns in-memory counters. Do not change policy live by mutating registration options later. The current contract validates and captures values at registration, so changing policy means configuring the application with new settings.

```ts
import { Module } from '@fluojs/core';
import { ThrottlerModule } from '@fluojs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 30,
      global: true,
      trustProxy: false,
    }),
  ],
})
export class ProtectionModule {}
```

Import `ProtectionModule` in `src/app.ts` and add it once to the existing `AppModule.imports`. Keep the existing Prisma registration, `AuthModule`, and `PostsModule`. `global: true` makes `ThrottlerGuard` injectable in other modules. It does not automatically install a limit on every route. A login path without the guard continues running without limits after module registration.

The following is a **change fragment for Chapter 14's `src/auth/auth.controller.ts`**. Keep the existing `@Inject(AuthService, AccountsService)`, constructor, method bodies, and DTO declarations. `ThrottlerGuard` is the actual DI token registered through `ProtectionModule`, and `@UseGuards` resolves it from the request container. Incorrect passwords pass through the same guard as successful logins.

```diff
 import {
   BadRequestException,
   ConflictException,
   Controller,
   FromBody,
   Get,
   Header,
   HttpCode,
   Post,
   RequestDto,
   UnauthorizedException,
+  UseGuards,
   type RequestContext,
 } from '@fluojs/http';
+import { Throttle, ThrottlerGuard } from '@fluojs/throttler';

   @Post('/login')
+  @UseGuards(ThrottlerGuard)
+  @Throttle({ ttl: 60, limit: 5 })
   @HttpCode(200)
   @Header('Cache-Control', 'no-store')
   @RequestDto(LoginInput)

   @Post('/register')
+  @UseGuards(ThrottlerGuard)
+  @Throttle({ ttl: 300, limit: 3 })
   @HttpCode(201)
   @Header('Cache-Control', 'no-store')
   @RequestDto(RegisterInput)
```

If we wait until the outcome is known to deduct an allowance, many password verifications started together can all be admitted. This guard consumes the request allowance before running the handler. Five failed login attempts therefore exhaust the budget too. The sixth request receives 429 within this window even if its password is correct. That does not mean the server has checked the password and is asking the user to wait a moment; it means the server has not yet allocated resources to that work.

Add a limit to Chapter 15's editing path too. The following is a **change fragment for `src/posts/post-editing.controller.ts`**. Keep the existing class-level `@Inject(PostEditingService)`, `@UseAuth('blog-jwt')`, and `@RequireScopes('posts:write')`. The limit does not replace ownership decisions or version-conflict handling.

```diff
  import {
   Controller, HttpCode, Put, RequestDto, UnauthorizedException,
-  UseInterceptors, type RequestContext,
+  UseGuards, UseInterceptors, type RequestContext,
 } from '@fluojs/http';
+import { Throttle, ThrottlerGuard } from '@fluojs/throttler';

   @Put('/:id')
   @HttpCode(200)
+  @UseGuards(ThrottlerGuard)
+  @Throttle({ ttl: 60, limit: 20 })
   @UseAuth('blog-jwt')
   @RequireScopes('posts:write')
   @ApiSecurity('bearer')
   @RequestDto(EditPostDto)
```

The current default key does not read the principal, so its meaning does not depend on the relative order of the authentication and throttling guards. Order does, however, affect which error appears first and which cost is incurred first. If a request with an expired token ends with 401 first, it may not consume a later throttling counter. When composing guards, do not guess from declaration order alone: use a real HTTP integration test to check the response and whether expensive providers are called.

Avoid a solution that merely renames the guard `AuthenticatedThrottleGuard` and uses an unverified `Authorization` string as its key. An attacker can keep generating arbitrary token strings to create a fresh bucket each time, and raw tokens will remain in storage keys. If per-user limits are needed, configure an application guard with guaranteed execution order so it uses `requestContext.principal.subject` after authentication completes. Keep the IP limit in front of login separately so it also protects the expensive authentication stage.

## Proxy Headers May Be Client Claims

Seeing every request as `127.0.0.1` in development is expected. In a real deployment, the server may see only the reverse proxy's address. But blindly trusting the first `X-Forwarded-For` value would give an external client a fresh budget whenever it changes that header. Declare a trust boundary grounded in the network topology.

For example, if the proxy address actually observed by the application is `192.0.2.10` and that proxy sanitizes external forwarding headers, you can replace the earlier `trustProxy: false` with the following **registration option fragment**. This is an illustrative address, not a default to copy into production configuration.

```ts
trustProxy: ['192.0.2.10/32']
```

You can also observe the selected result with `resolveHttpConnection` from `@fluojs/http`. The following is the **complete file `src/protection/client-address.ts`**. It is a diagnostic function with the same trust boundary as the limiting policy and does not serialize the entire request into logs. In a real deployment, supply both address lists from one application configuration value.

```ts
import { resolveHttpConnection, type RequestContext } from '@fluojs/http';

export function inspectClientAddress(context: RequestContext) {
  const connection = resolveHttpConnection(context.request, {
    trustProxy: ['192.0.2.10/32'],
  });
  return {
    clientAddress: connection.clientAddress,
    remoteAddress: connection.remoteAddress,
  };
}
```

Forwarding headers from an untrusted peer cannot replace the direct connection address. Malformed forwarding information is not adopted as an arbitrary identity either. On a host with no trustworthy connection identifier at all, the default throttler throws an exception. Its contract does not silently merge all users into a single `unknown` bucket. The existence of a URL on a Fetch request does not make that URL's host a usable client IP.

Review this configuration whenever another proxy is added. A simple hop count is useful with a fixed network path, but opening a bypass path can change which position is trusted. Where possible, specify the actual proxy address ranges and inspect direct-access paths too. `trustProxyHeaders: true` is a compatibility option that broadly trusts headers, not shorthand for "trust only my one proxy."

## Experiment Without Waiting for the Window

We can first verify counter timing in a small, deterministic experiment rather than an HTTP test that waits 60 seconds at a time. The following is the **complete file `experiments/throttle-window.mjs`**. It imports the actual public `createMemoryThrottlerStore` and supplies explicit input times. The experiment also reveals that the store returns an incremented counter instead of rejecting a request over the limit. Producing 429 is the guard's responsibility.

```js
import assert from 'node:assert/strict';
import { createMemoryThrottlerStore } from '@fluojs/throttler';

const store = createMemoryThrottlerStore();
const key = 'login:client-a';
const start = 1_800_000_000_000;
const first = await store.consume(key, { now: start, ttlSeconds: 60 });
const burst = await Promise.all(
  Array.from({ length: 5 }, () =>
    store.consume(key, { now: start + 1, ttlSeconds: 60 }),
  ),
);
assert.equal(first.count, 1);
assert.deepEqual(burst.map((entry) => entry.count), [2, 3, 4, 5, 6]);
assert.ok(burst.every((entry) => entry.resetAt === start + 60_000));

const beforeReset = await store.consume(key, {
  now: start + 59_999,
  ttlSeconds: 60,
});
assert.equal(beforeReset.count, 7);
assert.equal(beforeReset.resetAt, start + 60_000);

const atReset = await store.consume(key, {
  now: start + 60_000,
  ttlSeconds: 60,
});
assert.equal(atReset.count, 1);
assert.equal(atReset.resetAt, start + 120_000);

const anotherProcess = createMemoryThrottlerStore();
assert.equal((await anotherProcess.consume(key, {
  now: start + 1,
  ttlSeconds: 60,
})).count, 1);
console.log('fixed-window and process-isolation checks passed');
```

```bash
node experiments/throttle-window.mjs
```

It is not a bug that the counter reaches the sixth request in the first window. With a limit of 5, the guard rejects requests where `count > limit`. Rejected requests still increment the counter, but `resetAt` remains unchanged, so an attacker cannot extend the window indefinitely by continuing to send requests. This algorithm can allow a brief burst of five requests just before a window boundary and five just after it. If strict instantaneous rate control is needed, choose another policy, such as a token bucket or sliding window.

The second store at the end of the experiment models process isolation. It does not mean an actual second process was launched, but it verifies the public behavior that separate stores do not share a budget even for the same key. With two servers, the total allowance can roughly double, and restarting a server clears its in-memory windows. Relying on load-balancer session affinity does not adequately solve this problem because failures or rescheduling can break that assumption.

## What Changes with Multiple Instances and Store Failures

Sharing a request allowance across instances requires an atomic storage operation. `ThrottlerStore.consume(key, { now, ttlSeconds })` returns `count` and `resetAt` reflecting the current request. Splitting "read the current value -> increment in the application -> write it back" across network round trips lets concurrent requests read the same old value and lose some increments. Merely calling the replacement store Redis does not provide atomicity.

`RedisThrottlerStore` updates the counter and expiration in one Lua operation. It uses Redis `TIME` rather than the application's `now` for the window's time and returns the remaining duration as `retryAfterMs`. This choice allows applications A and B to use the same storage window and retry interval even if A's clock runs ahead of B's. The default guard rounds this value up to seconds to produce a `Retry-After` of at least one second.

The following is the **complete composition-function file `src/protection/distributed-protection.ts`**. It is a replacement registration for the transition to multiple instances, not code to import alongside the current in-memory module. The parameter is the public structural type of an already prepared connection; this function does not create a Redis server or own connection shutdown. The caller must connect and dispose of the client within its own startup and shutdown boundaries.

```ts
import {
  RedisThrottlerStore,
  ThrottlerModule,
  type RedisThrottlerClient,
} from '@fluojs/throttler';

export function createDistributedProtection(client: RedisThrottlerClient) {
  return ThrottlerModule.forRoot({
    global: true,
    ttl: 60,
    limit: 30,
    trustProxy: false,
    store: new RedisThrottlerStore(client),
  });
}
```

When adding the module returned by this function to `AppModule.imports`, remove the earlier `ProtectionModule` registration. Do not make two default policies compete for the same `ThrottlerGuard` token. Asynchronous client preparation must finish before this synchronous registration. The current package has no `ThrottlerModule.forRootAsync`. Instead of inventing a convenient method name for the example, pass a prepared resource from the existing application's composition boundary.

When the store fails, the guard propagates the failure and does not create `Retry-After` as though a limit had been exceeded. A Redis connection failure must therefore not be presented as 429. This book's default policy does not proceed with sensitive work when the limit cannot be checked. You may choose to allow requests during an outage to preserve login availability, but must accept that protection disappears during an attack. Silently falling back to memory also changes a distributed limit into a local one, so do not introduce that policy without observability.

Distributed keys include the route's module, controller, method, path, and version, along with the compiled handler identifier. Instances with the same build structure share a bucket, but moving a controller or changing artifact structure during a rolling deployment requires checking whether the window continues across versions. Hardcoding internal key strings in consumer code is not a supported migration strategy. If strict quotas are required, define continuity across deployments as part of the application's storage policy too.

## Some Costs Are Beyond Rate Limiting's Reach

Guards run after a request's route has been selected. They do not protect against every cost of network connections, very large JSON bodies, slowly transmitted requests, or header parsing. In particular, Chapter 15's UTF-16 length check for `content` runs after the body has been read. Set body-size and connection-time limits at the host and proxy as well, and apply separate size and format boundaries to file uploads in Chapter 18. Registering one guard does not solve all denial-of-service attacks.

`@fluojs/http` also provides `createRateLimitMiddleware` for an earlier stage. Its option is `windowMs`, and its store has a `get`, `set`, `increment`, and `evict` contract. This differs from `ThrottlerStore`'s atomic `consume` contract, so the two stores are not directly interchangeable. Nor does implementing each of the middleware's storage calls justify a general claim of distributed atomicity. The sensitive routes in this chapter use the throttler path with its explicit contract.

Keep account locking separate from request limiting too. Automatically setting `User.status = disabled` after several failed passwords lets an attacker suspend someone else's account. In this product, `disabled` is an account-lifecycle policy, while rate limiting is a short-window resource policy. A single 429 does not increment `authVersion` or log out every device.

## Verify Rejection from a Legitimate User's Perspective

Use a development Node server that supplies a real connection address for HTTP verification. Do not expect an arbitrary IP header added by a request tool to change the default identity. From the same development client, submit five well-formed but incorrect passwords to `POST /auth/login`. They should return 401; the sixth should return 429 with a positive integer `Retry-After`. Observing the number of calls at the application's hashing boundary should show that the rejected sixth request does not perform a hash comparison.

For a concurrency test, fix the test process's clock and start ten requests together while retaining the real in-memory store, guard, and HTTP dispatch. If all credentials are incorrect, expect five requests to reach password verification and five to end at the limit. You may use observable boundary doubles in place of the real database or hashing, but replacing the guard with a fake limiter whose results are predetermined cannot find this defect. Close the application when the HTTP test ends so counters and connections do not carry into the next test.

Check header forgery as well. On a direct connection, a different `X-Forwarded-For` on every request must still consume the same connection address's budget. In the trusted-proxy experiment, configure both the test request's actual peer and explicit forwarding information. Verify both outcomes: budgets separate for a trusted peer and do not separate for an untrusted peer. Record simulated peer information separately from actual socket verification.

Do not assert that all of the first 20 editing requests save successfully. They can still return 401, 403, or 409. Preserve each failure's data invariants while observing that requests no longer reach the persistence service once the allowance is exhausted. Also note that a method's `@Throttle` cannot reenable throttling on a class marked `@SkipThrottle`. Skipping the entire authentication controller to exempt public queries also exempts login. We explicitly select only the methods to protect here, so no such global exception is necessary.

The storage experiment, HTTP load experiment, and real Redis connection experiment above were not run while writing this manuscript. The commands and results presented are reproduction procedures and expected values. The evidence below shows which behaviors the packages' store and guard sources and existing tests verify; IP forwarding, clocks, and client lifecycle in your deployment require separate verification.

The interface must not show 429 as an ordinary login failure. Stop automatic retries for `Retry-After` and preserve the entered content. Distinguish 401 as requiring reauthentication, 403 as requiring a permissions explanation, and 409 as requiring comparison with the latest post. Start operational metrics with per-route counts of allowed requests, rejected requests, and store errors; do not put emails or tokens in metric labels. High identifier cardinality increases memory use and cost while unnecessarily spreading personal data.

FluoBlog now evaluates users, login state, post ownership, and request budgets at separate boundaries. The next chapter brings these contracts into React screens. The interface's job is not to replace server decisions, but to let readers read posts, authors keep their drafts, and users choose their next action even after a failure.

## Evidence and Further Source Reading

- [Throttler registration, units, proxies, and migration limitations](../../packages/throttler/README.md)
- [Throttler public exports](../../packages/throttler/src/index.ts), [store input and output types](../../packages/throttler/src/types.ts)
- [Guard key construction, consumption, and 429 handling](../../packages/throttler/src/guard.ts)
- [In-memory window implementation](../../packages/throttler/src/store.ts), [Redis atomic consumption implementation](../../packages/throttler/src/redis-store.ts)
- [HTTP integration, visibility, and store-failure tests](../../packages/throttler/src/module.test.ts), [Redis time-contract tests](../../packages/throttler/src/redis-store.test.ts)
- [HTTP connection trust and guard contracts](../../packages/http/README.md), [connection identity implementation](../../packages/http/src/connection.ts)
- [The HTTP middleware's separate storage contract](../../packages/http/src/middleware/rate-limit.ts)

[Previous Chapter](./ch15-authorization.md) | [Volume 1 Contents](./toc.md) | [Next Chapter](./ch17-react-reading-and-writing.md)
