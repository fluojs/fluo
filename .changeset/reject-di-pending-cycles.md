---
'@fluojs/di': patch
---

Reject cycles across pending singleton and request-scoped resolutions, and prevent request-scope overrides from introducing new singleton providers.
