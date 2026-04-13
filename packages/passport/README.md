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

### 1. Register Providers

Define your strategies and register them using `createPassportProviders`.

```typescript
import { Module } from '@fluojs/core';
import { createPassportProviders } from '@fluojs/passport';
import { MyJwtStrategy } from './jwt.strategy';

@Module({
  providers: [
    MyJwtStrategy,
    ...createPassportProviders(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: MyJwtStrategy }]
    ),
  ],
})
export class AuthModule {}
```

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

### Refresh Token Lifecycle

The package provides a built-in `RefreshTokenStrategy` and `RefreshTokenService` to handle secure token rotation and revocation.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Post, type RequestContext } from '@fluojs/http';
import { UseAuth, createRefreshTokenProviders } from '@fluojs/passport';

@Module({
  providers: [
    MyRefreshTokenService,
    ...createRefreshTokenProviders(MyRefreshTokenService),
  ],
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

`createRefreshTokenProviders(...)` returns standard DI alias providers, so resolving `REFRESH_TOKEN_SERVICE` yields the same concrete service instance you registered.

## Public API Overview

### Decorators
- `@UseAuth(strategyName)`: Attaches `AuthGuard` and sets the active strategy.
- `@RequireScopes(...scopes)`: Enforces specific scope requirements.

### Core Classes
- `AuthGuard`: The HTTP guard that executes the strategy chain.
- `CookieManager`: Utility for managing HttpOnly auth cookies.
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
- `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`: Canonical JWT strategy implementation.
