---
"@fluojs/http": minor
---

Add optional atomic `RateLimitStore.consume(key, { now, windowMs })` and use it in HTTP rate-limit middleware. The built-in memory store now initializes, resets, and increments windows atomically under concurrent requests while preserving fixed deadlines and 429 responses.

Existing custom stores retain the get/set/increment/evict fallback without source changes. Add backend-atomic consume to enforce concurrent or distributed quotas; the legacy fallback remains non-atomic.
