# @fluojs/passport

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Strategy-agnostic auth execution layer for fluo. It routes any `AuthStrategy` through a generic `AuthGuard` into the request context, populating `requestContext.principal`.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/passport
```

## When to Use

- When you need to protect routes with authentication and authorization (RBAC/Scopes).
- When using multiple auth strategies (e.g., JWT, Cookies, API Keys) in the same application.
- When you need a bridge to existing Passport.js strategies.
- When implementing refresh token rotation or account-linking policies.

## Quick Start

### 1. Register Modules

Define your strategies and register them using `PassportModule.forRoot(...)`.

```typescript
import { Inject, Module } from '@fluojs/core';
import type { GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier, JwtModule } from '@fluojs/jwt';
import { AuthenticationRequiredError, PassportModule, type AuthStrategy } from '@fluojs/passport';

@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authorization = context.requestContext.request.headers.authorization;
    const [scheme, token] = typeof authorization === 'string' ? authorization.split(' ') : [];

    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationRequiredError('Bearer access token is required.');
    }

    return this.verifier.verifyAccessToken(token);
  }
}

@Module({
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      audience: 'my-app',
      issuer: 'my-api',
      secret: 'your-secure-secret',
    }),
    PassportModule.forRoot(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: BearerJwtStrategy }],
    ),
  ],
  providers: [BearerJwtStrategy],
})
export class AuthModule {}
```

JWT-based passport strategies require both pieces of module wiring: `JwtModule.forRoot(...)` registers `DefaultJwtVerifier`, and `PassportModule.forRoot(...)` registers the named strategy that `@UseAuth('jwt')` resolves. Returning the `DefaultJwtVerifier.verifyAccessToken(...)` result preserves the normalized principal contract (`subject`, `claims`, `issuer`, `audience`, `roles`, and `scopes`) that `AuthGuard` writes to `requestContext.principal`.

### 2. Protect Routes

Use `@UseAuth()` and `@RequireScopes()` to enforce authentication.

```typescript
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { UseAuth, RequireScopes } from '@fluojs/passport';

