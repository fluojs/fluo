---
"@fluojs/http": patch
---

Emit `Vary: Origin` for array and function CORS policies even when the request origin is rejected or absent, or a function returns a wildcard, including preflight responses. Preserve allow-origin selection and explicit or default wildcard policy behavior.
