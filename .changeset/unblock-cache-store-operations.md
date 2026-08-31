---
"@fluojs/cache-manager": patch
---

Run ordinary `CacheService` store reads, writes, and deletes concurrently so a slow store call for one key no longer blocks unrelated keys, while `reset()` and store teardown keep running exclusively after already-started operations settle.
