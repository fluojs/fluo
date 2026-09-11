---
"@fluojs/passport": patch
---

Consolidate the cookie preset under `CookieAuthModule.forRoot(config)`. One `CookieManagerConfig` now supplies both `CookieAuthStrategy` credential names and `CookieManager` response-cookie names. The module owns one Passport registry for `CookieAuthStrategy`, `CookieManager`, and `AuthGuard`; compose bearer or Passport.js bridge registrations through the additional `forRoot` arguments instead of a sibling `PassportModule.forRoot(...)`.

Remove `CookieAuthPresetConfig`, `createCookieAuthPreset`, `createCookieAuthStrategyRegistration`, and `createCookieManager` from the public runtime and declaration surfaces. Preserve `CookieManager`'s constructor, class token, instance identity, structured cookie options, token TTL precedence, and clear behavior. Passport.js bridge timeout, shutdown, and principal mapping remain unchanged.

Migration: replace nested `cookieAuth` / `cookieManager` configuration and manual preset assembly with `CookieAuthModule.forRoot({ accessTokenCookieName, refreshTokenCookieName, cookieOptions })`. Access and refresh names may differ, but each reader/writer pair must use its matching shared name. Replace `createCookieManager(config)` with `CookieManager.create(config)`. `cookieOptions.maxAge` is seconds and maps to portable HTTP `maxAgeSeconds`; auth defaults are `Path=/`, `Secure`, `HttpOnly`, and `SameSite=Strict`, unlike general HTTP `setCookie(...)`. See `docs/getting-started/migrate-passport-cookie-preset.md` and `docs/getting-started/migrate-passport-cookie-preset.ko.md`.
