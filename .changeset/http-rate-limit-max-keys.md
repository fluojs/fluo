---
"@fluojs/http": minor
---

Bound live keys in the default memory rate-limit store with a new `maxKeys` option on `createRateLimitMiddleware(...)` and `createMemoryRateLimitStore({ maxKeys })`, defaulting to 5,000. While the store is full, requests for new keys receive 429 with `Retry-After` set to the earliest live window deadline; active counters are never evicted to grant fresh budgets.

This changes the default for existing configurations: more than 5,000 distinct live keys within one window previously each received a budget. Raise `maxKeys`, or pass `Number.POSITIVE_INFINITY` to restore the unbounded behavior. Invalid `maxKeys` values throw a `RangeError`, and `maxKeys` combined with a custom `store` throws a `TypeError`. Custom stores are unaffected.
