---
"@fluojs/passport": patch
---

Consolidate the cookie preset under `CookieAuthModule.forRoot(config)`. One `CookieManagerConfig` now supplies both `CookieAuthStrategy` credential names and `CookieManager` response-cookie names. The module registers `CookieAuthStrategy`, `CookieManager`, `AuthGuard`, and the matching Passport registry entry.

Remove `CookieAuthPresetConfig`, `createCookieAuthPreset`, `createCookieAuthStrategyRegistration`, and `createCookieManager` from the public runtime and declaration surfaces. Preserve `CookieManager`'s constructor, class token, instance identity, structured cookie options, token TTL precedence, and clear behavior. Passport.js bridge timeout, shutdown, and principal mapping remain unchanged.

Migration: replace nested `cookieAuth` / `cookieManager` configuration and manual preset assembly with `CookieAuthModule.forRoot({ accessTokenCookieName, refreshTokenCookieName, cookieOptions })`. Replace `createCookieManager(config)` with `CookieManager.create(config)`. See `docs/getting-started/migrate-passport-cookie-preset.md` and `docs/getting-started/migrate-passport-cookie-preset.ko.md`.
