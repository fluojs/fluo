---
"@fluojs/cache-manager": patch
"@fluojs/core": minor
"@fluojs/cqrs": patch
"@fluojs/cron": patch
"@fluojs/event-bus": patch
"@fluojs/graphql": patch
"@fluojs/http": patch
"@fluojs/microservices": patch
"@fluojs/openapi": patch
"@fluojs/passport": patch
"@fluojs/queue": patch
"@fluojs/serialization": patch
"@fluojs/throttler": patch
"@fluojs/websockets": patch
---

Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
