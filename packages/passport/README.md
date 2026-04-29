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
import { Module } from '@fluojs/core';
import { PassportModule } from '@fluojs/passport';
import { MyJwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.forRoot(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: MyJwtStrategy }]
    ),
  ],
  providers: [MyJwtStrategy],
})
export class AuthModule {}
```

Register strategies through `PassportModule.forRoot(...)`.

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

The bridge settles each Passport.js strategy execution exactly once. A strategy must call one of the bound Passport actions (`success`, `fail`, `redirect`, `pass`, or `error`); promise rejections and promise completion without an action become authentication failures instead of leaving the request unresolved. Custom `mapPrincipal` functions must return a valid fluo `Principal` with a non-empty `subject` and object `claims`.

### Cookie Auth Preset

Use `CookieAuthModule.forRoot(...)` when your app authenticates requests from HTTP cookies.

```typescript
import { Module } from '@fluojs/core';
import {
  CookieAuthModule,
  CookieAuthStrategy,
  COOKIE_AUTH_STRATEGY_NAME,
  PassportModule,
} from '@fluojs/passport';

@Module({
  imports: [
    CookieAuthModule.forRoot(),
    PassportModule.forRoot(
      { defaultStrategy: COOKIE_AUTH_STRATEGY_NAME },
      [{ name: COOKIE_AUTH_STRATEGY_NAME, token: CookieAuthStrategy }],
    ),
  ],
})
export class AuthModule {}
```

Import `CookieAuthModule.forRoot(...)` alongside `PassportModule.forRoot(...)` when you want cookie-auth support in an application module.

`CookieAuthStrategy` preserves the normalized JWT principal contract from `@fluojs/jwt`, including `subject`, `claims`, `issuer`, `audience`, `roles`, and `scopes`.

Protected routes must keep using `@UseAuth(...)`. If you configure `requireAccessToken: false`, a missing cookie now resolves to an explicit unauthenticated result instead of an anonymous principal, so protected routes still reject the request.

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

The package provides a built-in `RefreshTokenStrategy` and `RefreshTokenService` to handle secure token rotation and revocation.

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

### Interfaces
- `AuthStrategy`: The contract for implementing custom authentication logic.
- `AccountLinkPolicy`: Extension point for identity-linking decisions.

## Related Packages

- `@fluojs/jwt`: The underlying token core for JWT-based strategies.
- `@fluojs/http`: Provides the routing and guard infrastructure.

## Example Sources

- `packages/passport/src/guard.test.ts`: Guard execution and scope enforcement patterns.
- `packages/passport/src/adapters/passport-js.ts`: Implementation of the Passport.js bridge.
- `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`: JWT strategy implementation.
