---
"@fluojs/cache-manager": patch
---

Serialize cache reset and shutdown boundaries so in-flight `remember(...)` loaders cannot repopulate stale entries and closed stores are not touched by later cache operations.
