---
"@fluojs/cache-manager": minor
"@fluojs/redis": patch
---

Add `CacheService.update` for pure, retryable single-key cache mutations with explicit set/delete decisions, fixed-expiry TTL preservation, cancellation, and lifecycle drain.

Provide store-instance-local FIFO updates in MemoryStore and opt-in Redis WATCH transactions using isolated connections, namespace epochs, and per-key invalidation identities. Export the optional custom-store capability and Redis atomic client/transaction seams without requiring changes to legacy stores or the `@fluojs/redis` runtime API.

Document API usage, Redis deployment and metadata requirements, cancellation limits, and queue-free application composition in English and Korean.

The `@fluojs/redis` change is documentation-only: its shipped English and Korean READMEs explain how cache-manager atomic updates use the existing raw Redis client seam, without changing Redis runtime behavior or API.
