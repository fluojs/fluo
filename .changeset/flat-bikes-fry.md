---
'@fluojs/di': patch
---

Lazily materialize request-scope container tracking and caches so singleton-only request paths avoid the fixed request-scope lifecycle overhead while preserving request-local isolation and disposal behavior.
