---
'@fluojs/throttler': patch
---

Anchor `RedisThrottlerStore` rate-limit windows to Redis server time so distributed deployments keep one shared reset boundary even when application node clocks drift.