@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')
  @RequireScopes('profile:read')
  async getProfile(input: never, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
```

## Common Patterns

### Passport.js Bridge

Easily adapt any standard Passport.js strategy (like `passport-google-oauth20`) to work with fluo's DI and async lifecycle.

```typescript
const googleBridge = createPassportJsStrategyBridge('google', GoogleStrategy, {
  mapPrincipal: ({ user }) => ({ subject: user.id, claims: user }),
});
```

The bridge settles each Passport.js strategy execution exactly once. A strategy must call one of the bound Passport actions (`success`, `fail`, `redirect`, `pass`, or `error`); promise rejections, promise completion without an action, and callback-style executions that exceed the bounded action timeout become authentication failures instead of leaving the request unresolved. Custom `mapPrincipal` functions must return a valid fluo `Principal` with a non-empty `subject` and object `claims`.

### Cookie Auth Preset

Use `CookieAuthModule.forRoot(...)` when your app authenticates requests from HTTP cookies.

```typescript
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import {
  CookieAuthModule,
  CookieAuthStrategy,
  COOKIE_AUTH_STRATEGY_NAME,
  PassportModule,
} from '@fluojs/passport';

@Module({
  imports: [
    CookieAuthModule.forRoot(),
    JwtModule.forRoot({
      algorithms: ['HS256'],
      secret: 'your-secure-secret',
    }),
    PassportModule.forRoot(
      { defaultStrategy: COOKIE_AUTH_STRATEGY_NAME },
      [{ name: COOKIE_AUTH_STRATEGY_NAME, token: CookieAuthStrategy }],
    ),
  ],
})
export class AuthModule {}
```

Import `CookieAuthModule.forRoot(...)`, `JwtModule.forRoot(...)`, and `PassportModule.forRoot(...)` together when you want cookie-auth support in an application module. The cookie preset provides `CookieAuthStrategy` and cookie options; JWT verification still comes from `@fluojs/jwt`, and the passport registry still comes from `PassportModule.forRoot(...)`.

`CookieAuthStrategy` preserves the normalized JWT principal contract from `@fluojs/jwt`, including `subject`, `claims`, `issuer`, `audience`, `roles`, and `scopes`.

Cookie access tokens must be non-empty strings. Missing cookies can resolve to `{ authenticated: false }` only when `requireAccessToken: false`; malformed present cookie values always fail authentication before JWT verification.

Protected routes must keep using `@UseAuth(...)`. If you configure `requireAccessToken: false`, a missing cookie resolves to an explicit unauthenticated result instead of an anonymous principal, so protected routes still reject the request.

Use `@UseOptionalAuth(...)` only on routes that intentionally support both signed-in and guest callers:

```typescript
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { UseOptionalAuth } from '@fluojs/passport';

@Controller('/session')
export class SessionController {
  @Get('/')
  @UseOptionalAuth('cookie')
  getSession(_input: never, ctx: RequestContext) {
    return { subject: ctx.principal?.subject ?? null };
  }
}
```

### Refresh Token Lifecycle

The package provides a built-in `RefreshTokenStrategy` plus the `RefreshTokenModule` and `RefreshTokenService` contract for secure token rotation and revocation.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Post, type RequestContext } from '@fluojs/http';
import {
  PassportModule,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
  RefreshTokenStrategy,
  UseAuth,
} from '@fluojs/passport';

@Module({
  imports: [
    RefreshTokenModule.forRoot(MyRefreshTokenService),
    PassportModule.forRoot(
      { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
      [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
    ),
  ],
  providers: [MyRefreshTokenService],
})
export class AuthModule {}

@Controller('/auth')
export class AuthController {
  @Post('/refresh')
  @UseAuth('refresh-token')
  async refresh(input: never, ctx: RequestContext) {
    return ctx.principal; // Contains new token pair
  }
}
```

Import `RefreshTokenModule.forRoot(...)` alongside `PassportModule.forRoot(...)` so the refresh-token strategy and shared `REFRESH_TOKEN_SERVICE` alias are available in the same module wiring.

`RefreshTokenStrategy` reads tokens from `body.refreshToken`, `Authorization: Bearer ...`, or `x-refresh-token`; malformed non-string tokens fail authentication. After rotation, it trusts the normalized access-token principal subject returned by `@fluojs/jwt`. `JwtRefreshTokenAdapter` requires a `secret` and a backing store; `store: 'memory'` is for development and single-instance deployments only, and rotation detects reuse through the store consume contract.

### Account Linking and Status

Use `createConservativeAccountLinkPolicy(...)` and `resolveAccountLinking(...)` to model identity-link decisions. The default conservative policy links one unambiguous existing account link or user-confirmed matches, reports multiple existing links as conflicts, and otherwise creates, skips, rejects, or reports conflicts deterministically.

`createPassportPlatformStatusSnapshot(...)` and `createPassportPlatformDiagnosticIssues(...)` expose readiness/health diagnostics for registered strategies, default strategy configuration, presets, and refresh-token store readiness.

## Public API Overview

### Decorators
- `@UseAuth(strategyName)`: Attaches `AuthGuard` and sets the active strategy.
- `@UseOptionalAuth(strategyName)`: Attaches `AuthGuard` but allows routes without scopes to continue when the strategy reports missing credentials.
- `@RequireScopes(...scopes)`: Enforces specific scope requirements.

### Core Classes
- `PassportModule`: Module entry point for passport strategy wiring.
- `AuthGuard`: The HTTP guard that executes the strategy chain.
- `CookieAuthModule`: Module entry point for the built-in cookie-auth preset.
- `CookieManager`: Utility for managing HttpOnly auth cookies.
- `RefreshTokenModule`: Module entry point for the built-in refresh-token preset.
- `JwtRefreshTokenAdapter`: Bridges `@fluojs/jwt` refresh logic to the passport interface.
- `createPassportJsStrategyBridge(...)`: Adapts Passport.js strategies to fluo `AuthStrategy`.
- Cookie helpers: `createCookieAuthPreset`, `createCookieAuthStrategyRegistration`, `createCookieManager`, `normalizeCookieAuthOptions`.
- Refresh helpers: `createRefreshTokenStrategyRegistration`.
- Status/diagnostics helpers: `createPassportPlatformStatusSnapshot`, `createPassportPlatformDiagnosticIssues`.

### Interfaces
- `AuthStrategy`: The contract for implementing custom authentication logic.
- `AccountLinkPolicy`: Extension point for identity-linking decisions.

`UseOptionalAuth` only bypasses missing credentials when no scopes are required; scoped routes still need a principal. Passport.js bridge `redirect()` commits the response and skips the protected handler, while `pass()` and strategy completion without a Passport action are authentication failures.

## Related Packages

- `@fluojs/jwt`: The underlying token core for JWT-based strategies.
- `@fluojs/http`: Provides the routing and guard infrastructure.

## Example Sources

- `packages/passport/src/guard.test.ts`: Guard execution and scope enforcement patterns.
- `packages/passport/src/adapters/passport-js.ts`: Implementation of the Passport.js bridge.
- `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`: JWT strategy implementation.
