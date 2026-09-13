---
"@fluojs/cache-manager": patch
---

Make `route+query` the default HTTP cache key strategy and remove the redundant
`full` strategy alias. Normalized module-option and TTL-jitter types are now
internal provider-assembly details rather than package-root exports.

Migration: remove `httpKeyStrategy: 'full'` or replace it with
`'route+query'`. Omitting `httpKeyStrategy` now uses query-aware
`'route+query'`; select explicit `'route'` only for responses intentionally
insensitive to every query value. Application code should register `CacheModule`
with `CacheModule.forRoot(...)` or `forRootAsync(...)` and inject `CacheService`;
replace root imports of normalized option types with application-facing
`CacheModuleOptions` configuration. Memory selector registration still defaults
to `300` seconds, while Redis and supplied custom stores default to `0` (no
expiry). New resource-owning custom stores should implement `close()`; existing
`dispose()`-only stores remain compatible.
