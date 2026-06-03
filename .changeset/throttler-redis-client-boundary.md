---
"@fluojs/throttler": patch
---

Expose a structural Redis client contract for `RedisThrottlerStore` so the root `@fluojs/throttler` API no longer leaks the concrete `ioredis` constructor type while remaining compatible with `ioredis` and `@fluojs/redis` clients.
