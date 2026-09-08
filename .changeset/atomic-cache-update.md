---
"@fluojs/cache-manager": minor
---

Add `CacheService.update` for pure, retryable single-key cache mutations with explicit set/delete decisions, fixed-expiry TTL preservation, cancellation, and lifecycle drain.

Provide store-instance-local FIFO updates in MemoryStore and opt-in Redis WATCH transactions using isolated connections, namespace epochs, and per-key invalidation identities. Export the optional custom-store capability and Redis atomic client/transaction seams without requiring changes to legacy stores or the `@fluojs/redis` runtime API.

Document API usage, Redis deployment and metadata requirements, cancellation limits, and queue-free application composition in English and Korean.
