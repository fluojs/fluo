---
"@fluojs/jwt": patch
"@fluojs/passport": patch
---

Make `JwtModule` the sole owner of refresh-token crypto, store, and rotation state. `RefreshTokenModule.forRoot()` now aliases the configured JWT `RefreshTokenService` for the Passport HTTP exchange, including async JWT registration, instead of allowing adapter-owned refresh state.

Migration: move every refresh `secret`, `expiresInSeconds`, `rotation`, and `store` value into `JwtModule.forRoot({ global: true, refreshToken: ... })`, then replace `RefreshTokenModule.forRoot(JwtRefreshTokenAdapter)` with `RefreshTokenModule.forRoot()`. `JwtRefreshTokenAdapter`, `REFRESH_TOKEN_MODULE_OPTIONS`, and `RefreshTokenModuleOptions` are removed. Replace Passport's former structural `RefreshTokenService` type with `RefreshTokenService` from `@fluojs/jwt` for the canonical path. A custom `RefreshTokenServicePort` remains supported only alongside a globally visible `JwtModule` verifier and JWT access tokens that it accepts.
