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

Use `@UseAuth()` to enforce authentication and `@RequireScopes()` to enforce authorization.

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

`createPassportJsStrategyBridge(...)` is an intentionally documented manual-composition compatibility helper. It returns the provider bundle and matching `AuthStrategyRegistration` needed by `PassportModule.forRoot(...)`; applications should register the bridge providers in the same module that imports `PassportModule` and pass `googleBridge.strategy` to the strategy registry:

```typescript
@Module({
  imports: [
    PassportModule.forRoot({ defaultStrategy: 'google' }, [googleBridge.strategy]),
  ],
  providers: [GoogleStrategy, ...googleBridge.providers],
})
export class AuthModule {}
```

This bridge helper is the official exception to the module-facade rule for Passport.js adapters because third-party strategy instances must be bound as providers before `AuthGuard` can execute them. It does not replace `PassportModule`, `@UseAuth(...)`, or `AuthGuard` as the application-facing authentication surface.

The bridge settles each Passport.js strategy execution exactly once. A strategy must call one of the bound Passport actions (`success`, `fail`, `redirect`, `pass`, or `error`); promise rejections, promise completion without an action, and callback-style executions that exceed the bounded action timeout become authentication failures instead of leaving the request unresolved. The bridge never consumes an `authenticate()` return value: only a bound action settles the request. Any `AuthStrategyResult` with `handled: true` is fully terminal after the strategy commits a response, even if it also includes a `principal`; `AuthGuard` skips principal validation, scope checks, `requestContext.principal` assignment, and the protected handler. Custom `mapPrincipal` functions must return a valid fluo `Principal` with a non-empty `subject` and object `claims`.

The bridge calls `authenticate(request, options)` with the active platform adapter's raw host request when one exists, and with the normalized fluo request otherwise. It never creates a Passport-initialized host request, so strategies that depend on Passport middleware augmentation (`request.logIn`, `request.user`, session state) or on adapter-specific request fields need the compatibility checklist in [NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.md#passportjs-bridge-migration) before cutover.

`actionTimeoutMs` defaults to `30_000` milliseconds and must be a non-negative finite number. Set it to `0` to schedule timeout settlement on the next timer turn. Negative, `NaN`, and infinite values throw `RangeError` when the bridge strategy is constructed instead of disabling the settlement bound.

Application shutdown cancels every in-flight bridge execution, clears its action timeout, and rejects the pending authentication instead of retaining request state through the configured timeout. The bridge participates in the ordinary application lifecycle, so this cancellation runs when the application or application context is closed.

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
      global: true,
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

Import `CookieAuthModule.forRoot(...)`, `JwtModule.forRoot(...)`, and `PassportModule.forRoot(...)` together when you want cookie-auth support in an application module. `CookieAuthModule` and `JwtModule` are sibling imports in this graph, so set the documented `global: true` JWT option to make `DefaultJwtVerifier` visible when the cookie module resolves `CookieAuthStrategy`. The cookie preset provides `CookieAuthStrategy` and cookie options; JWT verification still comes from `@fluojs/jwt`, and the passport registry still comes from `PassportModule.forRoot(...)`.

`CookieAuthModule.forRoot(...)` is the canonical module-first entrypoint for application registration. `createCookieAuthPreset(...)` remains public as a compatibility bundle for manual provider composition; it returns the same cookie-auth providers plus the matching strategy registration for hosts that assemble provider graphs themselves. Prefer the module facade in application docs, generated code, and ordinary app modules.

`CookieAuthStrategy` preserves the normalized JWT principal contract from `@fluojs/jwt`, including `subject`, `claims`, `issuer`, `audience`, `roles`, and `scopes`.

Cookie access tokens must be non-empty strings. Missing cookies can resolve to `{ authenticated: false }` only when `requireAccessToken: false`; malformed present cookie values always fail authentication before JWT verification.

Cookie verification failures keep their documented classification: expired access tokens raise `AuthenticationExpiredError`, invalid access tokens raise `AuthenticationFailedError`, and missing or malformed access-token cookies raise `AuthenticationRequiredError`. The originating `@fluojs/jwt` error is preserved as the `cause`, while `AuthGuard` still answers HTTP `401` for every variant.

`CookieManagerConfig.cookieOptions` accepts `SetCookieOptions`. Its `accessTokenTtlSeconds` and `refreshTokenTtlSeconds` fields supply the default `Max-Age` for the matching token cookie when the positional TTL argument is omitted; an explicit positional TTL always wins.

`CookieManager` appends access-token and refresh-token `Set-Cookie` values without overwriting cookies that were already placed on the response, even when the underlying adapter stores the existing header with different casing such as `set-cookie`.

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
import { JwtModule } from '@fluojs/jwt';
import {
  PassportModule,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
  RefreshTokenStrategy,
  UseAuth,
} from '@fluojs/passport';

