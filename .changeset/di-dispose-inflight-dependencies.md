---
"@fluojs/di": patch
---

Dispose cached dependencies materialized by in-flight resolutions after disposal starts, including uncached transient and multi-provider roots and resolutions started from request children, preserving reverse creation order and failed-hook retry ownership.
