---
'@fluojs/cache-manager': patch
---

Fix built-in HTTP cache key strategies so parameterized routes use the concrete request path and do not collide across different path-param values.
