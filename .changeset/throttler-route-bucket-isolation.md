---
"@fluojs/throttler": patch
---

Preserve route-bucket isolation for handlers that share the same HTTP method, path, version, and method name by including controller identity in throttler storage keys.
