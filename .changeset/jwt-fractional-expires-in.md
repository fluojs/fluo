---
"@fluojs/jwt": patch
---

Preserve fractional NumericDate precision for numeric per-call `JwtService.sign(..., { expiresIn })` values so short fractional TTLs no longer collapse to whole seconds.
