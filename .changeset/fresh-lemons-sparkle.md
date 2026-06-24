---
"@fluojs/core": patch
---

Freeze class DI wrapper-token snapshots so caller-owned `forwardRef(...)` and `optional(...)` wrapper mutations cannot rewrite stored injection metadata.
