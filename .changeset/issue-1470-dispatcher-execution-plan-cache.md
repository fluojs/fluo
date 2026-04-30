---
'@fluojs/http': patch
---

Reduce singleton-route dispatcher overhead by caching stable execution plans while preserving lazy request-scope promotion, route-matched middleware behavior, observer callbacks, and request-scoped DI isolation.
