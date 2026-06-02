---
"@fluojs/di": patch
---

Improve repeated singleton multi-provider resolution by caching the resolved provider list internally while preserving fresh arrays for callers.
