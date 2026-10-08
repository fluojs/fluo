# Authentication Ownership Migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-auth-ownership.ko.md"><kbd>한국어</kbd></a></p>

## Scope

This additive separation preserves existing imports and runtime contracts. It changes canonical ownership, not authentication policy. Existing Passport.js bridge, bearer challenge, cookie and refresh behavior remain unchanged.

## Imports

| Responsibility | Canonical import | Compatibility |
| --- | --- | --- |
| Principal, neutral AuthStrategy&lt;Context&gt;, results and authentication errors | `@fluojs/auth` | HTTP Principal and Passport error/result imports remain available |
| Account-linking policy and token | `@fluojs/auth` | Existing Passport exports share class/token identity |
| HTTP AuthStrategy, guards, decorators and registration | `@fluojs/auth-http` | `@fluojs/passport` retains `AuthStrategy` with `GuardContext` input |
| Bearer JWT, cookie and HTTP refresh integration | `@fluojs/auth-http` | Prior Passport exports alias the same classes |
| Signing, verification, JwtPrincipal and refresh rotation/replay | `@fluojs/jwt` | Unchanged |
| Passport.js provider bundle and action binding | `@fluojs/passport` | Unchanged |

```ts
import { type Principal, AuthenticationFailedError } from '@fluojs/auth';
import { AuthModule, type AuthStrategy, UseAuth } from '@fluojs/auth-http';
import { createPassportJsStrategyBridge } from '@fluojs/passport';
```

Change general HTTP imports from Passport to auth-http and use `AuthModule.forRoot(...)`. `AuthModule === PassportModule`; an application class also called AuthModule can alias the import or use another local name. Do not register both modules for the same registry. Cookie composition still uses one `CookieAuthModule.forRoot(config, options, additionalStrategies)`.

## Identity and dependency direction

The neutral root depends only on core. HTTP and JWT consume the shared mutable Principal; JwtPrincipal extends it without reducing verified-claim normalization. auth-http consumes auth, HTTP, JWT, DI and runtime. Passport consumes the adapter for its bridge and compatibility exports. There is no reverse auth dependency or cross-package cycle.

Old and new class tokens, decorator metadata and errors can be mixed in one application. The guard service identity, legacy `@fluojs/passport` error owner/version and `Symbol.for` keys remain intact. `isAuthError` aliases `isPassportError`; unrelated code-string lookalikes and incompatible copies remain rejected.

## Behavior and limits

Neutral strategies do not automatically support new protocols. HTTP custom strategies keep `authenticate(GuardContext)` and do not need inheritance. Optional auth requires an explicit unauthenticated result without scopes; bearer missing credentials still throw. A committed handled result remains terminal. Roles are normalized and carried, not automatically authorized.

JWT still owns crypto, keys, claims and refresh store/rotation/replay. `RefreshTokenModule.forRoot()` aliases its existing service. Custom refresh ports still require JWT access-token verification. Passport.js actions, raw request delegation, timeout and shutdown cancellation remain bridge-owned; middleware/session augmentation is not added.

See [auth](../../packages/auth/README.md), [auth-http](../../packages/auth-http/README.md), [Auth & JWT Contract](../architecture/auth-and-jwt.md) and the canonical [example](../../examples/auth-jwt-passport).
