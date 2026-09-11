# Passport Cookie Preset 마이그레이션

<p><a href="./migrate-passport-cookie-preset.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위

`@fluojs/passport`는 이제 `CookieAuthModule.forRoot(...)`만을 cookie preset 등록 recipe로 사용합니다. 이 경로는 `CookieAuthStrategy`, `CookieManager`, `AuthGuard`, 대응 Passport strategy registry entry를 등록합니다. 별도로 소유하는 manager는 클래스가 소유하는 `CookieManager.create(...)` 경로를 사용합니다. Passport.js bridge는 별도의 integration capability로 유지됩니다.

## import와 호출

| 제거된 표면 | 대체 표면 |
| --- | --- |
| `createCookieAuthPreset(config)` | `CookieAuthModule.forRoot(config)` |
| `createCookieAuthStrategyRegistration()` | `CookieAuthModule.forRoot(config)` 내부 registry registration |
| `createCookieManager(config)` | `CookieManager.create(config)` |
| `CookieAuthPresetConfig` | `CookieManagerConfig` |

## 설정 마이그레이션

독립적으로 설정하던 reader/writer cookie 이름을 하나의 shared configuration으로 바꾸세요.

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

새 configuration은 credential reader와 response-cookie writer 모두에 전달되므로 access/refresh cookie 이름이 달라질 수 없습니다. `DefaultJwtVerifier`를 위해 `JwtModule.forRoot({ global: true, ... })`는 sibling import로 유지하세요.

## 보존되는 capability

`CookieManager`의 public constructor, DI class token, `instanceof` identity, structured cookie option, token별 TTL 우선순위, clear 동작은 유지됩니다. `createPassportJsStrategyBridge(...)`는 cookie preset 등록이 아니라 third-party Passport.js strategy instance를 통합하므로 timeout, shutdown, principal-mapping 동작을 그대로 유지합니다.

## release 영향

이 변경은 lane policy에 따라 patch Changeset으로 기록하는 breaking public API 제거입니다. 업그레이드 전에 import와 configuration을 바꾸세요. package root나 generated declaration에 compatibility alias는 남지 않습니다.
