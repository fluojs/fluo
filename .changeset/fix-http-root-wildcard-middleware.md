---
"@fluojs/http": patch
---

Preserve the canonical `/*` middleware pattern during normalization so root wildcard middleware runs on root and non-root paths. Keep request-scoped middleware dependencies active and preserve root wildcard global-prefix exclusions.
