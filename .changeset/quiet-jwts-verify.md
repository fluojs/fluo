---
"@fluojs/jwt": patch
---

Make `JwtService` the canonical application API for access-token signing and verification. `JwtService.verify(token, policy?)` now returns `JwtPrincipal`; migrate claims-only callers to `(await jwt.verify(token)).claims`. Pass call-specific verification settings as the optional policy.

Remove `createJwtCoreProviders`, `normalizeRefreshTokenOptions`, and `DefaultJwtVerifier.verifyAccessTokenWithOverrides` from the public API. Register with `JwtModule.forRoot(...)` or `JwtModule.forRootAsync(...)`, use `RefreshTokenService` after configuring `refreshToken`, and replace `verifyAccessTokenWithOverrides(token, policy)` with `verifyAccessToken(token, policy)`.
