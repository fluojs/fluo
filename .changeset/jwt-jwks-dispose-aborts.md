---
"@fluojs/jwt": patch
---

Abort active JWKS fetches when `JwksClient.dispose()` or `DefaultJwtVerifier.dispose()` clears retained JWKS key material during shutdown or identity-provider reconfiguration.
