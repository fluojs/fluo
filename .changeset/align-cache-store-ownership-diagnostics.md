---
"@fluojs/cache-manager": patch
---

Align cache store ownership diagnostics with runtime teardown responsibility. Custom stores now default to `framework` ownership because `CacheService.close()` owns their optional teardown dispatch. Redis stays `external` to `CacheService`; `@fluojs/redis` owns the lifecycle of an integration-resolved client, while the application owns a directly supplied client. Explicit `storeOwnershipMode` overrides still win.
