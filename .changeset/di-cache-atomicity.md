---
"@fluojs/di": patch
---

Invalidate already-materialized request-scope child caches when parent or root providers are overridden so request-scoped resolutions cannot reuse stale instances after an override.
