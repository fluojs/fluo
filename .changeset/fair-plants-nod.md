---
'@fluojs/jwt': minor
---

Fix async `JwtModule.forRootAsync(...)` refresh-token export parity with the sync registration path, and keep `JwtService.verify(token, options)` on the shared JWKS/key-resolution cache when applying per-call verification overrides.
