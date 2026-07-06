---
"@fluojs/jwt": patch
---

Align `JwtModule.forRoot(...)` with async registration by exposing the `RefreshTokenService` provider/export surface even when sync options omit `refreshToken`, while preserving resolution-time configuration failure for callers that resolve the service without refresh-token options.
