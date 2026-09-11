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

The new configuration feeds both the credential reader and response-cookie writer, so access and refresh cookie names cannot diverge. Keep `JwtModule.forRoot({ global: true, ... })` as a sibling import for `DefaultJwtVerifier`.

## Preserved capabilities

`CookieManager` keeps its public constructor, DI class token, `instanceof` identity, structured cookie options, per-token TTL precedence, and clear behavior. `createPassportJsStrategyBridge(...)` retains its timeout, shutdown, and principal-mapping behavior because it integrates third-party Passport.js strategy instances rather than registering the cookie preset.

## Release impact

This is a breaking public API removal recorded as a patch Changeset under the lane policy. Update imports and configuration before upgrading; no compatibility aliases remain at the package root or generated declarations.
