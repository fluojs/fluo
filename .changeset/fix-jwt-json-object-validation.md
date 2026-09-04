---
'@fluojs/jwt': patch
---

Normalize non-object JSON JWT headers and payloads to `JwtInvalidTokenError` instead of leaking raw runtime errors.
