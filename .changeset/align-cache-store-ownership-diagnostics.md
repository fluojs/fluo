---
"@fluojs/cache-manager": patch
---

Align cache store ownership diagnostics with runtime teardown responsibility. Custom stores now default to `framework` ownership because `CacheService.close()` owns their optional teardown dispatch, while Redis stays `external` because its client lifecycle remains application-owned. Explicit `storeOwnershipMode` overrides still win.
