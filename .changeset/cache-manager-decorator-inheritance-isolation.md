---
"@fluojs/cache-manager": patch
---

Isolate inherited controller cache metadata before applying CacheKey, CacheTTL, or CacheEvict overrides. Child decorators no longer change parent or sibling cache keys, TTLs, or eviction targets, while unchanged policies and methods continue to inherit normally.