@Controller('/auth')
export class AuthController {
  @Post('/refresh')
  @UseAuth('refresh-token')
  async refresh(input: never, ctx: RequestContext) {
    return ctx.principal; // Contains new token pair
  }
}

@Module({
  controllers: [AuthController],
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      global: true,
      secret: 'your-access-token-secret',
    }),
    RefreshTokenModule.forRoot(MyRefreshTokenService),
    PassportModule.forRoot(
      { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
      [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
    ),
  ],
})
export class AuthModule {}
```

Import `JwtModule.forRoot(...)`, `RefreshTokenModule.forRoot(...)`, and `PassportModule.forRoot(...)` together. `RefreshTokenStrategy` belongs to `RefreshTokenModule`, which is a sibling of `JwtModule` in this graph, so this example sets the documented `global: true` option to make `DefaultJwtVerifier` visible when the refresh module resolves the strategy. `RefreshTokenModule.forRoot(MyRefreshTokenService)` registers the service class inside the refresh module and exports it through the shared `REFRESH_TOKEN_SERVICE` alias. Do not also list `MyRefreshTokenService` in the application module's `providers`; that duplicates a provider registration, which bootstrap warns about by default and can reject under `duplicateProviderPolicy: 'throw'`. Inject the exported `REFRESH_TOKEN_SERVICE` alias where application code needs the service, keep the service class's own dependencies visible to the refresh module graph, and register `AuthController` in the application module so the refresh route exists. `PassportModule` registers the named strategy resolved by `@UseAuth('refresh-token')`.

A successful exchange resolves `ctx.principal` to the `RefreshTokenPrincipal` shape: the rotated pair is nested under `claims.accessToken` and `claims.refreshToken`, with the verified `subject` at the top level. The separate exported `RefreshTokenAuthResult` type describes the application-facing exchange payload a refresh endpoint returns to clients.

`RefreshTokenStrategy` reads tokens from `body.refreshToken`, `Authorization: Bearer ...`, or `x-refresh-token`; malformed non-string tokens fail authentication. After rotation, it trusts the normalized access-token principal subject returned by `@fluojs/jwt`. `JwtRefreshTokenAdapter` requires a `secret` and a backing store; `store: 'memory'` is for development and single-instance deployments only, and rotation detects reuse through the store consume contract.

### Account Linking and Status

Use `createConservativeAccountLinkPolicy(...)` and `resolveAccountLinking(...)` to model identity-link decisions. The default conservative policy links one unambiguous existing account link or user-confirmed matches, reports multiple existing links as conflicts, and otherwise creates, skips, rejects, or reports conflicts deterministically.

`createPassportPlatformStatusSnapshot(...)` and `createPassportPlatformDiagnosticIssues(...)` expose readiness/health diagnostics for registered strategies, default strategy configuration, presets, and refresh-token store readiness.

## Public API Overview

### Decorators
- `@UseAuth(strategyName)`: Attaches `AuthGuard` and sets the active strategy.
- `@UseOptionalAuth(strategyName)`: Attaches `AuthGuard` but allows routes without scopes to continue when the strategy reports missing credentials.
- `@RequireScopes(...scopes)`: Enforces specific scope requirements.

### Module and Guard Entry Points
- `PassportModule`: Module entry point for passport strategy wiring.
- `AuthGuard`: The HTTP guard that executes the strategy chain and enforces required scopes.
- `PassportModuleOptions`, `AuthStrategyRegistration`, `AuthStrategyRegistry`, `AuthGuardContract`: Strategy registry and guard wiring contracts.

### Strategy Contracts and Errors
- `AuthStrategy`: The contract for implementing custom authentication logic.
- `AuthRequirement`: Route-level metadata for the selected strategy, optional-auth mode, and required scopes.
- `AuthStrategyResult`, `AuthOptionalResult`, `AuthHandledResult`: Strategy return variants for principals, intentionally missing credentials, and fully handled responses.
- `AuthStrategyResolutionError`, `AuthenticationRequiredError`, `AuthenticationFailedError`, `AuthenticationExpiredError`: Public errors used by guards and strategy adapters for registry misses, missing credentials, invalid credentials, and expired credentials.

### Metadata and Scope Helpers
- `defineAuthRequirement(...)`, `getOwnAuthRequirement(...)`, `getAuthRequirement(...)`: Public helpers for reading and writing auth requirement metadata when integrating custom decorators or tooling with `AuthGuard`.
- Scope requirements are normally authored with `@RequireScopes(...)`; lower-level scope normalization helpers remain internal and are not part of the package root export.

### Cookie Auth Preset
- `CookieAuthModule`: Module entry point for the built-in cookie-auth preset.
- `CookieAuthStrategy`, `COOKIE_AUTH_STRATEGY_NAME`, `COOKIE_AUTH_OPTIONS`, `DEFAULT_COOKIE_AUTH_OPTIONS`, `DEFAULT_COOKIE_OPTIONS`: Cookie strategy wiring tokens, preset defaults, and response-cookie defaults.
- `CookieAuthOptions`, `CookieAuthPresetConfig`, `CookieManagerConfig`, `CookieOptions`, `SetCookieOptions`: Cookie strategy and response cookie configuration types. `CookieManagerConfig.cookieOptions` accepts `SetCookieOptions`, whose per-token TTL fields become default cookie `Max-Age` values.
- `CookieManager`: Utility for setting and clearing HttpOnly access/refresh token cookies.
- Cookie helpers: `createCookieAuthPreset` (compatibility-only manual provider bundle), `createCookieAuthStrategyRegistration` (low-level registration helper), `createCookieManager`, `normalizeCookieAuthOptions`.

### Refresh Token Preset
- `RefreshTokenModule`: Module entry point for the built-in refresh-token preset.
- `RefreshTokenStrategy`, `REFRESH_TOKEN_STRATEGY_NAME`, `REFRESH_TOKEN_SERVICE`: Refresh-token strategy and service alias wiring.
- `RefreshTokenService`, `RefreshTokenInput`, `RefreshTokenAuthResult`, `RefreshTokenPrincipal`: Application service contract, exchange payload shapes, and the principal shape resolved onto `ctx.principal` after a successful exchange.
- `JwtRefreshTokenAdapter`: Bridges `@fluojs/jwt` refresh logic to the passport interface.
- `REFRESH_TOKEN_MODULE_OPTIONS`, `RefreshTokenModuleOptions`: JWT-backed refresh-token adapter configuration token and options, including the required `secret` and `store` contract.
- Refresh helpers: `createRefreshTokenStrategyRegistration`.

### Passport.js Bridge
- `createPassportJsStrategyBridge(...)`: Compatibility helper that adapts Passport.js strategies to fluo `AuthStrategy` and returns providers plus the matching strategy registration for `PassportModule.forRoot(...)`.
- `PassportJsAuthStrategy`, `PassportJsStrategyLike`, `PassportJsPrincipalMapperInput`, `PassportJsPrincipalMapper`, `PassportJsAuthStrategyOptions`, `PassportJsStrategyBridge`: Bridge strategy, mapper, configuration, and provider bundle contracts.

### Account Linking
- `ACCOUNT_LINKING_POLICY`: DI token for registering an account-linking policy implementation.
- `createConservativeAccountLinkPolicy(...)`, `resolveAccountLinking(...)`: Conservative default policy and resolver for identity-link decisions.
- `AccountIdentity`, `AccountLinkCandidate`, `AccountLinkAttempt`, `AccountLinkContext`, `AccountLinkPolicy`, `AccountLinkPolicyDecision`, `AccountLinkingOptions`, `AccountLinkingResolution`: Account-linking input, policy, and result contracts.
- `AccountLinkConflictError`, `AccountLinkRejectedError`: Errors raised for ambiguous or rejected account-linking attempts.

### Status and Diagnostics
- `createPassportPlatformStatusSnapshot(...)`: Creates a runtime platform snapshot for strategy registry, preset readiness, ownership, and telemetry labels.
- `createPassportPlatformDiagnosticIssues(...)`: Emits diagnostic issues for empty registries, missing default strategies, cookie preset readiness, and refresh-token backing store readiness.
- `PassportPlatformStatusSnapshot`, `PassportStatusAdapterInput`: Status helper input/output contracts.

`UseOptionalAuth` only bypasses missing credentials when no scopes are required; scoped routes still need a principal. `AuthHandledResult` with `handled: true` is terminal only after the strategy commits the response, including results that also carry a `principal`. Passport.js bridge `redirect()` commits the response and skips the protected handler, while `pass()` and strategy completion without a Passport action are authentication failures. Refresh-token backing store status and diagnostic surfaces redact secret-like reason strings before exposing readiness, health, details, or diagnostic causes.

## Related Packages

- `@fluojs/jwt`: The underlying token core for JWT-based strategies.
- `@fluojs/http`: Provides the routing and guard infrastructure.

## Example Sources

- `packages/passport/src/guard.test.ts`: Guard execution and scope enforcement patterns.
- `packages/passport/src/adapters/passport-js.ts`: Implementation of the Passport.js bridge.
- `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`: JWT strategy implementation.
