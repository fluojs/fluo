---
"@fluojs/di": patch
---

Dispose cached dependencies materialized by in-flight resolutions after disposal starts, preserving reverse creation order and failed-hook retry ownership.
