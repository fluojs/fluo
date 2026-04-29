---
'@fluojs/platform-express': patch
---

Preserve fluo routing semantics while letting the Express adapter pre-register safe per-method router entries for explicit routes and fall back to catch-all dispatch for overlapping param shapes, `@All(...)` handlers, and normalization-sensitive requests.
