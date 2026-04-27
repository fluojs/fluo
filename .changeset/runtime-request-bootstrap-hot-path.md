---
"@fluojs/runtime": patch
---

Reduce runtime hot-path overhead by memoizing request metadata materialization, context singleton lookups, and independent bootstrap lifecycle provider resolution.
