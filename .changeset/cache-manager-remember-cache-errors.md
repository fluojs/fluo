---
"@fluojs/cache-manager": minor
---

Add opt-in `rememberCacheErrors: 'bypass'` to synchronous and asynchronous CacheModule configuration. CacheService.remember can bypass only store read/write failures while preserving loader error identity, same-key coalescing, invalidation, and privacy-safe error observations. The default `throw` policy remains unchanged.
