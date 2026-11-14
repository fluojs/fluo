---
"@fluojs/cache-manager": patch
---

Preserve empty cache keys in literal, array, and resolver eviction targets after a confirmed HTTP response commit. Reject non-method placement of CacheKey, CacheTTL, and CacheEvict synchronously before registering metadata.
