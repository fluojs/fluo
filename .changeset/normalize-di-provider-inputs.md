---
"@fluojs/di": patch
---

Normalize malformed provider `inject` arrays, dependency wrappers, and `scope` values to structured `InvalidProviderError` failures during registration while preserving class `@Inject(...)` metadata fallback for omitted or `undefined` `inject` values.
