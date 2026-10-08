---
"@fluojs/auth": minor
"@fluojs/auth-http": minor
"@fluojs/passport": minor
"@fluojs/http": patch
"@fluojs/jwt": patch
---

Separate transport-neutral identity, authentication results, strategies and account-linking policy into `@fluojs/auth`, and HTTP guards, registration, bearer, cookie and refresh integration into `@fluojs/auth-http`.

Passport.js action binding remains in `@fluojs/passport`. Existing Passport, HTTP Principal and JWT JwtPrincipal imports remain compatible, including class tokens, metadata and versioned error identities. New applications use auth/auth-http as the canonical owners; JWT signing, verification and refresh rotation semantics are unchanged.
