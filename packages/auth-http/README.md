# @fluojs/auth-http

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

HTTP authentication adapter for `@fluojs/auth`. Node.js support is `>=24.0.0 <27`. This explicit integration depends on auth, core, DI, HTTP, JWT and runtime; use the neutral auth root for identity and policies without concrete integrations.

## Installation

```sh
pnpm add @fluojs/auth-http @fluojs/jwt
```

## Public imports and registration

```ts
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import {
  AuthModule, BearerJwtStrategy, createBearerJwtStrategyRegistration,
} from '@fluojs/auth-http';

@Module({
  imports: [
    JwtModule.forRoot({ algorithms: ['HS256'], secret: 'application-owned-secret' }),
    AuthModule.forRoot({ defaultStrategy: 'jwt' }, [createBearerJwtStrategyRegistration()]),
  ],
  providers: [BearerJwtStrategy],
})
export class ApplicationAuthModule {}
```

`AuthModule` is the same class token as legacy `PassportModule`. `forRoot(options?, strategies?)` creates one application-local registry, rejects duplicate names, supports prototype-shadowing names and exports `AuthGuard`, not internal registry/options tokens. `global` defaults to `false`. Register custom providers beside the importing application module. HTTP `AuthStrategy` specializes neutral `AuthStrategy<GuardContext>` without requiring a base class.

## Guards and results

`UseAuth`, `UseOptionalAuth`, `RequireScopes`, `defineAuthRequirement`, and `getAuthRequirement` own HTTP metadata. Guards resolve strategies through the request container, validate principal shape, require every scope, preserve original causes on canonical 401 and return 403 for missing scopes. Roles are validated and passed through, not a new authorization policy. Method mandatory auth overrides optional class auth; class/method scopes merge.

Optional routes allow only explicit `{ authenticated: false }` without required scopes. A thrown missing-credential error still fails. `{ handled: true }` is terminal only after response commitment: no principal validation, assignment, scope enforcement or handler execution follows, even if it carries a principal. Uncommitted completion fails authentication.

## Bearer, cookie and refresh

`BearerJwtStrategy`, `BEARER_JWT_STRATEGY_NAME` (`jwt`) and `createBearerJwtStrategyRegistration` preserve RFC 6750 b64token parsing, case-insensitive header/scheme, ASCII spaces and first array entry. Missing/malformed credentials produce bare `WWW-Authenticate: Bearer`; expired/invalid JWT produces `Bearer error="invalid_token"` with the JWT cause. Infrastructure/configuration errors propagate unchanged.

`CookieAuthModule.forRoot(config?, options?, additionalStrategies?)` owns one registry and a shared cookie reader/writer configuration. `CookieAuthStrategy` permits absent cookies only with `requireAccessToken: false`; malformed present cookies never become anonymous. Unknown verifier failures retain their authentication-required wrapping. `CookieManager.create(config?)` and its DI class token preserve Secure/HttpOnly/SameSite defaults, second-based TTL precedence, encoding/validation, ordered Set-Cookie append and clear behavior.

`RefreshTokenModule.forRoot()` aliases the exact JWT-owned `RefreshTokenService`, not a second store, service or crypto configuration. `RefreshTokenStrategy` reads `body.refreshToken`, then Authorization bearer, then `x-refresh-token`; malformed present body does not fall back. The four-method `RefreshTokenServicePort` supports application-owned custom services but still requires a JWT verifier for rotated access tokens and normalized subject. JWT owns rotation, replay, revocation, algorithms and keys.

## Passport and compatibility

Use `createPassportJsStrategyBridge` from `@fluojs/passport`, then register its named strategy and providers with this module or the cookie module's additional strategies. The bridge owns request-local action binding and lifecycle cancellation; it does not provide Passport middleware/session augmentation.

Existing `@fluojs/passport` imports remain aliases of these classes, decorators and errors. Framework service identity, metadata keys and `Symbol.for` tokens remain unchanged, including compatible duplicate-copy guard resolution. `AuthModuleOptions` equals `PassportModuleOptions`. See [migration](../../docs/getting-started/migrate-auth-ownership.md).

## Evidence

[Auth & JWT Contract](../../docs/architecture/auth-and-jwt.md), [runnable example](../../examples/auth-jwt-passport), [`auth-http.compatibility.test.ts`](../passport/src/auth-http.compatibility.test.ts), and the retained [Passport regression suite](../passport/src) cover canonical and compatibility behavior.
