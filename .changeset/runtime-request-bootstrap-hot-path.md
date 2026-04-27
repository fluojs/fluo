---
"@fluojs/runtime": patch
---

Reduce runtime hot-path overhead by memoizing request metadata materialization, safe direct root singleton context lookups, and independent bootstrap lifecycle provider resolution.
