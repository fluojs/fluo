---
"@fluojs/passport": minor
---

Add a built-in bearer JWT strategy preset.

`BearerJwtStrategy` reads RFC 6750 `Authorization: Bearer <token>` credentials, delegates verification to `DefaultJwtVerifier`, and returns the normalized `JwtPrincipal` unchanged. Missing credentials raise `AuthenticationRequiredError`, wrong-scheme or malformed headers raise `AuthenticationFailedError`, and expired tokens raise `AuthenticationExpiredError` with the original JWT verifier error preserved as `cause`. Missing or malformed credentials serialize `WWW-Authenticate: Bearer`; verifier-reported invalid or expired tokens serialize `WWW-Authenticate: Bearer error="invalid_token"`. The preset registers under the stable `BEARER_JWT_STRATEGY_NAME` (`'jwt'`) through the new `createBearerJwtStrategyRegistration()` helper, so applications no longer copy strategy parsing code from examples.
