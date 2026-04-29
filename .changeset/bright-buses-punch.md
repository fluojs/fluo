---
'@fluojs/http': patch
---

Improve `@fluojs/http` dispatcher and route-matching hot paths by short-circuiting empty middleware/guard/interceptor/observer chains and pre-indexing static routes for faster request matching.
