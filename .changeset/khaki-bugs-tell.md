---
'@fluojs/passport': minor
---

Make cookie-auth guest access explicit by requiring `@UseOptionalAuth(...)` when routes intentionally allow missing credentials.

Protected routes now reject missing cookie credentials even when `requireAccessToken: false`, so applications that previously relied on anonymous cookie principals should switch those guest-capable handlers to `@UseOptionalAuth('cookie')`.
