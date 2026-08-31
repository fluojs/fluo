---
"@fluojs/jwt": major
---

Correct the shipped README contracts for JWT signing timestamps and `JwtService.verify()`.

Migration: `JwtService.verify<T>(token, options)` returns the verified claim bag as `T`; it does not return a normalized `JwtPrincipal`. Consumers that need normalized `subject`, `roles`, `scopes`, `issuer`, `audience`, and `claims` must call `DefaultJwtVerifier.verifyAccessToken(token)` and adapt callers that treated the `JwtService.verify(...)` result as a `JwtPrincipal`.
