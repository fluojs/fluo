---
"@fluojs/cache-manager": patch
---

Route cache-manager decorator initialization and effective metadata-bag reads through the documented `@fluojs/core/request-pipeline` seam instead of importing `@fluojs/core/internal` directly.

`@CacheKey(...)`, `@CacheTTL(...)`, and `@CacheEvict(...)` now initialize standard decorator metadata with `ensureRequestPipelineMetadataSymbol()`, and `CacheInterceptor` resolves controller route records with `getRequestPipelineMetadataBag(...)`. Cache metadata inherited from a base controller keeps resolving through the same effective metadata-bag lookup, so decorator storage, cache-key resolution, and commit-gated eviction behavior are unchanged.
