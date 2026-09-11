# Passport Cookie Preset Migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-passport-cookie-preset.ko.md"><kbd>한국어</kbd></a></p>

## Scope

`@fluojs/passport` now uses `CookieAuthModule.forRoot(...)` as the only cookie preset registration recipe. It registers `CookieAuthStrategy`, `CookieManager`, `AuthGuard`, and the matching Passport strategy registry entry. `CookieManager.create(...)` is the class-owned path for a separately owned manager. The Passport.js bridge remains a distinct integration capability.

## Imports and calls

| Removed surface | Replacement |
| --- | --- |
| `createCookieAuthPreset(config)` | `CookieAuthModule.forRoot(config)` |
| `createCookieAuthStrategyRegistration()` | The registry registration inside `CookieAuthModule.forRoot(config)` |
| `createCookieManager(config)` | `CookieManager.create(config)` |
| `CookieAuthPresetConfig` | `CookieManagerConfig` |

## Configuration migration

Replace independently configured reader and writer names with one shared configuration:

```ts
// Before
CookieAuthModule.forRoot({
  cookieAuth: { accessTokenCookieName: 'session_access' },
  cookieManager: {
    accessTokenCookieName: 'session_access',
    cookieOptions: { path: '/sessions' },
  },
});

// After
CookieAuthModule.forRoot({
  accessTokenCookieName: 'session_access',
  cookieOptions: { path: '/sessions' },
});
```

The new configuration feeds both the credential reader and response-cookie writer. Access and refresh names remain distinct configurable values, but the reader and writer must share the configured access name and must share the configured refresh name. Keep `JwtModule.forRoot({ global: true, ... })` as a sibling import for `DefaultJwtVerifier`.

For cookie plus bearer or Passport.js bridge auth, keep one registry by moving the other named registrations into `CookieAuthModule.forRoot(...)` and removing the sibling `PassportModule.forRoot(...)`:

```ts
CookieAuthModule.forRoot(
  { accessTokenCookieName: 'session_access' },
  { defaultStrategy: 'jwt' },
  [createBearerJwtStrategyRegistration()],
);
```

## Preserved capabilities

`CookieManager` keeps its public constructor, DI class token, `instanceof` identity, structured cookie options, per-token TTL precedence, and clear behavior. `cookieOptions.maxAge` is seconds and becomes portable HTTP `maxAgeSeconds`; precedence is positional TTL, matching per-token TTL, then `maxAge`. Auth cookies default to `Path=/`, `Secure`, `HttpOnly`, and `SameSite=Strict`, whereas general HTTP `setCookie(...)` adds none of those auth defaults. `createPassportJsStrategyBridge(...)` retains its timeout, shutdown, and principal-mapping behavior because it integrates third-party Passport.js strategy instances rather than registering the cookie preset.

## Release impact

This is a breaking public API removal recorded as a patch Changeset under the lane policy. Update imports and configuration before upgrading; no compatibility aliases remain at the package root or generated declarations.
